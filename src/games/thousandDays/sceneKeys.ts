/**
 * Phaser scene keys share one global namespace across every game in the hub,
 * so each game prefixes its own to stay collision-free.
 */
export const ThousandDaysScenes = {
  Start: 'thousandDays.Start',
  Game: 'thousandDays.Game',
  UI: 'thousandDays.UI',
} as const
