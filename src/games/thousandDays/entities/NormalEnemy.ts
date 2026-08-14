import Enemy from './Enemy'
import { TextureKeys } from '../config/textureKeys'
import { WORLD_GRAVITY_Y } from '../config/physics'
import { getDifficulty } from '../config/difficulty'

const PATROL_SPEED = 60
// Jump height scales with velocity^2 under constant gravity, so doubling the
// height needs a sqrt(2)x velocity increase, not a literal doubling.
const JUMP_VELOCITY = 380 * Math.SQRT2
const JUMP_CHECK_INTERVAL_MS = 500
const JUMP_CHANCE = 0.5

export default class NormalEnemy extends Enemy {
  protected minX: number
  protected maxX: number
  private jumpTimer = 0

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

  updateBehavior(_time: number, delta: number): void {
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

    if (getDifficulty() === 'high') {
      this.jumpTimer += delta
      if (this.jumpTimer >= JUMP_CHECK_INTERVAL_MS) {
        this.jumpTimer = 0
        const isGrounded = body.blocked.down || body.touching.down
        if (isGrounded && Math.random() < JUMP_CHANCE) {
          body.velocity.y = -JUMP_VELOCITY
        }
      }
    }
  }
}
