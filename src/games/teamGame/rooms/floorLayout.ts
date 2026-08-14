// A small compile-time-known floor layout, imported identically by host,
// joiner, and solo mode — the layout itself never needs to go over the
// network, only which room the host is currently in does (see
// StateMessage.roomCoord in net/syncProtocol.ts). Real procedural
// generation replaces this module later; nothing that consumes it should
// need to change when that happens, since the shape (a list of rooms with
// coords) stays the same.

export type Direction = 'north' | 'south' | 'east' | 'west'

export interface RoomCoord {
  x: number
  y: number
}

export interface RoomDefinition {
  coord: RoomCoord
  enemyCount: number
}

// A 2x2 loop — small, but exercises all 4 door directions and a room with
// two doors, unlike a straight line of rooms would.
export const TEST_FLOOR: RoomDefinition[] = [
  { coord: { x: 0, y: 0 }, enemyCount: 1 }, // start room
  { coord: { x: 1, y: 0 }, enemyCount: 2 },
  { coord: { x: 1, y: 1 }, enemyCount: 2 },
  { coord: { x: 0, y: 1 }, enemyCount: 2 },
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
