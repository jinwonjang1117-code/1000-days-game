import Phaser from 'phaser'
import type { RoomCoord } from '../rooms/floorLayout'
import { coordsEqual, getNeighborCoord, ALL_DIRECTIONS } from '../rooms/floorLayout'
import type { RoomObstacle } from '../rooms/roomLayouts'

const ROOM_SQUARE_SIZE = 14
const ROOM_GAP = 4
const PANEL_PADDING = 10
const BACKDROP_COLOR = 0x000000
const BACKDROP_ALPHA = 0.5

const UNEXPLORED_ALPHA = 0
const KNOWN_COLOR = 0x555566
const EXPLORED_COLOR = 0xccddff
const BOSS_COLOR = 0xdd2222
const GOLDEN_COLOR = 0xffcc00
const CURRENT_ROOM_STROKE = 0xffffff

export interface MiniMapRoomInfo {
  coord: RoomCoord
  isBoss: boolean
  isGolden: boolean
  /** Not used by the minimap itself — carried here purely so this already-shared per-room shape gets it to the joiner too, same as isBoss/isGolden (see CoopPlayScene's obstacle rendering). */
  obstacles: RoomObstacle[]
}

/**
 * Fog-of-war minimap, anchored by its top-right corner at (x, y). A room
 * square is invisible until it's either been visited or is adjacent to a
 * visited room ("known") — nothing about the floor's shape is revealed
 * upfront. The boss and golden rooms get distinct colors as soon as
 * they're known, same as any other room becoming visible — they just
 * look different once seen.
 */
export default class MiniMap {
  private readonly container: Phaser.GameObjects.Container
  private readonly squares: Map<
    string,
    { coord: RoomCoord; isBoss: boolean; isGolden: boolean; rect: Phaser.GameObjects.Rectangle }
  > = new Map()

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.container = scene.add.container(x, y).setDepth(150)
  }

  /** (Re)builds the squares for a freshly-generated floor. Called once per level start. */
  setFloor(rooms: MiniMapRoomInfo[], _startCoord: RoomCoord) {
    this.container.removeAll(true)
    this.squares.clear()

    if (rooms.length === 0) {
      return
    }

    const xs = rooms.map((r) => r.coord.x)
    const ys = rooms.map((r) => r.coord.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const gridWidth = Math.max(...xs) - minX + 1
    const gridHeight = Math.max(...ys) - minY + 1
    const cell = ROOM_SQUARE_SIZE + ROOM_GAP

    const panelWidth = gridWidth * cell + PANEL_PADDING * 2
    const panelHeight = gridHeight * cell + PANEL_PADDING * 2

    const backdrop = new Phaser.GameObjects.Rectangle(
      this.container.scene,
      0,
      0,
      panelWidth,
      panelHeight,
      BACKDROP_COLOR,
      BACKDROP_ALPHA,
    ).setOrigin(1, 0)
    this.container.add(backdrop)

    for (const room of rooms) {
      const column = room.coord.x - minX
      const row = room.coord.y - minY
      const localX = -panelWidth + PANEL_PADDING + column * cell + ROOM_SQUARE_SIZE / 2
      const localY = PANEL_PADDING + row * cell + ROOM_SQUARE_SIZE / 2

      const rect = new Phaser.GameObjects.Rectangle(
        this.container.scene,
        localX,
        localY,
        ROOM_SQUARE_SIZE,
        ROOM_SQUARE_SIZE,
        KNOWN_COLOR,
        UNEXPLORED_ALPHA,
      )
      this.container.add(rect)
      this.squares.set(coordKey(room.coord), { coord: room.coord, isBoss: room.isBoss, isGolden: room.isGolden, rect })
    }
  }

  /** Updates fill/visibility/highlight. Called whenever exploredRooms or the current room coord changes. */
  refresh(explored: RoomCoord[], current: RoomCoord) {
    const exploredKeys = new Set(explored.map(coordKey))
    const knownKeys = new Set(exploredKeys)
    for (const coord of explored) {
      for (const direction of ALL_DIRECTIONS) {
        const neighborKey = coordKey(getNeighborCoord(coord, direction))
        if (this.squares.has(neighborKey)) {
          knownKeys.add(neighborKey)
        }
      }
    }

    for (const [key, entry] of this.squares) {
      const isExplored = exploredKeys.has(key)
      const isKnown = knownKeys.has(key)
      const isCurrent = coordsEqual(entry.coord, current)

      if (!isKnown) {
        entry.rect.setFillStyle(KNOWN_COLOR, UNEXPLORED_ALPHA)
        entry.rect.setStrokeStyle()
        continue
      }

      const fillColor = entry.isBoss
        ? BOSS_COLOR
        : entry.isGolden
          ? GOLDEN_COLOR
          : isExplored
            ? EXPLORED_COLOR
            : KNOWN_COLOR
      entry.rect.setFillStyle(fillColor, 1)
      if (isCurrent) {
        entry.rect.setStrokeStyle(2, CURRENT_ROOM_STROKE, 1)
      } else {
        entry.rect.setStrokeStyle()
      }
    }
  }

  destroy() {
    this.container.destroy()
  }
}

function coordKey(coord: RoomCoord): string {
  return `${coord.x},${coord.y}`
}
