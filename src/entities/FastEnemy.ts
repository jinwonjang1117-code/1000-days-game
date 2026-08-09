import NormalEnemy from './NormalEnemy'
import { TextureKeys } from '../config/textureKeys'

const BASE_PATROL_SPEED = 60
const FAST_MULTIPLIER = 1.8

export default class FastEnemy extends NormalEnemy {
  constructor(scene: Phaser.Scene, x: number, y: number, minX: number, maxX: number) {
    super(scene, x, y, minX, maxX, BASE_PATROL_SPEED * FAST_MULTIPLIER, TextureKeys.Enemy)

    this.setTint(0xffaa00)
  }
}
