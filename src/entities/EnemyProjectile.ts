import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'

const PROJECTILE_SPEED = 260
const PROJECTILE_WIDTH = 30
const PROJECTILE_HEIGHT = 60

export default class EnemyProjectile extends Phaser.Physics.Arcade.Sprite {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    direction: -1 | 1,
    texture: string = TextureKeys.EnemyProjectile,
    aimAt?: { x: number; y: number },
  ) {
    super(scene, x, y, texture)

    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.setDisplaySize(PROJECTILE_WIDTH, PROJECTILE_HEIGHT)
    this.setGravityY(0)
    this.setCollideWorldBounds(false)

    if (aimAt) {
      const dx = aimAt.x - x
      const dy = aimAt.y - y
      const distance = Math.hypot(dx, dy) || 1
      this.setVelocity((dx / distance) * PROJECTILE_SPEED, (dy / distance) * PROJECTILE_SPEED)
    } else {
      this.setVelocityX(direction * PROJECTILE_SPEED)
    }
  }
}
