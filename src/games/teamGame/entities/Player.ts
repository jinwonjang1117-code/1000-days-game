import Phaser from 'phaser'
import type { LifeState } from '../gameplay/lives'
import {
  createLifeState,
  applyHit as applyHitToLifeState,
  grantLife as grantLifeToState,
  increaseMaxLives as increaseMaxLivesForState,
  decreaseMaxLives as decreaseMaxLivesForState,
  crushMaxLivesTo1 as crushMaxLivesTo1ForState,
  respawnForNextLevel as respawnLifeStateForNextLevel,
  isInvincible as isLifeStateInvincible,
  INVINCIBILITY_DURATION_MS,
} from '../gameplay/lives'
import type { AttackState } from '../gameplay/attack'
import { createAttackState, canFire, recordFire, DEFAULT_FIRE_RATE_MS } from '../gameplay/attack'
import type { FlickerController } from '../gameplay/flicker'
import { createFlickerController } from '../gameplay/flicker'
import type { PlayerStats, BoostItemId, StrongItemId } from '../gameplay/items'
import { createDefaultStats, STAT_ITEMS } from '../gameplay/items'
import type { KeyState, PlayerState, Vec2 } from '../net/syncProtocol'

const PLAYER_SIZE = 40
const GRAY_OUT_ALPHA = 0.3

export interface PlayerOptions {
  /** Host owns its own LifeState and an Arcade body it moves directly. */
  simulated: boolean
}

/**
 * A player square — either "simulated" (host: owns an Arcade body + its own
 * LifeState, driven by local or forwarded input) or render-only (joiner:
 * no physics body, position/lives/invincibility all come from a received
 * PlayerState and get eased toward each frame). One class either way so the
 * visual/life-state bookkeeping (label, flicker, gray-out) isn't duplicated
 * between the host and joiner code paths that use it. Still a plain colored
 * square — swap the Rectangle for a Sprite once real art exists; nothing
 * else here should need to change.
 */
export default class Player {
  readonly square: Phaser.GameObjects.Rectangle
  private readonly flicker: FlickerController
  private readonly body: Phaser.Physics.Arcade.Body | null

  // Simulated (host) only.
  private lifeState: LifeState = createLifeState()
  private attackState: AttackState = createAttackState()
  /** Last non-zero movement direction — persists while standing still, since aim has no other input source. */
  private facingAngle = 0
  /** Room-clear item effects picked up so far this run — see gameplay/items.ts. */
  private stats: PlayerStats = createDefaultStats()

  // Render-only (joiner) only.
  private target: Vec2 | null = null

  constructor(scene: Phaser.Scene, x: number, y: number, color: number, options: PlayerOptions) {
    this.square = scene.add.rectangle(x, y, PLAYER_SIZE, PLAYER_SIZE, color)

    if (options.simulated) {
      scene.physics.add.existing(this.square)
      this.body = this.square.body as Phaser.Physics.Arcade.Body
      this.body.setCollideWorldBounds(true)
    } else {
      this.body = null
    }

    this.flicker = createFlickerController(scene, this.square)
  }

  get x(): number {
    return this.square.x
  }

  get y(): number {
    return this.square.y
  }

  get isOut(): boolean {
    return this.lifeState.isOut
  }

  /** Current lives / heart-container cap — kept in sync for a render-only player too (see applyReceivedState), so a HUD can read either kind of Player the same way. */
  getLives(): number {
    return this.lifeState.lives
  }

  getMaxLives(): number {
    return this.lifeState.maxLives
  }

  // ---- Simulated (host) ----

  /** Diagonal-normalized so pressing two directions isn't faster than one. No-ops while out. */
  setVelocityFromKeys(keys: KeyState, speed: number) {
    if (!this.body) {
      return
    }
    if (this.lifeState.isOut) {
      this.body.setVelocity(0, 0)
      return
    }

    const rawX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
    const rawY = (keys.down ? 1 : 0) - (keys.up ? 1 : 0)
    const length = Math.hypot(rawX, rawY)
    const effectiveSpeed = speed * this.stats.moveSpeedMultiplier
    const vx = length > 0 ? (rawX / length) * effectiveSpeed : 0
    const vy = length > 0 ? (rawY / length) * effectiveSpeed : 0
    this.body.setVelocity(vx, vy)

    if (length > 0) {
      this.facingAngle = Math.atan2(rawY, rawX)
    }
  }

  /** No keyboard-aim input exists, so this is just whichever way was last moved. */
  getFacingAngle(): number {
    return this.facingAngle
  }

  applyHit(now: number) {
    this.lifeState = applyHitToLifeState(this.lifeState, now, INVINCIBILITY_DURATION_MS + this.stats.invincibilityBonusMs)
  }

  /** Item-pickup effect (Heart). */
  grantLife() {
    this.lifeState = grantLifeToState(this.lifeState)
  }

  /** Item-pickup effect (Heart Container) / passive per-level growth (DESIGN.md §3). */
  increaseMaxLives(amount: number) {
    this.lifeState = increaseMaxLivesForState(this.lifeState, amount)
  }

  /** Devil's Room cost (Blood Pact / Turret Pact) — floors at 1, see gameplay/lives.ts. */
  decreaseMaxLives(amount: number) {
    this.lifeState = decreaseMaxLivesForState(this.lifeState, amount)
  }

