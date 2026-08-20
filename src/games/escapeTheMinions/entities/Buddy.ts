import Phaser from 'phaser'
import type { Vec2 } from '../net/syncProtocol'
import type { ShadowController } from '../gameplay/shadow'
import { createShadow } from '../gameplay/shadow'

const BUDDY_RADIUS = 10
/** How eagerly a buddy eases toward its follow target each frame — lower = more trailing lag. */
const FOLLOW_LERP_RATE = 0.12

export interface BuddyOptions {
  simulated: boolean
  color: number
}

/**
 * An Isaac-style familiar (DESIGN.md §7's Buddy strong item) — trails its
 * owning player and fires a small fixed-damage shot whenever they do (see
 * GameSimulation's tryFirePlayer). No Arcade body of its own: nothing ever
 * collides with a Buddy directly, only with the projectiles it fires, so a
 * plain positioned shape is enough. Same simulated/render-only split as
 * every other entity — the host eases it toward a follow target each
 * frame (followTarget), the joiner eases it toward whatever position the
 * host last broadcast (applyReceivedState/interpolate).
 */
export default class Buddy {
  readonly id: number
  readonly shape: Phaser.GameObjects.Arc
  private readonly shadow: ShadowController

  // Render-only (joiner) only.
  private target: Vec2 | null = null

  constructor(scene: Phaser.Scene, id: number, x: number, y: number, options: BuddyOptions) {
    this.id = id
    this.shadow = createShadow(scene, BUDDY_RADIUS * 2)
    this.shadow.setPosition(x, y)
    this.shape = scene.add.circle(x, y, BUDDY_RADIUS, options.color)
  }

  get x(): number {
    return this.shape.x
  }

  get y(): number {
    return this.shape.y
  }

  // ---- Simulated (host) ----

  /** Eases toward (targetX, targetY) with lag — chain multiple Buddies (each targeting the previous one) for an Isaac-style trailing line. */
  followTarget(targetX: number, targetY: number) {
    this.shape.x = Phaser.Math.Linear(this.shape.x, targetX, FOLLOW_LERP_RATE)
    this.shape.y = Phaser.Math.Linear(this.shape.y, targetY, FOLLOW_LERP_RATE)
    this.shadow.setPosition(this.shape.x, this.shape.y)
  }

  /** Instant snap, no lerp — call whenever the owning player teleports (room/level transitions) so the buddy doesn't get left behind in the old room and have to visibly race back across the new one. */
  teleport(x: number, y: number) {
    this.shape.setPosition(x, y)
    this.shadow.setPosition(x, y)
  }

  // ---- Render-only (joiner) ----

  applyReceivedState(pos: Vec2) {
    if (!this.target) {
      this.shape.setPosition(pos.x, pos.y)
      this.shadow.setPosition(pos.x, pos.y)
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
    this.shadow.setPosition(this.shape.x, this.shape.y)
  }

  destroy() {
    this.shape.destroy()
    this.shadow.destroy()
  }
}
