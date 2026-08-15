// Gameplay message shapes sent over the DataConnection once two peers are
// connected. Kept separate from peerConnection.ts's NameMessage, which is
// part of establishing the connection rather than gameplay itself.

import type { RoomCoord } from '../rooms/floorLayout'
import type { ArchetypeId } from '../gameplay/enemyArchetypes'
import { ARCHETYPES } from '../gameplay/enemyArchetypes'
import type { ItemId } from '../gameplay/items'
import { isKnownItemId } from '../gameplay/items'

export interface KeyState {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

/**
 * Joiner -> host: sent only when the key state (movement or fire) changes.
 * Aim direction isn't part of this message — it's derived host-side from
 * whichever way the player is currently facing (see Player.getFacingAngle),
 * itself derived from the same `keys` this message already carries.
 */
export interface InputMessage {
  type: 'input'
  keys: KeyState
  fire: boolean
}

/** Joiner -> host: "someone wants to toggle pause" — no payload, host decides and broadcasts the result. */
export interface PauseToggleMessage {
  type: 'pauseToggle'
}

/**
 * Host -> joiner: sent once whenever a level (re)starts, not per-tick —
 * mirrors PauseToggleMessage's discrete, send-on-event shape rather than
 * StateMessage's fixed-rate broadcast. The room list only carries what the
 * joiner needs to render doors/the minimap (coord + isBoss); enemy
 * composition never needs to travel here since enemy instances already
 * arrive via the existing per-room EnemyState reconciliation.
 */
export interface LevelStartMessage {
  type: 'levelStart'
  level: number
  startCoord: RoomCoord
  rooms: { coord: RoomCoord; isBoss: boolean; isGolden: boolean }[]
}

export interface Vec2 {
  x: number
  y: number
}

/** One active projectile's authoritative position, broadcast alongside player/enemy state. */
export interface ProjectileState {
  id: number
  pos: Vec2
  /** Only present when a shot's radius differs from the default (Big Shot) — the joiner needs this to render it at the right size too. */
  radius?: number
  /** Only present for player shots whose color is damage-tinted (see entities/Projectile.ts's projectileColorForDamage) — enemy shots and Buddy's fixed shot always use their own fixed defaults, so this is omitted for those. */
  color?: number
}

/** One active room-clear reward pickup, sitting still on the ground until someone walks over it. */
export interface ItemPickupState {
  id: number
  itemId: ItemId
  pos: Vec2
}

/** One active enemy's authoritative state — a room can now hold more than one at a time. */
export interface EnemyState {
  id: number
  /** Which archetype (gameplay/enemyArchetypes.ts) to render this as — always sent, not inferred. */
  archetype: ArchetypeId
  pos: Vec2
  health: number
}

/**
 * One Buddy familiar or Orbiting Shield (DESIGN.md §7's stackable strong
 * items) — just an id + position, unlike EnemyState/ProjectileState there's
 * no other state to mirror (no health, always the same visual). Persists
 * across room transitions (they follow the player, not the room), unlike
 * everything else broadcast alongside it.
 */
export interface FollowerState {
  id: number
  pos: Vec2
}

/**
 * Per-player snapshot broadcast each tick. Nested (rather than flattened
 * into host- and joiner-prefixed StateMessage fields) so later phases
 * (role, holdables, etc.) have somewhere to grow without reshaping the
 * message. isInvincible is a derived boolean, not the host's raw
 * invincibleUntil timestamp — that timestamp is on the host's own clock and
 * meaningless on the joiner's differently-started one (see gameplay/lives.ts).
 */
export interface PlayerState {
  pos: Vec2
  lives: number
  /** Heart-container cap (DESIGN.md §3) — the joiner needs this too, not just `lives`, to render a heart row's empty slots correctly. */
  maxLives: number
  isOut: boolean
  isInvincible: boolean
}

/** Host -> joiner: authoritative state, broadcast at a fixed rate. */
export interface StateMessage {
  type: 'state'
  host: PlayerState
  joiner: PlayerState
  /** Which room of the current level's generated floor (see LevelStartMessage) the host is currently in. */
  roomCoord: RoomCoord
  /** The current room's live enemies — spawned/destroyed as the room is fought through and left. */
  enemies: EnemyState[]
  /** Player-fired shots. Spawned/destroyed continuously, cleared entirely on a room transition. */
  projectiles: ProjectileState[]
  /**
   * Enemy-fired shots (Ranged shooter). Kept as its own field rather than
   * folded into `projectiles` with an owner tag — mirrors how
   * enemies/projectiles/pause/gameOver are already each their own
   * top-level concern, and keeps "which side does this hit" unambiguous
   * by construction instead of a runtime check.
   */
  enemyProjectiles: ProjectileState[]
  /** Host-accumulated set of every room coord visited so far this level — joiner mirrors it wholesale, same as isPaused/isGameOver. Drives the minimap's fog-of-war reveal. */
  exploredRooms: RoomCoord[]
  /** Room-clear reward pickups currently on the ground in this room. */
  itemPickups: ItemPickupState[]
  /** Every Buddy familiar in play, both players' combined (host's and joiner's aren't distinguished — see FollowerState). */
  buddies: FollowerState[]
  /** Every Orbiting Shield in play, both players' combined. */
  shields: FollowerState[]
  isGameOver: boolean
  isPaused: boolean
}

function isKeyState(value: unknown): value is KeyState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    typeof v.up === 'boolean' &&
    typeof v.down === 'boolean' &&
    typeof v.left === 'boolean' &&
    typeof v.right === 'boolean'
  )
}

