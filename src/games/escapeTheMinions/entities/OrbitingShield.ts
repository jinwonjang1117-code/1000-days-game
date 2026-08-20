import Phaser from 'phaser'
import type { Vec2 } from '../net/syncProtocol'
import type { ShadowController } from '../gameplay/shadow'
import { createShadow } from '../gameplay/shadow'

const SHIELD_RADIUS = 10
const SHIELD_COLOR = 0x99ccff
/** Turret Pact's visual tell (DESIGN.md §9) — bigger and a hot color, distinct from the default shield's cool blue, since a firing shield reads as a meaningfully different threat/tool than a plain contact-damage one. */
const TURRET_COLOR = 0xff8800
const TURRET_SCALE = 1.3
/** Minimum time between damage ticks against the same enemy, so continuous Arcade overlap doesn't melt a target in one frame. */
export const SHIELD_HIT_COOLDOWN_MS = 500

export interface OrbitingShieldOptions {
  simulated: boolean
}

/**
 * A stackable shield that circles its owning player and damages enemies on
 * contact (DESIGN.md §7's Orbiting Shield strong item). Position is fully
 * host-computed each frame (orbitTo) rather than velocity-driven, so it
 * uses body.reset() the same way a teleport does — Arcade overlap still
 * needs a real dynamic body for the contact-damage collider even though
 * nothing pushes it around like a normal physics object. Same
 * simulated/render-only split as every other entity.
 */
export default class OrbitingShield {
  readonly id: number
  readonly shape: Phaser.GameObjects.Arc
  private readonly shadow: ShadowController
  private readonly body: Phaser.Physics.Arcade.Body | null

  // Simulated (host) only — per-enemy contact-damage cooldown, since Arcade
  // overlap fires every frame two bodies are touching, not once.
  private readonly lastHitAt: Map<number, number> = new Map()

  // Render-only (joiner) only.
  private target: Vec2 | null = null

  constructor(scene: Phaser.Scene, id: number, x: number, y: number, options: OrbitingShieldOptions) {
    this.id = id
    this.shadow = createShadow(scene, SHIELD_RADIUS * 2)
    this.shadow.setPosition(x, y)
    this.shape = scene.add.circle(x, y, SHIELD_RADIUS, SHIELD_COLOR)

    if (options.simulated) {
      scene.physics.add.existing(this.shape)
      this.body = this.shape.body as Phaser.Physics.Arcade.Body
      this.body.setAllowGravity(false)
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

  // ---- Simulated (host) ----

  /** Repositions on the orbit path — via body.reset() (not velocity) since the path is fully computed each frame, not physics-driven. */
  orbitTo(x: number, y: number) {
    if (this.body) {
      this.body.reset(x, y)
    } else {
      this.shape.setPosition(x, y)
    }
    this.shadow.setPosition(x, y)
  }

  /** Turret Pact (DESIGN.md §9) — safe to call every frame, no-ops visually once already in the requested mode. Host-only, deliberately not networked to the joiner's render-only copy (a known simplification — the joiner still sees the turret shots fired, just not the shield's own recolor). */
  setTurretMode(enabled: boolean) {
    this.shape.setFillStyle(enabled ? TURRET_COLOR : SHIELD_COLOR)
    this.shape.setScale(enabled ? TURRET_SCALE : 1)
  }

  /** Whether enough time has passed since this shield last damaged this specific enemy. */
  canHitEnemy(enemyId: number, now: number): boolean {
    const last = this.lastHitAt.get(enemyId)
    return last === undefined || now - last >= SHIELD_HIT_COOLDOWN_MS
  }

  recordHit(enemyId: number, now: number) {
    this.lastHitAt.set(enemyId, now)
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
