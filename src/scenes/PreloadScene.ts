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

const PROJECTILE_SPRITE_PATH = 'assets/projectile.png'

const BOSS_SPRITE_PATHS = {
  boss: 'assets/boss.png',
  projectile: 'assets/boss-projectile.png',
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

    this.load.image(TextureKeys.Projectile, PROJECTILE_SPRITE_PATH)

    this.load.image(TextureKeys.Boss, BOSS_SPRITE_PATHS.boss)
    this.load.image(TextureKeys.BossProjectile, BOSS_SPRITE_PATHS.projectile)

    const graphics = this.add.graphics({ x: 0, y: 0 })

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
    graphics.destroy()
  }

  create() {
    this.scene.start('GameScene')
  }
}
