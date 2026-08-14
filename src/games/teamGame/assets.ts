import Phaser from 'phaser'
import { HOME_BGM_KEY } from '../../config/audio'
import { TEAM_GAME_NAMESPACE } from './gameId'

export const TEAM_GAME_THUMBNAIL_KEY = `${TEAM_GAME_NAMESPACE}.thumbnail`

const THUMBNAIL_SIZE = 64

/**
 * No real art exists for this game yet, so the hub thumbnail is generated at
 * runtime instead of loading an asset file — swap this for a real sprite once
 * the game has one, no other code needs to change. Called by the hub itself
 * (see games.ts's thumbnail.generate), before this game is ever chosen.
 */
export function generateTeamGameThumbnail(scene: Phaser.Scene) {
  const graphics = scene.add.graphics({ x: 0, y: 0 })

  graphics.fillStyle(0x3355ff, 1)
  graphics.fillRoundedRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE, 8)
  graphics.lineStyle(3, 0x99aaff)
  graphics.strokeRoundedRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE, 8)
  graphics.fillStyle(0xffffff, 1)
  graphics.fillCircle(24, 26, 9)
  graphics.fillCircle(40, 26, 9)
  graphics.fillRoundedRect(14, 38, 36, 18, 6)
  graphics.generateTexture(TEAM_GAME_THUMBNAIL_KEY, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  graphics.destroy()
}

// No game-specific assets yet, so this reuses the hub's own main-screen
// track (see LobbyScene.ts) rather than play silence — swap for a real
// teamGame BGM once one exists, nothing else needs to change. Guarded
// since a hard refresh straight onto this game's URL skips MainMenuScene
// entirely, so its preload can't be relied on to have already loaded this
// key — but coming from the hub, it usually has, and re-queueing an
// already-cached key is a harmless no-op either way.
export function loadTeamGameAssets(scene: Phaser.Scene) {
  if (!scene.cache.audio.exists(HOME_BGM_KEY)) {
    scene.load.audio(HOME_BGM_KEY, 'assets/bgm-home.mp3')
  }
}
