import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'

const PROJECTILE_SPEED = 420
const PROJECTILE_WIDTH = 30
const PROJECTILE_HEIGHT = 40

export default class Projectile extends Phaser.Physics.Arcade.Sprite {
  bounceCount = 0
  isBossMinionProjectile = false

  constructor(scene: Phaser.Scene, x: number, y: number, direction: -1 | 1) {
    super(scene, x, y, TextureKeys.Projectile)

    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.setOrigin(0.5)
    this.setDisplaySize(PROJECTILE_WIDTH, PROJECTILE_HEIGHT)
    this.setGravityY(0)
    this.setVelocityX(direction * PROJECTILE_SPEED)
    this.setVelocityY(0)
    this.setCollideWorldBounds(false)
    this.setBounce(1, 0)
    this.setAngularVelocity(direction * 200)
  }

  bounceOffWall() {
    const body = this.body as Phaser.Physics.Arcade.Body | null
    if (!body) {
      return
    }

    this.bounceCount += 1
    this.setVelocityX(-body.velocity.x)
    this.setVelocityY(220)
  }
}
