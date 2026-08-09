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
}

const GROUND: PlatformConfig = { x: 400, y: 580, width: 800, height: GROUND_HEIGHT }

// Fixed height tiers, spaced 1.5x further apart than the original layout.
// Current jump (velocity 640, gravity 1400) reaches a max rise of ~146px;
// every platform sits on one of these rows so any tier-to-tier jump
// (including ground, which is thicker) clears with a ~40px buffer.
const TIER1 = 466
const TIER2 = 361
const TIER3 = 256
const TIER4 = 151

export const stages: StageConfig[] = [
  {
    // Level 1: flat ground only, one enemy, no platforming required.
    level: 1,
    platforms: [GROUND],
    enemies: [{ type: 'normal', x: 600, y: 500 }],
  },
  {
    // Level 2: one low platform introduces jumping (no enemy on it yet).
    level: 2,
    platforms: [GROUND, { x: 400, y: TIER1, width: 280 }],
    enemies: [
      { type: 'normal', x: 250, y: 500 },
      { type: 'fast', x: 600, y: 500 },
    ],
  },
  {
    // Level 3: two low platforms with a gap, plus a ghost to dodge.
    level: 3,
    platforms: [
      GROUND,
      { x: 150, y: TIER1, width: 220 },
      { x: 620, y: TIER1, width: 220 },
    ],
    enemies: [
      { type: 'normal', x: 150, y: TIER1 - 60 },
      { type: 'fast', x: 620, y: TIER1 - 60 },
      { type: 'ghost', x: 400, y: 450 },
    ],
  },
  {
    // Level 4: adds a center platform and the flyer's ranged attacks.
    level: 4,
    platforms: [
      GROUND,
      { x: 150, y: TIER1, width: 220 },
      { x: 620, y: TIER1, width: 220 },
      { x: 400, y: TIER2, width: 260 },
    ],
    enemies: [
      { type: 'normal', x: 150, y: TIER1 - 60 },
      { type: 'fast', x: 620, y: TIER1 - 60 },
      { type: 'ghost', x: 400, y: 400 },
      { type: 'flyer', x: 400, y: 220 },
    ],
  },
  {
    // Level 5: adds a narrow top-center platform, one tier higher.
    level: 5,
    platforms: [
      GROUND,
      { x: 150, y: TIER1, width: 220 },
      { x: 620, y: TIER1, width: 220 },
      { x: 400, y: TIER2, width: 260 },
      { x: 400, y: TIER3, width: 220 },
    ],
    enemies: [
      { type: 'normal', x: 150, y: TIER1 - 60 },
      { type: 'fast', x: 620, y: TIER1 - 60 },
      { type: 'normal', x: 400, y: TIER3 - 60 },
      { type: 'ghost', x: 400, y: 400 },
      { type: 'flyer', x: 400, y: 220 },
    ],
  },
  {
    // Level 6: full symmetric six-platform climb.
    level: 6,
    platforms: [
      GROUND,
      { x: 150, y: TIER1, width: 220 },
      { x: 620, y: TIER1, width: 220 },
      { x: 400, y: TIER2, width: 260 },
      { x: 140, y: TIER3, width: 200 },
      { x: 650, y: TIER3, width: 200 },
    ],
    enemies: [
      { type: 'normal', x: 150, y: TIER1 - 60 },
      { type: 'normal', x: 650, y: TIER3 - 60 },
      { type: 'fast', x: 620, y: TIER1 - 60 },
      { type: 'fast', x: 140, y: TIER3 - 60 },
      { type: 'ghost', x: 400, y: 400 },
      { type: 'flyer', x: 400, y: 220 },
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
      { x: 150, y: TIER3, width: 180 },
      { x: 650, y: TIER3, width: 180 },
      { x: 400, y: TIER4, width: 200 },
    ],
    enemies: [
      { type: 'normal', x: 200, y: TIER1 - 60 },
      { type: 'fast', x: 600, y: TIER1 - 60 },
      { type: 'normal', x: 150, y: TIER3 - 60 },
      { type: 'fast', x: 650, y: TIER3 - 60 },
      { type: 'ghost', x: 400, y: 400 },
      { type: 'flyer', x: 400, y: 230 },
    ],
  },
  {
    // Level 8: narrower platforms, three columns, tighter precision.
    level: 8,
    platforms: [
      GROUND,
      { x: 160, y: TIER1, width: 180 },
      { x: 420, y: TIER1, width: 180 },
      { x: 660, y: TIER1, width: 180 },
      { x: 280, y: TIER2, width: 200 },
      { x: 560, y: TIER2, width: 200 },
      { x: 420, y: TIER3, width: 220 },
      { x: 420, y: TIER4, width: 200 },
    ],
    enemies: [
      { type: 'normal', x: 160, y: TIER1 - 60 },
      { type: 'fast', x: 660, y: TIER1 - 60 },
      { type: 'normal', x: 420, y: TIER1 - 60 },
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
      { x: 140, y: TIER1, width: 170 },
      { x: 420, y: TIER1, width: 170 },
      { x: 680, y: TIER1, width: 170 },
      { x: 260, y: TIER2, width: 190 },
      { x: 560, y: TIER2, width: 190 },
      { x: 140, y: TIER3, width: 170 },
      { x: 680, y: TIER3, width: 170 },
      { x: 420, y: TIER4, width: 220 },
    ],
    enemies: [
      { type: 'normal', x: 140, y: TIER1 - 60 },
      { type: 'fast', x: 680, y: TIER1 - 60 },
      { type: 'normal', x: 420, y: TIER1 - 60 },
      { type: 'fast', x: 260, y: TIER2 - 60 },
      { type: 'ghost', x: 560, y: 400 },
      { type: 'ghost', x: 420, y: 260 },
      { type: 'flyer', x: 140, y: 330 },
      { type: 'flyer', x: 680, y: 330 },
    ],
  },
  {
    // Level 10: boss arena. Symmetric side platforms to dodge/reposition on;
    // no roster of patrol enemies — the boss spawns its own minions.
    level: 10,
    platforms: [
      GROUND,
      { x: 130, y: TIER1, width: 200 },
      { x: 670, y: TIER1, width: 200 },
    ],
    enemies: [],
    isBossLevel: true,
  },
]
