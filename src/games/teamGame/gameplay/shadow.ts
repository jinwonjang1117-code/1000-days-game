import Phaser from 'phaser'

const SHADOW_COLOR = 0x000000
const SHADOW_ALPHA = 0.45
/** Below every entity, above the plain background-color floor — nothing else currently claims negative depth. */
const SHADOW_DEPTH = -1
/**
 * A same-size, unoffset shadow is invisible in this game today — every
 * entity is still a solid-color placeholder rectangle/circle with no
 * transparency or silhouette variation, so it fully covers a shadow drawn
 * directly beneath it at the same size. Real shadows (Isaac included) are
 * only ever visible because they're wider than the object *and* sit
 * slightly below it, so the edges actually peek out. These two constants
 * exist entirely to make that peek-out happen against a solid placeholder
 * shape — once real sprites with actual silhouettes/transparency exist,
 * both can likely shrink back toward 1.0/0.
 */
const SHADOW_WIDTH_RATIO = 1.3
const SHADOW_Y_OFFSET_RATIO = 0.35
/** A ground shadow reads as flatter/wider than the object standing on it — this is its height as a fraction of its own (already-widened) width. */
const SHADOW_HEIGHT_RATIO = 0.4

export interface ShadowController {
  setPosition(x: number, y: number): void
  destroy(): void
}

/**
 * A soft ground shadow beneath an entity (Isaac-style grounding cue) —
 * purely cosmetic, drawn locally on whichever client calls it. Same
 * reasoning as gameplay/flicker.ts: both host and joiner already render
 * their own independent copy of every entity, so this needs no network
 * state of its own — it just tracks whatever position its owner already
 * knows about, on both sides of the split.
 *
 * `entitySize` is the owner's own width/diameter — setPosition takes the
 * owner's real (x, y) unmodified; the widening/downward offset needed to
 * actually be visible (see the constants above) happens internally so
 * every call site can just pass through its own true position.
 */
export function createShadow(scene: Phaser.Scene, entitySize: number): ShadowController {
  const width = entitySize * SHADOW_WIDTH_RATIO
  const yOffset = entitySize * SHADOW_Y_OFFSET_RATIO
  const ellipse = scene.add.ellipse(0, 0, width, width * SHADOW_HEIGHT_RATIO, SHADOW_COLOR, SHADOW_ALPHA)
  ellipse.setDepth(SHADOW_DEPTH)

  return {
    setPosition(x: number, y: number) {
      ellipse.setPosition(x, y + yOffset)
    },
    destroy() {
      ellipse.destroy()
    },
  }
}
