import Phaser from 'phaser'
import type { EnemyState, Vec2 } from '../net/syncProtocol'
import type { ArchetypeId, EnemyArchetype } from '../gameplay/enemyArchetypes'
import type { AttackState } from '../gameplay/attack'
import { createAttackState, canFire, recordFire } from '../gameplay/attack'

const ENEMY_HIT_FLASH_COLOR = 0xffffff
const ENEMY_HIT_FLASH_MS = 80
const HEALTH_TEXT_OFFSET_BASE = 18
/** Charger's wind-up tell — bright and distinct from the hit-flash white so the two never read as the same thing. */
const TELEGRAPH_COLOR = 0xffee00
/** Berserker's sustained enraged tint — fixed regardless of archetype color, same "clear state signal" idea as the hit-flash. */
const ENRAGE_COLOR = 0xff2222
/** Erratic retargets to a new random direction/speed within this interval range. */
const ERRATIC_RETARGET_MIN_MS = 600
const ERRATIC_RETARGET_MAX_MS = 1400
/** Erratic's per-retarget speed is randomized down to this fraction of its base speed, at most its full base speed. */
const ERRATIC_MIN_SPEED_FRACTION = 0.5

const HEALTH_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffcc66',
}

export interface EnemyOptions {
  simulated: boolean
}

/**
 * A real enemy archetype (DESIGN.md §9) — health/death, hit-flash, and
 * networking are all archetype-agnostic and unchanged from the original
 * placeholder; `archetype` only drives visuals/stats and movement/attack
 * behavior. Same simulated/render-only split as Player/Projectile. A room
 * can hold several at once, so each instance carries an id the same way
 * Projectile already does. Death is reported, not acted on — the scene
 * decides what happens next (removing it from the room's list, and, for
 * Splitter, spawning its children).
 */
export default class Enemy {
  readonly id: number
  readonly archetype: EnemyArchetype
  readonly square: Phaser.GameObjects.Rectangle
  private readonly healthText: Phaser.GameObjects.Text
  private readonly body: Phaser.Physics.Arcade.Body | null
  private readonly healthTextOffset: number

  // Simulated (host) only.
  private health: number
  private attackState: AttackState = createAttackState()
  private summonState: AttackState = createAttackState()
  private hazardDropState: AttackState = createAttackState()
  /** 'erratic' movement only — next time it picks a fresh random direction/speed. Starts at 0 so the very first frame retargets immediately. */
  private nextErraticRetargetAt = 0
  /** 'charge' movement only — see updateCharge. */
  private chargeState: 'idle' | 'telegraphing' | 'dashing' | 'cooldown' = 'idle'
  private chargeStateUntil = 0
  private chargeDirection: Vec2 | null = null

  // Shared (host sets it directly in updateCharge; joiner mirrors whatever
  // the host broadcasts in applyReceivedState) — whether this enemy is
  // *currently* telegraphing a charge, the one bit of state genuinely not
  // derivable from position/health alone (unlike the enrage tint, which
  // both sides can compute live from health/maxHealth).
  private telegraphing = false

  // Render-only (joiner) only.
  private target: Vec2 | null = null

  constructor(scene: Phaser.Scene, id: number, archetype: EnemyArchetype, x: number, y: number, options: EnemyOptions) {
    this.id = id
    this.archetype = archetype
    this.health = archetype.maxHealth
    this.healthTextOffset = archetype.size / 2 + HEALTH_TEXT_OFFSET_BASE

    this.square = scene.add.rectangle(x, y, archetype.size, archetype.size, archetype.color)
    this.healthText = scene.add
      .text(x, y - this.healthTextOffset, `HP ${archetype.maxHealth}`, HEALTH_TEXT_STYLE)
      .setOrigin(0.5)

    if (options.simulated) {
      scene.physics.add.existing(this.square)
      this.body = this.square.body as Phaser.Physics.Arcade.Body
      this.body.setCollideWorldBounds(true)

      if (archetype.movement === 'bounce') {
        this.body.setBounce(1, 1)
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
        this.body.setVelocity(Math.cos(angle) * archetype.speed, Math.sin(angle) * archetype.speed)
      }
      // 'chase'/'keepDistance' start stationary — updateMovement sets their
      // velocity every frame once a target exists.
    } else {
      this.body = null
    }
  }

  get x(): number {
    return this.square.x
  }

  get y(): number {
    return this.square.y
  }

  // ---- Simulated (host) ----

