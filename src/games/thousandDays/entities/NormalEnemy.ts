import Enemy from './Enemy'
import { TextureKeys } from '../config/textureKeys'
import { WORLD_GRAVITY_Y } from '../config/physics'

const PATROL_SPEED = 60

export default class NormalEnemy extends Enemy {
  protected minX: number
  protected maxX: number

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    minX: number,
    maxX: number,
    speed: number = PATROL_SPEED,
    texture: string = TextureKeys.Enemy,
  ) {
    super(scene, x, y, texture)

    this.minX = minX
    this.maxX = maxX
    this.canBeInhaled = true

    this.setDisplaySize(40, 54)
    this.setGravityY(WORLD_GRAVITY_Y)
    this.setCollideWorldBounds(true)
    this.setVelocityX(speed)
  }

  updateBehavior(): void {
    const body = this.body as Phaser.Physics.Arcade.Body | null
    if (!body) {
      return
    }

    if (this.x <= this.minX && body.velocity.x < 0) {
      body.velocity.x = Math.abs(body.velocity.x)
    } else if (this.x >= this.maxX && body.velocity.x > 0) {
      body.velocity.x = -Math.abs(body.velocity.x)
    }

    this.setFlipX(body.velocity.x < 0)
  }
}
