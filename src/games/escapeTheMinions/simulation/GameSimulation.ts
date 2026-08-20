import Phaser from 'phaser'
import type { KeyState, StateMessage, LevelStartMessage, Vec2 } from '../net/syncProtocol'
import Player from '../entities/Player'
import Projectile, { PROJECTILE_RADIUS, PROJECTILE_SPEED, PROJECTILE_MAX_RANGE, projectileColorForDamage } from '../entities/Projectile'
import Enemy from '../entities/Enemy'
import ItemPickup from '../entities/ItemPickup'
import Buddy from '../entities/Buddy'
import OrbitingShield from '../entities/OrbitingShield'
import HazardZone from '../entities/HazardZone'
import StatusZone from '../entities/StatusZone'
import type { StatusZoneEffect } from '../entities/StatusZone'
import Chest from '../entities/Chest'
import DevilPedestal from '../entities/DevilPedestal'
import GambleShrine from '../entities/GambleShrine'
import type { EnemyArchetype } from '../gameplay/enemyArchetypes'
import { ARCHETYPES } from '../gameplay/enemyArchetypes'
import type { ItemId, StrongItemId } from '../gameplay/items'
import {
  getItemLabel,
  randomBoostItemId,
  randomStrongItemId,
  randomRewardItemIds,
  randomAngelItemIds,
  STAT_ITEMS,
  STRONG_ITEMS,
} from '../gameplay/items'
import type { DevilItemId } from '../gameplay/devilItems'
import { DEVIL_ITEMS, availableDevilItemIds } from '../gameplay/devilItems'
import type { RoleId } from '../gameplay/roles'
import {
  isRoleId,
  ICE_FREEZE_CHANCE,
  ICE_FREEZE_DURATION_MS,
  ELECTRIC_CHAIN_CHANCE,
  ELECTRIC_CHAIN_RADIUS,
  ELECTRIC_CHAIN_MAX_HOPS,
  GRAVITY_PULL_RADIUS,
  GRAVITY_PULL_STRENGTH,
  BOMB_BLAST_RADIUS,
  getRoleColor,
} from '../gameplay/roles'
import type { ShadowController } from '../gameplay/shadow'
import { createShadow } from '../gameplay/shadow'
import {
  ICE_GLUE_COMBO_FREEZE_CHANCE,
  POISON_ELECTRIC_SPREAD_CHANCE,
  ICE_ELECTRIC_DAMAGE_MULTIPLIER,
  SHATTER_RADIUS,
  ICE_PATCH_RADIUS,
  ICE_PATCH_DURATION_MS,
  POISON_CLOUD_RADIUS,
  POISON_CLOUD_DURATION_MS,
  STATUS_ZONE_REAPPLY_INTERVAL_MS,
} from '../gameplay/roles'
import { bonusContainersForLevel } from '../gameplay/lives'
import type { AttackState } from '../gameplay/attack'
import { createAttackState, canFire, recordFire } from '../gameplay/attack'
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
// Relative to ARENA_MIN/MAX (the walkable floor), not the raw canvas edge —
// see ARENA_MIN_X/etc.'s doc comment in roomLayouts.ts for why the floor is
// inset from the canvas at all (env-room-bg.png bakes a painted wall border
// into the backdrop, so the walkable rect had to shrink to match it).
const ENTRY_MARGIN = 50
const PLAYER_ENTRY_OFFSET = 30

export interface DoorZone {
  x: number
  y: number
  width: number
  height: number
}

// Positioned at the ARENA boundary (the wall/floor seam), extending inward
// from it — not at the raw canvas edge, which is now painted wall in
// env-room-bg.png and unreachable since ARENA_MIN/MAX became the actual
// physics bounds (see PlayScene/CoopPlayScene's create()).
export const DOOR_ZONES: Record<Direction, DoorZone> = {
  north: { x: WORLD_WIDTH / 2 - DOOR_SIZE / 2, y: ARENA_MIN_Y, width: DOOR_SIZE, height: DOOR_DEPTH },
  south: { x: WORLD_WIDTH / 2 - DOOR_SIZE / 2, y: ARENA_MAX_Y - DOOR_DEPTH, width: DOOR_SIZE, height: DOOR_DEPTH },
  east: { x: ARENA_MAX_X - DOOR_DEPTH, y: WORLD_HEIGHT / 2 - DOOR_SIZE / 2, width: DOOR_DEPTH, height: DOOR_SIZE },
  west: { x: ARENA_MIN_X, y: WORLD_HEIGHT / 2 - DOOR_SIZE / 2, width: DOOR_DEPTH, height: DOOR_SIZE },
}

/**
 * Purely cosmetic — where GameplayHud draws the door *graphic*, as opposed
 * to DOOR_ZONES above (the touch-trigger rect, which has to stay on the
 * floor side of the boundary since a player physically can't reach into
 * the wall). Isaac-style: a door reads as a gap cut through the wall
 * leading off toward the screen edge, not a marker sitting on the floor —
 * so each of these spans the *entire* wall band on its side, from the
 * ARENA boundary out to the raw canvas edge.
 */
export const DOOR_VISUAL_ZONES: Record<Direction, DoorZone> = {
  north: { x: WORLD_WIDTH / 2 - DOOR_SIZE / 2, y: 0, width: DOOR_SIZE, height: ARENA_MIN_Y },
  south: { x: WORLD_WIDTH / 2 - DOOR_SIZE / 2, y: ARENA_MAX_Y, width: DOOR_SIZE, height: WORLD_HEIGHT - ARENA_MAX_Y },
  east: { x: ARENA_MAX_X, y: WORLD_HEIGHT / 2 - DOOR_SIZE / 2, width: WORLD_WIDTH - ARENA_MAX_X, height: DOOR_SIZE },
  west: { x: 0, y: WORLD_HEIGHT / 2 - DOOR_SIZE / 2, width: ARENA_MIN_X, height: DOOR_SIZE },
}

/** The boss room has no directional doors — clearing it reveals this instead, in the room's center. */
export const BOSS_HOLE_CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }
export const BOSS_HOLE_RADIUS = 36

/**
 * Devil's Room (DESIGN.md §9) — a real door on the wall (Isaac-style),
 * not a second hole in the same spot as the level-up one. Boss rooms
 * never show/use their real directional doors (checkRoomTransition's boss
 * branch never reaches the normal door-touch loop, and the room is always
 * a dead-end spur with only one real neighbor anyway), so any fixed edge
 * is safe to repurpose here without ever colliding with real navigation.
 */
export const DEVIL_DOOR_DIRECTION: Direction = 'north'
/**
 * Devil's Room isn't a grid room — it reuses the same 800x600 canvas, just
 * laid out with fixed pedestal/exit/spawn positions instead of doors. All
 * three of the below are kept within ARENA_MIN/MAX (the actual walkable
 * floor once env-room-bg.png's wall border became real physics bounds).
 * Deliberately NOT stacked in a straight vertical line between spawn and
 * the pedestals — the exit sits off in a corner instead, so walking
 * straight from spawn toward the pedestals can never clip through it.
 */
