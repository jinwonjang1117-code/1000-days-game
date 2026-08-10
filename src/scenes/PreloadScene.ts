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
  projectile: 'assets/enemy-projectile.png',
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
    this.load.image(TextureKeys.EnemyProjectile, ENEMY_SPRITE_PATHS.projectile)

    this.load.image(TextureKeys.Player, PLAYER_SPRITE_PATHS.normal)
    this.load.image(TextureKeys.PlayerInhaling, PLAYER_SPRITE_PATHS.inhaling)
    this.load.image(TextureKeys.PlayerFull, PLAYER_SPRITE_PATHS.full)

    this.load.image(TextureKeys.Projectile, PROJECTILE_SPRITE_PATH)

    this.load.image(TextureKeys.Boss, BOSS_SPRITE_PATHS.boss)
    this.load.image(TextureKeys.BossProjectile, BOSS_SPRITE_PATHS.projectile)

    this.load.image(TextureKeys.Gem, 'assets/gem.png')
    this.load.image(TextureKeys.Life, 'assets/life.png')

    const graphics = this.add.graphics({ x: 0, y: 0 })

    graphics.fillStyle(0xffff00, 1)
    graphics.fillRect(0, 0, 32, 32)
    graphics.lineStyle(2, 0xffe066)
    graphics.strokeRect(0, 0, 32, 32)
    graphics.lineStyle(1, 0xffd700)
    for (let offset = 6; offset < 32; offset += 8) {
      graphics.fillRect(0, offset, 32, 4)
    }
    graphics.generateTexture(TextureKeys.Platform, 32, 32)
    graphics.destroy()
  }

  create() {
    this.scene.start('GameScene')
  }
}
