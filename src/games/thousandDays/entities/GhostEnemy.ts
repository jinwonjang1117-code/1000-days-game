import Enemy from './Enemy'
import { TextureKeys } from '../config/textureKeys'
import { getDifficulty } from '../config/difficulty'

const FLOAT_AMPLITUDE = 40
const FLOAT_SPEED = 0.0015

const FIGURE_EIGHT_AMPLITUDE_X = 80
const FIGURE_EIGHT_AMPLITUDE_Y = 80
const FIGURE_EIGHT_SPEED = 0.0025

export default class GhostEnemy extends Enemy {
  private baseX: number
  private baseY: number
  private phaseOffset: number
  private useFigureEight: boolean

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TextureKeys.Ghost)

    this.baseX = x
    this.baseY = y
    this.phaseOffset = Phaser.Math.Between(0, 1000)
    this.canBeInhaled = false
    this.collidesWithPlatforms = false
    this.useFigureEight = getDifficulty() === 'high'

    this.setDisplaySize(48, 48)
    this.setGravityY(0)
    this.setImmovable(true)
  }

  updateBehavior(time: number): void {
    const t = time + this.phaseOffset

    if (this.useFigureEight) {
      // Single frequency on Y picks the top/bottom loop; double frequency on X
      // sweeps side-to-side within each loop, stacking the loops vertically.
      this.y = this.baseY + Math.sin(t * FIGURE_EIGHT_SPEED) * FIGURE_EIGHT_AMPLITUDE_Y
      this.x = this.baseX + Math.sin(t * FIGURE_EIGHT_SPEED * 2) * FIGURE_EIGHT_AMPLITUDE_X
    } else {
      this.y = this.baseY + Math.sin(t * FLOAT_SPEED) * FLOAT_AMPLITUDE
    }
  }
}
