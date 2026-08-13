import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'

const FALL_SPEED = 260
const RAIN_PROJECTILE_WIDTH = 20
const RAIN_PROJECTILE_HEIGHT = 50

export default class RainProjectile extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TextureKeys.BossProjectile)

    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.setDisplaySize(RAIN_PROJECTILE_WIDTH, RAIN_PROJECTILE_HEIGHT)
    this.setGravityY(0)
    this.setCollideWorldBounds(false)
    this.setVelocityY(FALL_SPEED)
  }
}
