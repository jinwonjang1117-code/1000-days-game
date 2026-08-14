// Procedural floor generation (step 3 of 3: fixed layout -> real
// archetypes -> procedural generation). Replaces the old hand-authored
// TEST_FLOOR with a random-walk layout generated fresh per level, with a
// difficulty ramp (archetype mixing + enemy count) driven by the level
// number. Pure logic, no Phaser dependency, mirrors gameplay/*.ts's
// separation of data/logic from the scene that consumes it.

import type { ArchetypeId } from '../gameplay/enemyArchetypes'
import type { RoomCoord, RoomDefinition, RoomEnemyGroup } from './floorLayout'
import { coordsEqual, getNeighborCoord, ALL_DIRECTIONS } from './floorLayout'

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
function unlockedArchetypes(level: number): ArchetypeId[] {
  const l = clampLevel(level)
  const unlocked: ArchetypeId[] = ['swarmer', 'chaser']
  if (l >= 3) unlocked.push('rangedShooter')
  if (l >= 5) unlocked.push('tank')
  if (l >= 7) unlocked.push('splitter')
  return unlocked
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** How many distinct archetypes this room mixes together (settled: mixing starts level 4, ramps up from there). */
function archetypeCountForRoom(level: number, unlockedCount: number): number {
  const l = clampLevel(level)
  if (l < 4) {
    return 1
  }
  const mixChance = Math.min(Math.max((l - 3) * 0.2, 0), 0.8)
  if (l >= 8 && unlockedCount >= 3 && Math.random() < 0.3) {
    return 3
  }
  return Math.random() < mixChance && unlockedCount >= 2 ? 2 : 1
}

function pickRoomEnemies(level: number): RoomEnemyGroup[] {
  const unlocked = unlockedArchetypes(level)
  const archetypeCount = Math.min(archetypeCountForRoom(level, unlocked.length), unlocked.length)
  const chosen = shuffled(unlocked).slice(0, archetypeCount)

  const total = 3 + Math.floor(clampLevel(level) / 2)
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

/** BFS from the start room — the boss room is whichever placed room is furthest away (ties broken randomly via shuffled adjacency checks). */
function findFurthestCoord(rooms: RoomCoord[]): RoomCoord {
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

  let furthest = START_COORD
  let furthestDist = -1
  for (const room of rooms) {
    const dist = distances.get(coordKey(room)) ?? 0
    if (dist > furthestDist) {
      furthest = room
      furthestDist = dist
    }
  }
  return furthest
}

export function generateFloor(level: number): GeneratedFloor {
  const coords = generateLayout(roomCountForLevel(level))
  const bossCoord = findFurthestCoord(coords)

  const rooms: RoomDefinition[] = coords.map((coord) => {
    if (coordsEqual(coord, START_COORD)) {
      return { coord, enemies: [] }
    }
    if (coordsEqual(coord, bossCoord)) {
      return { coord, enemies: [{ archetype: 'boss', count: 1 }], isBoss: true }
    }
    return { coord, enemies: pickRoomEnemies(level) }
  })

  return { level, rooms, startCoord: START_COORD, bossCoord }
}
