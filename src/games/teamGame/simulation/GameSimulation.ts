import Phaser from 'phaser'
import type { KeyState, StateMessage, LevelStartMessage, Vec2 } from '../net/syncProtocol'
import Player from '../entities/Player'
import Projectile, { PROJECTILE_RADIUS, PROJECTILE_SPEED, PROJECTILE_MAX_RANGE } from '../entities/Projectile'
import Enemy from '../entities/Enemy'
import ItemPickup from '../entities/ItemPickup'
import type { EnemyArchetype } from '../gameplay/enemyArchetypes'
import { ARCHETYPES } from '../gameplay/enemyArchetypes'
import type { ItemId } from '../gameplay/items'
import { getItemLabel, randomBoostItemId, randomStrongItemIds, STAT_ITEMS } from '../gameplay/items'
import { bonusContainersForLevel } from '../gameplay/lives'
import type { Direction, RoomCoord, RoomDefinition } from '../rooms/floorLayout'
import { ALL_DIRECTIONS, getRoomDefinition, getNeighborCoord, hasNeighbor, oppositeDirection, coordsEqual } from '../rooms/floorLayout'
import type { GeneratedFloor } from '../rooms/floorGenerator'
import { generateFloor } from '../rooms/floorGenerator'
import type { MiniMapRoomInfo } from '../ui/MiniMap'
import { showPickupText, spawnExplosionEffect, playFartSound } from '../ui/cosmeticEffects'

// Shared world/door geometry, exported so both PlayScene and DevTestScene
// can draw the same door rectangles / boss-hole circle this class's
// touch-detection math is based on, without duplicating the numbers.
export const WORLD_WIDTH = 800
export const WORLD_HEIGHT = 600
const DOOR_SIZE = 70
const DOOR_DEPTH = 24
const ENTRY_MARGIN = 90
const PLAYER_ENTRY_OFFSET = 30

export interface DoorZone {
  x: number
  y: number
  width: number
  height: number
}

export const DOOR_ZONES: Record<Direction, DoorZone> = {
  north: { x: WORLD_WIDTH / 2 - DOOR_SIZE / 2, y: 0, width: DOOR_SIZE, height: DOOR_DEPTH },
  south: { x: WORLD_WIDTH / 2 - DOOR_SIZE / 2, y: WORLD_HEIGHT - DOOR_DEPTH, width: DOOR_SIZE, height: DOOR_DEPTH },
  east: { x: WORLD_WIDTH - DOOR_DEPTH, y: WORLD_HEIGHT / 2 - DOOR_SIZE / 2, width: DOOR_DEPTH, height: DOOR_SIZE },
  west: { x: 0, y: WORLD_HEIGHT / 2 - DOOR_SIZE / 2, width: DOOR_DEPTH, height: DOOR_SIZE },
}

/** The boss room has no directional doors — clearing it reveals this instead, in the room's center. */
export const BOSS_HOLE_CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }
export const BOSS_HOLE_RADIUS = 36

function isInsideZone(x: number, y: number, zone: DoorZone): boolean {
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height
}

function getEntryCenter(edge: Direction): { x: number; y: number } {
  switch (edge) {
    case 'north':
      return { x: WORLD_WIDTH / 2, y: ENTRY_MARGIN }
    case 'south':
      return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - ENTRY_MARGIN }
    case 'east':
      return { x: WORLD_WIDTH - ENTRY_MARGIN, y: WORLD_HEIGHT / 2 }
    case 'west':
      return { x: ENTRY_MARGIN, y: WORLD_HEIGHT / 2 }
  }
}

/** Two slightly-offset spawn points so both players don't land exactly on top of each other. */
function getEntryPositions(edge: Direction): [{ x: number; y: number }, { x: number; y: number }] {
  const center = getEntryCenter(edge)
  if (edge === 'north' || edge === 'south') {
    return [
      { x: center.x - PLAYER_ENTRY_OFFSET, y: center.y },
      { x: center.x + PLAYER_ENTRY_OFFSET, y: center.y },
    ]
  }
  return [
    { x: center.x, y: center.y - PLAYER_ENTRY_OFFSET },
    { x: center.x, y: center.y + PLAYER_ENTRY_OFFSET },
  ]
}

function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2
  let n = a % twoPi
  if (n < 0) n += twoPi
  return Number(n.toFixed(4))
}

const MOVE_SPEED = 200
const HOST_COLOR = 0x3355ff
const JOINER_COLOR = 0xff6633
const HOST_START = { x: 300, y: 320 }
const JOINER_START = { x: 500, y: 320 }
const ORIGIN_COORD: RoomCoord = { x: 0, y: 0 }

const ENEMY_SPAWN_CENTER = { x: 400, y: 200 }
const ENEMY_SPAWN_SPACING = 60
const ENEMY_PROJECTILE_COLOR = 0xff3366
const ENEMY_PROJECTILE_SPEED = 240
/** Splitter's children spread out a little instead of stacking exactly on the death spot. */
const SPLIT_SPAWN_OFFSET = 20

