import Phaser from 'phaser'
import { TextureKeys, stageBackgroundKey } from '../config/textureKeys'
import { stages } from '../config/stages'

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

const LOADING_BAR_WIDTH = 300
const LOADING_BAR_HEIGHT = 24
const LOADING_RUNNER_WIDTH = 26
const LOADING_RUNNER_HEIGHT = 36
const MIN_LOADING_SCREEN_DURATION_MS = 1500 
const POST_LOAD_HOLD_MS = 200

export default class PreloadScene extends Phaser.Scene {
  private loadStartTime = 0

  constructor() {
    super({ key: 'PreloadScene' })
  }

  preload() {
    this.loadStartTime = Date.now()
    this.cameras.main.setBackgroundColor('#1a1a2e')
    this.createLoadingBar()

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
    this.load.image(TextureKeys.Diamond, 'assets/diamond.png')

    stages.forEach((stage) => {
      this.load.image(stageBackgroundKey(stage.level), `assets/stage${stage.level}.jpeg`)
    })

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
    const elapsed = Date.now() - this.loadStartTime
    const remaining = Math.max(0, MIN_LOADING_SCREEN_DURATION_MS - elapsed) + POST_LOAD_HOLD_MS

    this.time.delayedCall(remaining, () => {
      this.scene.start('StartScene')
    })
  }

  private createLoadingBar() {
    const centerX = 400
    const centerY = 300
    const barX = centerX - LOADING_BAR_WIDTH / 2
    const barY = centerY - LOADING_BAR_HEIGHT / 2

    this.add.text(centerX, barY - 40, '게임 로딩 중...', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5)

    this.add.rectangle(centerX, centerY, LOADING_BAR_WIDTH + 4, LOADING_BAR_HEIGHT + 4)
      .setStrokeStyle(2, 0xffcc00)

    const barFill = this.add.rectangle(barX, barY, 0, LOADING_BAR_HEIGHT, 0xffcc00).setOrigin(0, 0)

    const percentText = this.add.text(centerX, barY + LOADING_BAR_HEIGHT + 20, '0%', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    }).setOrigin(0.5)

    let runnerSprite: Phaser.GameObjects.Image | undefined

    this.load.once(`filecomplete-image-${TextureKeys.Enemy}`, () => {
      runnerSprite = this.add.image(barX, centerY, TextureKeys.Enemy)
        .setDisplaySize(LOADING_RUNNER_WIDTH, LOADING_RUNNER_HEIGHT)
    })

    // Driven by a fixed-duration tween rather than real load progress so the
    // bar always sweeps smoothly from 0% to 100% over MIN_LOADING_SCREEN_DURATION_MS,
    // instead of jumping in uneven steps or finishing early on a fast connection.
    // create() still waits for the real load to finish before leaving this scene.
    this.tweens.addCounter({
      from: 0,
      to: 100,
      duration: MIN_LOADING_SCREEN_DURATION_MS,
      onUpdate: (tween) => {
        const progress = (tween.getValue() ?? 0) / 100
        barFill.width = LOADING_BAR_WIDTH * progress
        percentText.setText(`${Math.round(progress * 100)}%`)
        runnerSprite?.setX(barX + LOADING_BAR_WIDTH * progress)
      },
    })
  }
}
