import Phaser from 'phaser'
import type { Vec2 } from '../net/syncProtocol'

// Exported so DevTestScene can compute a boosted player's actual shot
// stats as base * multiplier without duplicating these base numbers.
export const PROJECTILE_RADIUS = 5
export const PROJECTILE_SPEED = 300
export const PROJECTILE_MAX_RANGE = 300
const PROJECTILE_COLOR = 0xffffcc

export interface ProjectileOptions {
  simulated: boolean
  /** Defaults to the standard player-shot color — pass a different one (e.g. for enemy shots) to tell them apart at a glance. */
  color?: number
  /** Defaults to the standard player-shot speed — pass a different one (e.g. a slower speed for enemy shots, or a boosted player's Quick Shot) to tune independently. */
  speed?: number
  /** Defaults to PROJECTILE_RADIUS — Big Shot scales this up per-player. */
  radius?: number
  /** Defaults to 1 — Power Shot increases this per-player. */
  damage?: number
  /** Defaults to PROJECTILE_MAX_RANGE — Long Range scales this up per-player. */
  range?: number
  /** Defaults to 0 (destroyed on first hit) — Piercing Shot lets a shot survive extra hits before being destroyed. */
  pierceCount?: number
  /** Homing strength (0 = no homing). Higher numbers increase steering aggressiveness. */
  homingStrength?: number
}

/**
 * A single default-attack shot. Same simulated/render-only split as Player:
 * the host gives it a constant-velocity Arcade body and tracks how far it's
 * travelled; the joiner only ever renders whatever position the host last
 * reported, eased toward it like everything else on that side.
 */
export default class Projectile {
  readonly id: number
  readonly shape: Phaser.GameObjects.Arc
  readonly damage: number
  private readonly body: Phaser.Physics.Arcade.Body | null
  // (previously tracked net displacement) -- now using cumulative distance
  private readonly maxRange: number
  private target: Vec2 | null = null
  private readonly homingStrength: number
  private readonly initialSpeed: number
  // Track cumulative distance traveled (path-length) to expire homing
  // projectiles by path length instead of net displacement.
  private travelledDistance = 0
  private lastPos: Vec2
  // If attached to an enemy, store its id and per-attach tick bookkeeping.
  private attachedEnemyId: number | null = null
  private lastAttachedTickMs = 0
  /** Milliseconds between attached damage ticks. Tunable. */
  private readonly attachedTickMs = 400

  // Piercing bookkeeping — see the note on handleProjectileHitEnemy in
  // DevTestScene.ts: Arcade overlap fires every frame two bodies are
  // touching, not once, so a projectile that survives a hit must not be
  // allowed to re-hit the same enemy again while still overlapping it.
  private pierceRemaining: number
  private readonly hitEnemyIds: Set<number> = new Set()

