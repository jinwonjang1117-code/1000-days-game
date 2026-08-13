// Gameplay message shapes sent over the DataConnection once two peers are
// connected. Kept separate from peerConnection.ts's NameMessage, which is
// part of establishing the connection rather than gameplay itself.

export interface KeyState {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

/** Joiner -> host: sent only when the joiner's WASD state changes. */
export interface InputMessage {
  type: 'input'
  keys: KeyState
}

export interface Vec2 {
  x: number
  y: number
}

/** Host -> joiner: both squares' authoritative positions, broadcast at a fixed rate. */
export interface StateMessage {
  type: 'state'
  host: Vec2
  joiner: Vec2
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

export function isInputMessage(data: unknown): data is InputMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'input' &&
    isKeyState((data as { keys?: unknown }).keys)
  )
}

export function isStateMessage(data: unknown): data is StateMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'state' &&
    isVec2((data as { host?: unknown }).host) &&
    isVec2((data as { joiner?: unknown }).joiner)
  )
}