  /** Shared Consumption's cost — crushes the cap straight to 1. */
  crushMaxLivesTo1() {
    this.lifeState = crushMaxLivesTo1ForState(this.lifeState)
  }

  /** Called when a new level starts (DESIGN.md §3) — no-ops unless this player was out, in which case it comes back with a fixed 3 lives, not its previous count. */
  respawnForNextLevel() {
    this.lifeState = respawnLifeStateForNextLevel(this.lifeState)
  }

  /** Item-pickup effect (any boost or boss-tier item) — looks up its effect and applies it to this player's stats. 'fart' is a no-op by design (see gameplay/items.ts). */
  applyItem(itemId: BoostItemId | StrongItemId) {
    this.stats = STAT_ITEMS[itemId].apply(this.stats)
  }

  getStats(): PlayerStats {
    return this.stats
  }

  /** potatoDamage with Blood Pact's multiplier folded in (1 outside Devil's Room) — use this instead of reading stats.potatoDamage directly anywhere outgoing damage is computed (Buddy stays a deliberate exception, per its own note in GameSimulation). */
  getEffectiveDamage(): number {
    return Math.round(this.stats.potatoDamage * this.stats.devilDamageMultiplier)
  }

  /** Devil's Room — Blood Pact's benefit half (the cost half is decreaseMaxLives, applied to whichever player is paying). */
  applyDevilBloodPact() {
    this.stats = { ...this.stats, devilDamageMultiplier: this.stats.devilDamageMultiplier + 0.5 }
  }

  /** Devil's Room — Turret Pact's benefit half: one more Orbiting Shield, and every shield this player owns (GameSimulation reconciles the live entity list same as a normal Orbiting Shield pickup) now also fires and renders in turret mode. */
  applyDevilTurretPact() {
    this.stats = { ...this.stats, shieldCount: this.stats.shieldCount + 1, hasTurretShields: true }
  }

  /** Devil's Room — Shared Consumption's benefit half: replays `ids` (the teammate's own strong-item pickup history) onto this player's stats, same effect as if they'd picked each one up themselves. Order-sensitive for stacking items, so callers must pass the teammate's history in the order they actually collected it. */
  applyDevilSharedConsumption(ids: StrongItemId[]) {
    for (const id of ids) {
      this.applyItem(id)
    }
  }

  /** Instantly moves and zeroes velocity — for room transitions, not normal movement. */
  teleport(x: number, y: number) {
    if (!this.body) {
      return
    }
    this.square.setPosition(x, y)
    this.body.setVelocity(0, 0)
  }

  /** Returns true (and starts cooldown) if firing is currently allowed. No-ops while out. */
  tryFire(now: number): boolean {
    const fireRateMs = DEFAULT_FIRE_RATE_MS * this.stats.potatoFireRateMultiplier
    if (!this.body || this.lifeState.isOut || !canFire(this.attackState, now, fireRateMs)) {
      return false
    }
    this.attackState = recordFire(this.attackState, now)
    return true
  }

  getNetworkState(now: number): PlayerState {
    return {
      pos: { x: this.square.x, y: this.square.y },
      lives: this.lifeState.lives,
      maxLives: this.lifeState.maxLives,
      isOut: this.lifeState.isOut,
      isInvincible: isLifeStateInvincible(this.lifeState, now),
    }
  }

  /** Call every frame — invincibility can expire without any event to trigger a refresh. */
  refreshVisuals(now: number) {
    this.renderLifeVisuals(this.lifeState.isOut, isLifeStateInvincible(this.lifeState, now))
  }

  // ---- Render-only (joiner) ----

  applyReceivedState(state: PlayerState) {
    if (!this.target) {
      this.square.setPosition(state.pos.x, state.pos.y)
    }
    this.target = state.pos
    // Not otherwise touched on this side (applyHit/grantLife etc. are
    // simulated-only) — just mirrored so getLives()/getMaxLives() work the
    // same way regardless of which side of the split a Player is on.
    this.lifeState = { ...this.lifeState, lives: state.lives, maxLives: state.maxLives, isOut: state.isOut }
    this.renderLifeVisuals(state.isOut, state.isInvincible)
  }

  /**
   * Clears the interpolation target so the *next* applyReceivedState snaps
   * instead of easing — call before a room transition's first post-switch
   * state arrives, otherwise the player visibly slides across the screen
   * from the old room's position instead of cutting.
   */
  resetInterpolation() {
    this.target = null
  }

  /** Call every frame with a frame-rate-independent lerp factor. */
  interpolate(t: number) {
    if (!this.target) {
      return
    }
    this.square.x = Phaser.Math.Linear(this.square.x, this.target.x, t)
    this.square.y = Phaser.Math.Linear(this.square.y, this.target.y, t)
  }

  // ---- Shared ----

  private renderLifeVisuals(isOut: boolean, invincible: boolean) {
    if (isOut) {
      this.flicker.setActive(false)
      this.square.setAlpha(GRAY_OUT_ALPHA)
      return
    }

    this.flicker.setActive(invincible)
    if (!invincible) {
      this.square.setAlpha(1)
    }
  }

  destroy() {
    this.square.destroy()
  }
}