function isVec2(value: unknown): value is Vec2 {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return typeof v.x === 'number' && typeof v.y === 'number'
}

function isPlayerState(value: unknown): value is PlayerState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    isVec2(v.pos) &&
    typeof v.lives === 'number' &&
    typeof v.maxLives === 'number' &&
    typeof v.isOut === 'boolean' &&
    typeof v.isInvincible === 'boolean'
  )
}

function isProjectileState(value: unknown): value is ProjectileState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' &&
    isVec2(v.pos) &&
    (v.radius === undefined || typeof v.radius === 'number') &&
    (v.color === undefined || typeof v.color === 'number')
  )
}

function isItemPickupState(value: unknown): value is ItemPickupState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return typeof v.id === 'number' && typeof v.itemId === 'string' && isKnownItemId(v.itemId) && isVec2(v.pos)
}

function isFollowerState(value: unknown): value is FollowerState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return typeof v.id === 'number' && isVec2(v.pos)
}

function isEnemyState(value: unknown): value is EnemyState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' &&
    typeof v.archetype === 'string' &&
    v.archetype in ARCHETYPES &&
    isVec2(v.pos) &&
    typeof v.health === 'number'
  )
}

function isRoomCoord(value: unknown): value is RoomCoord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return typeof v.x === 'number' && typeof v.y === 'number'
}

export function isInputMessage(data: unknown): data is InputMessage {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const v = data as Record<string, unknown>
  return v.type === 'input' && isKeyState(v.keys) && typeof v.fire === 'boolean'
}

export function isPauseToggleMessage(data: unknown): data is PauseToggleMessage {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'pauseToggle'
}

function isRoomEntry(value: unknown): value is { coord: RoomCoord; isBoss: boolean; isGolden: boolean } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return isRoomCoord(v.coord) && typeof v.isBoss === 'boolean' && typeof v.isGolden === 'boolean'
}

export function isLevelStartMessage(data: unknown): data is LevelStartMessage {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const v = data as Record<string, unknown>
  return (
    v.type === 'levelStart' &&
    typeof v.level === 'number' &&
    isRoomCoord(v.startCoord) &&
    Array.isArray(v.rooms) &&
    v.rooms.every(isRoomEntry)
  )
}

export function isStateMessage(data: unknown): data is StateMessage {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const v = data as Record<string, unknown>
  return (
    v.type === 'state' &&
    isPlayerState(v.host) &&
    isPlayerState(v.joiner) &&
    isRoomCoord(v.roomCoord) &&
    Array.isArray(v.enemies) &&
    v.enemies.every(isEnemyState) &&
    Array.isArray(v.projectiles) &&
    v.projectiles.every(isProjectileState) &&
    Array.isArray(v.enemyProjectiles) &&
    v.enemyProjectiles.every(isProjectileState) &&
    Array.isArray(v.exploredRooms) &&
    v.exploredRooms.every(isRoomCoord) &&
    Array.isArray(v.itemPickups) &&
    v.itemPickups.every(isItemPickupState) &&
    Array.isArray(v.buddies) &&
    v.buddies.every(isFollowerState) &&
    Array.isArray(v.shields) &&
    v.shields.every(isFollowerState) &&
    typeof v.isGameOver === 'boolean' &&
    typeof v.isPaused === 'boolean'
  )
}
