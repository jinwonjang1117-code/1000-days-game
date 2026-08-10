import Enemy from './Enemy'
import { TextureKeys } from '../config/textureKeys'

const FLY_SPEED = 70
const FIRE_INTERVAL_MS = 2000

export interface FlyerBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type GetPlayerPosition = () => { x: number; y: number }
export type FireEnemyProjectile = (x: number, y: number, targetX: number, targetY: number) => void

export default class FlyerEnemy extends Enemy {
  private bounds: FlyerBounds
  private fireTimer = 0
  private getPlayerPosition: GetPlayerPosition
  private fireProjectile: FireEnemyProjectile

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    bounds: FlyerBounds,
    getPlayerPosition: GetPlayerPosition,
    fireProjectile: FireEnemyProjectile,
  ) {
    super(scene, x, y, TextureKeys.Flyer)

    this.bounds = bounds
    this.getPlayerPosition = getPlayerPosition
    this.fireProjectile = fireProjectile
    this.canBeInhaled = true
    this.collidesWithPlatforms = false

    this.setDisplaySize(72, 64)
    this.setGravityY(0)
    this.setVelocity(FLY_SPEED, FLY_SPEED * 0.6)
  }

  updateBehavior(_time: number, delta: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body | null
    if (!body) {
      return
    }

    if (this.x <= this.bounds.minX && body.velocity.x < 0) {
      body.velocity.x = Math.abs(body.velocity.x)
    } else if (this.x >= this.bounds.maxX && body.velocity.x > 0) {
      body.velocity.x = -Math.abs(body.velocity.x)
    }

    if (this.y <= this.bounds.minY && body.velocity.y < 0) {
      body.velocity.y = Math.abs(body.velocity.y)
    } else if (this.y >= this.bounds.maxY && body.velocity.y > 0) {
      body.velocity.y = -Math.abs(body.velocity.y)
    }

    this.setFlipX(body.velocity.x < 0)

    this.fireTimer += delta
    if (this.fireTimer >= FIRE_INTERVAL_MS) {
      this.fireTimer = 0
      const playerPos = this.getPlayerPosition()
      this.fireProjectile(this.x, this.y, playerPos.x, playerPos.y)
    }
  }
}
