import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'

// Real sprites go in public/assets/ under these exact filenames — drop them in
// and reload, no code changes needed. Loaded as runtime string paths (not JS
// imports) so a missing file just falls back to Phaser's placeholder texture
// instead of breaking the dev server / build.
const ENEMY_SPRITE_PATHS = {
  normal: 'assets/enemy-normal.png',
  flying: 'assets/enemy-flying.png',
  ghost: 'assets/enemy-ghost.png',
}

const PLAYER_SPRITE_PATHS = {
  normal: 'assets/player_normal.png',
  inhaling: 'assets/player_inhaling.png',
  full: 'assets/player_full.png',
}

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' })
  }

  preload() {
    this.load.image(TextureKeys.Enemy, ENEMY_SPRITE_PATHS.normal)
    this.load.image(TextureKeys.Flyer, ENEMY_SPRITE_PATHS.flying)
    this.load.image(TextureKeys.Ghost, ENEMY_SPRITE_PATHS.ghost)

    this.load.image(TextureKeys.Player, PLAYER_SPRITE_PATHS.normal)
    this.load.image(TextureKeys.PlayerInhaling, PLAYER_SPRITE_PATHS.inhaling)
    this.load.image(TextureKeys.PlayerFull, PLAYER_SPRITE_PATHS.full)

    const graphics = this.add.graphics({ x: 0, y: 0 })

    graphics.fillStyle(0xffff00, 1)
    graphics.fillPoints(
      [{
        x: 12,
        y: 0,
      },{
        x: 16,
        y: 12,
      },{
        x: 32,
        y: 16,
      },{
        x: 18,
        y: 24,
      },{
        x: 20,
        y: 38,
      },{
        x: 12,
        y: 30,
      },{
        x: 4,
        y: 38,
      },{
        x: 6,
        y: 24,
      },{
        x: 0,
        y: 16,
      },{
        x: 16,
        y: 12,
      }],
      true,
    )
    graphics.generateTexture(TextureKeys.Projectile, 32, 38)
    graphics.clear()

    graphics.fillStyle(0xff3333, 1)
    graphics.fillCircle(6, 6, 6)
    graphics.generateTexture(TextureKeys.EnemyProjectile, 12, 12)
    graphics.clear()

    graphics.fillStyle(0x00ffcc, 1)
    graphics.fillCircle(12, 12, 12)
    graphics.generateTexture(TextureKeys.Gem, 24, 24)
    graphics.clear()

    graphics.fillStyle(0x88ddff, 1)
    graphics.fillCircle(12, 12, 12)
    graphics.fillStyle(0xffffff, 1)
    graphics.fillCircle(12, 8, 4)
    graphics.generateTexture(TextureKeys.Diamond, 24, 24)
    graphics.clear()

    graphics.fillStyle(0x5a1030, 1)
    graphics.fillRect(0, 0, 96, 96)
    graphics.fillStyle(0x8a1c4a, 1)
    graphics.fillRect(8, 8, 80, 80)
    graphics.generateTexture(TextureKeys.Boss, 96, 96)
    graphics.destroy()
  }

  create() {
    this.scene.start('GameScene')
  }
}
