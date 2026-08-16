// Room obstacle geometry (DESIGN.md §9's room-structure-variety stage) —
// pure data/logic, no Phaser dependency, mirrors gameplay/enemyArchetypes.ts's
// separation of data from the entity/scene code that consumes it.
//
// Water/empty are fixed, hand-authored templates — water needs careful
// door-clearance verification, so there's no benefit to randomizing it.
// Pillars are generated per room instead (generatePillarLayout) since count
// and placement vary room to room, unlike the water templates.

export type ObstacleType = 'rock' | 'water'

export interface RoomObstacle {
  type: ObstacleType
  /** Top-left corner, world space. */
  x: number
  y: number
  width: number
  height: number
}

interface Vec2 {
  x: number
  y: number
}

export interface RoomObstacleLayout {
  obstacles: RoomObstacle[]
  /** Where non-ranged enemy groups (and this room's regular reward drop, if any) spawn — replaces the old global ENEMY_SPAWN_CENTER for a room with this layout. */
  enemyAnchor: Vec2
  /** Where keepDistance/ranged groups spawn instead — only set when this layout splits the room. */
  rangedEnemyAnchor?: Vec2
}

// World is 800x600 (GameSimulation.ts's WORLD_WIDTH/WORLD_HEIGHT). Every
// obstacle stays inset 140px from every edge so it never reaches a door
// zone or its ENTRY_MARGIN, regardless of which of a room's 4 sides
// actually has a door — templates don't need to know a room's specific
// door configuration.
export const ARENA_MIN_X = 140
export const ARENA_MAX_X = 660
export const ARENA_MIN_Y = 140
export const ARENA_MAX_Y = 460

const DEFAULT_ANCHOR: Vec2 = { x: 400, y: 200 }

export const EMPTY_LAYOUT: RoomObstacleLayout = {
  obstacles: [],
  enemyAnchor: DEFAULT_ANCHOR,
}

export const WATER_SPLIT_HORIZONTAL: RoomObstacleLayout = {
  obstacles: [{ type: 'water', x: ARENA_MIN_X, y: 270, width: ARENA_MAX_X - ARENA_MIN_X, height: 60 }],
  enemyAnchor: DEFAULT_ANCHOR,
  rangedEnemyAnchor: { x: 400, y: 400 },
}

export const WATER_SPLIT_VERTICAL: RoomObstacleLayout = {
  obstacles: [{ type: 'water', x: 370, y: ARENA_MIN_Y, width: 60, height: ARENA_MAX_Y - ARENA_MIN_Y }],
  enemyAnchor: { x: 200, y: 300 },
  rangedEnemyAnchor: { x: 600, y: 300 },
}

const PILLAR_SIZE = 40
const PILLAR_MIN_COUNT = 4
const PILLAR_MAX_COUNT = 8
/** Minimum center-to-center distance a new pillar must keep from every already-placed one, so they read as scattered cover rather than a clump. */
const PILLAR_MIN_SPACING = 70
/** Minimum distance from the enemy anchor, so pillars don't spawn on top of where enemies/rewards appear. */
const PILLAR_ANCHOR_CLEARANCE = 90
const PILLAR_PLACEMENT_ATTEMPTS = 300

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Scatters PILLAR_MIN_COUNT-PILLAR_MAX_COUNT rock pillars inside the safe
 * arena via rejection sampling — count and positions vary room to room,
 * unlike the fixed water templates. Skips a candidate too close to another
 * pillar or the enemy anchor; in the rare case it runs out of attempts it
 * just places fewer than requested (same shape as floorGenerator.ts's
 * existing MAX_PLACEMENT_ATTEMPTS pattern for the floor's room layout).
 */
export function generatePillarLayout(): RoomObstacleLayout {
  const count = PILLAR_MIN_COUNT + Math.floor(Math.random() * (PILLAR_MAX_COUNT - PILLAR_MIN_COUNT + 1))
  const centers: Vec2[] = []
  let attempts = 0

  while (centers.length < count && attempts < PILLAR_PLACEMENT_ATTEMPTS) {
    attempts++
    const center: Vec2 = {
      x: ARENA_MIN_X + PILLAR_SIZE / 2 + Math.random() * (ARENA_MAX_X - ARENA_MIN_X - PILLAR_SIZE),
      y: ARENA_MIN_Y + PILLAR_SIZE / 2 + Math.random() * (ARENA_MAX_Y - ARENA_MIN_Y - PILLAR_SIZE),
    }

    if (distance(center, DEFAULT_ANCHOR) < PILLAR_ANCHOR_CLEARANCE) {
      continue
    }
    if (centers.some((other) => distance(center, other) < PILLAR_MIN_SPACING)) {
      continue
    }
    centers.push(center)
  }

  return {
    obstacles: centers.map((center) => ({
      type: 'rock' as const,
      x: center.x - PILLAR_SIZE / 2,
      y: center.y - PILLAR_SIZE / 2,
      width: PILLAR_SIZE,
      height: PILLAR_SIZE,
    })),
    enemyAnchor: DEFAULT_ANCHOR,
  }
}
