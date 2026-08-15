import Phaser from 'phaser'
import type { LifeState } from '../gameplay/lives'
import {
  createLifeState,
  applyHit as applyHitToLifeState,
  grantLife as grantLifeToState,
  increaseMaxLives as increaseMaxLivesForState,
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
const LIFE_TEXT_OFFSET = 34
const GRAY_OUT_ALPHA = 0.3

const LIFE_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ff6688',
}

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
  private readonly lifeText: Phaser.GameObjects.Text
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

    this.lifeText = scene.add.text(x, y - LIFE_TEXT_OFFSET, '', LIFE_TEXT_STYLE).setOrigin(0.5)
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
      isOut: this.lifeState.isOut,
      isInvincible: isLifeStateInvincible(this.lifeState, now),
    }
  }

  /** Call every frame — invincibility can expire without any event to trigger a refresh. */
  refreshVisuals(now: number) {
    this.renderLifeVisuals(this.lifeState.lives, this.lifeState.isOut, isLifeStateInvincible(this.lifeState, now))
  }

  // ---- Render-only (joiner) ----

  applyReceivedState(state: PlayerState) {
    if (!this.target) {
      this.square.setPosition(state.pos.x, state.pos.y)
    }
    this.target = state.pos
    this.renderLifeVisuals(state.lives, state.isOut, state.isInvincible)
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
    this.lifeText.setPosition(this.square.x, this.square.y - LIFE_TEXT_OFFSET)
  }

  // ---- Shared ----

  private renderLifeVisuals(lives: number, isOut: boolean, invincible: boolean) {
    this.lifeText.setPosition(this.square.x, this.square.y - LIFE_TEXT_OFFSET)
    this.lifeText.setText(`❤️ ${Math.max(0, lives)}`)

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
    this.lifeText.destroy()
  }
}
