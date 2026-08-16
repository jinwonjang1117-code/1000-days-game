import Phaser from 'phaser'

const HAZARD_COLOR = 0x66cc44
const HAZARD_ALPHA = 0.45

export interface HazardZoneOptions {
  simulated: boolean
}

/**
 * A lingering damage zone (Slime's periodic drop, DESIGN.md's enemy-variety
 * pass) — sits still until its own duration expires (GameSimulation owns
 * the timer via scene.time.delayedCall, same as it owns everything else's
 * lifetime), damaging any player who overlaps it. Never moves, so like
 * ItemPickup there's no interpolation/applyReceivedState split needed — the
 * joiner just creates one at the received position/radius and destroys it
 * once it's gone from the broadcast, same presence-based reconciliation.
 */
export default class HazardZone {
  readonly id: number
  readonly shape: Phaser.GameObjects.Arc

  constructor(scene: Phaser.Scene, id: number, x: number, y: number, radius: number, options: HazardZoneOptions) {
    this.id = id
    this.shape = scene.add.circle(x, y, radius, HAZARD_COLOR, HAZARD_ALPHA)

    if (options.simulated) {
      // Static body — the zone never moves, only needs overlap detection.
      scene.physics.add.existing(this.shape, true)
    }
  }

  get x(): number {
    return this.shape.x
  }

  get y(): number {
    return this.shape.y
  }

  get radius(): number {
    return this.shape.radius
  }

  destroy() {
    this.shape.destroy()
  }
}
