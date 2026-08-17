import Phaser from 'phaser'
import type { DevilItemId } from '../gameplay/devilItems'
import { DEVIL_ITEMS } from '../gameplay/devilItems'

const PEDESTAL_SIZE = 32
const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '18px',
  color: '#ffffff',
}

export interface DevilPedestalOptions {
  simulated: boolean
}

/**
 * One of Devil's Room's 2-3 choices (DESIGN.md §9) — visually identified
 * (unlike a regular mystery pickup), since like a strong item it's an
 * earned/deliberate pick, not a grab-bag roll. Choosing one destroys every
 * other pedestal in the room (GameSimulation.handleDevilPedestalTouch) —
 * there's no "opened" visual state to worry about, same as Chest.
 */
export default class DevilPedestal {
  readonly id: DevilItemId
  readonly shape: Phaser.GameObjects.Rectangle
  private readonly label: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene, id: DevilItemId, x: number, y: number, options: DevilPedestalOptions) {
    this.id = id
    this.shape = scene.add.rectangle(x, y, PEDESTAL_SIZE, PEDESTAL_SIZE, DEVIL_ITEMS[id].color)
    this.label = scene.add.text(x, y, '!', LABEL_STYLE).setOrigin(0.5)

    if (options.simulated) {
      // Static body — pedestals never move, only need overlap detection.
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