/** Room-clear rewards (DESIGN.md §7, boost/life tier now; role items/holdables wait on the role system). */
const REGULAR_REWARD_SPACING = 50
const LIFE_ITEM_CHANCE = 0.15
/** Global chance that a non-boss room drops a boost on clear. Tweakable. */
const ROOM_DROP_CHANCE = 0.7
/** Extra shots fired in a spread when a player has picked up Multi Shot, in addition to the center shot. */
const MULTI_SHOT_SPREAD_RADIANS = Phaser.Math.DegToRad(15)

/**
 * The read-only shape any UI layer needs to draw doors/minimap/level
 * text/game-over — `GameSimulation` is the "real" implementer (host/solo);
 * `DevTestScene.ts` implements the same shape on itself for the joiner
 * role, which has no `GameSimulation` to point at. Lets `ui/GameplayHud.ts`
 * serve both roles from one instance without knowing which it's talking to.
 */
export interface RoomUiState {
  readonly currentRoomCoord: RoomCoord
  readonly currentLevel: number
  readonly floorRoomEntries: MiniMapRoomInfo[]
  readonly exploredRooms: RoomCoord[]
  readonly isGameOver: boolean
  readonly isPaused: boolean
  isCurrentRoomBoss(): boolean
  isRoomClear(): boolean
  isDirectionOpen(direction: Direction): boolean
}

export interface GameSimulationOptions {
  scene: Phaser.Scene
  /** True for co-op (host role) — false for single-player. Solo has always been "host simulation with no joiner slot," so this one flag covers both. */
  hasJoiner: boolean
}

/**
 * The role-agnostic core loop — rooms, enemies, projectiles, items, lives,
 * pause, level progression. Extracted from `DevTestScene.ts`, where solo
 * mode and co-op's host role had always run this exact same code, just
 * duplicated in spirit (one class, no joiner slot, no connection) versus
 * (one class, joiner slot, PeerJS). `PlayScene.ts` (single-player) and
 * `DevTestScene.ts` (co-op, host role only) both construct one of these
 * and drive it; a co-op joiner never does — it never simulates anything,
 * so it has nothing in common with this class and keeps its own
 * render-only reconciliation code in `DevTestScene.ts` untouched.
 *
 * Deliberately does NOT own: PeerJS/connection handling, the broadcast
 * timer, or any Phaser "chrome" — door/boss-hole graphics, the minimap,
 * pause menu, game-over text, dev item-menu buttons. Those read this
 * class's state (getters below) and draw themselves; this class just
 * exposes what changed. The one exception is `spawnExplosionEffect`/
 * `showPickupText`/`playFartSound` — cosmetic, but triggered deep inside
 * hit-resolution logic, so it's simplest to keep them here rather than
 * invent an event just to hoist three tween calls out.
 */
export default class GameSimulation implements RoomUiState {
  private readonly scene: Phaser.Scene
  readonly hasJoiner: boolean

  private readonly hostPlayer: Player
  private readonly joinerPlayer?: Player

  private roomEnemies: Map<number, Enemy> = new Map()
  private roomEnemyColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextEnemyId = 0

  private roomCoord: RoomCoord = ORIGIN_COORD
  /** Rooms whose enemies have already been cleared once — loadRoom skips (re)spawning enemies for these. */
  private clearedRooms: RoomCoord[] = []
  /**
   * True only during the exact frame trackRoomCleared() detects a fresh
   * clear — checkRoomTransition holds off for that one frame so a
   * just-spawned reward can't be destroyed (via a door/hole transition)
   * before it's ever visible, e.g. a player already standing inside the
   * boss hole's radius the instant the boss dies.
   */
  private roomJustCleared = false

  private level = 1
  /** Drives hasNeighbor/door logic, boss-room lookup, and the minimap. */
  private floorRooms: MiniMapRoomInfo[] = []
  private explored: RoomCoord[] = []
  /** Always defined once start() has run — set synchronously by the startLevel(1) call inside it. */
  private currentFloor!: GeneratedFloor

  private projectiles: Map<number, Projectile> = new Map()
  private projectileColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextProjectileId = 0

  private enemyProjectiles: Map<number, Projectile> = new Map()
  private enemyProjectileColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextEnemyProjectileId = 0

  private itemPickups: Map<number, ItemPickup> = new Map()
  private itemPickupColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextItemPickupId = 0
  /** Run-wide, not per-player — a `unique` item (see items.ts) is excluded from future strong-item rolls once anyone has gotten it. No item sets `unique` yet, so this has no visible effect today. */
  private grantedUniqueItems: Set<ItemId> = new Set()

  private gameOver = false
  private paused = false
  /** Whether the joiner's fire key is currently held, per its last InputMessage. Unused when !hasJoiner. */
  private joinerFireHeld = false

  private onLevelStart?: (message: LevelStartMessage) => void
  private onGameOver?: () => void

