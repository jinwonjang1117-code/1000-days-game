import Phaser from 'phaser'
import type { ItemId, StrongItemId } from '../gameplay/items'
import { STRONG_ITEMS, getItemColor } from '../gameplay/items'

const PICKUP_RADIUS = 12
/** Boost items (incl. Fart) share this one look — genuine mystery among *which* boost you got is still preserved, this is only about telling the category apart from heart/coin/key at a glance. */
const MYSTERY_COLOR = 0xaaaaaa
const HEART_COLOR = 0xff5577
/** Matches GameplayHud's COIN_TEXT_STYLE, so the HUD count and the pickup on the ground read as "the same thing." */
const COIN_COLOR = 0xffd700
/** Distinct from MYSTERY_COLOR on purpose — KEY_TEXT_STYLE's gray was too close to it to tell apart at a glance. */
const KEY_COLOR = 0x66ccff

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
 * Placeholder shape/color per pickup *category* — not per specific item.
 * Boost items still all render identically to each other (mystery "?"),
 * so which specific boost you got stays hidden until picked up; this only
 * separates heart/coin/key/boost from each other so they're visually
 * distinct while real sprites don't exist yet (each is meant to get its
 * own sprite later, see DESIGN.md §12 — this is a placeholder stand-in,
 * not the final look).
 */
function pickupVisual(itemId: ItemId): { color: number; label: string } {
  if (isStrongItemId(itemId)) {
    return { color: getItemColor(itemId), label: '!' }
  }
  if (itemId === 'heart') {
    return { color: HEART_COLOR, label: 'H' }
  }
  if (itemId === 'coin') {
    return { color: COIN_COLOR, label: 'C' }
  }
  if (itemId === 'key') {
    return { color: KEY_COLOR, label: 'K' }
  }
  return { color: MYSTERY_COLOR, label: '?' }
}

/**
 * A room-clear reward, sitting still on the ground until someone walks
 * over it. Never moves, so unlike Projectile/Enemy there's no
 * interpolation/applyReceivedState split needed — the joiner just creates
 * one at the received position and destroys it once it's gone from the
 * broadcast (picked up), same presence-based reconciliation as
 * projectiles, just without any per-frame movement.
 *
 * Visual is category-dependent (see pickupVisual), not per-item: every
 * boost item (incl. Fart) still renders identically to every *other* boost
 * item (the "?" mystery look) so which one you got stays unknown until
 * consumed, but heart/coin/key each get their own distinct placeholder
 * look, and boss-tier "strong" items are drawn with their real, identified
 * color — an earned reward, not a grab-bag roll.
 */
export default class ItemPickup {
  readonly id: number
  readonly itemId: ItemId
  readonly shape: Phaser.GameObjects.Arc
  private readonly label: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene, id: number, itemId: ItemId, x: number, y: number, options: ItemPickupOptions) {
    this.id = id
    this.itemId = itemId

    const { color, label } = pickupVisual(itemId)
    this.shape = scene.add.circle(x, y, PICKUP_RADIUS, color)
    this.label = scene.add.text(x, y, label, LABEL_STYLE).setOrigin(0.5)

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
