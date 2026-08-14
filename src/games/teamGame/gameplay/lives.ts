// Host-only lives/invincibility bookkeeping (DESIGN.md §3). The joiner never
// runs any of this — it only ever renders the PlayerState the host derives
// from a LifeState and broadcasts (see net/syncProtocol.ts).

export const STARTING_LIVES = 5
export const RESPAWN_LIVES = 3
export const INVINCIBILITY_DURATION_MS = 1200

export interface LifeState {
  lives: number
  isOut: boolean
  /**
   * Timestamp on the host's own scene clock (scene.time.now) — never sent
   * over the wire as-is, since the joiner's clock starts from a different
   * point. Broadcast only the derived isInvincible(...) boolean instead.
   */
  invincibleUntil: number
}

export function createLifeState(): LifeState {
  return { lives: STARTING_LIVES, isOut: false, invincibleUntil: 0 }
}

export function isInvincible(state: LifeState, now: number): boolean {
  return state.invincibleUntil > now
}

/** No-ops if already out or currently invincible — safe to call on every overlap frame. */
export function applyHit(state: LifeState, now: number): LifeState {
  if (state.isOut || isInvincible(state, now)) {
    return state
  }

  const lives = state.lives - 1
  return {
    lives,
    isOut: lives <= 0,
    invincibleUntil: now + INVINCIBILITY_DURATION_MS,
  }
}

/**
 * Called when a new level starts. Only touches a player who was out —
 * DESIGN.md §3 settles the previously-TBD reset rule as a fixed respawn
 * count, not the starting count and not inherited from the other player.
 * Not wired to any trigger yet — real levels don't exist until Phase F+.
 */
export function respawnForNextLevel(state: LifeState): LifeState {
  if (!state.isOut) {
    return state
  }
  return { lives: RESPAWN_LIVES, isOut: false, invincibleUntil: 0 }
}