  constructor(options: GameSimulationOptions) {
    this.scene = options.scene
    this.hasJoiner = options.hasJoiner
    this.hostPlayer = new Player(this.scene, HOST_START.x, HOST_START.y, HOST_COLOR, { simulated: true })
    if (options.hasJoiner) {
      this.joinerPlayer = new Player(this.scene, JOINER_START.x, JOINER_START.y, JOINER_COLOR, { simulated: true })
    }
  }

  /** Register before calling start() if the caller needs to broadcast level starts (co-op host only). */
  setOnLevelStart(callback: (message: LevelStartMessage) => void) {
    this.onLevelStart = callback
  }

  /** Register before calling start() if the caller needs to react to game-over (co-op host: send a final snapshot, stop broadcasting). */
  setOnGameOver(callback: () => void) {
    this.onGameOver = callback
  }

  /** Call once, after registering any callbacks — generates the first floor and enters its start room. */
  start() {
    this.startLevel(1)
  }

  // ---- Read-only state for the Scene's UI ----

  get currentRoomCoord(): RoomCoord {
    return this.roomCoord
  }

  get currentLevel(): number {
    return this.level
  }

  get floorRoomEntries(): MiniMapRoomInfo[] {
    return this.floorRooms
  }

  get exploredRooms(): RoomCoord[] {
    return this.explored
  }

  get isGameOver(): boolean {
    return this.gameOver
  }

  get isPaused(): boolean {
    return this.paused
  }

  isCurrentRoomBoss(): boolean {
    return getRoomDefinition(this.floorRooms, this.roomCoord)?.isBoss ?? false
  }

  /** No fight here — see rollRoomClearReward, which drops a guaranteed strong item the instant this room's (already-empty) enemy list is detected clear. */
  private isCurrentRoomGolden(): boolean {
    return getRoomDefinition(this.floorRooms, this.roomCoord)?.isGolden ?? false
  }

  isRoomClear(): boolean {
    return this.roomEnemies.size === 0
  }

  isDirectionOpen(direction: Direction): boolean {
    return hasNeighbor(this.floorRooms, this.roomCoord, direction)
  }

  // ---- Per-frame tick ----

  /** Drives the host player from local input; the joiner (if any) was already driven by the last applyJoinerInput call. */
  update(now: number, hostKeys: KeyState, hostFiring: boolean) {
    this.hostPlayer.setVelocityFromKeys(hostKeys, MOVE_SPEED)

    this.hostPlayer.refreshVisuals(now)
    this.joinerPlayer?.refreshVisuals(now)

    this.roomEnemies.forEach((enemy) => {
      const nearest = this.getNearestPlayerPos(enemy.x, enemy.y)
      enemy.updateMovement(nearest)
      const fireAngle = enemy.tryFireAt(nearest, now)
      if (fireAngle !== null) {
        this.spawnEnemyProjectile(enemy.x, enemy.y, fireAngle)
      }
      enemy.refreshVisuals()
    })

    this.tryFirePlayer(this.hostPlayer, hostFiring, now)
    this.tryFirePlayer(this.joinerPlayer, this.joinerFireHeld, now)

    this.projectiles.forEach((projectile, id) => {
      projectile.updateTravelledDistance()

      // Attached projectiles (homing + pierce, see Projectile.shouldAttachOnHit)
      // stick to one enemy and tick damage on a timer instead of continuing
      // to fly — handled first, and returns before the generic homing-steer
      // logic below, which only applies to a still-flying (non-attached) shot.
      if (projectile.isAttached()) {
        const attachedId = projectile.getAttachedEnemyId()
        if (attachedId === null) {
          return
        }
        const attachedEnemy = this.roomEnemies.get(attachedId)
        if (!attachedEnemy) {
          projectile.detach()
          this.destroyProjectile(id)
          return
        }

        projectile.steerTo({ x: attachedEnemy.x, y: attachedEnemy.y })

        if (projectile.shouldTickAttached(this.scene.time.now)) {
          const diedByTick = attachedEnemy.applyHit(projectile.damage)
          if (diedByTick) {
            this.resolveEnemyDeath(attachedId, attachedEnemy)
          }
        }
        // Attached projectiles do not expire by range; keep them until explicitly destroyed.
        return
      }

      // Not attached: homing steers toward whichever enemy is currently nearest.
      if (projectile.isHoming() && this.roomEnemies.size > 0) {
        let nearest: Enemy | null = null
        let nearestDist = Infinity
        for (const enemy of this.roomEnemies.values()) {
          const d = Phaser.Math.Distance.Between(projectile.x, projectile.y, enemy.x, enemy.y)
          if (d < nearestDist) {
            nearest = enemy
            nearestDist = d
          }
        }
        if (nearest) {
          projectile.steerTo({ x: nearest.x, y: nearest.y })
        }
      }

      if (projectile.hasExpired()) {
        this.destroyProjectile(id)
      }
    })
    this.enemyProjectiles.forEach((projectile, id) => {
      if (projectile.hasExpired()) {
        this.destroyEnemyProjectile(id)
      }
    })

    this.trackRoomCleared()
    this.checkRoomTransition()
  }

