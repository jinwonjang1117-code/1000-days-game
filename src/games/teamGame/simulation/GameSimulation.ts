import Phaser from 'phaser'
import type { KeyState, StateMessage, LevelStartMessage, Vec2 } from '../net/syncProtocol'
import Player from '../entities/Player'
import Projectile, { PROJECTILE_RADIUS, PROJECTILE_SPEED, PROJECTILE_MAX_RANGE, projectileColorForDamage } from '../entities/Projectile'
import Enemy from '../entities/Enemy'
import ItemPickup from '../entities/ItemPickup'
import Buddy from '../entities/Buddy'
import OrbitingShield from '../entities/OrbitingShield'
import HazardZone from '../entities/HazardZone'
import Chest from '../entities/Chest'
import type { EnemyArchetype } from '../gameplay/enemyArchetypes'
import { ARCHETYPES } from '../gameplay/enemyArchetypes'
import type { ItemId } from '../gameplay/items'
import { getItemLabel, randomBoostItemId, randomRewardItemIds, STAT_ITEMS } from '../gameplay/items'
import { bonusContainersForLevel } from '../gameplay/lives'
import type { Direction, RoomCoord, RoomDefinition, RoomEnemyGroup } from '../rooms/floorLayout'
import { ALL_DIRECTIONS, getRoomDefinition, getNeighborCoord, hasNeighbor, oppositeDirection, coordsEqual } from '../rooms/floorLayout'
import type { GeneratedFloor } from '../rooms/floorGenerator'
import { generateFloor } from '../rooms/floorGenerator'
import type { ObstacleType, RoomObstacle } from '../rooms/roomLayouts'
import { ARENA_MIN_X, ARENA_MAX_X, ARENA_MIN_Y, ARENA_MAX_Y } from '../rooms/roomLayouts'
import type { MiniMapRoomInfo } from '../ui/MiniMap'
import { showPickupText, spawnExplosionEffect, playFartSound } from '../ui/cosmeticEffects'

// Shared world/door geometry, exported so both PlayScene and CoopPlayScene
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

/**
 * Nudges a chase-movement spawn position toward the room edge farthest
 * from `enteredFrom` (the door the player is walking in through) — see
 * CHASE_ENEMY_ENTRY_PUSH. No-ops for the very first room of a level, which
 * has no enteredFrom (there's no "walking in" to react to).
 */
function pushAwayFromEntry(x: number, y: number, enteredFrom: Direction | undefined): Vec2 {
  if (!enteredFrom) {
    return { x, y }
  }
  switch (enteredFrom) {
    case 'north':
      return { x, y: Math.min(ARENA_MAX_Y, y + CHASE_ENEMY_ENTRY_PUSH) }
    case 'south':
      return { x, y: Math.max(ARENA_MIN_Y, y - CHASE_ENEMY_ENTRY_PUSH) }
    case 'west':
      return { x: Math.min(ARENA_MAX_X, x + CHASE_ENEMY_ENTRY_PUSH), y }
    case 'east':
      return { x: Math.max(ARENA_MIN_X, x - CHASE_ENEMY_ENTRY_PUSH), y }
  }
}

/** A random point at [minDistance, maxDistance] from `origin`, in a random direction, clamped to the arena's safe area — used to spread the boss-clear bonus coins/life items, and a Chest's rewards/ambush Swarmers, out instead of stacking them on one spot. */
function scatterPosition(origin: Vec2, minDistance: number, maxDistance: number): Vec2 {
  const angle = Math.random() * Math.PI * 2
  const distance = minDistance + Math.random() * (maxDistance - minDistance)
  return {
    x: Phaser.Math.Clamp(origin.x + Math.cos(angle) * distance, ARENA_MIN_X, ARENA_MAX_X),
    y: Phaser.Math.Clamp(origin.y + Math.sin(angle) * distance, ARENA_MIN_Y, ARENA_MAX_Y),
  }
}

/** Chest's coin reward — a single weighted pick among 0/1/2, not three independent rolls (25% 2, 50% 1, 25% 0). */
function rollChestCoinCount(): number {
  const r = Math.random()
  if (r < 0.25) {
    return 2
  }
  if (r < 0.75) {
    return 1
  }
  return 0
}

/**
 * A projectile-vs-enemy collider registered by spawnEnemy (for an enemy
 * spawned mid-flight, e.g. a Splitter's children) is deliberately stored in
 * both roomEnemyColliders (so it's cleaned up when that enemy dies) and
 * projectileColliders (so it's cleaned up when that projectile is
 * destroyed) — whichever happens first destroys the shared Collider object,
 * leaving a dangling reference in the other map. Phaser's Collider.destroy()
 * nulls out `this.world` and is not itself idempotent (a second call throws
 * trying to read `.removeCollider` off that null), so every destroy call
 * site that might touch a possibly-already-shared collider goes through
 * this guard instead of calling `.destroy()` directly.
 */
