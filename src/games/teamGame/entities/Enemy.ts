import Phaser from 'phaser'
import type { EnemyState, Vec2 } from '../net/syncProtocol'
import type { ArchetypeId, EnemyArchetype } from '../gameplay/enemyArchetypes'
import type { AttackState } from '../gameplay/attack'
import { createAttackState, canFire, recordFire } from '../gameplay/attack'
import {
  GLUE_SLOW_PER_STACK,
  GLUE_MAX_STACKS,
  GLUE_STACK_DURATION_MS,
  POISON_DAMAGE_PER_TICK,
  POISON_TICK_INTERVAL_MS,
  POISON_MAX_STACKS,
  POISON_STACK_DURATION_MS,
  ICE_PATCH_DROP_INTERVAL_MS,
} from '../gameplay/roles'
import type { ShadowController } from '../gameplay/shadow'
import { createShadow } from '../gameplay/shadow'

const ENEMY_HIT_FLASH_COLOR = 0xffffff
const ENEMY_HIT_FLASH_MS = 80
const HEALTH_TEXT_OFFSET_BASE = 18
/** Charger's wind-up tell — bright and distinct from the hit-flash white so the two never read as the same thing. */
const TELEGRAPH_COLOR = 0xffee00
/** Berserker's sustained enraged tint — fixed regardless of archetype color, same "clear state signal" idea as the hit-flash. */
const ENRAGE_COLOR = 0xff2222
/** Ice's freeze (DESIGN.md §5) — a full stop, distinct from the hit-flash white and the telegraph yellow. */
const FROZEN_COLOR = 0x66ddff
/** Poison's DoT (DESIGN.md §5) — matches ROLES.poison.color for visual consistency between the pickup and the effect it causes. */
const POISONED_COLOR = 0x66cc66
/** Glue's slow (DESIGN.md §5) — matches ROLES.glue.color. Without this, a single stack (12% slower) had no visual tell at all, unlike Ice/Poison. */
const SLOWED_COLOR = 0x88cc44
/** Erratic retargets to a new random direction/speed within this interval range. */
const ERRATIC_RETARGET_MIN_MS = 300
const ERRATIC_RETARGET_MAX_MS = 1000
/** Erratic's per-retarget speed is randomized down to this fraction of its base speed, at most its full base speed. */
const ERRATIC_MIN_SPEED_FRACTION = 0.3
/**
 * Calm idle wander — calmer/slower than Erratic's retargeting (that's
 * deliberately jittery for dodge-difficulty; this is just so an archetype
 * doesn't read as a frozen statue while otherwise not acting). Originally
 * Charger-only (waiting for a trigger); also drives 'keepDistance'
 * archetypes with idleWander set (e.g. Summoner) while not retreating.
 */
const IDLE_WANDER_RETARGET_MIN_MS = 1200
const IDLE_WANDER_RETARGET_MAX_MS = 2400
const IDLE_WANDER_SPEED_FRACTION = 0.35

const HEALTH_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffcc66',
}

export interface EnemyOptions {
  simulated: boolean
  /** Defaults to true. False for a Chest mimic's ambush Swarmers (GameSimulation.handleChestTouch) — they're real, fightable enemies, but shouldn't block the room from reading as clear/keep its doors from staying open, since the "real" fight was already won before the chest was even touched. */
  countsForClear?: boolean
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
  readonly countsForClear: boolean
  readonly square: Phaser.GameObjects.Rectangle
  private readonly shadow: ShadowController
  private readonly healthText: Phaser.GameObjects.Text
  private readonly body: Phaser.Physics.Arcade.Body | null
  private readonly healthTextOffset: number

  // Simulated (host) only.
  private health: number
  private attackState: AttackState = createAttackState()
  private summonState: AttackState = createAttackState()
  private hazardDropState: AttackState = createAttackState()
  /** Ice+Gravity combo (DESIGN.md §6) — throttles the ice-patch drop, see tryDropIcePatchAt. */
  private icePatchDropState: AttackState = createAttackState()
  /** 'erratic' movement and 'charge's idle wander — next time it picks a fresh random direction/speed. Starts at 0 so the very first frame retargets immediately. */
  private nextWanderRetargetAt = 0
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