  /** Co-op host only: apply the joiner's latest reported input. Movement applies immediately; fire is buffered for the next tick's cooldown check, same as before. */
  applyJoinerInput(keys: KeyState, fire: boolean) {
    this.joinerPlayer?.setVelocityFromKeys(keys, MOVE_SPEED)
    this.joinerFireHeld = fire
  }

  /** Flips pause and freezes/resumes the whole physics world — no menu UI, that's the Scene's job. */
  togglePause() {
    this.paused = !this.paused
    if (this.paused) {
      this.scene.physics.pause()
    } else {
      this.scene.physics.resume()
    }
  }

  /** Dev-menu hook: applies an item straight to the host player, same reveal a real pickup gets. */
  giveItemToHostPlayer(itemId: ItemId) {
    this.applyGrantedItem(itemId, this.hostPlayer)
    showPickupText(this.scene, this.hostPlayer.x, this.hostPlayer.y, getItemLabel(itemId))
    if (itemId === 'fart') {
      playFartSound()
    }
  }

  /** Effect-application, shared by real pickups and the dev give-item menu. 'heart' and 'heartContainer' aren't PlayerStats mutators, so they're special-cased here rather than going through Player.applyItem. */
  private applyGrantedItem(itemId: ItemId, player: Player) {
    if (itemId === 'heart') {
      player.grantLife()
    } else if (itemId === 'heartContainer') {
      player.increaseMaxLives(2)
    } else {
      player.applyItem(itemId)
    }

    if (itemId !== 'heart' && STAT_ITEMS[itemId].unique) {
      this.grantedUniqueItems.add(itemId)
    }
  }

  /** Co-op host only: the broadcast payload, built fresh whenever the caller wants to send one. */
  buildStateMessage(now: number): StateMessage {
    return {
      type: 'state',
      host: this.hostPlayer.getNetworkState(now),
      joiner: this.joinerPlayer
        ? this.joinerPlayer.getNetworkState(now)
        : { pos: { x: 0, y: 0 }, lives: 0, isOut: true, isInvincible: false },
      roomCoord: this.roomCoord,
      enemies: Array.from(this.roomEnemies.values()).map((enemy) => enemy.getNetworkState()),
      projectiles: Array.from(this.projectiles.entries()).map(([id, projectile]) => ({
        id,
        pos: { x: projectile.x, y: projectile.y },
        radius: projectile.radius,
      })),
      enemyProjectiles: Array.from(this.enemyProjectiles.entries()).map(([id, projectile]) => ({
        id,
        pos: { x: projectile.x, y: projectile.y },
        radius: projectile.radius,
      })),
      exploredRooms: this.explored,
      itemPickups: Array.from(this.itemPickups.values()).map((pickup) => ({
        id: pickup.id,
        itemId: pickup.itemId,
        pos: { x: pickup.x, y: pickup.y },
      })),
      isGameOver: this.gameOver,
      isPaused: this.paused,
    }
  }

  /** Cleanup mirroring DevTestScene's old SHUTDOWN handler — destroys every Phaser GameObject this simulation owns. */
  destroy() {
    this.hostPlayer.destroy()
    this.joinerPlayer?.destroy()
    this.projectiles.forEach((projectile) => projectile.destroy())
    this.projectiles.clear()
    this.projectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.projectileColliders.clear()
    this.enemyProjectiles.forEach((projectile) => projectile.destroy())
    this.enemyProjectiles.clear()
    this.enemyProjectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.enemyProjectileColliders.clear()
    this.itemPickups.forEach((pickup) => pickup.destroy())
    this.itemPickups.clear()
    this.itemPickupColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.itemPickupColliders.clear()
    this.roomEnemyColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.roomEnemyColliders.clear()
    this.roomEnemies.forEach((enemy) => enemy.destroy())
    this.roomEnemies.clear()
  }

  // ---- Movement / firing ----

  /** Nearest of whichever players exist and aren't out-of-lives — dead players aren't valid targets. */
  private getNearestPlayerPos(x: number, y: number): Vec2 | null {
    const candidates = [this.hostPlayer, this.joinerPlayer].filter(
      (player): player is Player => !!player && !player.isOut,
    )
    if (candidates.length === 0) {
      return null
    }
    let nearest = candidates[0]
    let nearestDist = Phaser.Math.Distance.Between(x, y, nearest.x, nearest.y)
    for (const player of candidates.slice(1)) {
      const dist = Phaser.Math.Distance.Between(x, y, player.x, player.y)
      if (dist < nearestDist) {
        nearest = player
        nearestDist = dist
      }
    }
    return { x: nearest.x, y: nearest.y }
  }