  /**
   * Call every frame. No-ops for 'bounce' (Arcade physics owns its motion
   * once launched). 'erratic' and 'charge' don't need a target to move
   * (erratic ignores players entirely; charge idles without one) — every
   * other mode still requires a valid nearestPlayerPos to chase/flee from.
   */
  updateMovement(nearestPlayerPos: Vec2 | null, now: number) {
    if (!this.body || this.archetype.movement === 'bounce') {
      return
    }

    if (this.archetype.movement === 'erratic') {
      if (now >= this.nextErraticRetargetAt) {
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
        const speedMultiplier = Phaser.Math.FloatBetween(ERRATIC_MIN_SPEED_FRACTION, 1)
        this.body.setVelocity(Math.cos(angle) * this.archetype.speed * speedMultiplier, Math.sin(angle) * this.archetype.speed * speedMultiplier)
        this.nextErraticRetargetAt = now + Phaser.Math.Between(ERRATIC_RETARGET_MIN_MS, ERRATIC_RETARGET_MAX_MS)
      }
      return
    }

    if (this.archetype.movement === 'charge') {
      this.updateCharge(nearestPlayerPos, now)
      return
    }

    if (!nearestPlayerPos) {
      return
    }

    if (this.archetype.movement === 'chase') {
      const speed = this.effectiveSpeed()
      const angle = Math.atan2(nearestPlayerPos.y - this.y, nearestPlayerPos.x - this.x)
      this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
      return
    }

    // 'keepDistance': back away once a player gets within half the firing
    // range, otherwise hold position.
    const retreatDistance = (this.archetype.ranged?.range ?? 200) / 2
    const distance = Phaser.Math.Distance.Between(this.x, this.y, nearestPlayerPos.x, nearestPlayerPos.y)
    if (distance < retreatDistance) {
      const speed = this.effectiveSpeed()
      const angle = Math.atan2(this.y - nearestPlayerPos.y, this.x - nearestPlayerPos.x)
      this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
    } else {
      this.body.setVelocity(0, 0)
    }
  }

  /**
   * 'charge' movement's state machine: idle (no-op until a player is
   * within triggerRange) -> telegraphing (stopped, tinted, direction
   * locked in now — not re-aimed later) -> dashing (committed straight
   * line at dashSpeed) -> cooldown (stopped) -> back to idle.
   */
  private updateCharge(nearestPlayerPos: Vec2 | null, now: number) {
    if (!this.body || !this.archetype.charge) {
      return
    }
    const { triggerRange, telegraphMs, dashSpeed, dashDurationMs, cooldownMs } = this.archetype.charge

    if (this.chargeState === 'idle') {
      if (!nearestPlayerPos) {
        return
      }
      const distance = Phaser.Math.Distance.Between(this.x, this.y, nearestPlayerPos.x, nearestPlayerPos.y)
      if (distance <= triggerRange) {
        const angle = Math.atan2(nearestPlayerPos.y - this.y, nearestPlayerPos.x - this.x)
        this.chargeDirection = { x: Math.cos(angle), y: Math.sin(angle) }
        this.chargeState = 'telegraphing'
        this.chargeStateUntil = now + telegraphMs
        this.telegraphing = true
        this.body.setVelocity(0, 0)
        this.syncTint()
      }
      return
    }

    if (this.chargeState === 'telegraphing') {
      if (now >= this.chargeStateUntil && this.chargeDirection) {
        this.chargeState = 'dashing'
        this.chargeStateUntil = now + dashDurationMs
        this.telegraphing = false
        this.body.setVelocity(this.chargeDirection.x * dashSpeed, this.chargeDirection.y * dashSpeed)
        this.syncTint()
      }
      return
    }

    if (this.chargeState === 'dashing') {
      if (now >= this.chargeStateUntil) {
        this.chargeState = 'cooldown'
        this.chargeStateUntil = now + cooldownMs
        this.body.setVelocity(0, 0)
      }
      return
    }

    // 'cooldown'
    if (now >= this.chargeStateUntil) {
      this.chargeState = 'idle'
    }
  }

  /** Berserker's enrage — a sustained speed multiplier once health drops to/below the threshold, derived live rather than a stored flag (both host and joiner already know health/maxHealth). */
  private effectiveSpeed(): number {
    const { enrage } = this.archetype
    if (enrage && this.isEnraged()) {
      return this.archetype.speed * enrage.speedMultiplier
    }
    return this.archetype.speed
  }

  private isEnraged(): boolean {
    const { enrage } = this.archetype
    return !!enrage && this.health / this.archetype.maxHealth <= enrage.healthThreshold
  }

