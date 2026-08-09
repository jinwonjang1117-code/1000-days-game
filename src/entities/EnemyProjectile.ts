import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'

const PROJECTILE_SPEED = 260

export default class EnemyProjectile extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number, direction: -1 | 1) {
    super(scene, x, y, TextureKeys.EnemyProjectile)

    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.setGravityY(0)
    this.setCollideWorldBounds(false)
    this.setVelocityX(direction * PROJECTILE_SPEED)
  }
}
