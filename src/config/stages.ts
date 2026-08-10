import type { PlatformConfig } from './platformLayout'
import { GROUND_HEIGHT } from './platformLayout'

export type EnemyType = 'normal' | 'fast' | 'ghost' | 'flyer'

export interface EnemySpawnConfig {
  type: EnemyType
  x: number
  y: number
}

export interface StageConfig {
  level: number
  platforms: PlatformConfig[]
  enemies: EnemySpawnConfig[]
  isBossLevel?: boolean
  playerSpawnX?: number
}

const GROUND: PlatformConfig = { x: 400, y: 580, width: 800, height: GROUND_HEIGHT }

// Fixed height tiers. Consecutive tiers are 128px apart (top-to-top), which
// leaves 128 - 16 (platform thickness) = 112px of clear headroom between a
// platform's surface and the underside of the one above it. Current jump
// (velocity 640, gravity 1400) reaches a max rise of ~146px, so a 128px rise
// still clears with an ~18px buffer. This is close to the practical ceiling:
// with 4 tiers stacked on a 600px-tall canvas, going much higher would push
// TIER4 up into the HUD text (~y=12-32) or off-screen.
const TIER1 = 440
const TIER2 = 312
const TIER3 = 184
const TIER4 = 56

export const stages: StageConfig[] = [
  {
    // Level 1: flat ground only, one enemy, no platforming required.
    level: 1,
    platforms: [GROUND],
    enemies: [{ type: 'normal', x: 600, y: 490 }],
  },
  {
    // Level 2: one low platform introduces jumping (no enemy on it yet).
    level: 2,
    platforms: [GROUND, { x: 400, y: TIER1, width: 280 }],
    enemies: [
      { type: 'normal', x: 250, y: 490 },
      { type: 'fast', x: 600, y: 490 },
    ],
  },
  {
    // Level 3: two low platforms with a gap, plus a ghost to dodge.
    level: 3,
    platforms: [
      GROUND,
      { x: 180, y: TIER1, width: 220 },
      { x: 620, y: TIER1, width: 220 },
    ],
    enemies: [
      { type: 'normal', x: 180, y: TIER1 - 80 },
      { type: 'fast', x: 620, y: TIER1 - 80 },
      { type: 'ghost', x: 300, y: 450 },
    ],
  },
  {
    // Level 4: adds a center platform and the flyer's ranged attacks.
    level: 4,
    platforms: [
      GROUND,
      { x: 180, y: TIER1, width: 220 },
      { x: 600, y: TIER1, width: 220 },
      { x: 400, y: TIER2, width: 260 },
    ],
    enemies: [
      { type: 'normal', x: 180, y: TIER1 - 80 },
      { type: 'fast', x: 620, y: TIER1 - 80 },
      { type: 'ghost', x: 300, y: 400 },
      { type: 'flyer', x: 400, y: 220 },
    ],
  },
  {
    // Level 5: adds a narrow top-center platform, one tier higher.
    level: 5,
    platforms: [
      GROUND,
      { x: 180, y: TIER1, width: 220 },
      { x: 620, y: TIER1, width: 220 },
      { x: 400, y: TIER2, width: 260 },
      { x: 400, y: TIER3, width: 220 },
    ],
    enemies: [
      { type: 'normal', x: 180, y: TIER1 - 80 },
      { type: 'fast', x: 620, y: TIER1 - 80 },
      { type: 'normal', x: 400, y: TIER3 - 80 },
      { type: 'ghost', x: 300, y: 400 },
      { type: 'flyer', x: 400, y: 220 },
    ],
  },
  {
    // Level 6: full symmetric six-platform climb.
    level: 6,
    platforms: [
      GROUND,
      { x: 180, y: TIER1, width: 220 },
      { x: 620, y: TIER1, width: 220 },
      { x: 400, y: TIER2, width: 260 },
      { x: 180, y: TIER3, width: 200 },
      { x: 640, y: TIER3, width: 200 },
    ],
    enemies: [
      { type: 'normal', x: 180, y: TIER1 - 80 },
      { type: 'normal', x: 620, y: TIER3 - 80 },
      { type: 'fast', x: 620, y: TIER1 - 80 },
      { type: 'fast', x: 180, y: TIER3 - 80 },
      { type: 'ghost', x: 300, y: 400 },
      { type: 'flyer', x: 400, y: 200  },
    ],
  },
  {
    // Level 7: asymmetric layout, introduces the fourth (highest) tier.
    level: 7,
    platforms: [
      GROUND,
      { x: 200, y: TIER1, width: 200 },
      { x: 600, y: TIER1, width: 200 },
      { x: 400, y: TIER2, width: 240 },
      { x: 180, y: TIER3, width: 180 },
      { x: 620, y: TIER3, width: 180 },
      { x: 400, y: TIER4, width: 200 },
    ],
    enemies: [
      { type: 'normal', x: 200, y: TIER1 - 80 },
      { type: 'fast', x: 600, y: TIER1 - 80 },
      { type: 'normal', x: 180, y: TIER3 - 80 },
      { type: 'fast', x: 620, y: TIER3 - 80 },
      { type: 'ghost', x: 300, y: 400 },
      { type: 'flyer', x: 400, y: 230 },
    ],
  },
  {
    // Level 8: narrower platforms, three columns, tighter precision.
    level: 8,
    platforms: [
      GROUND,
      { x: 180, y: TIER1, width: 180 },
      { x: 400, y: TIER1, width: 180 },
      { x: 620, y: TIER1, width: 180 },
      { x: 280, y: TIER2, width: 200 },
      { x: 520, y: TIER2, width: 200 },
      { x: 400, y: TIER3, width: 220 },
      { x: 400, y: TIER4, width: 200 },
    ],
    enemies: [
      { type: 'normal', x: 180, y: TIER1 - 80 },
      { type: 'fast', x: 620, y: TIER1 - 80 },
      { type: 'normal', x: 400, y: TIER1 - 80 },
      { type: 'ghost', x: 280, y: 400 },
      { type: 'ghost', x: 560, y: 400 },
      { type: 'flyer', x: 420, y: 230 },
    ],
  },
  {
    // Level 9: dense nine-platform layout, two flyers.
    level: 9,
    platforms: [
      GROUND,
      { x: 180, y: TIER1, width: 170 },
      { x: 400, y: TIER1, width: 170 },
      { x: 620, y: TIER1, width: 170 },
      { x: 280, y: TIER2, width: 190 },
      { x: 520, y: TIER2, width: 190 },
      { x: 180, y: TIER3, width: 170 },
      { x: 620, y: TIER3, width: 170 },
      { x: 400, y: TIER4, width: 220 },
    ],
    enemies: [
      { type: 'normal', x: 180, y: TIER1 - 80 },
      { type: 'fast', x: 620, y: TIER1 - 80 },
      { type: 'normal', x: 400, y: TIER1 - 80 },
      { type: 'fast', x: 280, y: TIER2 - 80 },
      { type: 'ghost', x: 520, y: 400 },
      { type: 'ghost', x: 400, y: 260 },
      { type: 'flyer', x: 140, y: 330 },
      { type: 'flyer', x: 680, y: 330 },
    ],
  },
  {
    // Level 10: boss arena. Player spawns left, boss spawns and patrols on
    // the right. The right platform sits two tiers higher (TIER3) since the
    // boss's 200px height would otherwise clip through anything at TIER1 as
    // it patrols underneath. The boss never reaches the left side, so a
    // normal TIER1→TIER2→TIER3 staircase there is safe and gives the player
    // a climbable path up to the same height as the boss's platform.
    level: 10,
    platforms: [
      GROUND,
      { x: 585, y: TIER3, width: 370 },
      { x: 160, y: TIER1, width: 180 },
      { x: 230, y: TIER2, width: 160 },
      { x: 160, y: TIER3, width: 220 },
    ],
    enemies: [],
    isBossLevel: true,
    playerSpawnX: 130,
  },
]