  /** Fires toward whichever direction the player is currently facing, if its cooldown allows. Multi Shot/Multi Direction stack and compose. */
  private tryFirePlayer(player: Player | undefined, firing: boolean, now: number) {
    if (!player || !firing) {
      return
    }
    if (!player.tryFire(now)) {
      return
    }
    const facing = player.getFacingAngle()
    const stats = player.getStats()
    // Compose base firing angles first based on Multi Direction stacking,
    // then expand each base by Multi Shot stacking so the two effects
    // compose naturally (e.g. Multi Direction + Multi Shot => multiple
    // shots per direction).
    const baseAngles: number[] = []
    const md = stats.hasMultiDirection
    if (md <= 0) {
      baseAngles.push(facing)
    } else if (md === 1) {
      // front/back
      baseAngles.push(facing, normalizeAngle(facing + Math.PI))
    } else if (md === 2) {
      // cardinal four
      baseAngles.push(0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2)
    } else {
      // 8 directions (every 45deg)
      for (let i = 0; i < 8; i++) baseAngles.push((i / 8) * Math.PI * 2)
    }

    const anglesSet = new Set<number>()
    const ms = Math.min(stats.hasMultiShot, 2) // cap at 2 so shots per base are 1/2/3
    for (const base of baseAngles) {
      if (ms === 0) {
        anglesSet.add(normalizeAngle(base))
      } else if (ms === 1) {
        // two-shot: symmetric around base with half-spread
        anglesSet.add(normalizeAngle(base - MULTI_SHOT_SPREAD_RADIANS / 2))
        anglesSet.add(normalizeAngle(base + MULTI_SHOT_SPREAD_RADIANS / 2))
      } else {
        // three-shot: left, center, right
        anglesSet.add(normalizeAngle(base - MULTI_SHOT_SPREAD_RADIANS))
        anglesSet.add(normalizeAngle(base))
        anglesSet.add(normalizeAngle(base + MULTI_SHOT_SPREAD_RADIANS))
      }
    }

    for (const a of anglesSet) this.spawnProjectile(player, a)
  }

  // ---- Rooms ----

  private trackRoomCleared() {
    // Reset every call so checkRoomTransition only ever sees this true for
    // the exact frame a fresh clear happened, not stale from an earlier one.
    this.roomJustCleared = false

    const clear = this.roomEnemies.size === 0
    const wasAlreadyCleared = this.clearedRooms.some((cleared) => coordsEqual(cleared, this.roomCoord))
    if (!clear || wasAlreadyCleared) {
      return
    }

    this.clearedRooms.push(this.roomCoord)
    this.roomJustCleared = true
    this.rollRoomClearReward(this.roomCoord)
  }

  private getTouchedDoorDirection(x: number, y: number): Direction | undefined {
    for (const direction of ALL_DIRECTIONS) {
      if (!this.isDirectionOpen(direction)) {
        continue
      }
      if (isInsideZone(x, y, DOOR_ZONES[direction])) {
        return direction
      }
    }
    return undefined
  }

  /** Only checked once the room is clear — closed doors/the boss hole don't trigger anything before then. */
  private checkRoomTransition() {
    // Same-frame guard: must run after trackRoomCleared() every frame so a
    // room that JUST became clear gets one frame before its door/hole can
    // be walked through — otherwise a player already standing in range
    // (very plausible for the boss hole, dead center of the room) would
    // tear down the reward that was just spawned this same frame before
    // ever seeing it.
    if (this.roomEnemies.size > 0 || this.roomJustCleared) {
      return
    }

    if (this.isCurrentRoomBoss()) {
      for (const player of [this.hostPlayer, this.joinerPlayer]) {
        if (!player) {
          continue
        }
        if (Phaser.Math.Distance.Between(player.x, player.y, BOSS_HOLE_CENTER.x, BOSS_HOLE_CENTER.y) < BOSS_HOLE_RADIUS) {
          this.startLevel(this.level + 1)
          return
        }
      }
      return
    }

    for (const player of [this.hostPlayer, this.joinerPlayer]) {
      if (!player) {
        continue
      }
      const direction = this.getTouchedDoorDirection(player.x, player.y)
      if (direction) {
        this.loadRoom(getNeighborCoord(this.roomCoord, direction), oppositeDirection(direction))
        return
      }
    }
  }

  /**
   * Generates a fresh floor for `level` and enters its start room. Called
   * once from start() and again every time a boss hole is stepped through,
   * so players are explicitly re-teleported to their normal spawn points
   * here — loadRoom only repositions players when given an `enteredFrom`
   * edge, which a brand-new floor's start room doesn't have.
   */
  private startLevel(level: number) {
    // Passive heart-container growth (DESIGN.md §3) — computed off the
    // outgoing level before it's overwritten, so this is a no-op on the
    // very first call (startLevel(1) when this.level is already 1).
    const containerDelta = bonusContainersForLevel(level) - bonusContainersForLevel(this.level)
    if (containerDelta > 0) {
      this.hostPlayer.increaseMaxLives(containerDelta)
      this.joinerPlayer?.increaseMaxLives(containerDelta)
    }

    this.level = level
    this.currentFloor = generateFloor(level)
    this.floorRooms = this.currentFloor.rooms.map((room) => ({
      coord: room.coord,
      isBoss: !!room.isBoss,
      isGolden: !!room.isGolden,
    }))
    this.explored = [this.currentFloor.startCoord]
    this.clearedRooms = []

    // No-ops for a player who wasn't out — safe to call every level start,
    // including the very first one.
    this.hostPlayer.respawnForNextLevel()
    this.joinerPlayer?.respawnForNextLevel()

    this.hostPlayer.teleport(HOST_START.x, HOST_START.y)
    this.joinerPlayer?.teleport(JOINER_START.x, JOINER_START.y)

    this.loadRoom(this.currentFloor.startCoord)

    this.onLevelStart?.({
      type: 'levelStart',
      level,
      startCoord: this.currentFloor.startCoord,
      rooms: this.floorRooms,
    })
  }

