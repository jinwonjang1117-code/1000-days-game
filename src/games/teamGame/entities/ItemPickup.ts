import Phaser from 'phaser'
import type { ItemId, StrongItemId } from '../gameplay/items'
import { STRONG_ITEMS, getItemColor } from '../gameplay/items'

const PICKUP_RADIUS = 12
const MYSTERY_COLOR = 0xaaaaaa

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#000000',
}

export interface ItemPickupOptions {
  simulated: boolean
}

function isStrongItemId(id: ItemId): id is StrongItemId {
  return id in STRONG_ITEMS
}

/**
 * A room-clear reward, sitting still on the ground until someone walks
 * over it. Never moves, so unlike Projectile/Enemy there's no
 * interpolation/applyReceivedState split needed — the joiner just creates
 * one at the received position and destroys it once it's gone from the
 * broadcast (picked up), same presence-based reconciliation as
 * projectiles, just without any per-frame movement.
 *
 * Visual is tier-dependent, not per-item: boost/heart/fart pickups all
 * render identically (the "?" mystery look) so the effect stays unknown
 * until consumed; only the boss-tier "strong" items are drawn with their
 * real, identified color — an earned reward, not a grab-bag roll.
 */
export default class ItemPickup {
  readonly id: number
  readonly itemId: ItemId
  readonly shape: Phaser.GameObjects.Arc
  private readonly label: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene, id: number, itemId: ItemId, x: number, y: number, options: ItemPickupOptions) {
    this.id = id
    this.itemId = itemId

    const mystery = !isStrongItemId(itemId)
    const color = mystery ? MYSTERY_COLOR : getItemColor(itemId)
    this.shape = scene.add.circle(x, y, PICKUP_RADIUS, color)
    this.label = scene.add.text(x, y, mystery ? '?' : '!', LABEL_STYLE).setOrigin(0.5)

    if (options.simulated) {
      // Static body — pickups never move, only need overlap detection.
      scene.physics.add.existing(this.shape, true)
    }
  }

  get x(): number {
    return this.shape.x
  }

  get y(): number {
    return this.shape.y
  }

  destroy() {
    this.shape.destroy()
    this.label.destroy()
  }
}
