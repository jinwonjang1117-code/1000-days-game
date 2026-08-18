import Phaser from 'phaser'
import type { ShadowController } from '../gameplay/shadow'
import { createShadow } from '../gameplay/shadow'

const CHEST_SIZE = 32
const CHEST_COLOR = 0xaa7733
const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '18px',
  color: '#000000',
}

export interface ChestOptions {
  simulated: boolean
}

/**
 * A locked Treasure Chest (DESIGN.md §9) — a room fixture decided at
 * floor-generation time (rooms/floorGenerator.ts's hasChest/chestAnchor),
 * spawned in loadRoom same as obstacles. Never moves, so like ItemPickup/
 * HazardZone there's no interpolation split needed — the joiner just
 * creates one at the received position and destroys it once it drops out
 * of the broadcast (opened). Always visually locked — there's only one
 * visual state, since it disappears entirely the instant it's opened
 * (GameSimulation.handleChestTouch) rather than switching to an "opened"
 * look.
 */
export default class Chest {
  readonly id: number
  readonly shape: Phaser.GameObjects.Rectangle
  private readonly label: Phaser.GameObjects.Text
  private readonly shadow: ShadowController

  constructor(scene: Phaser.Scene, id: number, x: number, y: number, options: ChestOptions) {
    this.id = id
    this.shadow = createShadow(scene, CHEST_SIZE)
    this.shadow.setPosition(x, y)
    this.shape = scene.add.rectangle(x, y, CHEST_SIZE, CHEST_SIZE, CHEST_COLOR)
    this.label = scene.add.text(x, y, 'C', LABEL_STYLE).setOrigin(0.5)

    if (options.simulated) {
      // Static body — chests never move, only need overlap detection.
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
