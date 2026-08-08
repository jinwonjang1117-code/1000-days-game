import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' })
  }

  preload() {
    const graphics = this.add.graphics({ x: 0, y: 0 })

    graphics.fillStyle(0x0000ff, 1)
    graphics.fillRect(0, 0, 32, 48)
    graphics.generateTexture(TextureKeys.Player, 32, 48)
    graphics.clear()

    graphics.fillStyle(0xff0000, 1)
    graphics.fillRect(0, 0, 24, 24)
    graphics.generateTexture(TextureKeys.Enemy, 24, 24)
    graphics.destroy()
  }

  create() {
    this.scene.start('GameScene')
  }
}
