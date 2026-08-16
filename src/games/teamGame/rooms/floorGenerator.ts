// Procedural floor generation (step 3 of 3: fixed layout -> real
// archetypes -> procedural generation). Replaces the old hand-authored
// TEST_FLOOR with a random-walk layout generated fresh per level, with a
// difficulty ramp (archetype mixing + enemy count) driven by the level
// number. Pure logic, no Phaser dependency, mirrors gameplay/*.ts's
// separation of data/logic from the scene that consumes it.

import type { ArchetypeCategory, ArchetypeId } from '../gameplay/enemyArchetypes'
import { ARCHETYPES } from '../gameplay/enemyArchetypes'
import type { RoomCoord, RoomDefinition, RoomEnemyGroup } from './floorLayout'
import { coordsEqual, getNeighborCoord, ALL_DIRECTIONS } from './floorLayout'
import type { RoomObstacleLayout } from './roomLayouts'
import { EMPTY_LAYOUT, WATER_SPLIT_HORIZONTAL, WATER_SPLIT_VERTICAL, generatePillarLayout } from './roomLayouts'

export interface GeneratedFloor {
  level: number
  rooms: RoomDefinition[]
  startCoord: RoomCoord
  bossCoord: RoomCoord
}

const START_COORD: RoomCoord = { x: 0, y: 0 }
/** Difficulty stops ramping past this level — level 10's "final boss only, no regular rooms" is out of scope until a real boss exists. */
const MAX_RAMP_LEVEL = 9
const MAX_PLACEMENT_ATTEMPTS = 2000

function clampLevel(level: number): number {
  return Math.min(level, MAX_RAMP_LEVEL)
}

function roomCountForLevel(level: number): number {
  return Math.min(6 + Math.floor((clampLevel(level) - 1) / 2), 10)
}

/** Cumulative per DESIGN.md §8's enemy archetype introduction schedule. */
const ARCHETYPE_UNLOCK_LEVEL: Record<ArchetypeCategory, number> = {
  swarmer: 1,
  chaser: 1,
  rangedShooter: 1,
  erratic: 2,
  tank: 2,
  movingShooter: 2,
  charger: 3,
  splitter: 3,
  berserker: 4,
  spreadShooter: 4,
  summoner: 5,
  slime: 5,
}

function unlockedCategories(level: number): ArchetypeCategory[] {
  const l = clampLevel(level)
  return (Object.keys(ARCHETYPE_UNLOCK_LEVEL) as ArchetypeCategory[]).filter((c) => l >= ARCHETYPE_UNLOCK_LEVEL[c])
}

/**
 * Weak right when a category unlocks and the level after; Strong starts at
 * a coin-flip once eligible and ramps up from there, fully retiring Weak
 * (100% Strong) 5 levels after unlock — an early category (unlocks level 1)
 * stops showing its Weak tier by level 6; a late one (e.g. unlocks level 5)
 * never reaches that offset within the level-9 ramp cap, so it just keeps
 * climbing without ever fully retiring. Relative to each category's own
 * unlock level, not a single absolute level for everyone.
 */