  /** Ranged archetypes only. Returns fire angles (more than one for a Spread Shooter's fan) if in range and off cooldown, else null. */
  tryFireAt(nearestPlayerPos: Vec2 | null, now: number): number[] | null {
    if (!this.body || !this.archetype.ranged || !nearestPlayerPos) {
      return null
    }
    const distance = Phaser.Math.Distance.Between(this.x, this.y, nearestPlayerPos.x, nearestPlayerPos.y)
    if (distance > this.archetype.ranged.range) {
      return null
    }
    if (!canFire(this.attackState, now, this.archetype.ranged.fireRateMs)) {
      return null
    }
    this.attackState = recordFire(this.attackState, now)

    const baseAngle = Math.atan2(nearestPlayerPos.y - this.y, nearestPlayerPos.x - this.x)
    const { shotCount, spreadRadians } = this.archetype.ranged
    if (!shotCount || shotCount <= 1 || !spreadRadians) {
      return [baseAngle]
    }
    const angles: number[] = []
    for (let i = 0; i < shotCount; i++) {
      const offset = spreadRadians * (i / (shotCount - 1) - 0.5)
      angles.push(baseAngle + offset)
    }
    return angles
  }

  /** Summoner only. Returns a random archetype from its summon pool to spawn nearby if off cooldown, else null — independent of player proximity. Weak Summoner's pool is just one entry; Strong Summoner mixes two. */
  trySummonAt(now: number): ArchetypeId | null {
    if (!this.body || !this.archetype.summons) {
      return null
    }
    if (!canFire(this.summonState, now, this.archetype.summons.intervalMs)) {
      return null
    }
    this.summonState = recordFire(this.summonState, now)
    const { archetypes } = this.archetype.summons
    return archetypes[Phaser.Math.Between(0, archetypes.length - 1)]
  }

  /** Slime only. Returns true if a hazard zone should drop at this enemy's current position right now, else false — independent of player proximity, and not tied to death. */
  tryDropHazardAt(now: number): boolean {
    if (!this.body || !this.archetype.hazard) {
      return false
    }
    if (!canFire(this.hazardDropState, now, this.archetype.hazard.intervalMs)) {
      return false
    }
    this.hazardDropState = recordFire(this.hazardDropState, now)
    return true
  }

  /** Whether this enemy is currently telegraphing a charge — the host reads this directly, the joiner reads whatever was last broadcast (see applyReceivedState). */
  isTelegraphing(): boolean {
    return this.telegraphing
  }

  /** Returns true if this hit brought health to 0. */
  applyHit(damage = 1): boolean {
    this.health = Math.max(0, this.health - damage)
    this.syncHealthLabel()
    this.flashHit()
    return this.health <= 0
  }

  getNetworkState(): EnemyState {
    return {
      id: this.id,
      archetype: this.archetype.id,
      pos: { x: this.square.x, y: this.square.y },
      health: this.health,
      telegraphing: this.telegraphing,
    }
  }

  /** Call every frame — keeps the label glued to the moving square. */
  refreshVisuals() {
    this.syncHealthLabel()
  }

  // ---- Render-only (joiner) ----

  applyReceivedState(state: EnemyState) {
    if (!this.target) {
      this.square.setPosition(state.pos.x, state.pos.y)
    }
    this.target = state.pos
    this.health = state.health
    this.telegraphing = state.telegraphing
    this.syncHealthLabel()
    this.syncTint()
  }

  /** Call every frame with a frame-rate-independent lerp factor. */
  interpolate(t: number) {
    if (!this.target) {
      return
    }
    this.square.x = Phaser.Math.Linear(this.square.x, this.target.x, t)
    this.square.y = Phaser.Math.Linear(this.square.y, this.target.y, t)
    this.syncHealthLabel()
  }

  // ---- Shared ----

  private flashHit() {
    this.square.setFillStyle(ENEMY_HIT_FLASH_COLOR)
    // Reverts via syncTint (not a hardcoded archetype.color) so a hit that
    // crosses the enrage threshold ends up showing the enrage tint once
    // the flash clears, instead of stomping back to the base color.
    this.square.scene.time.delayedCall(ENEMY_HIT_FLASH_MS, () => this.syncTint())
  }

  /**
   * Sets the square's fill color from current state — telegraphing takes
   * priority (Charger's dodge-tell), then a sustained enrage tint
   * (Berserker), then the plain archetype color. Deliberately only called
   * at specific transition points (charge state changes, applyReceivedState,
   * flashHit's revert) rather than every frame, so it never fights with the
   * hit-flash's own brief white flash.
   */
  private syncTint() {
    if (this.telegraphing) {
      this.square.setFillStyle(TELEGRAPH_COLOR)
    } else if (this.isEnraged()) {
      this.square.setFillStyle(ENRAGE_COLOR)
    } else {
      this.square.setFillStyle(this.archetype.color)
    }
  }

  private syncHealthLabel() {
    this.healthText.setPosition(this.square.x, this.square.y - this.healthTextOffset)
    this.healthText.setText(`HP ${this.health}`)
  }

  destroy() {
    this.square.destroy()
    this.healthText.destroy()
  }
}