  /**
   * Tears down the current room's enemies/projectiles and builds the next
   * one. `enteredFrom` is the edge of the *new* room being entered through
   * — omitted for the very first room, since freshly-constructed Players
   * are already at their normal spawn points.
   */
  private loadRoom(coord: RoomCoord, enteredFrom?: Direction) {
    this.roomEnemyColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.roomEnemyColliders.clear()
    this.roomEnemies.forEach((enemy) => enemy.destroy())
    this.roomEnemies.clear()

    // Projectiles don't carry through a door.
    this.projectiles.forEach((projectile) => projectile.destroy())
    this.projectiles.clear()
    this.projectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.projectileColliders.clear()
    this.enemyProjectiles.forEach((projectile) => projectile.destroy())
    this.enemyProjectiles.clear()
    this.enemyProjectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.enemyProjectileColliders.clear()

    // Uncollected pickups don't carry through a door either — same reasoning as projectiles.
    this.itemPickups.forEach((pickup) => pickup.destroy())
    this.itemPickups.clear()
    this.itemPickupColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.itemPickupColliders.clear()

    if (enteredFrom) {
      const [posA, posB] = getEntryPositions(enteredFrom)
      this.hostPlayer.teleport(posA.x, posA.y)
      this.joinerPlayer?.teleport(posB.x, posB.y)
    }

    this.roomCoord = coord
    if (!this.explored.some((explored) => coordsEqual(explored, coord))) {
      this.explored.push(coord)
    }

    const room = getRoomDefinition(this.currentFloor?.rooms ?? [], coord)
    const alreadyCleared = this.clearedRooms.some((cleared) => coordsEqual(cleared, coord))
    if (room && !alreadyCleared) {
      this.spawnRoomEnemies(room)
    }
    this.trackRoomCleared()
  }

  // ---- Enemies ----

  /** One room-clear spawn wave, grouped by archetype. */
  private spawnRoomEnemies(room: RoomDefinition) {
    let index = 0
    const total = room.enemies.reduce((sum, group) => sum + group.count, 0)
    for (const group of room.enemies) {
      const archetype = ARCHETYPES[group.archetype]
      for (let i = 0; i < group.count; i++) {
        const x = ENEMY_SPAWN_CENTER.x + (index - (total - 1) / 2) * ENEMY_SPAWN_SPACING
        this.spawnEnemy(archetype, x, ENEMY_SPAWN_CENTER.y)
        index++
      }
    }
  }

  /** Registers overlap against whichever of hostPlayer/joinerPlayer exist (solo has only one). Also used by the split-on-death path. */
  private spawnEnemy(archetype: EnemyArchetype, x: number, y: number) {
    const id = this.nextEnemyId++
    const enemy = new Enemy(this.scene, id, archetype, x, y, { simulated: true })
    this.roomEnemies.set(id, enemy)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    const hostPlayer = this.hostPlayer
    colliders.push(this.scene.physics.add.overlap(hostPlayer.square, enemy.square, () => this.handleHit(hostPlayer)))
    const joinerPlayer = this.joinerPlayer
    if (joinerPlayer) {
      colliders.push(this.scene.physics.add.overlap(joinerPlayer.square, enemy.square, () => this.handleHit(joinerPlayer)))
    }

    // spawnProjectile only wires a shot up against enemies that already
    // existed at the moment it was fired — an enemy spawned afterward
    // (most notably a Splitter's children, spawned mid-flight when a
    // piercing shot kills their parent) had no overlap registered against
    // any already-flying projectile at all, so a piercing shot could never
    // actually hit them despite having pierce charges left. Wired up here,
    // from the enemy side, for every projectile currently in flight.
    this.projectiles.forEach((projectile, projectileId) => {
      const collider = this.scene.physics.add.overlap(projectile.shape, enemy.square, () => {
        this.handleProjectileHitEnemy(projectileId, id)
      })
      colliders.push(collider)
      this.projectileColliders.get(projectileId)?.push(collider)
    })

    this.roomEnemyColliders.set(id, colliders)
  }

