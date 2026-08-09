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
    graphics.clear()

    graphics.fillStyle(0xffff00, 1)
    graphics.fillPoints(
      [{
        x: 12,
        y: 0,
      },{
        x: 16,
        y: 12,
      },{
        x: 32,
        y: 16,
      },{
        x: 18,
        y: 24,
      },{
        x: 20,
        y: 38,
      },{
        x: 12,
        y: 30,
      },{
        x: 4,
        y: 38,
      },{
        x: 6,
        y: 24,
      },{
        x: 0,
        y: 16,
      },{
        x: 16,
        y: 12,
      }],
      true,
    )
    graphics.generateTexture(TextureKeys.Projectile, 32, 38)
    graphics.clear()

    graphics.fillStyle(0xffffff, 0.85)
    graphics.fillCircle(12, 12, 12)
    graphics.generateTexture(TextureKeys.Ghost, 24, 24)
    graphics.clear()

    graphics.fillStyle(0xff8800, 1)
    graphics.fillTriangle(0, 20, 20, 20, 10, 0)
    graphics.generateTexture(TextureKeys.Flyer, 20, 20)
    graphics.clear()

    graphics.fillStyle(0xff3333, 1)
    graphics.fillCircle(6, 6, 6)
    graphics.generateTexture(TextureKeys.EnemyProjectile, 12, 12)
    graphics.clear()

    graphics.fillStyle(0x00ffcc, 1)
    graphics.fillCircle(12, 12, 12)
    graphics.generateTexture(TextureKeys.Gem, 24, 24)
    graphics.clear()

    graphics.fillStyle(0x88ddff, 1)
    graphics.fillCircle(12, 12, 12)
    graphics.fillStyle(0xffffff, 1)
    graphics.fillCircle(12, 8, 4)
    graphics.generateTexture(TextureKeys.Diamond, 24, 24)
    graphics.destroy()
  }

  create() {
    this.scene.start('GameScene')
  }
}