function pickTier(category: ArchetypeCategory, level: number): 'Weak' | 'Strong' {
  const levelsSinceUnlock = clampLevel(level) - ARCHETYPE_UNLOCK_LEVEL[category]
  if (levelsSinceUnlock < 2) {
    return 'Weak'
  }
  const strongChance = Math.min(0.5 + (levelsSinceUnlock - 2) * (0.5 / 3), 1)
  return Math.random() < strongChance ? 'Strong' : 'Weak'
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * How many distinct archetypes this room mixes together.
 * 2 archetypes: 50% at level 3, ramping linearly to 100% by level 6.
 * 3 archetypes: 50% at level 7, ramping linearly to 100% by level 9 —
 * only rolled once a room has already qualified for 2.
 */
function archetypeCountForRoom(level: number, unlockedCount: number): number {
  const l = clampLevel(level)
  if (l < 3 || unlockedCount < 2) {
    return 1
  }

  const twoChance = Math.min(0.5 + Math.max(l - 3, 0) * (0.5 / 3), 1)
  if (Math.random() >= twoChance) {
    return 1
  }
  if (l < 7 || unlockedCount < 3) {
    return 2
  }

  const threeChance = Math.min(0.5 + (l - 7) * 0.25, 1)
  return Math.random() < threeChance ? 3 : 2
}

/** Base 3 + the current level (e.g. 4 at level 1, 12 at level 9), then a random -2..+2 wobble so rooms don't all feel identically sized. */
function totalEnemiesForRoom(level: number): number {
  const base = 3 + clampLevel(level)
  const variance = Math.floor(Math.random() * 5) - 2
  return Math.max(1, base + variance)
}

function pickRoomEnemies(level: number): RoomEnemyGroup[] {
  const unlocked = unlockedCategories(level)
  const archetypeCount = Math.min(archetypeCountForRoom(level, unlocked.length), unlocked.length)
  const chosen: ArchetypeId[] = shuffled(unlocked)
    .slice(0, archetypeCount)
    .map((category) => `${category}${pickTier(category, level)}` as ArchetypeId)

  const total = totalEnemiesForRoom(level)
  const groups: RoomEnemyGroup[] = []
  let remaining = total
  chosen.forEach((archetype, index) => {
    const isLast = index === chosen.length - 1
    const count = isLast ? remaining : Math.max(1, Math.round(total / chosen.length))
    groups.push({ archetype, count })
    remaining -= count
  })
  return groups
}

/** Chance a room with a keepDistance/ranged group gets a water split instead of staying open (coin flip between horizontal/vertical). */
const WATER_LAYOUT_CHANCE = 0.5
/** Chance a room without one gets scattered rock pillars instead of staying open. */
const PILLAR_LAYOUT_CHANCE = 0.75

/** Room structure (DESIGN.md §9) — a room with a keepDistance/ranged group (only rangedShooter today, checked by movement type rather than a hardcoded archetype id) can get a water split so the ranged group lands genuinely out of melee reach; everything else can get scattered rock pillars instead. */
function pickRoomObstacles(enemies: RoomEnemyGroup[]): RoomObstacleLayout {
  const hasRangedGroup = enemies.some((group) => ARCHETYPES[group.archetype].movement === 'keepDistance')
  if (hasRangedGroup) {
    if (Math.random() >= WATER_LAYOUT_CHANCE) {
      return EMPTY_LAYOUT
    }
    return Math.random() < 0.5 ? WATER_SPLIT_HORIZONTAL : WATER_SPLIT_VERTICAL
  }
  return Math.random() < PILLAR_LAYOUT_CHANCE ? generatePillarLayout() : EMPTY_LAYOUT
}

function coordKey(coord: RoomCoord): string {
  return `${coord.x},${coord.y}`
}

/** Random walk from the start room — repeatedly extends from a random already-placed room into a random open neighboring cell. */
function generateLayout(roomCount: number): RoomCoord[] {
  const placed: RoomCoord[] = [START_COORD]
  const placedKeys = new Set([coordKey(START_COORD)])

  let attempts = 0
  while (placed.length < roomCount && attempts < MAX_PLACEMENT_ATTEMPTS) {
    attempts++
    const from = placed[Math.floor(Math.random() * placed.length)]
    for (const direction of shuffled(ALL_DIRECTIONS)) {
      const candidate = getNeighborCoord(from, direction)
      const key = coordKey(candidate)
      if (!placedKeys.has(key)) {
        placed.push(candidate)
        placedKeys.add(key)
        break
      }
    }
  }

  return placed
}

/** BFS distance from the start room to every placed room. */
function computeDistancesFromStart(rooms: RoomCoord[]): Map<string, number> {
  const distances = new Map<string, number>([[coordKey(START_COORD), 0]])
  const queue: RoomCoord[] = [START_COORD]

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentDist = distances.get(coordKey(current))!
    for (const direction of ALL_DIRECTIONS) {
      const neighbor = getNeighborCoord(current, direction)
      const key = coordKey(neighbor)
      if (rooms.some((r) => coordsEqual(r, neighbor)) && !distances.has(key)) {
        distances.set(key, currentDist + 1)
        queue.push(neighbor)
      }
    }
  }

  return distances
}