  constructor(scene: Phaser.Scene, id: number, x: number, y: number, angle: number, options: ProjectileOptions) {
    this.id = id
    // start position intentionally not stored; cumulative travel is tracked
    this.lastPos = { x, y }
    this.damage = options.damage ?? 1
    this.maxRange = options.range ?? PROJECTILE_MAX_RANGE
    // Cap piercing to at most 3 hits to limit over-stacking effects.
    this.pierceRemaining = Math.min(options.pierceCount ?? 0, 3)
    this.homingStrength = options.homingStrength ?? 0
    this.shape = scene.add.circle(x, y, options.radius ?? PROJECTILE_RADIUS, options.color ?? PROJECTILE_COLOR)

    if (options.simulated) {
      scene.physics.add.existing(this.shape)
      this.body = this.shape.body as Phaser.Physics.Arcade.Body
      const speed = options.speed ?? PROJECTILE_SPEED
      this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed)
      this.initialSpeed = speed
    } else {
      this.body = null
      this.initialSpeed = options.speed ?? PROJECTILE_SPEED
    }
  }

  /** Have we already applied damage from this projectile to this enemy? Guards against re-triggering while piercing through it. */
  hasHitEnemy(enemyId: number): boolean {
    return this.hitEnemyIds.has(enemyId)
  }

  recordEnemyHit(enemyId: number) {
    this.hitEnemyIds.add(enemyId)
  }

  /** Call once per new hit. Returns true if this projectile should be destroyed now (out of pierces). */
  consumePierce(): boolean {
    if (this.pierceRemaining > 0) {
      this.pierceRemaining--
      return false
    }
    return true
  }

  get x(): number {
    return this.shape.x
  }

  get y(): number {
    return this.shape.y
  }

  /** For the broadcast — the joiner needs this to render a Big Shot-boosted shot at the right size too. */
  get radius(): number {
    return this.shape.radius
  }

  isHoming(): boolean {
    return this.homingStrength > 0
  }

  /**
   * Whether this projectile should attach to the first enemy it hits
   * (homing+pierce behavior). Excludes an already-attached projectile —
   * without this, a shot chasing its attached target could graze a
   * different enemy along the way and silently reassign itself, abandoning
   * the enemy it was still ticking damage against.
   */
  shouldAttachOnHit(): boolean {
    return this.homingStrength > 0 && this.pierceRemaining > 0 && !this.isAttached()
  }

  attachTo(enemyId: number) {
    this.attachedEnemyId = enemyId
    this.lastAttachedTickMs = 0
  }

  isAttached(): boolean {
    return this.attachedEnemyId !== null
  }

  getAttachedEnemyId(): number | null {
    return this.attachedEnemyId
  }

  detach() {
    this.attachedEnemyId = null
  }

  /** Returns true when enough time has elapsed to apply another attached tick. */
  shouldTickAttached(nowMs: number): boolean {
    if (!this.isAttached()) return false
    if (nowMs - this.lastAttachedTickMs >= this.attachedTickMs) {
      this.lastAttachedTickMs = nowMs
      return true
    }
    return false
  }

  /** Host-only: steer the projectile toward a target position (sets velocity). */
  steerTo(target: Vec2 | null) {
    if (!this.body || !target) {
      return
    }
    // Steer gradually toward the target instead of snapping so multiple
    // homing stacks can be represented as a stronger steering factor.
    const dx = target.x - this.shape.x
    const dy = target.y - this.shape.y
    const len = Math.hypot(dx, dy)
    if (len === 0) {
      return
    }
    const desiredVx = (dx / len)
    const desiredVy = (dy / len)
    const currentVx = this.body.velocity.x
    const currentVy = this.body.velocity.y
    const currentSpeed = Math.hypot(currentVx, currentVy) || this.initialSpeed

    // Normalize current velocity direction
    const curLen = Math.hypot(currentVx, currentVy) || 1
    const curDirX = currentVx / curLen
    const curDirY = currentVy / curLen

    // Homing strength controls how much we blend toward the desired direction.
    // Reduce base steering factor to decrease homing effectiveness and cap it.
    const blend = Math.min(0.1 * this.homingStrength, 0.6)
    const newDirX = curDirX + (desiredVx - curDirX) * blend
    const newDirY = curDirY + (desiredVy - curDirY) * blend
    const newLen = Math.hypot(newDirX, newDirY) || 1
    this.body.setVelocity((newDirX / newLen) * currentSpeed, (newDirY / newLen) * currentSpeed)
  }

  /** Simulated only — a tear's range is a real, boostable-per-player stat, not a screen-bounds thing. */
  hasExpired(): boolean {
    if (!this.body) {
      return false
    }
    // Expire by cumulative travelled distance so homing's curved paths
    // don't artificially extend lifetime compared to straight shots.
    return this.travelledDistance >= this.maxRange
  }

  /** Host-only: accumulate distance traveled since last frame. */
  updateTravelledDistance() {
    const dx = this.shape.x - this.lastPos.x
    const dy = this.shape.y - this.lastPos.y
    this.travelledDistance += Math.hypot(dx, dy)
    this.lastPos.x = this.shape.x
    this.lastPos.y = this.shape.y
  }

  applyReceivedPos(pos: Vec2) {
    if (!this.target) {
      this.shape.setPosition(pos.x, pos.y)
    }
    this.target = pos
  }

  /** Call every frame with a frame-rate-independent lerp factor. */
  interpolate(t: number) {
    if (!this.target) {
      return
    }
    this.shape.x = Phaser.Math.Linear(this.shape.x, this.target.x, t)
    this.shape.y = Phaser.Math.Linear(this.shape.y, this.target.y, t)
  }

  destroy() {
    this.shape.destroy()
  }
}