function destroyCollider(collider: Phaser.Physics.Arcade.Collider) {
  if (collider.active) {
    collider.destroy()
  }
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
/**
 * How far a `movement: 'chase'` group's spawn nudges toward the room's far
 * side from wherever the player just walked in — so a beelining enemy
 * doesn't spawn right in the player's face at the door. Only chase movement
 * gets this: 'bounce'/'erratic' don't target the player at all, ranged
 * archetypes already keep their distance on their own, and 'charge' idles
 * until triggered rather than closing in immediately. Clamped to the
 * arena's safe area (roomLayouts.ts's ARENA_MIN/MAX) so the push can't
 * shove them into a wall or another door.
 */
const CHASE_ENEMY_ENTRY_PUSH = 140

/**
 * Room-clear rewards (DESIGN.md §7, boost/life/coin tier now; role items/
 * holdables wait on the role system). Only the boost roll (ROOM_DROP_CHANCE)
 * requires a no-hit clear (see rollRoomClearReward/tookDamageThisRoom) —
 * LIFE_ITEM_CHANCE and COIN_DROP_CHANCE always get rolled regardless of
 * whether anyone got hit, so a rough room clear still has a real shot at
 * healing back up or earning currency, just not the boost. Golden/boss
 * rooms are unaffected by any of this either way — they're not "fights to
 * play cleanly" in the same sense (golden has no enemies at all; boss's
 * guaranteed drop is a separate, deliberate design choice).
 */
const REGULAR_REWARD_SPACING = 50
const LIFE_ITEM_CHANCE = 0.25
/** Coins are groundwork for the future shop (roadmap stage 13, CLAUDE.md) — nothing spends them yet. */
const COIN_DROP_CHANCE = 0.5
/** Opens a Chest — see the Chest section below. Unconditional, same class as coin/life. */
const KEY_DROP_CHANCE = 0.2
/** Chance that a no-hit non-boss room drops a boost on clear. Tweakable. */
const ROOM_DROP_CHANCE = 0.6
/**
 * Boss-clear bonus, on top of the guaranteed 2-item drop above — a random
 * count of coins/life items/keys scattered outward from wherever the boss
 * died (see resolveEnemyDeath's lastEnemyDeathPos / scatterPosition), not
 * gated by anything since a boss fight itself is already the harder bar to
 * clear.
 */
const BOSS_BONUS_COIN_MIN = 1
const BOSS_BONUS_COIN_MAX = 4
const BOSS_BONUS_LIFE_MIN = 1
const BOSS_BONUS_LIFE_MAX = 2
const BOSS_BONUS_KEY_MIN = 0
const BOSS_BONUS_KEY_MAX = 2
const BOSS_BONUS_SCATTER_MIN_DISTANCE = 60
const BOSS_BONUS_SCATTER_MAX_DISTANCE = 250
/**
 * Chest open outcome (DESIGN.md §9) — 15% of opens are a mimic: 2 ambush
 * Swarmers (countsForClear: false, so they can't re-close already-open
 * doors) and nothing else. Every other open independently rolls each of
 * heart/key/coin/boost — a chest can give several rewards at once, or none
 * at all if every roll misses; see rollChestCoinCount for the coin roll's
 * own 0/1/2 weighting (not independent — the three outcomes are one pick).
 */
const CHEST_AMBUSH_CHANCE = 0.15
const CHEST_AMBUSH_SWARMER_COUNT = 2
const CHEST_AMBUSH_SCATTER_MIN_DISTANCE = 20
const CHEST_AMBUSH_SCATTER_MAX_DISTANCE = 60
const CHEST_HEART_CHANCE = 0.5
const CHEST_KEY_CHANCE = 0.5
const CHEST_BOOST_CHANCE = 0.1
const CHEST_REWARD_SCATTER_MIN_DISTANCE = 30
const CHEST_REWARD_SCATTER_MAX_DISTANCE = 90
/** Extra shots fired in a spread when a player has picked up Multi Shot, in addition to the center shot. */
const MULTI_SHOT_SPREAD_RADIANS = Phaser.Math.DegToRad(15)

/** Buddy's shot is fixed, deliberately not reading the owning player's stats (DESIGN.md's composability tenet calls this out explicitly as the one exception). */
const BUDDY_PROJECTILE_RADIUS = 3
const BUDDY_PROJECTILE_DAMAGE = 1
const BUDDY_COLOR = 0x33aaff
/** Radians/sec — shared by every shield on a player so a stack stays evenly spaced while it rotates. */
const SHIELD_ANGULAR_SPEED = 1.5
const SHIELD_ORBIT_RADIUS = 50

/** Room obstacles (DESIGN.md §9) — water is translucent so it visually reads as "you can see/shoot across it," unlike a solid rock. */
const ROCK_COLOR = 0x554433
const WATER_COLOR = 0x3366cc

/**
 * The read-only shape any UI layer needs to draw doors/minimap/level
 * text/game-over — `GameSimulation` is the "real" implementer (host/solo);
 * `CoopPlayScene.ts` implements the same shape on itself for the joiner
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
  /**
   * "Own"/"partner" are perspective-relative, not host/joiner-relative —
   * whichever implementer this is, `own` is always the player controlled
   * from *this* screen (GameSimulation only ever runs on the host's own
   * machine, so `own` is hostPlayer there; CoopPlayScene's joiner-role
   * self-implementation is only ever used on the joiner's own screen, so
   * `own` is joinerPlayer there). `partner` is null in solo (no joiner).
   */
  readonly ownLives: number
  readonly ownMaxLives: number
  readonly partnerLives: number | null
  readonly partnerMaxLives: number | null
  /** Team-shared, not per-player — see GameSimulation's coinCount field. Nothing spends this yet (roadmap stage 13, the future shop). */
  readonly coins: number
  /** Team-shared, not per-player — opens Chests. See GameSimulation's keyCount field. */
  readonly keys: number
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
 * pause, level progression. Extracted from `CoopPlayScene.ts`, where solo
 * mode and co-op's host role had always run this exact same code, just
 * duplicated in spirit (one class, no joiner slot, no connection) versus
 * (one class, joiner slot, PeerJS). `PlayScene.ts` (single-player) and
 * `CoopPlayScene.ts` (co-op, host role only) both construct one of these
 * and drive it; a co-op joiner never does — it never simulates anything,
 * so it has nothing in common with this class and keeps its own
 * render-only reconciliation code in `CoopPlayScene.ts` untouched.
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

  // Room structure (DESIGN.md §9) — rebuilt every loadRoom() alongside
  // enemies/projectiles/pickups. Player-vs-obstacle colliders are wired up
  // once here at spawn time (players are only ever created once, in the
  // constructor); enemy-vs-obstacle and projectile-vs-obstacle colliders
  // are wired from the enemy/projectile side instead (see spawnEnemy /
  // spawnProjectile) since obstacles always exist first in a room, never
  // spawned mid-room afterward.
  private roomObstacles: { shape: Phaser.GameObjects.Rectangle; type: ObstacleType }[] = []
  private obstacleColliders: Phaser.Physics.Arcade.Collider[] = []

  private roomCoord: RoomCoord = ORIGIN_COORD
  /** Rooms whose enemies have already been cleared once — loadRoom skips (re)spawning enemies for these. */
  private clearedRooms: RoomCoord[] = []
  /**
   * Uncollected item pickups, snapshotted per room on exit so they're still
   * there on a return visit instead of despawning like projectiles do.
   * Keyed by coordKey(coord); reset per level in startLevel() alongside
   * clearedRooms, since a fresh floor has none of this level's history.
   */
  private persistedItemPickups: Map<string, { itemId: ItemId; x: number; y: number }[]> = new Map()
  /**
   * True only during the exact frame trackRoomCleared() detects a fresh
   * clear — checkRoomTransition holds off for that one frame so a
   * just-spawned reward can't be destroyed (via a door/hole transition)
   * before it's ever visible, e.g. a player already standing inside the
   * boss hole's radius the instant the boss dies.
   */
  private roomJustCleared = false
  /** Reset on every loadRoom(), set by handleHit — gates the regular-room reward roll in rollRoomClearReward (no-hit clears only). */
  private tookDamageThisRoom = false
  /** Reset on every loadRoom(), set by resolveEnemyDeath — a boss room only ever holds one enemy, so this is the boss's death position by the time rollRoomClearReward runs (see scatterBossBonusRewards). */
  private lastEnemyDeathPos: Vec2 | null = null

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
  /** Team-shared currency, not per-player — matches how this is a shared-room co-op (both players are always together), and the eventual shop room will be too. Nothing spends this yet (roadmap stage 13) — groundwork only. */
  private coinCount = 0
  /** Team-shared, not per-player — opens Chests (see spawnChest/handleChestTouch). */
  private keyCount = 0
  /** coordKey(coord) of every room whose Chest has already been opened this level — reset in startLevel(), checked in loadRoom() so a re-opened chest doesn't respawn on a return visit. */
  private openedChests: Set<string> = new Set()
  /** True once the golden room's locked door (level 2+, see isGoldenDoorLocked) has been paid for this level — reset in startLevel(). Only one golden room per level, so a single flag is enough. */
  private goldenDoorUnlocked = false
  /** At most one per room — room-scoped like hazard zones, torn down every loadRoom(). */
  private chest: Chest | null = null
  private chestColliders: Phaser.Physics.Arcade.Collider[] = []
  private nextChestId = 0

  // Slime's periodic drop (DESIGN.md's enemy-variety pass) — room-scoped
  // like enemies/projectiles/pickups, not persistent like Buddy/Shield, so
  // torn down every loadRoom() alongside them.
  private hazardZones: Map<number, HazardZone> = new Map()
  private hazardZoneColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextHazardZoneId = 0

  // Buddy/Orbiting Shield (DESIGN.md §7) — unlike rooms/enemies/projectiles,
  // these persist across room transitions (they follow the player, not the
  // room), so they live at the top level, not inside loadRoom's teardown.
  private hostBuddies: Buddy[] = []
  private joinerBuddies: Buddy[] = []
  private nextBuddyId = 0
  private hostShields: OrbitingShield[] = []
  private joinerShields: OrbitingShield[] = []
  private nextShieldId = 0

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

  /** GameSimulation only ever runs on the host's own machine (solo or co-op host role) — "own" is always hostPlayer here. */
  get ownLives(): number {
    return this.hostPlayer.getLives()
  }

  get ownMaxLives(): number {
    return this.hostPlayer.getMaxLives()
  }

  get partnerLives(): number | null {
    return this.joinerPlayer ? this.joinerPlayer.getLives() : null
  }

  get partnerMaxLives(): number | null {
    return this.joinerPlayer ? this.joinerPlayer.getMaxLives() : null
  }

  get coins(): number {
    return this.coinCount
  }

  get keys(): number {
    return this.keyCount
  }

  isCurrentRoomBoss(): boolean {
    return getRoomDefinition(this.floorRooms, this.roomCoord)?.isBoss ?? false
  }

  /** No fight here — see rollRoomClearReward, which drops a guaranteed strong item the instant this room's (already-empty) enemy list is detected clear. */
  private isCurrentRoomGolden(): boolean {
    return getRoomDefinition(this.floorRooms, this.roomCoord)?.isGolden ?? false
  }

  /** True if any live enemy actually counts toward "room clear" — a Chest mimic's ambush Swarmers (countsForClear: false) don't, so they can't re-close already-open doors. */
  private hasClearBlockingEnemies(): boolean {
    for (const enemy of this.roomEnemies.values()) {
      if (enemy.countsForClear) {
        return true
      }
    }
    return false
  }

  isRoomClear(): boolean {
    return !this.hasClearBlockingEnemies()
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
      enemy.updateMovement(nearest, now)
      const fireAngles = enemy.tryFireAt(nearest, now)
      fireAngles?.forEach((angle) => this.spawnEnemyProjectile(enemy.x, enemy.y, angle, enemy.archetype.ranged?.range))
      const summonArchetype = enemy.trySummonAt(now)
      if (summonArchetype) {
        this.spawnEnemy(ARCHETYPES[summonArchetype], enemy.x, enemy.y)
      }
      if (enemy.tryDropHazardAt(now) && enemy.archetype.hazard) {
        this.spawnHazardZone(enemy.x, enemy.y, enemy.archetype.hazard.radius, enemy.archetype.hazard.durationMs)
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

    this.updateBuddies(this.hostPlayer, this.hostBuddies)
    if (this.joinerPlayer) this.updateBuddies(this.joinerPlayer, this.joinerBuddies)
    this.updateShields(this.hostPlayer, this.hostShields, now)
    if (this.joinerPlayer) this.updateShields(this.joinerPlayer, this.joinerShields, now)

    this.trackRoomCleared()
    this.checkRoomTransition()
  }

  // ---- Buddy / Orbiting Shield ----

  /** Chain-follow: the first Buddy trails the player, each subsequent one trails the previous — an Isaac-style trailing line rather than everyone independently chasing the player. */
  private updateBuddies(player: Player, buddies: Buddy[]) {
    let targetX = player.x
    let targetY = player.y
    for (const buddy of buddies) {
      buddy.followTarget(targetX, targetY)
      targetX = buddy.x
      targetY = buddy.y
    }
  }

  /** Evenly spaces however many shields this player has around a rotating orbit. */
  private updateShields(player: Player, shields: OrbitingShield[], now: number) {
    if (shields.length === 0) {
      return
    }
    const baseAngle = (now / 1000) * SHIELD_ANGULAR_SPEED
    shields.forEach((shield, index) => {
      const angle = baseAngle + (index / shields.length) * Math.PI * 2
      shield.orbitTo(player.x + Math.cos(angle) * SHIELD_ORBIT_RADIUS, player.y + Math.sin(angle) * SHIELD_ORBIT_RADIUS)
    })
  }

  /** New Buddy for whichever player picked it up — mirrors an existing count on PlayerStats (buddyCount), so no separate "how many should exist" reconciliation is needed. */
  private spawnBuddy(player: Player) {
    const buddies = player === this.hostPlayer ? this.hostBuddies : this.joinerBuddies
    const id = this.nextBuddyId++
    buddies.push(new Buddy(this.scene, id, player.x, player.y, { simulated: true, color: BUDDY_COLOR }))
  }

  /** New Orbiting Shield for whichever player picked it up. Wires overlap against every enemy currently in the room, the same way a freshly-fired projectile does — colliders are stored on the *enemy's* own collider array (roomEnemyColliders) so room-transition teardown cleans them up automatically without a separate map. */
  private spawnShield(player: Player) {
    const shields = player === this.hostPlayer ? this.hostShields : this.joinerShields
    const id = this.nextShieldId++
    const shield = new OrbitingShield(this.scene, id, player.x, player.y, { simulated: true })
    shields.push(shield)

    this.roomEnemies.forEach((enemy, enemyId) => {
      const collider = this.scene.physics.add.overlap(shield.shape, enemy.square, () => {
        this.handleShieldHitEnemy(shield, enemyId, player)
      })
      this.roomEnemyColliders.get(enemyId)?.push(collider)
    })
  }

  /** Contact damage, throttled per (shield, enemy) pair — Arcade overlap fires every frame two bodies are touching, not once, so an untethered cooldown would melt anything standing in a shield's orbit path in a single frame. */
  private handleShieldHitEnemy(shield: OrbitingShield, enemyId: number, owner: Player) {
    const enemy = this.roomEnemies.get(enemyId)
    const now = this.scene.time.now
    if (!enemy || !shield.canHitEnemy(enemyId, now)) {
      return
    }
    shield.recordHit(enemyId, now)
    const died = enemy.applyHit(owner.getStats().potatoDamage)
    if (died) {
      this.resolveEnemyDeath(enemyId, enemy)
    }
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

  /** Dev-menu hook: jumps straight to `level`, regenerating a fresh floor exactly like stepping through a boss hole (see startLevel) — same re-teleport/rebroadcast, just skipping the actual clear. */
  devJumpToLevel(level: number) {
    this.startLevel(level)
  }

  /** Dev-menu hook: applies an item straight to the host player, same reveal a real pickup gets. */
  giveItemToHostPlayer(itemId: ItemId) {
    this.applyGrantedItem(itemId, this.hostPlayer)
    showPickupText(this.scene, this.hostPlayer.x, this.hostPlayer.y, getItemLabel(itemId))
    if (itemId === 'fart') {
      playFartSound()
    }
  }

  /** Effect-application, shared by real pickups and the dev give-item menu. 'heart', 'heartContainer', 'coin', and 'key' aren't PlayerStats mutators, so they're special-cased here rather than going through Player.applyItem. */
  private applyGrantedItem(itemId: ItemId, player: Player) {
    if (itemId === 'heart') {
      player.grantLife()
    } else if (itemId === 'heartContainer') {
      player.increaseMaxLives(1)
    } else if (itemId === 'coin') {
      // Team-shared, not per-player — see the `coins` field/getter.
      this.coinCount++
    } else if (itemId === 'key') {
      // Team-shared, not per-player — see the `keys` field/getter.
      this.keyCount++
    } else {
      player.applyItem(itemId)
    }

    if (itemId === 'buddy') {
      this.spawnBuddy(player)
    } else if (itemId === 'orbitingShield') {
      this.spawnShield(player)
    }

    if (itemId !== 'heart' && itemId !== 'coin' && itemId !== 'key' && STAT_ITEMS[itemId].unique) {
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
        : { pos: { x: 0, y: 0 }, lives: 0, maxLives: 0, isOut: true, isInvincible: false },
      roomCoord: this.roomCoord,
      enemies: Array.from(this.roomEnemies.values()).map((enemy) => enemy.getNetworkState()),
      projectiles: Array.from(this.projectiles.entries()).map(([id, projectile]) => ({
        id,
        pos: { x: projectile.x, y: projectile.y },
        radius: projectile.radius,
        color: projectile.color,
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
      buddies: [...this.hostBuddies, ...this.joinerBuddies].map((buddy) => ({
        id: buddy.id,
        pos: { x: buddy.x, y: buddy.y },
      })),
      shields: [...this.hostShields, ...this.joinerShields].map((shield) => ({
        id: shield.id,
        pos: { x: shield.x, y: shield.y },
      })),
      hazardZones: Array.from(this.hazardZones.values()).map((zone) => ({
        id: zone.id,
        pos: { x: zone.x, y: zone.y },
        radius: zone.radius,
      })),
      isGameOver: this.gameOver,
      isPaused: this.paused,
      coins: this.coinCount,
      keys: this.keyCount,
      chests: this.chest ? [{ id: this.chest.id, pos: { x: this.chest.x, y: this.chest.y } }] : [],
    }
  }

  /** Cleanup mirroring CoopPlayScene's old SHUTDOWN handler — destroys every Phaser GameObject this simulation owns. */
  destroy() {
    this.hostPlayer.destroy()
    this.joinerPlayer?.destroy()
    this.projectiles.forEach((projectile) => projectile.destroy())
    this.projectiles.clear()
    this.projectileColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.projectileColliders.clear()
    this.enemyProjectiles.forEach((projectile) => projectile.destroy())
    this.enemyProjectiles.clear()
    this.enemyProjectileColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.enemyProjectileColliders.clear()
    this.itemPickups.forEach((pickup) => pickup.destroy())
    this.itemPickups.clear()
    this.itemPickupColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.itemPickupColliders.clear()
    this.hazardZones.forEach((zone) => zone.destroy())
    this.hazardZones.clear()
    this.hazardZoneColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.hazardZoneColliders.clear()
    this.chest?.destroy()
    this.chest = null
    this.chestColliders.forEach(destroyCollider)
    this.chestColliders = []
    this.roomEnemyColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.roomEnemyColliders.clear()
    this.roomEnemies.forEach((enemy) => enemy.destroy())
    this.roomEnemies.clear()
    this.hostBuddies.forEach((buddy) => buddy.destroy())
    this.hostBuddies = []
    this.joinerBuddies.forEach((buddy) => buddy.destroy())
    this.joinerBuddies = []
    this.hostShields.forEach((shield) => shield.destroy())
    this.hostShields = []
    this.joinerShields.forEach((shield) => shield.destroy())
    this.joinerShields = []
    this.roomObstacles.forEach((obstacle) => obstacle.shape.destroy())
    this.roomObstacles = []
    this.obstacleColliders.forEach(destroyCollider)
    this.obstacleColliders = []
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

    // Buddy mirrors the player's raw facing, not the Multi Shot/Multi
    // Direction-expanded angle set — deliberately kept simple for this
    // first pass (fixed single shot per buddy per player-fire) rather than
    // composing with those stacks. Flagged, not silent: revisit against
    // the composability tenet (DESIGN.md, top of file) before calling
    // Buddy "done."
    const buddies = player === this.hostPlayer ? this.hostBuddies : this.joinerBuddies
    for (const buddy of buddies) {
      this.spawnBuddyProjectile(buddy.x, buddy.y, facing)
    }
  }

  // ---- Rooms ----

  private trackRoomCleared() {
    // Reset every call so checkRoomTransition only ever sees this true for
    // the exact frame a fresh clear happened, not stale from an earlier one.
    this.roomJustCleared = false

    const clear = !this.hasClearBlockingEnemies()
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
    if (this.hasClearBlockingEnemies() || this.roomJustCleared) {
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
      if (!direction) {
        continue
      }
      const neighborCoord = getNeighborCoord(this.roomCoord, direction)
      if (this.isGoldenDoorLocked(neighborCoord)) {
        if (this.keyCount < 1) {
          // Locked, no key — silently blocked, same as an unopened Chest.
          return
        }
        this.keyCount--
        this.goldenDoorUnlocked = true
      }
      this.loadRoom(neighborCoord, oppositeDirection(direction))
      return
    }
  }

  /** DESIGN.md §9: from level 2 on, the golden room's one door (it's always a dead-end spur, per floorGenerator.ts) costs 1 key to open — stays unlocked for the rest of the level once paid, same as an Isaac locked door. */
  private isGoldenDoorLocked(neighborCoord: RoomCoord): boolean {
    if (this.level < 2 || this.goldenDoorUnlocked) {
      return false
    }
    return getRoomDefinition(this.currentFloor.rooms, neighborCoord)?.isGolden ?? false
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
      obstacles: room.obstacles,
    }))
    this.explored = [this.currentFloor.startCoord]
    this.clearedRooms = []
    this.persistedItemPickups.clear()
    this.openedChests.clear()
    this.goldenDoorUnlocked = false

    // No-ops for a player who wasn't out — safe to call every level start,
    // including the very first one.
    this.hostPlayer.respawnForNextLevel()
    this.joinerPlayer?.respawnForNextLevel()

    this.hostPlayer.teleport(HOST_START.x, HOST_START.y)
    this.joinerPlayer?.teleport(JOINER_START.x, JOINER_START.y)
    this.hostBuddies.forEach((buddy) => buddy.teleport(HOST_START.x, HOST_START.y))
    this.joinerBuddies.forEach((buddy) => buddy.teleport(JOINER_START.x, JOINER_START.y))

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
    this.tookDamageThisRoom = false
    this.lastEnemyDeathPos = null

    this.roomEnemyColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.roomEnemyColliders.clear()
    this.roomEnemies.forEach((enemy) => enemy.destroy())
    this.roomEnemies.clear()

    this.roomObstacles.forEach((obstacle) => obstacle.shape.destroy())
    this.roomObstacles = []
    this.obstacleColliders.forEach(destroyCollider)
    this.obstacleColliders = []

    // Projectiles don't carry through a door.
    this.projectiles.forEach((projectile) => projectile.destroy())
    this.projectiles.clear()
    this.projectileColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.projectileColliders.clear()
    this.enemyProjectiles.forEach((projectile) => projectile.destroy())
    this.enemyProjectiles.clear()
    this.enemyProjectileColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.enemyProjectileColliders.clear()

    // Unlike projectiles, uncollected pickups DO carry through a door —
    // snapshot whatever's still sitting in the room we're leaving before
    // tearing down its visuals/colliders, so a return visit can respawn them.
    const leftRoomPickups = Array.from(this.itemPickups.values()).map((pickup) => ({
      itemId: pickup.itemId,
      x: pickup.x,
      y: pickup.y,
    }))
    if (leftRoomPickups.length > 0) {
      this.persistedItemPickups.set(this.coordKey(this.roomCoord), leftRoomPickups)
    } else {
      this.persistedItemPickups.delete(this.coordKey(this.roomCoord))
    }
    this.itemPickups.forEach((pickup) => pickup.destroy())
    this.itemPickups.clear()
    this.itemPickupColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.itemPickupColliders.clear()

    // Unlike item pickups, hazard zones don't carry through a door — they're a
    // consequence of a Slime that's now behind you, same lifetime class as projectiles.
    this.hazardZones.forEach((zone) => zone.destroy())
    this.hazardZones.clear()
    this.hazardZoneColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.hazardZoneColliders.clear()

    // A Chest doesn't need a persisted-pickups-style snapshot like item
    // pickups do — whether this room *has* one at all is stable, stored on
    // the room definition itself (room.hasChest), and openedChests is the
    // only "has it already been consumed" state that needs to survive
    // between visits.
    this.chest?.destroy()
    this.chest = null
    this.chestColliders.forEach(destroyCollider)
    this.chestColliders = []

    if (enteredFrom) {
      const [posA, posB] = getEntryPositions(enteredFrom)
      this.hostPlayer.teleport(posA.x, posA.y)
      this.joinerPlayer?.teleport(posB.x, posB.y)
      this.hostBuddies.forEach((buddy) => buddy.teleport(posA.x, posA.y))
      this.joinerBuddies.forEach((buddy) => buddy.teleport(posB.x, posB.y))
    }

    this.roomCoord = coord
    if (!this.explored.some((explored) => coordsEqual(explored, coord))) {
      this.explored.push(coord)
    }

    const room = getRoomDefinition(this.currentFloor?.rooms ?? [], coord)
    room?.obstacles.forEach((rect) => this.spawnObstacle(rect))

    if (room?.hasChest && !this.openedChests.has(this.coordKey(coord))) {
      this.spawnChest(room.chestAnchor.x, room.chestAnchor.y)
    }

    const alreadyCleared = this.clearedRooms.some((cleared) => coordsEqual(cleared, coord))
    if (room && !alreadyCleared) {
      this.spawnRoomEnemies(room, enteredFrom)
    }
    this.trackRoomCleared()

    // Restore whatever was left behind on a previous visit — taken out of
    // the persisted map since the live itemPickups map is the source of
    // truth again from here until the room is next exited.
    const restored = this.persistedItemPickups.get(this.coordKey(coord))
    if (restored) {
      this.persistedItemPickups.delete(this.coordKey(coord))
      restored.forEach(({ itemId, x, y }) => this.spawnItemPickup(itemId, x, y))
    }
  }

  private coordKey(coord: RoomCoord): string {
    return `${coord.x},${coord.y}`
  }

  // ---- Obstacles ----

  /** Static, room-structure-only body (DESIGN.md §9) — rock blocks movement and projectiles, water blocks movement only. Wires a collider against both players right away; enemy/projectile colliders are wired from the enemy/projectile side instead (see spawnEnemy/spawnProjectile), since obstacles are always spawned before either can exist in a fresh room. */
  private spawnObstacle(rect: RoomObstacle) {
    const color = rect.type === 'rock' ? ROCK_COLOR : WATER_COLOR
    const alpha = rect.type === 'rock' ? 1 : 0.6
    const shape = this.scene.add.rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, color, alpha)
    this.scene.physics.add.existing(shape, true)
    this.roomObstacles.push({ shape, type: rect.type })

    this.obstacleColliders.push(this.scene.physics.add.collider(this.hostPlayer.square, shape))
    if (this.joinerPlayer) {
      this.obstacleColliders.push(this.scene.physics.add.collider(this.joinerPlayer.square, shape))
    }
  }

  // ---- Enemies ----

  /**
   * One room-clear spawn wave, grouped by archetype and bucketed by anchor
   * — a keepDistance/ranged group spawns at the room's rangedEnemyAnchor if
   * it has one (a water-split room), everything else at enemyAnchor. Each
   * bucket lays its groups out along the same centered-line formula used
   * before obstacles existed, just parameterized by that bucket's anchor
   * instead of the old hardcoded ENEMY_SPAWN_CENTER — a room with only one
   * anchor (the common case) produces identical output to before. Chase
   * groups additionally get pushed toward the far side of the room from
   * `enteredFrom` — see pushAwayFromEntry/CHASE_ENEMY_ENTRY_PUSH.
   */
  private spawnRoomEnemies(room: RoomDefinition, enteredFrom: Direction | undefined) {
    const buckets = new Map<string, { anchor: { x: number; y: number }; groups: RoomEnemyGroup[] }>()
    for (const group of room.enemies) {
      const isRanged = ARCHETYPES[group.archetype].movement === 'keepDistance'
      const anchor = (isRanged && room.rangedEnemyAnchor) || room.enemyAnchor
      const key = `${anchor.x},${anchor.y}`
      if (!buckets.has(key)) {
        buckets.set(key, { anchor, groups: [] })
      }
      buckets.get(key)!.groups.push(group)
    }

    for (const { anchor, groups } of buckets.values()) {
      let index = 0
      const total = groups.reduce((sum, group) => sum + group.count, 0)
      for (const group of groups) {
        const archetype = ARCHETYPES[group.archetype]
        const isChase = archetype.movement === 'chase'
        for (let i = 0; i < group.count; i++) {
          const x = anchor.x + (index - (total - 1) / 2) * ENEMY_SPAWN_SPACING
          const pos = isChase ? pushAwayFromEntry(x, anchor.y, enteredFrom) : { x, y: anchor.y }
          this.spawnEnemy(archetype, pos.x, pos.y)
          index++
        }
      }
    }
  }

  /** Registers overlap against whichever of hostPlayer/joinerPlayer exist (solo has only one). Also used by the split-on-death path and a Chest mimic's ambush Swarmers (countsForClear: false). */
  private spawnEnemy(archetype: EnemyArchetype, x: number, y: number, countsForClear = true) {
    const id = this.nextEnemyId++
    const enemy = new Enemy(this.scene, id, archetype, x, y, { simulated: true, countsForClear })
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

    // Same reasoning, extended to Orbiting Shields: unlike projectiles they
    // persist across rooms, so a shield that existed before this enemy
    // spawned still needs a fresh overlap wired up against it.
    const shieldGroups: [Player, OrbitingShield[]][] = [[hostPlayer, this.hostShields]]
    if (joinerPlayer) {
      shieldGroups.push([joinerPlayer, this.joinerShields])
    }
    for (const [owner, shields] of shieldGroups) {
      for (const shield of shields) {
        colliders.push(
          this.scene.physics.add.overlap(shield.shape, enemy.square, () => {
            this.handleShieldHitEnemy(shield, id, owner)
          }),
        )
      }
    }

    // Both rock and water block enemy movement (only rock also blocks
    // projectiles — see spawnProjectile/spawnBuddyProjectile/
    // spawnEnemyProjectile). Registered from the enemy side only: a room's
    // obstacles are always spawned before its enemies (loadRoom spawns
    // obstacles, then spawnRoomEnemies), so there's no case where an
    // obstacle needs to reach out to an enemy that already existed first.
    this.roomObstacles.forEach((obstacle) => {
      colliders.push(this.scene.physics.add.collider(enemy.square, obstacle.shape))
    })

    this.roomEnemyColliders.set(id, colliders)
  }

  /** Shared cleanup for an enemy that just died, however it died (projectile hit or an attached tick) — removes it and resolves split/explode. */
  private resolveEnemyDeath(enemyId: number, enemy: Enemy) {
    const { splitsOnDeath, splitCount, explodesOnDeath, explosionRadius } = enemy.archetype
    const deathX = enemy.x
    const deathY = enemy.y
    this.lastEnemyDeathPos = { x: deathX, y: deathY }

    this.roomEnemyColliders.get(enemyId)?.forEach(destroyCollider)
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

    // Boss and golden rooms drop 2 *distinct* items side by side, drawn
    // from strong items AND boost items combined (still gets the tier's
    // real visual — a boost item still renders as the regular mystery "?"
    // look, see ItemPickup.ts — but the drop itself is guaranteed, not
    // gated by ROOM_DROP_CHANCE). In co-op each player can grab a
    // different one; solo, both are available to the one player.
    if (this.isCurrentRoomBoss()) {
      const [firstId, secondId] = randomRewardItemIds(2, this.grantedUniqueItems)
      this.spawnItemPickup(firstId, BOSS_HOLE_CENTER.x - REGULAR_REWARD_SPACING / 2, BOSS_HOLE_CENTER.y - REGULAR_REWARD_SPACING)
      if (secondId) {
        this.spawnItemPickup(secondId, BOSS_HOLE_CENTER.x + REGULAR_REWARD_SPACING / 2, BOSS_HOLE_CENTER.y - REGULAR_REWARD_SPACING)
      }
      this.scatterBossBonusRewards()
      return
    }

    // No fight, no LIFE_ITEM_CHANCE roll — a golden room is 2 guaranteed
    // reward items and nothing else.
    if (this.isCurrentRoomGolden()) {
      const [firstId, secondId] = randomRewardItemIds(2, this.grantedUniqueItems)
      this.spawnItemPickup(firstId, ENEMY_SPAWN_CENTER.x - REGULAR_REWARD_SPACING / 2, ENEMY_SPAWN_CENTER.y)
      if (secondId) {
        this.spawnItemPickup(secondId, ENEMY_SPAWN_CENTER.x + REGULAR_REWARD_SPACING / 2, ENEMY_SPAWN_CENTER.y)
      }
      return
    }

    // Regular room — reads this room's own enemyAnchor instead of the bare
    // ENEMY_SPAWN_CENTER constant, so a reward can never land inside a
    // pillar room's rocks (golden/boss above stay on the fixed constants
    // since those room types are always the obstacle-free empty layout).
    const anchor = getRoomDefinition(this.currentFloor.rooms, coord)?.enemyAnchor ?? ENEMY_SPAWN_CENTER

    // Coin, life item, and key all roll unconditionally, regardless of
    // whether anyone got hit clearing this room.
    if (Math.random() < COIN_DROP_CHANCE) {
      this.spawnItemPickup('coin', anchor.x, anchor.y - REGULAR_REWARD_SPACING)
    }
    if (Math.random() < LIFE_ITEM_CHANCE) {
      this.spawnItemPickup('heart', anchor.x + REGULAR_REWARD_SPACING / 2, anchor.y)
    }
    if (Math.random() < KEY_DROP_CHANCE) {
      this.spawnItemPickup('key', anchor.x, anchor.y + REGULAR_REWARD_SPACING)
    }

    // No-hit gate: the boost roll only happens at all if nobody took a hit
    // while this room was being cleared — rewards a clean clear instead of
    // dropping regardless of how the fight went.
    if (!this.tookDamageThisRoom && Math.random() < ROOM_DROP_CHANCE) {
      const boostId = randomBoostItemId()
      this.spawnItemPickup(boostId, anchor.x - REGULAR_REWARD_SPACING / 2, anchor.y)
    }
  }

  /**
   * Boss-clear bonus (DESIGN.md §7/§9): a random count of coins/life
   * items/keys scattered outward from wherever the boss died, on top of the
   * guaranteed 2-item drop rollRoomClearReward already spawned. Falls back
   * to BOSS_HOLE_CENTER if lastEnemyDeathPos is somehow unset (defensive
   * only — a boss room always holds exactly one enemy, so it's always set
   * by the time this runs).
   */
  private scatterBossBonusRewards() {
    const origin = this.lastEnemyDeathPos ?? BOSS_HOLE_CENTER
    const coinCount = Phaser.Math.Between(BOSS_BONUS_COIN_MIN, BOSS_BONUS_COIN_MAX)
    for (let i = 0; i < coinCount; i++) {
      const pos = scatterPosition(origin, BOSS_BONUS_SCATTER_MIN_DISTANCE, BOSS_BONUS_SCATTER_MAX_DISTANCE)
      this.spawnItemPickup('coin', pos.x, pos.y)
    }
    const lifeCount = Phaser.Math.Between(BOSS_BONUS_LIFE_MIN, BOSS_BONUS_LIFE_MAX)
    for (let i = 0; i < lifeCount; i++) {
      const pos = scatterPosition(origin, BOSS_BONUS_SCATTER_MIN_DISTANCE, BOSS_BONUS_SCATTER_MAX_DISTANCE)
      this.spawnItemPickup('heart', pos.x, pos.y)
    }
    const keyCount = Phaser.Math.Between(BOSS_BONUS_KEY_MIN, BOSS_BONUS_KEY_MAX)
    for (let i = 0; i < keyCount; i++) {
      const pos = scatterPosition(origin, BOSS_BONUS_SCATTER_MIN_DISTANCE, BOSS_BONUS_SCATTER_MAX_DISTANCE)
      this.spawnItemPickup('key', pos.x, pos.y)
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
    this.itemPickupColliders.get(id)?.forEach(destroyCollider)
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

  // ---- Hazard zones ----

  /** Slime's periodic drop — a lingering damage zone that expires on its own after durationMs. Damage reuses handleHit directly, so invincibility frames already apply for free (no separate per-zone cooldown needed). */
  private spawnHazardZone(x: number, y: number, radius: number, durationMs: number) {
    const id = this.nextHazardZoneId++
    const zone = new HazardZone(this.scene, id, x, y, radius, { simulated: true })
    this.hazardZones.set(id, zone)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    const hostPlayer = this.hostPlayer
    colliders.push(this.scene.physics.add.overlap(hostPlayer.square, zone.shape, () => this.handleHit(hostPlayer)))
    const joinerPlayer = this.joinerPlayer
    if (joinerPlayer) {
      colliders.push(this.scene.physics.add.overlap(joinerPlayer.square, zone.shape, () => this.handleHit(joinerPlayer)))
    }
    this.hazardZoneColliders.set(id, colliders)

    this.scene.time.delayedCall(durationMs, () => this.destroyHazardZone(id))
  }

  private destroyHazardZone(id: number) {
    this.hazardZones.get(id)?.destroy()
    this.hazardZones.delete(id)
    this.hazardZoneColliders.get(id)?.forEach(destroyCollider)
    this.hazardZoneColliders.delete(id)
  }

  // ---- Chest ----

  /** A locked Treasure Chest (DESIGN.md §9) — decided once at floor-generation time (room.hasChest/chestAnchor), spawned here from loadRoom. At most one per room. */
  private spawnChest(x: number, y: number) {
    const id = this.nextChestId++
    const chest = new Chest(this.scene, id, x, y, { simulated: true })
    this.chest = chest

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    const hostPlayer = this.hostPlayer
    colliders.push(this.scene.physics.add.overlap(hostPlayer.square, chest.shape, () => this.handleChestTouch(chest)))
    const joinerPlayer = this.joinerPlayer
    if (joinerPlayer) {
      colliders.push(this.scene.physics.add.overlap(joinerPlayer.square, chest.shape, () => this.handleChestTouch(chest)))
    }
    this.chestColliders = colliders
  }

  /**
   * Costs 1 key — no-ops (stays locked) if the team has none. `this.chest
   * !== chest` guards against both players overlapping the same Chest in
   * the same physics step (Arcade fires each registered overlap
   * independently) — whichever callback runs first nulls `this.chest`
   * immediately, so a same-frame second callback sees it's already gone
   * instead of double-opening it.
   */
  private handleChestTouch(chest: Chest) {
    if (this.chest !== chest || this.keyCount < 1) {
      return
    }
    this.keyCount--
    this.chest = null
    this.openedChests.add(this.coordKey(this.roomCoord))
    const origin = { x: chest.x, y: chest.y }
    chest.destroy()
    this.chestColliders.forEach(destroyCollider)
    this.chestColliders = []

    // 15% mimic: an ambush, nothing else. Otherwise, independently roll
    // each reward — a chest can give several things at once, or nothing.
    if (Math.random() < CHEST_AMBUSH_CHANCE) {
      for (let i = 0; i < CHEST_AMBUSH_SWARMER_COUNT; i++) {
        const pos = scatterPosition(origin, CHEST_AMBUSH_SCATTER_MIN_DISTANCE, CHEST_AMBUSH_SCATTER_MAX_DISTANCE)
        this.spawnEnemy(ARCHETYPES.swarmerWeak, pos.x, pos.y, false)
      }
      return
    }

    if (Math.random() < CHEST_HEART_CHANCE) {
      const pos = scatterPosition(origin, CHEST_REWARD_SCATTER_MIN_DISTANCE, CHEST_REWARD_SCATTER_MAX_DISTANCE)
      this.spawnItemPickup('heart', pos.x, pos.y)
    }
    if (Math.random() < CHEST_KEY_CHANCE) {
      const pos = scatterPosition(origin, CHEST_REWARD_SCATTER_MIN_DISTANCE, CHEST_REWARD_SCATTER_MAX_DISTANCE)
      this.spawnItemPickup('key', pos.x, pos.y)
    }
    const coinCount = rollChestCoinCount()
    for (let i = 0; i < coinCount; i++) {
      const pos = scatterPosition(origin, CHEST_REWARD_SCATTER_MIN_DISTANCE, CHEST_REWARD_SCATTER_MAX_DISTANCE)
      this.spawnItemPickup('coin', pos.x, pos.y)
    }
    if (Math.random() < CHEST_BOOST_CHANCE) {
      const pos = scatterPosition(origin, CHEST_REWARD_SCATTER_MIN_DISTANCE, CHEST_REWARD_SCATTER_MAX_DISTANCE)
      this.spawnItemPickup(randomBoostItemId(), pos.x, pos.y)
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
      color: projectileColorForDamage(stats.potatoDamage),
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
    // Rocks destroy a shot on contact — water is skipped, shots pass over
    // it freely. Registered from the projectile side since a room's
    // obstacles are always spawned before any projectile can exist in it.
    this.roomObstacles.forEach((obstacle) => {
      if (obstacle.type !== 'rock') {
        return
      }
      colliders.push(
        this.scene.physics.add.overlap(projectile.shape, obstacle.shape, () => {
          this.destroyProjectile(id)
        }),
      )
    })
    this.projectileColliders.set(id, colliders)
  }

  /** Buddy's shot — fixed size/damage, deliberately not reading the owning player's stats (see the note in tryFirePlayer). Shares the same projectiles/projectileColliders maps as a normal shot, so it gets pierce-fix collider registration against newly-spawned enemies, room-transition cleanup, and broadcast for free. */
  private spawnBuddyProjectile(x: number, y: number, angle: number) {
    const id = this.nextProjectileId++
    const projectile = new Projectile(this.scene, id, x, y, angle, {
      simulated: true,
      damage: BUDDY_PROJECTILE_DAMAGE,
      radius: BUDDY_PROJECTILE_RADIUS,
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
    this.roomObstacles.forEach((obstacle) => {
      if (obstacle.type !== 'rock') {
        return
      }
      colliders.push(
        this.scene.physics.add.overlap(projectile.shape, obstacle.shape, () => {
          this.destroyProjectile(id)
        }),
      )
    })
    this.projectileColliders.set(id, colliders)
  }

  private destroyProjectile(id: number) {
    this.projectiles.get(id)?.destroy()
    this.projectiles.delete(id)
    this.projectileColliders.get(id)?.forEach(destroyCollider)
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

  /**
   * Spawns an enemy shot and wires overlap detection against whichever
   * players currently exist. `range` should be the firing archetype's own
   * `ranged.range` (falls back to PROJECTILE_MAX_RANGE) — otherwise a shot
   * fired at max engage distance could despawn before ever reaching a
   * player, making the archetype's real threat reach shorter than its
   * stated engage range.
   */
  private spawnEnemyProjectile(x: number, y: number, angle: number, range?: number) {
    const id = this.nextEnemyProjectileId++
    const projectile = new Projectile(this.scene, id, x, y, angle, {
      simulated: true,
      color: ENEMY_PROJECTILE_COLOR,
      speed: ENEMY_PROJECTILE_SPEED,
      range,
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
    this.roomObstacles.forEach((obstacle) => {
      if (obstacle.type !== 'rock') {
        return
      }
      colliders.push(
        this.scene.physics.add.overlap(projectile.shape, obstacle.shape, () => {
          this.destroyEnemyProjectile(id)
        }),
      )
    })
    this.enemyProjectileColliders.set(id, colliders)
  }

  private destroyEnemyProjectile(id: number) {
    this.enemyProjectiles.get(id)?.destroy()
    this.enemyProjectiles.delete(id)
    this.enemyProjectileColliders.get(id)?.forEach(destroyCollider)
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
    this.tookDamageThisRoom = true

    const hostOut = this.hostPlayer.isOut
    const joinerOut = this.joinerPlayer ? this.joinerPlayer.isOut : true
    if (hostOut && joinerOut) {
      this.gameOver = true
      this.scene.physics.pause()
      this.onGameOver?.()
    }
  }
}