  /** Shared cleanup for an enemy that just died, however it died (projectile hit or an attached tick) — removes it and resolves split/explode. */
  private resolveEnemyDeath(enemyId: number, enemy: Enemy) {
    const { splitsOnDeath, splitCount, explodesOnDeath, explosionRadius } = enemy.archetype
    const deathX = enemy.x
    const deathY = enemy.y

    this.roomEnemyColliders.get(enemyId)?.forEach((collider) => collider.destroy())
    this.roomEnemyColliders.delete(enemyId)
    enemy.destroy()
    this.roomEnemies.delete(enemyId)

    if (splitsOnDeath && splitCount) {
      const childArchetype = ARCHETYPES[splitsOnDeath]
      for (let i = 0; i < splitCount; i++) {
        const angle = (i / splitCount) * Math.PI * 2
        this.spawnEnemy(
          childArchetype,
          deathX + Math.cos(angle) * SPLIT_SPAWN_OFFSET,
          deathY + Math.sin(angle) * SPLIT_SPAWN_OFFSET,
        )
      }
    }

    // Strong Swarmer's escalation — a normal hit (DESIGN.md §3, no damage
    // variance), just triggered by proximity at death instead of contact
    // while alive. Reuses handleHit, so invincibility frames already apply
    // for free.
    if (explodesOnDeath) {
      const radius = explosionRadius ?? 0
      for (const player of [this.hostPlayer, this.joinerPlayer]) {
        if (player && !player.isOut && Phaser.Math.Distance.Between(player.x, player.y, deathX, deathY) <= radius) {
          this.handleHit(player)
        }
      }
      spawnExplosionEffect(this.scene, deathX, deathY)
    }
  }

  // ---- Item pickups ----

  /** Called exactly once, the moment a room's enemy list first empties. Start room never drops anything. */
  private rollRoomClearReward(coord: RoomCoord) {
    if (coordsEqual(coord, this.currentFloor.startCoord)) {
      return
    }

    // Boss and golden rooms drop 2 *distinct* strong items side by side —
    // in co-op each player can grab a different one; solo, both are
    // available to the one player.
    if (this.isCurrentRoomBoss()) {
      const [firstId, secondId] = randomStrongItemIds(2, this.grantedUniqueItems)
      this.spawnItemPickup(firstId, BOSS_HOLE_CENTER.x - REGULAR_REWARD_SPACING / 2, BOSS_HOLE_CENTER.y - REGULAR_REWARD_SPACING)
      if (secondId) {
        this.spawnItemPickup(secondId, BOSS_HOLE_CENTER.x + REGULAR_REWARD_SPACING / 2, BOSS_HOLE_CENTER.y - REGULAR_REWARD_SPACING)
      }
      return
    }

    // No fight, no regular boost/heart pool — a golden room is a
    // guaranteed strong-item drop and nothing else.
    if (this.isCurrentRoomGolden()) {
      const [firstId, secondId] = randomStrongItemIds(2, this.grantedUniqueItems)
      this.spawnItemPickup(firstId, ENEMY_SPAWN_CENTER.x - REGULAR_REWARD_SPACING / 2, ENEMY_SPAWN_CENTER.y)
      if (secondId) {
        this.spawnItemPickup(secondId, ENEMY_SPAWN_CENTER.x + REGULAR_REWARD_SPACING / 2, ENEMY_SPAWN_CENTER.y)
      }
      return
    }

    // Global gate: boost drops only happen with ROOM_DROP_CHANCE probability.
    if (Math.random() < ROOM_DROP_CHANCE) {
      const boostId = randomBoostItemId()
      this.spawnItemPickup(boostId, ENEMY_SPAWN_CENTER.x - REGULAR_REWARD_SPACING / 2, ENEMY_SPAWN_CENTER.y)
    }

    // Life item still spawns independently at LIFE_ITEM_CHANCE.
    if (Math.random() < LIFE_ITEM_CHANCE) {
      this.spawnItemPickup('heart', ENEMY_SPAWN_CENTER.x + REGULAR_REWARD_SPACING / 2, ENEMY_SPAWN_CENTER.y)
    }
  }

  /** Registers overlap against whichever of hostPlayer/joinerPlayer exist. */
  private spawnItemPickup(itemId: ItemId, x: number, y: number) {
    const id = this.nextItemPickupId++
    const pickup = new ItemPickup(this.scene, id, itemId, x, y, { simulated: true })
    this.itemPickups.set(id, pickup)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    const hostPlayer = this.hostPlayer
    colliders.push(
      this.scene.physics.add.overlap(hostPlayer.square, pickup.shape, () => this.handleItemPickup(id, itemId, hostPlayer)),
    )
    const joinerPlayer = this.joinerPlayer
    if (joinerPlayer) {
      colliders.push(
        this.scene.physics.add.overlap(joinerPlayer.square, pickup.shape, () =>
          this.handleItemPickup(id, itemId, joinerPlayer),
        ),
      )
    }
    this.itemPickupColliders.set(id, colliders)
  }

  private destroyItemPickup(id: number) {
    this.itemPickups.get(id)?.destroy()
    this.itemPickups.delete(id)
    this.itemPickupColliders.get(id)?.forEach((collider) => collider.destroy())
    this.itemPickupColliders.delete(id)
  }

  /** Applies the effect to whichever specific player touched it. */
  private handleItemPickup(pickupId: number, itemId: ItemId, player: Player) {
    this.destroyItemPickup(pickupId)
    this.applyGrantedItem(itemId, player)

    showPickupText(this.scene, player.x, player.y, getItemLabel(itemId))
    if (itemId === 'fart') {
      playFartSound()
    }
  }

