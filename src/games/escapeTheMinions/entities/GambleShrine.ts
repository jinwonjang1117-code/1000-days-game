import Phaser from 'phaser'
import type { ShadowController } from '../gameplay/shadow'
import { createShadow } from '../gameplay/shadow'

const SHRINE_SIZE = 32
const SHRINE_COLOR = 0x9933cc
const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '18px',
  color: '#ffffff',
}

export interface GambleShrineOptions {
  simulated: boolean
}

/**
 * The Gamble Shrine (DESIGN.md §8, brainstorm) — a room fixture in a
 * `RoomDefinition.isGamble` room, spawned in loadRoom same as a Chest.
 * Unlike Chest, it doesn't disappear after use: it's repeatable for as
 * long as you're in the room and can afford a pull (GameSimulation's
 * handleShrinePull, cooldown-gated so standing on it doesn't spam-pull
 * every frame). No per-instance network state needed — unlike Chest, its
 * presence is fully determined by the room's own `isGamble` flag (already
 * networked via floorRoomEntries/LevelStartMessage), so the joiner just
 * draws one locally whenever it's in that room (see CoopPlayScene's
 * drawGambleShrine) rather than reconciling a broadcast list.
 */
export default class GambleShrine {
  readonly shape: Phaser.GameObjects.Rectangle
  private readonly label: Phaser.GameObjects.Text
  private readonly shadow: ShadowController

  constructor(scene: Phaser.Scene, x: number, y: number, options: GambleShrineOptions) {
    this.shadow = createShadow(scene, SHRINE_SIZE)
    this.shadow.setPosition(x, y)
    this.shape = scene.add.rectangle(x, y, SHRINE_SIZE, SHRINE_SIZE, SHRINE_COLOR)
    this.label = scene.add.text(x, y, 'G', LABEL_STYLE).setOrigin(0.5)

    if (options.simulated) {
      // Static body — the shrine never moves, only needs overlap detection.
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
    this.shadow.destroy()
  }
}
