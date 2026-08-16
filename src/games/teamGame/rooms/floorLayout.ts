// Room/coordinate primitives shared by host, joiner, and solo mode. A
// floor's actual room list is no longer one static module constant (see
// rooms/floorGenerator.ts) — it's generated per level and threaded through
// as a plain argument, so these helpers are generic over "any list of
// things with a coord" rather than reading a fixed floor. Only the
// *current* room coord (and, once per level, the room list itself) needs
// to go over the network — see StateMessage.roomCoord and
// LevelStartMessage in net/syncProtocol.ts.

import type { ArchetypeId } from '../gameplay/enemyArchetypes'
import type { RoomObstacle } from './roomLayouts'

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
  /** Marks the floor's boss room — see rooms/floorGenerator.ts and DevTestScene's hole-instead-of-doors handling. */
  isBoss?: boolean
  /** Marks the floor's golden room — no enemies, a guaranteed strong-item drop. One per level, see rooms/floorGenerator.ts. */
  isGolden?: boolean
  /** Room structure (DESIGN.md §9's room-variety stage) — resolved to concrete geometry once at floor-generation time (rooms/floorGenerator.ts's pickRoomObstacles), not a lookup id, since pillar count/placement varies per room. */
  obstacles: RoomObstacle[]
  /** Where non-ranged enemy groups (and this room's regular reward drop, if any) spawn. */
  enemyAnchor: { x: number; y: number }
  /** Where keepDistance/ranged groups spawn instead — only set for a room whose layout splits it (a water-split room). */
  rangedEnemyAnchor?: { x: number; y: number }
}

export function coordsEqual(a: RoomCoord, b: RoomCoord): boolean {
  return a.x === b.x && a.y === b.y
}

export function getRoomDefinition<T extends { coord: RoomCoord }>(rooms: T[], coord: RoomCoord): T | undefined {
  return rooms.find((room) => coordsEqual(room.coord, coord))
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

export function hasNeighbor(rooms: { coord: RoomCoord }[], coord: RoomCoord, direction: Direction): boolean {
  return getRoomDefinition(rooms, getNeighborCoord(coord, direction)) !== undefined
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