  // ---- Projectiles ----

  /** Spawns a projectile (reading the firing player's item-boosted stats) and wires overlap detection against every enemy currently in the room. */
  private spawnProjectile(player: Player, angle: number) {
    const id = this.nextProjectileId++
    const stats = player.getStats()
    const projectile = new Projectile(this.scene, id, player.x, player.y, angle, {
      simulated: true,
      damage: stats.potatoDamage,
      speed: PROJECTILE_SPEED * stats.potatoSpeedMultiplier,
      radius: PROJECTILE_RADIUS * stats.potatoSizeMultiplier,
      range: PROJECTILE_MAX_RANGE * stats.potatoRangeMultiplier,
      pierceCount: stats.hasPiercing,
      homingStrength: stats.hasHoming,
    })
    this.projectiles.set(id, projectile)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    this.roomEnemies.forEach((enemy, enemyId) => {
      colliders.push(
        this.scene.physics.add.overlap(projectile.shape, enemy.square, () => {
          this.handleProjectileHitEnemy(id, enemyId)
        }),
      )
    })
    this.projectileColliders.set(id, colliders)
  }

  private destroyProjectile(id: number) {
    this.projectiles.get(id)?.destroy()
    this.projectiles.delete(id)
    this.projectileColliders.get(id)?.forEach((collider) => collider.destroy())
    this.projectileColliders.delete(id)
  }

  /**
   * Applies damage; if lethal, removes the enemy from the room's list for
   * good (and spawns split children, if any). Looks the projectile up
   * (rather than destroying it immediately) because a piercing shot
   * survives a hit — Arcade overlap fires every frame two bodies are
   * touching, not once, so hasHitEnemy/recordEnemyHit guard against
   * re-applying damage to the same enemy while a pierced shot is still
   * passing through it.
   */
  private handleProjectileHitEnemy(projectileId: number, enemyId: number) {
    const projectile = this.projectiles.get(projectileId)
    const enemy = this.roomEnemies.get(enemyId)
    if (!projectile || !enemy || projectile.hasHitEnemy(enemyId)) {
      return
    }
    projectile.recordEnemyHit(enemyId)

    // If projectile can attach (homing+pierce), attach and start periodic ticks.
    // shouldAttachOnHit() already excludes a projectile that's already
    // attached, so a shot can't reassign itself to a different enemy just
    // because it grazed one while chasing its real target.
    if (projectile.shouldAttachOnHit()) {
      projectile.attachTo(enemyId)
    }

    const died = enemy.applyHit(projectile.damage)
    if (died) {
      this.resolveEnemyDeath(enemyId, enemy)
    }

    if (projectile.consumePierce()) {
      // If it attached, keep the projectile around to tick attached damage.
      if (!projectile.isAttached()) {
        this.destroyProjectile(projectileId)
      }
    }
  }

  /** Spawns an enemy shot and wires overlap detection against whichever players currently exist. */
  private spawnEnemyProjectile(x: number, y: number, angle: number) {
    const id = this.nextEnemyProjectileId++
    const projectile = new Projectile(this.scene, id, x, y, angle, {
      simulated: true,
      color: ENEMY_PROJECTILE_COLOR,
      speed: ENEMY_PROJECTILE_SPEED,
    })
    this.enemyProjectiles.set(id, projectile)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    const hostPlayer = this.hostPlayer
    colliders.push(
      this.scene.physics.add.overlap(projectile.shape, hostPlayer.square, () =>
        this.handleEnemyProjectileHitPlayer(id, hostPlayer),
      ),
    )
    const joinerPlayer = this.joinerPlayer
    if (joinerPlayer) {
      colliders.push(
        this.scene.physics.add.overlap(projectile.shape, joinerPlayer.square, () =>
          this.handleEnemyProjectileHitPlayer(id, joinerPlayer),
        ),
      )
    }
    this.enemyProjectileColliders.set(id, colliders)
  }

  private destroyEnemyProjectile(id: number) {
    this.enemyProjectiles.get(id)?.destroy()
    this.enemyProjectiles.delete(id)
    this.enemyProjectileColliders.get(id)?.forEach((collider) => collider.destroy())
    this.enemyProjectileColliders.delete(id)
  }

  /** An enemy shot connecting is the same hit as contact damage, just via a projectile instead of overlap-with-the-enemy-itself. */
  private handleEnemyProjectileHitPlayer(projectileId: number, player: Player) {
    this.destroyEnemyProjectile(projectileId)
    this.handleHit(player)
  }

  /** Applies a hit and checks for a simultaneous both-out game over (no joiner: hostPlayer alone). */
  private handleHit(player: Player) {
    player.applyHit(this.scene.time.now)

    const hostOut = this.hostPlayer.isOut
    const joinerOut = this.joinerPlayer ? this.joinerPlayer.isOut : true
    if (hostOut && joinerOut) {
      this.gameOver = true
      this.scene.physics.pause()
      this.onGameOver?.()
    }
  }
}
