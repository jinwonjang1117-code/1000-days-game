import Phaser from 'phaser'
import { HOME_BGM_KEY } from '../../config/audio'
import { TEAM_GAME_NAMESPACE } from './gameId'
import { SHADOW_DEPTH } from './gameplay/shadow'

export const TEAM_GAME_THUMBNAIL_KEY = `${TEAM_GAME_NAMESPACE}.thumbnail`

/**
 * The room backdrop (DESIGN.md §12's environment art) — the first real
 * sprite asset in this game, everything else so far has been colored
 * rectangles/arcs. Lives at `public/assets/escape-the-minions/environment/`,
 * matching the folder convention settled in DESIGN.md §12 — `TEAM_GAME_ID`
 * (see gameId.ts) was later renamed to match this same string too, though
 * that's a coincidence of both being renamed together, not a hard link.
 */
export const ROOM_BACKGROUND_KEY = 'env-room-bg'
/** Beneath every entity's shadow (SHADOW_DEPTH), so it never floats on top of one. */
export const ROOM_BACKGROUND_DEPTH = SHADOW_DEPTH - 1

/**
 * The door archway (DESIGN.md §12's `env-<theme>-door.png` row) — painted
 * as a neutral/desaturated gate so GameplayHud's existing setTint() calls
 * (open/closed/golden/boss/devil colors) still read correctly on it, same
 * as the placeholder Rectangle it replaces. Generated in the north/south
 * (vertical) orientation only — GameplayHud rotates it 90° for east/west.
 */
export const ROOM_DOOR_KEY = 'env-room-door'

/** Called from each gameplay scene's own preload() — PlayScene.ts and CoopPlayScene.ts both render a room, so both need this queued before their create() runs. */
export function loadRoomBackgroundAssets(scene: Phaser.Scene) {
  if (!scene.textures.exists(ROOM_BACKGROUND_KEY)) {
    scene.load.image(ROOM_BACKGROUND_KEY, 'assets/escape-the-minions/environment/env-room-bg.png')
  }
  if (!scene.textures.exists(ROOM_DOOR_KEY)) {
    scene.load.image(ROOM_DOOR_KEY, 'assets/escape-the-minions/environment/env-room-door.png')
  }
}

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
