import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'

const PROJECTILE_SPEED = 260
const PROJECTILE_WIDTH = 20
const PROJECTILE_HEIGHT = 50

export default class EnemyProjectile extends Phaser.Physics.Arcade.Sprite {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    direction: -1 | 1,
    texture: string = TextureKeys.EnemyProjectile,
  ) {
    super(scene, x, y, texture)

    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.setDisplaySize(PROJECTILE_WIDTH, PROJECTILE_HEIGHT)
    this.setGravityY(0)
    this.setCollideWorldBounds(false)
    this.setVelocityX(direction * PROJECTILE_SPEED)
  }
}
