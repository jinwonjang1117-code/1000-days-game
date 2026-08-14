// A small compile-time-known floor layout, imported identically by host,
// joiner, and solo mode — the layout itself never needs to go over the
// network, only which room the host is currently in does (see
// StateMessage.roomCoord in net/syncProtocol.ts). Real procedural
// generation replaces this module later; nothing that consumes it should
// need to change when that happens, since the shape (a list of rooms with
// coords) stays the same.

import type { ArchetypeId } from '../gameplay/enemyArchetypes'

export type Direction = 'north' | 'south' | 'east' | 'west'

export interface RoomCoord {
  x: number
  y: number
}

export interface RoomEnemyGroup {
  archetype: ArchetypeId
  count: number
}

export interface RoomDefinition {
  coord: RoomCoord
  enemies: RoomEnemyGroup[]
}

// A straight line, one room per archetype (plus an empty start room) — the
// simplest layout for testing each archetype in isolation. The old 2x2
// loop only existed to exercise all 4 door directions during step 1; that
// shape wasn't meaningful on its own.
export const TEST_FLOOR: RoomDefinition[] = [
  { coord: { x: 0, y: 0 }, enemies: [] },
  { coord: { x: 1, y: 0 }, enemies: [{ archetype: 'swarmer', count: 5 }] },
  { coord: { x: 2, y: 0 }, enemies: [{ archetype: 'tank', count: 1 }] },
  { coord: { x: 3, y: 0 }, enemies: [{ archetype: 'chaser', count: 2 }] },
  { coord: { x: 4, y: 0 }, enemies: [{ archetype: 'rangedShooter', count: 2 }] },
  { coord: { x: 5, y: 0 }, enemies: [{ archetype: 'splitter', count: 2 }] },
]

export const START_COORD: RoomCoord = { x: 0, y: 0 }

export function coordsEqual(a: RoomCoord, b: RoomCoord): boolean {
  return a.x === b.x && a.y === b.y
}

export function getRoomDefinition(coord: RoomCoord): RoomDefinition | undefined {
  return TEST_FLOOR.find((room) => coordsEqual(room.coord, coord))
}

export function getNeighborCoord(coord: RoomCoord, direction: Direction): RoomCoord {
  switch (direction) {
    case 'north':
      return { x: coord.x, y: coord.y - 1 }
    case 'south':
      return { x: coord.x, y: coord.y + 1 }
    case 'east':
      return { x: coord.x + 1, y: coord.y }
    case 'west':
      return { x: coord.x - 1, y: coord.y }
  }
}

export function hasNeighbor(coord: RoomCoord, direction: Direction): boolean {
  return getRoomDefinition(getNeighborCoord(coord, direction)) !== undefined
}

export function oppositeDirection(direction: Direction): Direction {
  switch (direction) {
    case 'north':
      return 'south'
    case 'south':
      return 'north'
    case 'east':
      return 'west'
    case 'west':
      return 'east'
  }
}

export const ALL_DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west']
