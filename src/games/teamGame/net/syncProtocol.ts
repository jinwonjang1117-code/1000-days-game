// Gameplay message shapes sent over the DataConnection once two peers are
// connected. Kept separate from peerConnection.ts's NameMessage, which is
// part of establishing the connection rather than gameplay itself.

import type { RoomCoord } from '../rooms/floorLayout'

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

export interface Vec2 {
  x: number
  y: number
}

/** One active projectile's authoritative position, broadcast alongside player/enemy state. */
export interface ProjectileState {
  id: number
  pos: Vec2
}

/** One active enemy's authoritative state — a room can now hold more than one at a time. */
export interface EnemyState {
  id: number
  pos: Vec2
  health: number
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
  isOut: boolean
  isInvincible: boolean
}

/** Host -> joiner: authoritative state, broadcast at a fixed rate. */
export interface StateMessage {
  type: 'state'
  host: PlayerState
  joiner: PlayerState
  /** Which room of rooms/floorLayout.ts's fixed TEST_FLOOR the host is currently in. */
  roomCoord: RoomCoord
  /** The current room's live enemies — spawned/destroyed as the room is fought through and left. */
  enemies: EnemyState[]
  /** Spawned/destroyed continuously, cleared entirely on a room transition. */
  projectiles: ProjectileState[]
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
    typeof v.isOut === 'boolean' &&
    typeof v.isInvincible === 'boolean'
  )
}

function isProjectileState(value: unknown): value is ProjectileState {
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
  return typeof v.id === 'number' && isVec2(v.pos) && typeof v.health === 'number'
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
    typeof v.isGameOver === 'boolean' &&
    typeof v.isPaused === 'boolean'
  )
}
