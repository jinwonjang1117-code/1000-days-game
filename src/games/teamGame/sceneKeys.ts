import { TEAM_GAME_NAMESPACE } from './gameId'

/**
 * Phaser scene keys share one global namespace across every game in the hub,
 * so each game prefixes its own to stay collision-free (mirrors thousandDays).
 */
export const TeamGameScenes = {
  Lobby: `${TEAM_GAME_NAMESPACE}.Lobby`,
  Play: `${TEAM_GAME_NAMESPACE}.Play`,
  DevTest: `${TEAM_GAME_NAMESPACE}.DevTest`,
} as const