  // Status effects (DESIGN.md §5) — host-only bookkeeping, mirrored to the
  // joiner as booleans/counts (see getNetworkState/applyReceivedState)
  // since none of these are derivable from an absolute host timestamp the
  // joiner doesn't independently track, same reasoning as telegraphing.
  /** Ice — a full stop until this timestamp. 0 (default) reads as "not frozen" against any real `now`. */
  private frozenUntil = 0
  /** Glue — one independently-expiring timestamp per active stack (not a flat refresh per hit). */
  private slowStackExpirations: number[] = []
  /** Poison — same independently-expiring-stack shape as Glue. */
  private poisonStackExpirations: number[] = []
  private nextPoisonTickAt = 0
  /** Replaces the old delayedCall-based hit-flash revert — see syncTint, which now needs to run every frame (not just at sparse transition points) to keep the frozen/poisoned tints live. */
  private flashUntil = 0

  // Shared (host sets directly; joiner mirrors via applyReceivedState) — see EnemyState.
  private frozen = false
  private slowStacks = 0
  private poisonStacks = 0

  // Render-only (joiner) only.
  private target: Vec2 | null = null

  constructor(scene: Phaser.Scene, id: number, archetype: EnemyArchetype, x: number, y: number, options: EnemyOptions) {
    this.id = id
    this.archetype = archetype
    this.countsForClear = options.countsForClear ?? true
    this.health = archetype.maxHealth
    this.healthTextOffset = archetype.size / 2 + HEALTH_TEXT_OFFSET_BASE

    this.shadow = createShadow(scene, archetype.size)
    this.shadow.setPosition(x, y)
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
   * Call every frame. 'erratic' and 'charge' don't need a target to move
   * (erratic ignores players entirely; charge idles without one) — every
   * other mode still requires a valid nearestPlayerPos to chase/flee from.
   */
  updateMovement(nearestPlayerPos: Vec2 | null, now: number) {
    if (!this.body) {
      return
    }

    // Ice's freeze (DESIGN.md §5) — a full stop, checked once here ahead of
    // every movement mode, 'bounce' included (previously bounce returned
    // before this check ever ran, making Swarmer-type enemies immune to
    // both freeze and Glue's slow — real bug, not an intentional exception).
    if (this.isFrozen(now)) {
      this.body.setVelocity(0, 0)
      return
    }

    if (this.archetype.movement === 'bounce') {
      // Arcade's own bounce physics owns *direction* (it reflects velocity
      // automatically on wall/world-bounds collisions, before this runs
      // each frame) — this only ever rescales the current direction's
      // *magnitude* to the current effective speed, so Glue's slow can
      // apply without fighting that reflection.
      const targetSpeed = this.effectiveSpeed(now)
      const currentSpeed = Math.hypot(this.body.velocity.x, this.body.velocity.y)
      if (currentSpeed > 0) {
        const scale = targetSpeed / currentSpeed
        this.body.setVelocity(this.body.velocity.x * scale, this.body.velocity.y * scale)
      } else {
        // Zero velocity only happens right after thawing from a freeze —
        // bounce mode never naturally settles at 0 otherwise. Relaunch at
        // a fresh random angle, same as the constructor's initial launch.
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
        this.body.setVelocity(Math.cos(angle) * targetSpeed, Math.sin(angle) * targetSpeed)
      }
      return
    }

    if (this.archetype.movement === 'erratic') {
      if (now >= this.nextWanderRetargetAt) {
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
        const speedMultiplier = Phaser.Math.FloatBetween(ERRATIC_MIN_SPEED_FRACTION, 1)
        this.body.setVelocity(Math.cos(angle) * this.archetype.speed * speedMultiplier, Math.sin(angle) * this.archetype.speed * speedMultiplier)
        this.nextWanderRetargetAt = now + Phaser.Math.Between(ERRATIC_RETARGET_MIN_MS, ERRATIC_RETARGET_MAX_MS)
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
      const speed = this.effectiveSpeed(now)
      const angle = Math.atan2(nearestPlayerPos.y - this.y, nearestPlayerPos.x - this.x)
      this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
      return
    }

    // 'keepDistance': back away once a player gets within half the firing
    // range, otherwise hold position — or, for archetypes with idleWander
    // set (Summoner), drift calmly instead of standing dead still.
    const retreatDistance = (this.archetype.ranged?.range ?? 300) / 1.5
    const distance = Phaser.Math.Distance.Between(this.x, this.y, nearestPlayerPos.x, nearestPlayerPos.y)
    if (distance < retreatDistance) {
      const speed = this.effectiveSpeed(now)
      const angle = Math.atan2(this.y - nearestPlayerPos.y, this.x - nearestPlayerPos.x)
      this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
    } else if (this.archetype.idleWander) {
      if (now >= this.nextWanderRetargetAt) {
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
        const wanderSpeed = this.effectiveSpeed(now) * IDLE_WANDER_SPEED_FRACTION
        this.body.setVelocity(Math.cos(angle) * wanderSpeed, Math.sin(angle) * wanderSpeed)
        this.nextWanderRetargetAt = now + Phaser.Math.Between(IDLE_WANDER_RETARGET_MIN_MS, IDLE_WANDER_RETARGET_MAX_MS)
      }
    } else {
      this.body.setVelocity(0, 0)
    }
  }

  /**
   * 'charge' movement's state machine: idle (subtle wander, same retarget
   * shape as 'erratic' but calmer — see IDLE_WANDER_* — until a player is
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
      if (now >= this.nextWanderRetargetAt) {
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
        const wanderSpeed = this.archetype.speed * IDLE_WANDER_SPEED_FRACTION
        this.body.setVelocity(Math.cos(angle) * wanderSpeed, Math.sin(angle) * wanderSpeed)
        this.nextWanderRetargetAt = now + Phaser.Math.Between(IDLE_WANDER_RETARGET_MIN_MS, IDLE_WANDER_RETARGET_MAX_MS)
      }
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

  /**
   * Berserker's enrage and Glue's slow both fold in here — enrage is a
   * sustained speed multiplier once health drops to/below the threshold
   * (derived live, both host and joiner already know health/maxHealth);
   * Glue's slow is a straight multiplier from the current stack count.
   * Read by 'chase'/'keepDistance' (recompute velocity from scratch every
   * frame) and 'bounce' (rescales its current velocity's magnitude to
   * this, see updateMovement). **Known first-pass scope limit**: Erratic's
   * wander and Charger's dash speed don't go through effectiveSpeed today,
   * so Glue won't slow them yet (Ice's freeze, which is checked once up
   * front in updateMovement for every mode, still stops them fine).
   */
  private effectiveSpeed(now: number): number {
    const { enrage } = this.archetype
    let speed = this.archetype.speed
    if (enrage && this.isEnraged()) {
      speed *= enrage.speedMultiplier
    }
    speed *= this.slowMultiplier(now)
    return speed
  }

  private isEnraged(): boolean {
    const { enrage } = this.archetype
    return !!enrage && this.health / this.archetype.maxHealth <= enrage.healthThreshold
  }

  // ---- Status effects (DESIGN.md §5) ----

  /** Ice — extends the freeze rather than overwriting it, so a second freeze landing mid-freeze can't ever shorten the remaining duration. */
  applyFreeze(now: number, durationMs: number) {
    this.frozenUntil = Math.max(this.frozenUntil, now + durationMs)
  }

  isFrozen(now: number): boolean {
    return now < this.frozenUntil
  }

  /** Glue — a fresh independently-expiring stack, capped at GLUE_MAX_STACKS. No-ops at the cap rather than refreshing the oldest stack, keeping this simple for a first pass. */
  addSlowStack(now: number) {
    if (this.slowStackExpirations.length < GLUE_MAX_STACKS) {
      this.slowStackExpirations.push(now + GLUE_STACK_DURATION_MS)
    }
  }

  /** Poison — same independently-expiring-stack shape as Glue, capped at POISON_MAX_STACKS. */
  addPoisonStack(now: number) {
    if (this.poisonStackExpirations.length < POISON_MAX_STACKS) {
      this.poisonStackExpirations.push(now + POISON_STACK_DURATION_MS)
    }
  }

  /** Filters live rather than relying on updateStatusEffects' last prune, so a stack that expired mid-frame (updateMovement runs before updateStatusEffects in GameSimulation.update's enemy loop) never reads stale. */
  private slowMultiplier(now: number): number {
    const activeStacks = this.slowStackExpirations.filter((expiresAt) => expiresAt > now).length
    return Math.max(0, 1 - activeStacks * GLUE_SLOW_PER_STACK)
  }

  /** DESIGN.md §6's Ice+Glue combo needs to check this host-side at hit time — the mirrored `slowStacks` field is only refreshed once/frame for the joiner's benefit, so this filters live instead, same reasoning as slowMultiplier. */
  isSlowed(now: number): boolean {
    return this.slowStackExpirations.some((expiresAt) => expiresAt > now)
  }

  /** DESIGN.md §6's Poison+Bomb/Poison+Electric combos need this host-side at hit/kill time — same live-filter reasoning as isSlowed. */
  isPoisoned(now: number): boolean {
    return this.poisonStackExpirations.some((expiresAt) => expiresAt > now)
  }

  /**
   * Call once per frame (host only) — expires stacks whose timers have run
   * out and ticks Poison damage. Returns true if this tick brought health
   * to 0, same shape as applyHit, so the caller (GameSimulation.update)
   * handles death the same way it already does for the attached-projectile
   * tick. Reuses applyHit itself (rather than duplicating its hit-flash/
   * health-label/death-return logic) — a poison tick reads visually the
   * same as any other hit, which is fine.
   */
  updateStatusEffects(now: number): boolean {
    this.slowStackExpirations = this.slowStackExpirations.filter((expiresAt) => expiresAt > now)
    this.poisonStackExpirations = this.poisonStackExpirations.filter((expiresAt) => expiresAt > now)

    if (this.poisonStackExpirations.length > 0 && now >= this.nextPoisonTickAt) {
      this.nextPoisonTickAt = now + POISON_TICK_INTERVAL_MS
      return this.applyHit(POISON_DAMAGE_PER_TICK * this.poisonStackExpirations.length)
    }
    return false
  }

  /**
   * Gravity — an additive per-frame velocity nudge toward (towardX, towardY)
   * on top of whatever updateMovement already set this frame, called from
   * GameSimulation.update's projectile loop for every in-flight Gravity
   * shot. DESIGN.md §6's Ice+Gravity combo needs this to also affect a
   * frozen enemy — deliberately allowed (no isFrozen guard here anymore):
   * freeze's full stop is re-enforced *fresh* every frame in updateMovement,
   * which runs before this pull pass, so a nudge added here doesn't break
   * "can't act" — it just causes a slow per-frame drag toward the puller
   * across many frames, not a contradiction.
   */
  applyGravityPull(towardX: number, towardY: number, strength: number) {
    if (!this.body) {
      return
    }
    const angle = Math.atan2(towardY - this.y, towardX - this.x)
    this.body.setVelocity(this.body.velocity.x + Math.cos(angle) * strength, this.body.velocity.y + Math.sin(angle) * strength)
  }

  /** DESIGN.md §6's Ice+Gravity combo — call only while this enemy is both frozen and actively being pulled; throttles the ice-patch drop to once per ICE_PATCH_DROP_INTERVAL_MS instead of every single frame it qualifies. Doesn't check frozen itself, same shape as tryDropHazardAt not checking its own trigger condition — the caller (GameSimulation.update's gravity-pull pass) already gates on isFrozen. */
  tryDropIcePatchAt(now: number): boolean {
    if (!canFire(this.icePatchDropState, now, ICE_PATCH_DROP_INTERVAL_MS)) {
      return false
    }
    this.icePatchDropState = recordFire(this.icePatchDropState, now)
    return true
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
      countsForClear: this.countsForClear,
      frozen: this.frozen,
      slowStacks: this.slowStacks,
      poisonStacks: this.poisonStacks,
    }
  }

  /**
   * Call every frame (host) — keeps the label glued to the moving square,
   * and refreshes the shared frozen/slowStacks/poisonStacks fields from the
   * host-only timer state (updateStatusEffects already pruned expired
   * stacks this frame) so getNetworkState/syncTint both read the current
   * count, not a stale one from whenever a stack was last added/removed.
   */
  refreshVisuals(now: number) {
    this.frozen = this.isFrozen(now)
    this.slowStacks = this.slowStackExpirations.length
    this.poisonStacks = this.poisonStackExpirations.length
    this.shadow.setPosition(this.square.x, this.square.y)
    this.syncHealthLabel()
    this.syncTint()
  }

  // ---- Render-only (joiner) ----

  applyReceivedState(state: EnemyState) {
    if (!this.target) {
      this.square.setPosition(state.pos.x, state.pos.y)
      this.shadow.setPosition(state.pos.x, state.pos.y)
    }
    this.target = state.pos
    this.health = state.health
    this.telegraphing = state.telegraphing
    this.frozen = state.frozen
    this.slowStacks = state.slowStacks
    this.poisonStacks = state.poisonStacks
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
    this.shadow.setPosition(this.square.x, this.square.y)
    this.syncHealthLabel()
  }

  // ---- Shared ----

  /**
   * flashUntil (not a delayedCall like before) so syncTint can evaluate the
   * flash as just another priority level instead of a separate revert path
   * — needed now that frozen/poisoned are continuously-refreshed states
   * with no discrete "just changed" event of their own to hang a revert off.
   */
  private flashHit() {
    this.flashUntil = this.square.scene.time.now + ENEMY_HIT_FLASH_MS
    this.syncTint()
  }

  /**
   * Sets the square's fill color from current state, in priority order:
   * the hit-flash (now < flashUntil) beats everything since it's the
   * shortest and most transient; then Ice's frozen tint and Poison's tint
   * (mechanically significant, continuously-refreshed states); then
   * telegraphing (Charger's dodge-tell); then a sustained enrage tint
   * (Berserker); then Glue's slowed tint (the subtlest effect, so lowest
   * priority — without its own tint at all, a single stack's 12% speed
   * drop had no visual tell whatsoever); then the plain archetype color. Called every frame from
   * both refreshVisuals (host) and applyReceivedState (joiner) rather than
   * only at sparse transition points — frozen/poisoned have no discrete
   * "just changed" event the way charge-state transitions do, so this has
   * to re-evaluate continuously instead of only reacting to one.
   */
  private syncTint() {
    const now = this.square.scene.time.now
    if (now < this.flashUntil) {
      this.square.setFillStyle(ENEMY_HIT_FLASH_COLOR)
    } else if (this.frozen) {
      this.square.setFillStyle(FROZEN_COLOR)
    } else if (this.poisonStacks > 0) {
      this.square.setFillStyle(POISONED_COLOR)
    } else if (this.telegraphing) {
      this.square.setFillStyle(TELEGRAPH_COLOR)
    } else if (this.isEnraged()) {
      this.square.setFillStyle(ENRAGE_COLOR)
    } else if (this.slowStacks > 0) {
      this.square.setFillStyle(SLOWED_COLOR)
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
    this.shadow.destroy()
  }
}
