import Phaser from 'phaser'
import type { Vec2 } from '../net/syncProtocol'

const PROJECTILE_RADIUS = 5
const PROJECTILE_COLOR = 0xffffcc
const PROJECTILE_SPEED = 420
const PROJECTILE_MAX_RANGE = 500

export interface ProjectileOptions {
  simulated: boolean
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
  private readonly body: Phaser.Physics.Arcade.Body | null
  private readonly startPos: Vec2
  private target: Vec2 | null = null

  constructor(scene: Phaser.Scene, id: number, x: number, y: number, angle: number, options: ProjectileOptions) {
    this.id = id
    this.startPos = { x, y }
    this.shape = scene.add.circle(x, y, PROJECTILE_RADIUS, PROJECTILE_COLOR)

    if (options.simulated) {
      scene.physics.add.existing(this.shape)
      this.body = this.shape.body as Phaser.Physics.Arcade.Body
      this.body.setVelocity(Math.cos(angle) * PROJECTILE_SPEED, Math.sin(angle) * PROJECTILE_SPEED)
    } else {
      this.body = null
    }
  }

  get x(): number {
    return this.shape.x
  }

  get y(): number {
    return this.shape.y
  }

  /** Simulated only — a tear's range is a real, later-boostable stat, not a screen-bounds thing. */
  hasExpired(): boolean {
    if (!this.body) {
      return false
    }
    const dx = this.shape.x - this.startPos.x
    const dy = this.shape.y - this.startPos.y
    return Math.hypot(dx, dy) >= PROJECTILE_MAX_RANGE
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
