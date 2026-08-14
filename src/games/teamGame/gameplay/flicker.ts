import Phaser from 'phaser'

const FLICKER_ALPHA_LOW = 0.25
const FLICKER_PERIOD_MS = 100

type FlickerTarget = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.AlphaSingle

export interface FlickerController {
  setActive(on: boolean): void
}

/**
 * Drives an alpha yoyo tween on a GameObject while invincible, purely
 * locally on whichever client calls it — the host derives its own "am I
 * invincible" from LifeState, the joiner from the received PlayerState.
 * Since it's cosmetic only, the two screens' flicker phases never need to
 * match, so nothing about the flicker itself goes over the network.
 */
export function createFlickerController(scene: Phaser.Scene, target: FlickerTarget): FlickerController {
  let tween: Phaser.Tweens.Tween | null = null
  let active = false

  return {
    setActive(on: boolean) {
      if (on === active) {
        return
      }
      active = on

      if (on) {
        tween = scene.tweens.add({
          targets: target,
          alpha: { from: 1, to: FLICKER_ALPHA_LOW },
          duration: FLICKER_PERIOD_MS,
          yoyo: true,
          repeat: -1,
        })
      } else {
        tween?.stop()
        tween = null
        target.setAlpha(1)
      }
    },
  }
}
