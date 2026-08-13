import Phaser from 'phaser'
import { TextureKeys, stageBackgroundKey } from './config/textureKeys'
import { AudioKeys } from './config/audioKeys'
import { stages } from './config/stages'

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

const PLAYER2_SPRITE_PATHS = {
  normal: 'assets/player2_normal.png',
  inhaling: 'assets/player2_inhaling.png',
  full: 'assets/player2_full.png',
}

const PROJECTILE_SPRITE_PATH = 'assets/projectile.png'
const PROJECTILE2_SPRITE_PATH = 'assets/projectile2.png'

const BOSS_SPRITE_PATHS = {
  boss: 'assets/boss.png',
  projectile: 'assets/boss-projectile.png',
}

export const THOUSAND_DAYS_PLAYER_THUMBNAIL = PLAYER_SPRITE_PATHS.normal

/**
 * Queues every asset this game needs. Called by PreloadScene only once the
 * player actually picks this game from the hub, so the hub itself stays light
 * and other games' assets are never downloaded unnecessarily.
 */
export function loadThousandDaysAssets(scene: Phaser.Scene) {
  scene.load.image(TextureKeys.Enemy, ENEMY_SPRITE_PATHS.normal)
  scene.load.image(TextureKeys.Flyer, ENEMY_SPRITE_PATHS.flying)
  scene.load.image(TextureKeys.Ghost, ENEMY_SPRITE_PATHS.ghost)
  scene.load.image(TextureKeys.EnemyProjectile, ENEMY_SPRITE_PATHS.projectile)

  scene.load.image(TextureKeys.Player, PLAYER_SPRITE_PATHS.normal)
  scene.load.image(TextureKeys.PlayerInhaling, PLAYER_SPRITE_PATHS.inhaling)
  scene.load.image(TextureKeys.PlayerFull, PLAYER_SPRITE_PATHS.full)

  scene.load.image(TextureKeys.Player2, PLAYER2_SPRITE_PATHS.normal)
  scene.load.image(TextureKeys.Player2Inhaling, PLAYER2_SPRITE_PATHS.inhaling)
  scene.load.image(TextureKeys.Player2Full, PLAYER2_SPRITE_PATHS.full)

  scene.load.image(TextureKeys.Projectile, PROJECTILE_SPRITE_PATH)
  scene.load.image(TextureKeys.Projectile2, PROJECTILE2_SPRITE_PATH)

  scene.load.image(TextureKeys.Boss, BOSS_SPRITE_PATHS.boss)
  scene.load.image(TextureKeys.BossProjectile, BOSS_SPRITE_PATHS.projectile)

  scene.load.image(TextureKeys.Gem, 'assets/gem.png')
  scene.load.image(TextureKeys.Life, 'assets/life.png')
  scene.load.image(TextureKeys.Diamond, 'assets/diamond.png')

  stages.forEach((stage) => {
    scene.load.image(stageBackgroundKey(stage.level), `assets/stage${stage.level}.jpeg`)
  })

  // BGM stays MP3 (loop timing doesn't need sample-accurate start). SFX are
  // WAV — MP3's encoder/decoder priming silence adds an audible delay to
  // short one-shot sounds that WAV's uncompressed PCM doesn't have.
  scene.load.audio(AudioKeys.StartBgm, 'assets/bgm-start.mp3')
  scene.load.audio(AudioKeys.GameplayBgm, 'assets/bgm-gameplay.mp3')
  scene.load.audio(AudioKeys.BossBgm, 'assets/bgm-boss.mp3')
  scene.load.audio(AudioKeys.FlyerProjectile, 'assets/sfx-flyer-projectile.wav')
  scene.load.audio(AudioKeys.BossProjectile, 'assets/sfx-boss-projectile.wav')
  scene.load.audio(AudioKeys.BossRain, 'assets/sfx-boss-rain.wav')
  scene.load.audio(AudioKeys.PickupConsume, 'assets/sfx-pickup.wav')
  scene.load.audio(AudioKeys.PlayerInhale, 'assets/sfx-player-inhale.wav')
  scene.load.audio(AudioKeys.PlayerSwallow, 'assets/sfx-player-swallow.wav')
  scene.load.audio(AudioKeys.PlayerSpit, 'assets/sfx-player-spit.wav')
  scene.load.audio(AudioKeys.PlayerHit, 'assets/sfx-player-hit.wav')
  scene.load.audio(AudioKeys.EnemyHit, 'assets/sfx-enemy-hit.wav')
  scene.load.audio(AudioKeys.StageClear, 'assets/sfx-stage-clear.wav')
  scene.load.audio(AudioKeys.Victory, 'assets/sfx-victory.wav')
  scene.load.audio(AudioKeys.Lose, 'assets/sfx-lose.wav')

  const graphics = scene.add.graphics({ x: 0, y: 0 })

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
