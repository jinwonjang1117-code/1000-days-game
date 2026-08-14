import Enemy from './Enemy'
import { TextureKeys } from '../config/textureKeys'
import { getDifficulty } from '../config/difficulty'
import type { GetPlayerPosition, FireEnemyProjectile } from './FlyerEnemy'

const FLOAT_AMPLITUDE = 40
const FLOAT_SPEED = 0.0015

const FIGURE_EIGHT_AMPLITUDE_X = 80
const FIGURE_EIGHT_AMPLITUDE_Y = 80
const FIGURE_EIGHT_SPEED = 0.0025

const ENRAGE_TINT = 0xff0000
const ENRAGE_FIRE_INTERVAL_MS = 2000

export default class GhostEnemy extends Enemy {
  private baseX: number
  private baseY: number
  private phaseOffset: number
  private useFigureEight: boolean
  private getPlayerPosition: GetPlayerPosition
  private fireProjectile: FireEnemyProjectile
  private isEnraged = false
  private fireTimer = 0

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    getPlayerPosition: GetPlayerPosition,
    fireProjectile: FireEnemyProjectile,
  ) {
    super(scene, x, y, TextureKeys.Ghost)

    this.baseX = x
    this.baseY = y
    this.phaseOffset = Phaser.Math.Between(0, 1000)
    this.getPlayerPosition = getPlayerPosition
    this.fireProjectile = fireProjectile
    this.canBeInhaled = false
    this.collidesWithPlatforms = false
    this.useFigureEight = getDifficulty() === 'high'

    this.setDisplaySize(48, 48)
    this.setGravityY(0)
    this.setImmovable(true)
  }

  enrage(): void {
    if (this.isEnraged) {
      return
    }

    this.isEnraged = true
    this.canBeInhaled = true
    this.setTint(ENRAGE_TINT)
  }

  updateBehavior(time: number, delta: number): void {
    const t = time + this.phaseOffset

    if (this.useFigureEight) {
      // Single frequency on Y picks the top/bottom loop; double frequency on X
      // sweeps side-to-side within each loop, stacking the loops vertically.
      this.y = this.baseY + Math.sin(t * FIGURE_EIGHT_SPEED) * FIGURE_EIGHT_AMPLITUDE_Y
      this.x = this.baseX + Math.sin(t * FIGURE_EIGHT_SPEED * 2) * FIGURE_EIGHT_AMPLITUDE_X
    } else {
      this.y = this.baseY + Math.sin(t * FLOAT_SPEED) * FLOAT_AMPLITUDE
    }

    if (this.isEnraged) {
      this.fireTimer += delta
      if (this.fireTimer >= ENRAGE_FIRE_INTERVAL_MS) {
        this.fireTimer = 0
        const playerPos = this.getPlayerPosition()
        this.fireProjectile(this.x, this.y, playerPos.x, playerPos.y)
      }
    }
  }
}