export const DEVIL_ROOM_PEDESTAL_ANCHOR = { x: WORLD_WIDTH / 2, y: 220 }
const DEVIL_ROOM_PEDESTAL_SPACING = 150
export const DEVIL_EXIT_CENTER = { x: ARENA_MAX_X - 40, y: ARENA_MAX_Y - 40 }
export const DEVIL_EXIT_RADIUS = 36
const DEVIL_ROOM_HOST_SPAWN = { x: WORLD_WIDTH / 2 - 50, y: ARENA_MAX_Y - 40 }
const DEVIL_ROOM_JOINER_SPAWN = { x: WORLD_WIDTH / 2 + 50, y: ARENA_MAX_Y - 40 }

function isInsideZone(x: number, y: number, zone: DoorZone): boolean {
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height
}

function getEntryCenter(edge: Direction): { x: number; y: number } {
  switch (edge) {
    case 'north':
      return { x: WORLD_WIDTH / 2, y: ARENA_MIN_Y + ENTRY_MARGIN }
    case 'south':
      return { x: WORLD_WIDTH / 2, y: ARENA_MAX_Y - ENTRY_MARGIN }
    case 'east':
      return { x: ARENA_MAX_X - ENTRY_MARGIN, y: WORLD_HEIGHT / 2 }
    case 'west':
      return { x: ARENA_MIN_X + ENTRY_MARGIN, y: WORLD_HEIGHT / 2 }
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

type GambleOutcome = 'bust' | 'refund' | 'heart' | 'key' | 'boost' | 'jackpot'

/** Gamble Shrine's per-pull outcome — one weighted pick: 30% bust, 25% refund, 20% heart, 15% key, 8% boost item, 2% jackpot (strong item). */
function rollGambleOutcome(): GambleOutcome {
  const r = Math.random()
  if (r < 0.3) {
    return 'bust'
  }
  if (r < 0.55) {
    return 'refund'
  }
  if (r < 0.75) {
    return 'heart'
  }
  if (r < 0.9) {
    return 'key'
  }
  if (r < 0.98) {
    return 'boost'
  }
  return 'jackpot'
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
/** Extra buffer beyond an enemy's own half-size when pushing it clear of a rock/water obstacle at spawn — see clearObstacles. */
const OBSTACLE_SPAWN_CLEARANCE_PADDING = 10
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
const KEY_DROP_CHANCE = 0.15
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
/** Free Loot Room (DESIGN.md §8) — guaranteed 2-3 pickups, each independently a random pick from this pool (duplicates allowed), scattered around the room's enemyAnchor. */
const FREE_ROOM_LOOT_POOL: ItemId[] = ['key', 'heart', 'coin']
const FREE_ROOM_LOOT_MIN = 2
const FREE_ROOM_LOOT_MAX = 3
const FREE_ROOM_SCATTER_MIN_DISTANCE = 40
const FREE_ROOM_SCATTER_MAX_DISTANCE = 150
/**
 * Gamble Shrine (DESIGN.md §8, brainstorm) — costs GAMBLE_PULL_COST coins
 * per pull, cooldown-gated (GAMBLE_PULL_COOLDOWN_MS) so standing on it
 * doesn't spam-pull every physics frame. One weighted outcome roll per
 * pull (rollGambleOutcome) — bust/refund/heart/key/boost/jackpot, summing
 * to 100%; jackpot draws from the strong-item pool specifically, a step up
 * from the separate, more common boost-item outcome.
 */
const GAMBLE_PULL_COST = 3
const GAMBLE_PULL_COOLDOWN_MS = 600
/** Angel Room (DESIGN.md §9) — 3 pedestal-style options, laid out along the same centered-line formula spawnRoomEnemies already uses. */
const ANGEL_ROOM_OPTION_COUNT = 3
const ANGEL_PICKUP_SPACING = 80
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
  /** Currently equipped role (DESIGN.md §5), or null before the first one is found — drives the HUD's minimal role indicator. */
  readonly ownRole: RoleId | null
  readonly partnerRole: RoleId | null
  /** Team-shared, not per-player — see GameSimulation's coinCount field. Nothing spends this yet (roadmap stage 13, the future shop). */
  readonly coins: number
  /** Team-shared, not per-player — opens Chests. See GameSimulation's keyCount field. */
  readonly keys: number
  isCurrentRoomBoss(): boolean
  isRoomClear(): boolean
  isDirectionOpen(direction: Direction): boolean
  /** DESIGN.md §8's placeholder room types — 'FREE ROOM' / 'GAMBLE ROOM' while their real content is still unbuilt, null everywhere else. */
  currentRoomPlaceholderLabel(): string | null
  /** Devil's Room (DESIGN.md §9) isn't a normal grid room — GameplayHud checks this first to suppress normal doors/the boss hole and render the devil room's own graphics instead. */
  readonly isInDevilRoom: boolean
  /** True for the rest of a no-hit boss-room visit — drives whether the devil door graphic shows up alongside the normal boss hole. */
  readonly isDevilHoleAvailable: boolean
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
  /** shadow is only ever set for 'rock' (a raised pillar) — water is flat/ground-level, same reasoning as HazardZone/StatusZone never getting one either. */
  private roomObstacles: { shape: Phaser.GameObjects.Rectangle; type: ObstacleType; shadow: ShadowController | null }[] = []
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

  /** The Gamble Shrine (DESIGN.md §8) — room-scoped like Chest, but unlike Chest it isn't destroyed on use, only on loadRoom teardown. shrinePullState cooldown-gates repeated pulls (otherwise standing on it would pull every physics frame). */
  private shrine: GambleShrine | null = null
  private shrineColliders: Phaser.Physics.Arcade.Collider[] = []
  private shrinePullState: AttackState = createAttackState()

  // Devil's Room (DESIGN.md §9) — isn't a normal grid room, see enterDevilRoom.
  /** Every strong item id, in order, this specific player has ever collected — Shared Consumption replays the *other* player's history onto whoever picks it (see applyGrantedItem/handleDevilPedestalTouch). */
  private hostStrongItemHistory: StrongItemId[] = []
  private joinerStrongItemHistory: StrongItemId[] = []
  /** True for the rest of this boss-room visit once it's been cleared without a hit — set in rollRoomClearReward's boss branch, reset every loadRoom(). Gates whether the devil door is even checked in checkRoomTransition. */
  private devilRoomAvailable = false
  private inDevilRoom = false
  /** The boss room's coord — where exitDevilRoom() sends you back to. */
  private devilRoomReturnCoord: RoomCoord | null = null
  private devilPedestals: Map<DevilItemId, DevilPedestal> = new Map()
  private devilPedestalColliders: Map<DevilItemId, Phaser.Physics.Arcade.Collider[]> = new Map()

  // Angel Room (DESIGN.md §9) — a real grid room (an extra optional spur,
  // like Gamble Shrine), unlike Devil's Room. Reuses the regular ItemPickup
  // entity directly (see spawnAngelPickups) — not its own new entity class —
  // since Angel items are real StrongItemIds/RoleIds with the exact
  // "visually identified" look this needs; the broadcast channel is its
  // own dedicated field though (see buildStateMessage's angelPickups).
  /** Rolled lazily the first time the room is entered, then remembered for the rest of the level — a re-visit shows the same 3 until one is picked. Reset in startLevel(). */
  private angelRoomItems: (StrongItemId | RoleId)[] | null = null
  /** True once any option has been picked — the room reads as empty forever after. Reset in startLevel(). */
  private angelRoomResolved = false
  private angelPickups: Map<number, ItemPickup> = new Map()
  private angelPickupColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()

  // Slime's periodic drop (DESIGN.md's enemy-variety pass) — room-scoped
  // like enemies/projectiles/pickups, not persistent like Buddy/Shield, so
  // torn down every loadRoom() alongside them.
  private hazardZones: Map<number, HazardZone> = new Map()
  private hazardZoneColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextHazardZoneId = 0
  /** DESIGN.md §6's Ice+Gravity/Poison+Bomb combos — same room-scoped lingering-zone shape as hazardZones, just enemy-targeting/stack-applying instead of player-damaging. */
  private statusZones: Map<number, StatusZone> = new Map()
  private statusZoneColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextStatusZoneId = 0

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

  get ownRole(): RoleId | null {
    return this.hostPlayer.getCurrentRole()
  }

  get partnerRole(): RoleId | null {
    return this.joinerPlayer ? this.joinerPlayer.getCurrentRole() : null
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

  currentRoomPlaceholderLabel(): string | null {
    const room = getRoomDefinition(this.floorRooms, this.roomCoord)
    if (room?.noEnemyVariant === 'empty') {
      return 'FREE ROOM'
    }
    if (room?.isGamble) {
      return 'GAMBLE ROOM'
    }
    return null
  }

  get isInDevilRoom(): boolean {
    return this.inDevilRoom
  }

  get isDevilHoleAvailable(): boolean {
    return this.devilRoomAvailable
  }

  // ---- Per-frame tick ----

  /** Drives the host player from local input; the joiner (if any) was already driven by the last applyJoinerInput call. */
  update(now: number, hostKeys: KeyState, hostFiring: boolean) {
    this.hostPlayer.setVelocityFromKeys(hostKeys, MOVE_SPEED)

    this.hostPlayer.refreshVisuals(now)
    this.joinerPlayer?.refreshVisuals(now)

    this.roomEnemies.forEach((enemy, enemyId) => {
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
      // Poison's DoT (DESIGN.md §5) can kill on its own, independent of any
      // fresh hit this frame — handled the same way the attached-projectile
      // tick below handles its own independent death.
      if (enemy.updateStatusEffects(now)) {
        this.resolveEnemyDeath(enemyId, enemy)
        return
      }
      enemy.refreshVisuals(now)
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
          // Known composability gap, flagged not silent (DESIGN.md's
          // composability tenet): an attached tick doesn't re-roll
          // applyRoleOnHitEffect the way a fresh handleProjectileHitEnemy
          // hit does, so a Homing+Pierce shot's attached ticks don't
          // re-apply Ice/Glue/Poison/Electric. Homing+Pierce+a status role
          // is an unusual enough stack to defer rather than block this pass on.
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

      // Gravity's pull (DESIGN.md §5) — a per-frame effect while the shot
      // is in flight, not an on-hit proc (see applyRoleOnHitEffect, which
      // deliberately has no 'gravity' branch). Runs every frame the
      // projectile is alive, following wherever it currently is.
      if (projectile.roleEffect === 'gravity') {
        this.roomEnemies.forEach((enemy) => {
          const d = Phaser.Math.Distance.Between(projectile.x, projectile.y, enemy.x, enemy.y)
          if (d <= GRAVITY_PULL_RADIUS) {
            enemy.applyGravityPull(projectile.x, projectile.y, GRAVITY_PULL_STRENGTH)
            // Ice + Gravity combo (DESIGN.md §6) — a frozen enemy actively
            // being pulled periodically leaves a brief slowing ice patch.
            if (enemy.isFrozen(now) && enemy.tryDropIcePatchAt(now)) {
              this.spawnStatusZone('slow', enemy.x, enemy.y, ICE_PATCH_RADIUS, ICE_PATCH_DURATION_MS)
            }
          }
        })
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

    // Devil's Room isn't a grid room — trackRoomCleared/checkRoomTransition
    // assume one (they'd misread this.roomCoord, which still points at the
    // boss room being detoured from) and don't apply here at all.
    if (this.inDevilRoom) {
      this.checkDevilRoomExit()
    } else {
      this.trackRoomCleared()
      this.checkRoomTransition()
    }
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
    const died = enemy.applyHit(owner.getEffectiveDamage())
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

  /** Effect-application, shared by real pickups and the dev give-item menu. 'heart', 'heartContainer', 'coin', and 'key' aren't PlayerStats mutators, and a role id isn't either (see Player.equipRole) — all special-cased here rather than going through Player.applyItem. */
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
    } else if (isRoleId(itemId)) {
      player.equipRole(itemId)
    } else {
      player.applyItem(itemId)
    }

    if (itemId === 'buddy') {
      this.spawnBuddy(player)
    } else if (itemId === 'orbitingShield') {
      this.spawnShield(player)
    }

    // Devil's Room's Shared Consumption replays whichever strong items the
    // *other* player collected onto whoever picks it — needs each player's
    // own history, not just their current derived stats (heavyShot in
    // particular has no separate "count" a snapshot could copy).
    if (itemId in STRONG_ITEMS) {
      const history = player === this.hostPlayer ? this.hostStrongItemHistory : this.joinerStrongItemHistory
      history.push(itemId as StrongItemId)
    }

    // Role ids never appear in STAT_ITEMS (they're not a PlayerStats
    // mutator) — a role is a replaceable mode, not a consumed one-per-run
    // resource, so it's deliberately never added to grantedUniqueItems
    // either; finding the same role again later is fine.
    if (itemId !== 'heart' && itemId !== 'coin' && itemId !== 'key' && !isRoleId(itemId) && STAT_ITEMS[itemId].unique) {
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
        : { pos: { x: 0, y: 0 }, lives: 0, maxLives: 0, isOut: true, isInvincible: false, role: null },
      roomCoord: this.roomCoord,
      enemies: Array.from(this.roomEnemies.values()).map((enemy) => enemy.getNetworkState()),
      projectiles: Array.from(this.projectiles.entries()).map(([id, projectile]) => ({
        id,
        pos: { x: projectile.x, y: projectile.y },
        radius: projectile.radius,
        color: projectile.color,
        isBomb: projectile.roleEffect === 'bomb',
      })),
      enemyProjectiles: Array.from(this.enemyProjectiles.entries()).map(([id, projectile]) => ({
        id,
        pos: { x: projectile.x, y: projectile.y },
        radius: projectile.radius,
        isBomb: false,
      })),
      exploredRooms: this.explored,
      itemPickups: Array.from(this.itemPickups.values()).map((pickup) => ({
        id: pickup.id,
        itemId: pickup.itemId,
        pos: { x: pickup.x, y: pickup.y },
      })),
      // Deliberately its own field, not merged into itemPickups above —
      // choosing one option destroys all 3 simultaneously, and the
      // joiner's reconcileItemPickups infers "picked up" (and shows reveal
      // text) from any id disappearing, which would wrongly fire 3 times
      // for a single choice if these shared that channel.
      angelPickups: Array.from(this.angelPickups.values()).map((pickup) => ({
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
      statusZones: Array.from(this.statusZones.values()).map((zone) => ({
        id: zone.id,
        pos: { x: zone.x, y: zone.y },
        radius: zone.radius,
        effect: zone.effect,
      })),
      isGameOver: this.gameOver,
      isPaused: this.paused,
      coins: this.coinCount,
      keys: this.keyCount,
      chests: this.chest ? [{ id: this.chest.id, pos: { x: this.chest.x, y: this.chest.y } }] : [],
      isInDevilRoom: this.inDevilRoom,
      devilPedestals: Array.from(this.devilPedestals.values()).map((pedestal) => ({
        id: pedestal.id,
        pos: { x: pedestal.x, y: pedestal.y },
      })),
      isDevilHoleAvailable: this.devilRoomAvailable,
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
    this.statusZones.forEach((zone) => zone.destroy())
    this.statusZones.clear()
    this.statusZoneColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.statusZoneColliders.clear()
    this.chest?.destroy()
    this.chest = null
    this.chestColliders.forEach(destroyCollider)
    this.chestColliders = []
    this.shrine?.destroy()
    this.shrine = null
    this.shrineColliders.forEach(destroyCollider)
    this.shrineColliders = []
    this.devilPedestals.forEach((pedestal) => pedestal.destroy())
    this.devilPedestals.clear()
    this.devilPedestalColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.devilPedestalColliders.clear()
    this.angelPickups.forEach((pickup) => pickup.destroy())
    this.angelPickups.clear()
    this.angelPickupColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.angelPickupColliders.clear()
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
    this.roomObstacles.forEach((obstacle) => {
      obstacle.shape.destroy()
      obstacle.shadow?.destroy()
    })
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

    // Role effect (DESIGN.md §5) captured once here at spawn time — see
    // Projectile.roleEffect's own note on why it's captured, not read live.
    const roleEffect = player.getCurrentRole()

    // Buddy mirrors the player's raw facing, not the Multi Shot/Multi
    // Direction-expanded angle set — deliberately kept simple for this
    // first pass (fixed single shot per buddy per player-fire) rather than
    // composing with those stacks. Flagged, not silent: revisit against
    // the composability tenet (DESIGN.md, top of file) before calling
    // Buddy "done." Its on-hit *role* identity does compose, though — only
    // Buddy's damage is the named non-scaling exception (DESIGN.md §7),
    // nothing says its status-effect identity should be exempt too.
    const buddies = player === this.hostPlayer ? this.hostBuddies : this.joinerBuddies
    for (const buddy of buddies) {
      this.spawnBuddyProjectile(buddy.x, buddy.y, facing, roleEffect)
    }

    // Turret Pact (Devil's Room, DESIGN.md §9) — every Orbiting Shield this
    // player owns also fires like a Buddy whenever they do. Shares the
    // exact same fixed-damage shot as Buddy, deliberately for the same
    // reason Buddy itself doesn't scale with player stats.
    if (stats.hasTurretShields) {
      const shields = player === this.hostPlayer ? this.hostShields : this.joinerShields
      for (const shield of shields) {
        this.spawnBuddyProjectile(shield.x, shield.y, facing, roleEffect)
      }
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
        if (this.devilRoomAvailable && isInsideZone(player.x, player.y, DOOR_ZONES[DEVIL_DOOR_DIRECTION])) {
          this.enterDevilRoom()
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
      noEnemyVariant: room.noEnemyVariant,
      isGamble: room.isGamble,
      chestAnchor: room.chestAnchor,
    }))
    this.explored = [this.currentFloor.startCoord]
    this.clearedRooms = []
    this.persistedItemPickups.clear()
    this.openedChests.clear()
    this.goldenDoorUnlocked = false
    this.angelRoomItems = null
    this.angelRoomResolved = false

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
   * Tears down every room-scoped thing the current room might have —
   * enemies, obstacles, projectiles, hazard zones, Chest, Gamble Shrine —
   * and snapshots any uncollected item pickups so a later return visit
   * (including a Devil's Room detour and back) still has them. Shared by
   * loadRoom (a real grid-room transition) and enterDevilRoom (a detour
   * out of the boss room, which isn't a grid room at all).
   */
  private teardownCurrentRoom() {
    this.tookDamageThisRoom = false
    this.lastEnemyDeathPos = null
    this.devilRoomAvailable = false

    this.roomEnemyColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.roomEnemyColliders.clear()
    this.roomEnemies.forEach((enemy) => enemy.destroy())
    this.roomEnemies.clear()

    this.roomObstacles.forEach((obstacle) => {
      obstacle.shape.destroy()
      obstacle.shadow?.destroy()
    })
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

    // Status zones (DESIGN.md §6's ice patch/poison cloud combos) are the same lifetime class — a leftover patch doesn't carry through a door either.
    this.statusZones.forEach((zone) => zone.destroy())
    this.statusZones.clear()
    this.statusZoneColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.statusZoneColliders.clear()

    // A Chest doesn't need a persisted-pickups-style snapshot like item
    // pickups do — whether this room *has* one at all is stable, stored on
    // the room definition itself (room.hasChest), and openedChests is the
    // only "has it already been consumed" state that needs to survive
    // between visits.
    this.chest?.destroy()
    this.chest = null
    this.chestColliders.forEach(destroyCollider)
    this.chestColliders = []

    // The Gamble Shrine is room-scoped like Chest, but unlike Chest it
    // never self-destructs on use — only ever torn down here, on room exit.
    this.shrine?.destroy()
    this.shrine = null
    this.shrineColliders.forEach(destroyCollider)
    this.shrineColliders = []

    // Angel Room pickups also don't need a persisted-pickups snapshot —
    // angelRoomItems/angelRoomResolved already remember everything needed
    // to respawn the same 3 (or nothing, once resolved) on a return visit.
    this.angelPickups.forEach((pickup) => pickup.destroy())
    this.angelPickups.clear()
    this.angelPickupColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.angelPickupColliders.clear()
  }

  /**
   * Tears down the current room's enemies/projectiles and builds the next
   * one. `enteredFrom` is the edge of the *new* room being entered through
   * — omitted for the very first room, since freshly-constructed Players
   * are already at their normal spawn points.
   */
  private loadRoom(coord: RoomCoord, enteredFrom?: Direction) {
    this.teardownCurrentRoom()

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

    if (room?.isGamble) {
      this.spawnGambleShrine(room.chestAnchor.x, room.chestAnchor.y)
    }

    if (room?.isAngel && !this.angelRoomResolved) {
      this.angelRoomItems ??= randomAngelItemIds(ANGEL_ROOM_OPTION_COUNT, this.grantedUniqueItems)
      this.spawnAngelPickups(this.angelRoomItems, room.enemyAnchor)
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

  // ---- Devil's Room (DESIGN.md §9) ----
  // Not a grid room — reuses the boss room's own canvas as a detour, see
  // DEVIL_DOOR_DIRECTION/checkRoomTransition's boss branch for how you get here.

  private enterDevilRoom() {
    this.teardownCurrentRoom()
    this.devilRoomReturnCoord = this.roomCoord
    this.inDevilRoom = true

    this.hostPlayer.teleport(DEVIL_ROOM_HOST_SPAWN.x, DEVIL_ROOM_HOST_SPAWN.y)
    this.joinerPlayer?.teleport(DEVIL_ROOM_JOINER_SPAWN.x, DEVIL_ROOM_JOINER_SPAWN.y)
    this.hostBuddies.forEach((buddy) => buddy.teleport(DEVIL_ROOM_HOST_SPAWN.x, DEVIL_ROOM_HOST_SPAWN.y))
    this.joinerBuddies.forEach((buddy) => buddy.teleport(DEVIL_ROOM_JOINER_SPAWN.x, DEVIL_ROOM_JOINER_SPAWN.y))

    this.spawnDevilPedestals()
  }

  /** 2 options in solo (sharedConsumption needs a teammate), 3 in co-op — laid out along the same centered-line formula spawnRoomEnemies already uses. */
  private spawnDevilPedestals() {
    const ids = availableDevilItemIds(!!this.joinerPlayer)
    const total = ids.length
    ids.forEach((id, index) => {
      const x = DEVIL_ROOM_PEDESTAL_ANCHOR.x + (index - (total - 1) / 2) * DEVIL_ROOM_PEDESTAL_SPACING
      const pedestal = new DevilPedestal(this.scene, id, x, DEVIL_ROOM_PEDESTAL_ANCHOR.y, { simulated: true })
      this.devilPedestals.set(id, pedestal)

      const colliders: Phaser.Physics.Arcade.Collider[] = []
      const hostPlayer = this.hostPlayer
      colliders.push(
        this.scene.physics.add.overlap(hostPlayer.square, pedestal.shape, () => this.handleDevilPedestalTouch(id, hostPlayer)),
      )
      const joinerPlayer = this.joinerPlayer
      if (joinerPlayer) {
        colliders.push(
          this.scene.physics.add.overlap(joinerPlayer.square, pedestal.shape, () => this.handleDevilPedestalTouch(id, joinerPlayer)),
        )
      }
      this.devilPedestalColliders.set(id, colliders)
    })
  }

  /** Whoever pays a Blood Pact/Turret Pact's cost — the *other* player if one exists, else the picker themself (solo has nobody else to pay). */
  private devilCostTarget(picker: Player): Player {
    const teammate = picker === this.hostPlayer ? this.joinerPlayer : this.hostPlayer
    return teammate ?? picker
  }

  /**
   * Choosing any pedestal destroys every other one immediately (before
   * applying any effect) — both guards against both players touching
   * different pedestals in the same physics frame, and is the actual
   * "the others are gone once you choose" rule.
   */
  private handleDevilPedestalTouch(id: DevilItemId, player: Player) {
    if (!this.devilPedestals.has(id)) {
      return
    }
    this.devilPedestals.forEach((pedestal) => pedestal.destroy())
    this.devilPedestals.clear()
    this.devilPedestalColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.devilPedestalColliders.clear()

    if (id === 'sharedConsumption') {
      // Both players receive a copy of the *other's* strong-item history —
      // true union, not just whoever physically touched the pedestal.
      const hostHistory = [...this.hostStrongItemHistory]
      const joinerHistory = [...this.joinerStrongItemHistory]
      this.hostPlayer.applyDevilSharedConsumption(joinerHistory)
      this.joinerPlayer?.applyDevilSharedConsumption(hostHistory)
      this.hostPlayer.crushMaxLivesTo1()
      this.joinerPlayer?.crushMaxLivesTo1()
    } else if (id === 'bloodPact') {
      player.applyDevilBloodPact()
      this.devilCostTarget(player).decreaseMaxLives(1)
    } else {
      // turretPact — applyDevilTurretPact only bumps stats.shieldCount; the
      // actual new entity (and retinting every existing one, "including
      // the new one") still needs doing here, same as a normal Orbiting
      // Shield pickup would via spawnShield.
      player.applyDevilTurretPact()
      this.spawnShield(player)
      const shields = player === this.hostPlayer ? this.hostShields : this.joinerShields
      shields.forEach((shield) => shield.setTurretMode(true))
      this.devilCostTarget(player).decreaseMaxLives(1)
    }

    showPickupText(this.scene, player.x, player.y, DEVIL_ITEMS[id].label)
  }

  /** Called every update() tick while inDevilRoom, in place of trackRoomCleared/checkRoomTransition — Devil's Room has neither enemies nor doors. */
  private checkDevilRoomExit() {
    for (const player of [this.hostPlayer, this.joinerPlayer]) {
      if (!player) {
        continue
      }
      if (Phaser.Math.Distance.Between(player.x, player.y, DEVIL_EXIT_CENTER.x, DEVIL_EXIT_CENTER.y) < DEVIL_EXIT_RADIUS) {
        this.exitDevilRoom()
        return
      }
    }
  }

  /** Back to the boss room you detoured from — always allowed, whether or not a pedestal was chosen. */
  private exitDevilRoom() {
    this.inDevilRoom = false
    this.devilPedestals.forEach((pedestal) => pedestal.destroy())
    this.devilPedestals.clear()
    this.devilPedestalColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.devilPedestalColliders.clear()

    const returnCoord = this.devilRoomReturnCoord
    this.devilRoomReturnCoord = null
    if (returnCoord) {
      this.loadRoom(returnCoord)
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
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    // Only rock pillars are raised off the ground — water is flat, same
    // reasoning HazardZone/StatusZone never get a shadow either.
    const shadow = rect.type === 'rock' ? createShadow(this.scene, Math.max(rect.width, rect.height)) : null
    shadow?.setPosition(centerX, centerY)
    const shape = this.scene.add.rectangle(centerX, centerY, rect.width, rect.height, color, alpha)
    this.scene.physics.add.existing(shape, true)
    this.roomObstacles.push({ shape, type: rect.type, shadow })

    this.obstacleColliders.push(this.scene.physics.add.collider(this.hostPlayer.square, shape))
    if (this.joinerPlayer) {
      this.obstacleColliders.push(this.scene.physics.add.collider(this.joinerPlayer.square, shape))
    }
  }

  // ---- Enemies ----

  /**
   * Nudges (x, y) outward from any rock/water obstacle it currently falls
   * inside (expanded by `clearance`, so the enemy's own size doesn't still
   * visually clip the edge) — the centered-line spawn formula below only
   * ever consulted a bucket's single anchor point, never the obstacles
   * placed around it, so an enemy several slots out from the anchor could
   * land squarely inside a pillar or water tile. Enemies *do* get a solid
   * collider against obstacles once spawned (see spawnEnemy), but physics
   * separating an already-overlapping body afterward looks buggy and isn't
   * guaranteed to push it somewhere sensible — better to never spawn inside
   * one at all. Pushes out along whichever edge is nearest; obstacles in
   * this game never overlap each other, so a single pass per obstacle is
   * enough.
   */
  private clearObstacles(x: number, y: number, clearance: number): Vec2 {
    let pos = { x, y }
    for (const obstacle of this.roomObstacles) {
      const left = obstacle.shape.x - obstacle.shape.width / 2 - clearance
      const right = obstacle.shape.x + obstacle.shape.width / 2 + clearance
      const top = obstacle.shape.y - obstacle.shape.height / 2 - clearance
      const bottom = obstacle.shape.y + obstacle.shape.height / 2 + clearance
      if (pos.x <= left || pos.x >= right || pos.y <= top || pos.y >= bottom) {
        continue
      }
      const pushLeft = pos.x - left
      const pushRight = right - pos.x
      const pushUp = pos.y - top
      const pushDown = bottom - pos.y
      const minPush = Math.min(pushLeft, pushRight, pushUp, pushDown)
      if (minPush === pushLeft) {
        pos = { x: left, y: pos.y }
      } else if (minPush === pushRight) {
        pos = { x: right, y: pos.y }
      } else if (minPush === pushUp) {
        pos = { x: pos.x, y: top }
      } else {
        pos = { x: pos.x, y: bottom }
      }
    }
    return pos
  }

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
          const clearPos = this.clearObstacles(pos.x, pos.y, archetype.size / 2 + OBSTACLE_SPAWN_CLEARANCE_PADDING)
          this.spawnEnemy(archetype, clearPos.x, clearPos.y)
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
        const pos = this.clearObstacles(
          deathX + Math.cos(angle) * SPLIT_SPAWN_OFFSET,
          deathY + Math.sin(angle) * SPLIT_SPAWN_OFFSET,
          childArchetype.size / 2 + OBSTACLE_SPAWN_CLEARANCE_PADDING,
        )
        this.spawnEnemy(childArchetype, pos.x, pos.y)
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
      // Devil's Room (DESIGN.md §9) — this is the one moment tookDamageThisRoom is still accurate for the fight that just ended.
      this.devilRoomAvailable = !this.tookDamageThisRoom
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

    const roomDef = getRoomDefinition(this.currentFloor.rooms, coord)

    // Guaranteed no-enemy rooms (DESIGN.md §8) — 'loot' always drops 2-3
    // key/heart/coin pickups scattered around the room; 'empty' drops
    // nothing at all (it's a placeholder for now, see
    // currentRoomPlaceholderLabel). Neither rolls the regular-room chances
    // below.
    if (roomDef?.noEnemyVariant) {
      if (roomDef.noEnemyVariant === 'loot') {
        const count = Phaser.Math.Between(FREE_ROOM_LOOT_MIN, FREE_ROOM_LOOT_MAX)
        for (let i = 0; i < count; i++) {
          const itemId = FREE_ROOM_LOOT_POOL[Math.floor(Math.random() * FREE_ROOM_LOOT_POOL.length)]
          const pos = scatterPosition(roomDef.enemyAnchor, FREE_ROOM_SCATTER_MIN_DISTANCE, FREE_ROOM_SCATTER_MAX_DISTANCE)
          this.spawnItemPickup(itemId, pos.x, pos.y)
        }
      }
      return
    }

    // The Gamble Shrine room drop rewards through pulls (handleShrinePull),
    // not the regular room-clear roll below.
    if (roomDef?.isGamble) {
      return
    }

    // Angel Room rewards through its own 3 curated pedestals (loadRoom's
    // spawnAngelPickups), not the regular room-clear roll below.
    if (roomDef?.isAngel) {
      return
    }

    // Regular room — reads this room's own enemyAnchor instead of the bare
    // ENEMY_SPAWN_CENTER constant, so a reward can never land inside a
    // pillar room's rocks (golden/boss above stay on the fixed constants
    // since those room types are always the obstacle-free empty layout).
    const anchor = roomDef?.enemyAnchor ?? ENEMY_SPAWN_CENTER

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

  /**
   * Applies the effect to whichever specific player touched it. A heart at
   * full lives is left on the ground untouched rather than being consumed
   * for nothing — this player (or their partner, in co-op, if they're not
   * also capped) can still come back for it later after taking a hit. No
   * feedback on the no-op touch, same "silently ignored" treatment as
   * walking into a locked golden-room door with 0 keys.
   */
  private handleItemPickup(pickupId: number, itemId: ItemId, player: Player) {
    if (itemId === 'heart' && player.getLives() >= player.getMaxLives()) {
      return
    }
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

  // ---- Status zones (DESIGN.md §6 combos) ----

  /**
   * Ice+Gravity's ice patch / Poison+Bomb's poison cloud — a lingering zone
   * that expires on its own after durationMs, same shape as spawnHazardZone,
   * but wired against roomEnemies (not players) and applying a status stack
   * (gated by the zone's own per-enemy cooldown, StatusZone.canApplyToEnemy —
   * unlike a hazard's direct handleHit, restacking needs its own throttle
   * since there's no built-in invincibility-frame equivalent for enemies).
   */
  private spawnStatusZone(effect: StatusZoneEffect, x: number, y: number, radius: number, durationMs: number) {
    const id = this.nextStatusZoneId++
    const zone = new StatusZone(this.scene, id, effect, x, y, radius, { simulated: true })
    this.statusZones.set(id, zone)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    this.roomEnemies.forEach((enemy, enemyId) => {
      colliders.push(
        this.scene.physics.add.overlap(zone.shape, enemy.square, () => {
          const now = this.scene.time.now
          if (!zone.canApplyToEnemy(enemyId, now, STATUS_ZONE_REAPPLY_INTERVAL_MS)) {
            return
          }
          zone.recordApply(enemyId, now)
          if (effect === 'slow') {
            enemy.addSlowStack(now)
          } else {
            enemy.addPoisonStack(now)
          }
        }),
      )
    })
    this.statusZoneColliders.set(id, colliders)

    this.scene.time.delayedCall(durationMs, () => this.destroyStatusZone(id))
  }

  private destroyStatusZone(id: number) {
    this.statusZones.get(id)?.destroy()
    this.statusZones.delete(id)
    this.statusZoneColliders.get(id)?.forEach(destroyCollider)
    this.statusZoneColliders.delete(id)
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

  // ---- Gamble Shrine ----

  /** DESIGN.md §8 (brainstorm) — a room fixture in a room.isGamble room, spawned here from loadRoom same as a Chest. */
  private spawnGambleShrine(x: number, y: number) {
    const shrine = new GambleShrine(this.scene, x, y, { simulated: true })
    this.shrine = shrine

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    const hostPlayer = this.hostPlayer
    colliders.push(this.scene.physics.add.overlap(hostPlayer.square, shrine.shape, () => this.handleShrinePull(hostPlayer)))
    const joinerPlayer = this.joinerPlayer
    if (joinerPlayer) {
      colliders.push(this.scene.physics.add.overlap(joinerPlayer.square, shrine.shape, () => this.handleShrinePull(joinerPlayer)))
    }
    this.shrineColliders = colliders
  }

  /**
   * Costs GAMBLE_PULL_COST coins — no-ops (silent) if the team can't
   * afford it. Cooldown-gated (not a one-shot guard like Chest, since the
   * shrine never disappears) so standing on it doesn't pull every physics
   * frame — walking off and back, or just waiting out the cooldown, both
   * get you another pull.
   */
  private handleShrinePull(player: Player) {
    const now = this.scene.time.now
    if (!canFire(this.shrinePullState, now, GAMBLE_PULL_COOLDOWN_MS) || this.coinCount < GAMBLE_PULL_COST) {
      return
    }
    this.shrinePullState = recordFire(this.shrinePullState, now)
    this.coinCount -= GAMBLE_PULL_COST

    const outcome = rollGambleOutcome()
    if (outcome === 'bust') {
      showPickupText(this.scene, player.x, player.y, '꽝!')
      return
    }
    if (outcome === 'refund') {
      this.coinCount += 1
      showPickupText(this.scene, player.x, player.y, '코인 +1')
      return
    }
    if (outcome === 'heart' || outcome === 'key') {
      this.applyGrantedItem(outcome, player)
      showPickupText(this.scene, player.x, player.y, getItemLabel(outcome))
      return
    }
    if (outcome === 'boost') {
      const id = randomBoostItemId()
      this.applyGrantedItem(id, player)
      showPickupText(this.scene, player.x, player.y, getItemLabel(id))
      return
    }
    // jackpot
    const id = randomStrongItemId(this.grantedUniqueItems)
    this.applyGrantedItem(id, player)
    showPickupText(this.scene, player.x, player.y, getItemLabel(id))
  }

  // ---- Angel Room ----

  /**
   * A real grid room (DESIGN.md §9), unlike Devil's Room — reuses the
   * regular ItemPickup entity directly (its curated items are already real
   * StrongItemIds/RoleIds, rendered with their true identified color/label
   * same as any other strong/role item) and shares nextItemPickupId's id
   * space with the normal itemPickups map so ids never collide, even
   * though the broadcast itself is its own dedicated field (see
   * buildStateMessage's angelPickups — kept separate from itemPickups on
   * purpose, see the comment there).
   */
  private spawnAngelPickups(items: (StrongItemId | RoleId)[], anchor: { x: number; y: number }) {
    const total = items.length
    items.forEach((itemId, index) => {
      const x = anchor.x + (index - (total - 1) / 2) * ANGEL_PICKUP_SPACING
      const id = this.nextItemPickupId++
      const pickup = new ItemPickup(this.scene, id, itemId, x, anchor.y, { simulated: true })
      this.angelPickups.set(id, pickup)

      const colliders: Phaser.Physics.Arcade.Collider[] = []
      const hostPlayer = this.hostPlayer
      colliders.push(
        this.scene.physics.add.overlap(hostPlayer.square, pickup.shape, () =>
          this.handleAngelPickupTouch(id, itemId, hostPlayer),
        ),
      )
      const joinerPlayer = this.joinerPlayer
      if (joinerPlayer) {
        colliders.push(
          this.scene.physics.add.overlap(joinerPlayer.square, pickup.shape, () =>
            this.handleAngelPickupTouch(id, itemId, joinerPlayer),
          ),
        )
      }
      this.angelPickupColliders.set(id, colliders)
    })
  }

  /** Choosing any option destroys every other one immediately, same "others are gone" rule and same same-frame-double-pick guard as Devil's Room pedestals. No cost — this is Angel Room's whole point. */
  private handleAngelPickupTouch(pickupId: number, itemId: StrongItemId | RoleId, player: Player) {
    if (!this.angelPickups.has(pickupId)) {
      return
    }
    this.angelPickups.forEach((pickup) => pickup.destroy())
    this.angelPickups.clear()
    this.angelPickupColliders.forEach((colliders) => colliders.forEach(destroyCollider))
    this.angelPickupColliders.clear()
    this.angelRoomResolved = true

    this.applyGrantedItem(itemId, player)
    showPickupText(this.scene, player.x, player.y, getItemLabel(itemId))
  }

  // ---- Projectiles ----

  /** Spawns a projectile (reading the firing player's item-boosted stats) and wires overlap detection against every enemy currently in the room. */
  private spawnProjectile(player: Player, angle: number) {
    const id = this.nextProjectileId++
    const stats = player.getStats()
    const damage = player.getEffectiveDamage()
    const roleEffect = player.getCurrentRole()
    const projectile = new Projectile(this.scene, id, player.x, player.y, angle, {
      simulated: true,
      damage,
      speed: PROJECTILE_SPEED * stats.potatoSpeedMultiplier,
      radius: PROJECTILE_RADIUS * stats.potatoSizeMultiplier,
      range: PROJECTILE_MAX_RANGE * stats.potatoRangeMultiplier,
      pierceCount: stats.hasPiercing,
      homingStrength: stats.hasHoming,
      // Bomb overrides the normal damage-tint with its own fixed color —
      // "which color is this" is more useful as a role-identity/danger cue
      // for an explosive shot than as a damage-scaling indicator.
      color: roleEffect === 'bomb' ? getRoleColor('bomb') : projectileColorForDamage(damage),
      roleEffect,
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

  /** Buddy's shot — fixed size/damage, deliberately not reading the owning player's stats (see the note in tryFirePlayer). Its role effect *does* compose (only the damage/size stat-scaling is the named exception), so callers pass the owning player's roleEffect through. Shares the same projectiles/projectileColliders maps as a normal shot, so it gets pierce-fix collider registration against newly-spawned enemies, room-transition cleanup, and broadcast for free. */
  private spawnBuddyProjectile(x: number, y: number, angle: number, roleEffect: RoleId | null) {
    const id = this.nextProjectileId++
    const projectile = new Projectile(this.scene, id, x, y, angle, {
      simulated: true,
      damage: BUDDY_PROJECTILE_DAMAGE,
      radius: BUDDY_PROJECTILE_RADIUS,
      color: roleEffect === 'bomb' ? getRoleColor('bomb') : undefined,
      roleEffect,
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

    // Bomb (DESIGN.md §5) explodes on first contact, full stop — none of
    // the pierce/attach/single-target-hit machinery below applies, since
    // the blast itself already sweeps every enemy (and every player) in
    // radius, including whichever enemy it just made contact with.
    if (projectile.roleEffect === 'bomb') {
      this.applyBombExplosion(projectile.x, projectile.y, projectile.damage, this.scene.time.now)
      this.destroyProjectile(projectileId)
      return
    }

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
    } else {
      // Skipped entirely on a lethal hit — nothing to apply status to.
      this.applyRoleOnHitEffect(projectile.roleEffect, enemy, enemyId, projectile.damage, this.scene.time.now)
    }

    if (projectile.consumePierce()) {
      // If it attached, keep the projectile around to tick attached damage.
      if (!projectile.isAttached()) {
        this.destroyProjectile(projectileId)
      }
    }
  }

  /**
   * Bomb's blast (DESIGN.md §5) — every enemy *and* every player (both
   * hostPlayer/joinerPlayer, including the shooter themselves — no
   * self-exemption, "highest risk role") within BOMB_BLAST_RADIUS of
   * (x, y). Enemy damage reuses applyHit/resolveEnemyDeath; player damage
   * reuses handleHit (i-frame gated) — the exact same shape as Strong
   * Swarmer's death explosion (resolveEnemyDeath's explodesOnDeath
   * branch), just triggered by projectile contact instead of a death.
   *
   * Poison + Bomb combo (DESIGN.md §6): a poisoned enemy killed by the
   * blast releases its poison as a lingering cloud at its death position.
   * `wasPoisoned`/`deathX`/`deathY` are all captured *before* applyHit/
   * resolveEnemyDeath, same destroyed-object read-safety reasoning as
   * applyElectricChain's shatter (this exact bug class already caught once
   * this session with Chest).
   */
  private applyBombExplosion(x: number, y: number, damage: number, now: number) {
    this.roomEnemies.forEach((enemy, enemyId) => {
      if (Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y) <= BOMB_BLAST_RADIUS) {
        const wasPoisoned = enemy.isPoisoned(now)
        const deathX = enemy.x
        const deathY = enemy.y
        const died = enemy.applyHit(damage)
        if (died) {
          this.resolveEnemyDeath(enemyId, enemy)
          if (wasPoisoned) {
            this.spawnStatusZone('poison', deathX, deathY, POISON_CLOUD_RADIUS, POISON_CLOUD_DURATION_MS)
          }
        }
      }
    })
    for (const player of [this.hostPlayer, this.joinerPlayer]) {
      if (player && !player.isOut && Phaser.Math.Distance.Between(x, y, player.x, player.y) <= BOMB_BLAST_RADIUS) {
        this.handleHit(player)
      }
    }
    spawnExplosionEffect(this.scene, x, y)
  }

  /**
   * The 5 status-effect roles' on-hit identity (DESIGN.md §5). Gravity has
   * no branch here — its pull is a per-frame in-flight effect (see
   * update()'s projectile loop), not an on-hit proc. Bomb never reaches
   * here either — handleProjectileHitEnemy branches to applyBombExplosion
   * before this point, since a lethal-hit-only gate (see the `!died` check
   * at this function's one call site) doesn't make sense for an AoE that
   * needs to resolve regardless of what its contact target's fate was.
   * Laser isn't buildable yet so its id never reaches here either.
   */
  private applyRoleOnHitEffect(roleEffect: RoleId | null, enemy: Enemy, enemyId: number, damage: number, now: number) {
    if (roleEffect === 'ice') {
      // Ice + Glue combo (DESIGN.md §6) — a slowed enemy is easier to freeze.
      const freezeChance = enemy.isSlowed(now) ? ICE_GLUE_COMBO_FREEZE_CHANCE : ICE_FREEZE_CHANCE
      if (Math.random() < freezeChance) {
        enemy.applyFreeze(now, ICE_FREEZE_DURATION_MS)
      }
    } else if (roleEffect === 'glue') {
      enemy.addSlowStack(now)
    } else if (roleEffect === 'poison') {
      enemy.addPoisonStack(now)
    } else if (roleEffect === 'electric') {
      this.applyElectricChain(enemy, enemyId, damage, now)
    }
  }

  /**
   * Electric's chain (DESIGN.md §5) — a single ELECTRIC_CHAIN_CHANCE roll
   * per hit (not one per hop); on success, the chain is guaranteed to
   * reach up to ELECTRIC_CHAIN_MAX_HOPS additional enemies, propagating
   * outward from wherever the chain currently is (not always back to the
   * original target), so it can snake through a loose cluster rather than
   * only ever reaching the same one neighbor twice. Stops early only if it
   * runs out of enemies in range; continues past a hop that kills its
   * target (the last known position of a just-killed enemy is still a
   * valid arc origin).
   *
   * Two combos (DESIGN.md §6) layer onto each hop:
   * - **Poison + Electric**: if the enemy the chain is arcing *from* is
   *   poisoned, a POISON_ELECTRIC_SPREAD_CHANCE roll can spread a poison
   *   stack onto the new target.
   * - **Ice + Electric**: if the *target* is frozen, this hop deals bonus
   *   damage and always (not just on a kill) triggers a small shatter AoE
   *   against nearby enemies.
   *
   * `targetX`/`targetY` are captured before any death-causing call — reading
   * position off an Enemy after resolveEnemyDeath has destroyed it is the
   * same bug class already caught once this session (Chest).
   */
  private applyElectricChain(originEnemy: Enemy, originId: number, damage: number, now: number) {
    if (Math.random() >= ELECTRIC_CHAIN_CHANCE) {
      return
    }
    const hitIds = new Set<number>([originId])
    let fromEnemy: Enemy = originEnemy
    let fromX = originEnemy.x
    let fromY = originEnemy.y
    for (let hop = 0; hop < ELECTRIC_CHAIN_MAX_HOPS; hop++) {
      const target = this.findNearestOtherEnemy(hitIds, fromX, fromY, ELECTRIC_CHAIN_RADIUS)
      if (!target) {
        return
      }
      const [targetId, targetEnemy] = target
      hitIds.add(targetId)
      const targetX = targetEnemy.x
      const targetY = targetEnemy.y

      if (fromEnemy.isPoisoned(now) && Math.random() < POISON_ELECTRIC_SPREAD_CHANCE) {
        targetEnemy.addPoisonStack(now)
      }

      const targetWasFrozen = targetEnemy.isFrozen(now)
      const hopDamage = targetWasFrozen ? Math.round(damage * ICE_ELECTRIC_DAMAGE_MULTIPLIER) : damage
      const died = targetEnemy.applyHit(hopDamage)
      if (died) {
        this.resolveEnemyDeath(targetId, targetEnemy)
      }
      if (targetWasFrozen) {
        this.applyShatterAoE(targetX, targetY, targetId, hopDamage)
      }

      fromEnemy = targetEnemy
      fromX = targetX
      fromY = targetY
    }
  }

  /** Ice + Electric combo (DESIGN.md §6) — a small AoE against every *other* living enemy within SHATTER_RADIUS, triggered by a chain hop landing on a frozen target (see applyElectricChain), regardless of whether that hop itself killed the target. Enemies-only, no player-damage pass — a reward for the freeze+chain setup, not additional risk like Bomb's blast. Reuses spawnExplosionEffect for the VFX as a first-pass placeholder. */
  private applyShatterAoE(x: number, y: number, excludeId: number, damage: number) {
    this.roomEnemies.forEach((enemy, enemyId) => {
      if (enemyId === excludeId) {
        return
      }
      if (Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y) <= SHATTER_RADIUS) {
        const died = enemy.applyHit(damage)
        if (died) {
          this.resolveEnemyDeath(enemyId, enemy)
        }
      }
    })
    spawnExplosionEffect(this.scene, x, y)
  }

  /** Electric's chain target — nearest living enemy not already part of this chain, within radius, or null. */
  private findNearestOtherEnemy(excludeIds: Set<number>, x: number, y: number, radius: number): [number, Enemy] | null {
    let best: [number, Enemy] | null = null
    let bestDist = radius
    this.roomEnemies.forEach((candidate, id) => {
      if (excludeIds.has(id)) {
        return
      }
      const d = Phaser.Math.Distance.Between(x, y, candidate.x, candidate.y)
      if (d <= bestDist) {
        bestDist = d
        best = [id, candidate]
      }
    })
    return best
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