/** How many other placed rooms this coord is grid-adjacent to — its door count, in effect. */
function degreeOf(coord: RoomCoord, coordSet: Set<string>): number {
  return ALL_DIRECTIONS.filter((direction) => coordSet.has(coordKey(getNeighborCoord(coord, direction)))).length
}

/**
 * Finds an *empty* cell adjacent to one of `anchors` that would have
 * exactly one connection once placed (checked against the full `coordSet`,
 * not just the anchor list, so a spot that happens to also touch some
 * other already-placed room is correctly rejected). Anchors are tried in
 * the order given — callers that care about *which* anchor (e.g. "prefer
 * a room deep in the floor") should pre-sort; ties/no-preference should
 * pre-shuffle. Returns null in the practically-unreachable case that every
 * anchor's every direction is either occupied or would create a second
 * connection — real floors (6-10 rooms, unbounded grid) always have room.
 */
function findDeadEndSpot(anchors: RoomCoord[], coordSet: Set<string>): RoomCoord | null {
  for (const anchor of anchors) {
    for (const direction of shuffled(ALL_DIRECTIONS)) {
      const candidate = getNeighborCoord(anchor, direction)
      if (coordSet.has(coordKey(candidate))) {
        continue
      }
      if (degreeOf(candidate, coordSet) === 1) {
        return candidate
      }
    }
  }
  return null
}

export function generateFloor(level: number): GeneratedFloor {
  // Boss and golden are never naturally-occurring leaves of the random
  // walk — a lot of small trees only have one non-start leaf, so "hope one
  // exists for each" fails far too often. Instead: generate a smaller core
  // layout, then deliberately attach two single-room dead-end spurs for
  // boss and golden, each to a *different* core room — guarantees both by
  // construction (each's only connection is its own anchor) rather than by
  // chance, and guarantees they're never adjacent to each other (if a spot
  // were adjacent to both an anchor and the other spur, its degree would
  // be 2 and findDeadEndSpot would reject it).
  const coreRoomCount = Math.max(roomCountForLevel(level) - 2, 1)
  const coreCoords = generateLayout(coreRoomCount)
  const coreSet = new Set(coreCoords.map(coordKey))

  // Boss prefers anchoring off a room deep in the floor (BFS-furthest from
  // start) so clearing it still feels like reaching the back of the floor,
  // falling through to shallower anchors if the deepest have no free spot.
  const distances = computeDistancesFromStart(coreCoords)
  const bossAnchors = shuffled(coreCoords).sort(
    (a, b) => (distances.get(coordKey(b)) ?? 0) - (distances.get(coordKey(a)) ?? 0),
  )
  const bossCoord = findDeadEndSpot(bossAnchors, coreSet) ?? coreCoords[coreCoords.length - 1]

  const withBossSet = new Set([...coreSet, coordKey(bossCoord)])
  const goldenCoord = findDeadEndSpot(shuffled(coreCoords), withBossSet) ?? coreCoords[0]

  const coords = [...coreCoords, bossCoord, goldenCoord]

  const rooms: RoomDefinition[] = coords.map((coord) => {
    if (coordsEqual(coord, START_COORD)) {
      return { coord, enemies: [], ...EMPTY_LAYOUT }
    }
    if (coordsEqual(coord, bossCoord)) {
      return { coord, enemies: [{ archetype: 'boss', count: 1 }], isBoss: true, ...EMPTY_LAYOUT }
    }
    if (coordsEqual(coord, goldenCoord)) {
      return { coord, enemies: [], isGolden: true, ...EMPTY_LAYOUT }
    }
    const enemies = pickRoomEnemies(level)
    return { coord, enemies, ...pickRoomObstacles(enemies) }
  })

  return { level, rooms, startCoord: START_COORD, bossCoord }
}
