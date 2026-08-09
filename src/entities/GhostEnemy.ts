import Enemy from './Enemy'
import { TextureKeys } from '../config/textureKeys'

const FLOAT_AMPLITUDE = 40
const FLOAT_SPEED = 0.0015

export default class GhostEnemy extends Enemy {
  private baseY: number
  private phaseOffset: number

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TextureKeys.Ghost)

    this.baseY = y
    this.phaseOffset = Phaser.Math.Between(0, 1000)
    this.canBeInhaled = false
    this.collidesWithPlatforms = false

    this.setDisplaySize(48, 54)
    this.setGravityY(0)
    this.setImmovable(true)
  }

  updateBehavior(time: number): void {
    this.y = this.baseY + Math.sin((time + this.phaseOffset) * FLOAT_SPEED) * FLOAT_AMPLITUDE
  }
}
