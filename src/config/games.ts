import Phaser from 'phaser'
import { ThousandDaysScenes } from '../games/thousandDays/sceneKeys'
import { TextureKeys } from '../games/thousandDays/config/textureKeys'
import { loadThousandDaysAssets, THOUSAND_DAYS_PLAYER_THUMBNAIL } from '../games/thousandDays/assets'
import { TeamGameScenes } from '../games/escapeTheMinions/sceneKeys'
import { TEAM_GAME_ID, TEAM_GAME_TITLE, TEAM_GAME_DESCRIPTION } from '../games/escapeTheMinions/gameId'
import { loadTeamGameAssets, generateTeamGameThumbnail, TEAM_GAME_THUMBNAIL_KEY } from '../games/escapeTheMinions/assets'

export interface GameDefinition {
  /** Stable identifier, also used to remember whether assets are loaded. */
  id: string
  title: string
  /** Short pitch shown on the hub card. '\n' to control line breaks. */
  description: string
  /** Scene key started once this game's assets have loaded. */
  sceneKey: string
  /**
   * Small image for the hub card. The hub loads/generates this itself, so
   * keep it tiny — it happens on first paint, before any game is chosen.
   * `path` loads a real asset file; `generate` builds a placeholder texture
   * at runtime for games that don't have real art yet.
   */
  thumbnail: { key: string; path: string } | { key: string; generate: (scene: Phaser.Scene) => void }
  /** Queues this game's assets. Only called after the player picks the game. */
  loadAssets: (scene: Phaser.Scene) => void
  /** Optional sprite that walks the loading bar; must come from loadAssets. */
  loadingRunnerTexture?: string
}

// To add a game: build its scene(s) + an assets module, register the scenes in
// gameConfig.ts, then add an entry here. The hub renders one card per entry and
// fills leftover slots with "준비 중" placeholders.
export const GAMES: GameDefinition[] = [
  {
    id: 'thousand-days',
    title: '1000일의 모험',
    description: '미니언을 처치하고\n1000일에 도달하세요!',
    sceneKey: ThousandDaysScenes.Start,
    thumbnail: { key: 'thumb-thousand-days', path: THOUSAND_DAYS_PLAYER_THUMBNAIL },
    loadAssets: loadThousandDaysAssets,
    loadingRunnerTexture: TextureKeys.Enemy,
  },
  {
    id: TEAM_GAME_ID,
    title: TEAM_GAME_TITLE,
    description: TEAM_GAME_DESCRIPTION,
    sceneKey: TeamGameScenes.Lobby,
    thumbnail: { key: TEAM_GAME_THUMBNAIL_KEY, generate: generateTeamGameThumbnail },
    loadAssets: loadTeamGameAssets,
  },
]

export function getGameById(id: string): GameDefinition | undefined {
  return GAMES.find((game) => game.id === id)
}

// Assets live in Phaser's global cache for the page's lifetime, so re-entering
// a game must not queue the same files again (duplicate keys warn and waste a
// round trip). Tracking what's loaded lets the hub skip straight back in.
const loadedGameIds = new Set<string>()

export function isGameLoaded(id: string): boolean {
  return loadedGameIds.has(id)
}

export function markGameLoaded(id: string) {
  loadedGameIds.add(id)
}
