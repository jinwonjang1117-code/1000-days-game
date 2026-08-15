// Host-only lives/invincibility bookkeeping (DESIGN.md §3). The joiner never
// runs any of this — it only ever renders the PlayerState the host derives
// from a LifeState and broadcasts (see net/syncProtocol.ts).

export const STARTING_LIVES = 5
export const RESPAWN_LIVES = 3
export const INVINCIBILITY_DURATION_MS = 1200

export interface LifeState {
  lives: number
  /** Heart-container cap (DESIGN.md §3) — grantLife/increaseMaxLives never push `lives` past this. */
  maxLives: number
  isOut: boolean
  /**
   * Timestamp on the host's own scene clock (scene.time.now) — never sent
   * over the wire as-is, since the joiner's clock starts from a different
   * point. Broadcast only the derived isInvincible(...) boolean instead.
   */
  invincibleUntil: number
}

export function createLifeState(): LifeState {
  return { lives: STARTING_LIVES, maxLives: STARTING_LIVES, isOut: false, invincibleUntil: 0 }
}

/** Passive heart-container growth (DESIGN.md §3): +1 every 2 levels, 0 at levels 1-2. */
export function bonusContainersForLevel(level: number): number {
  return Math.floor((level - 1) / 2)
}

export function isInvincible(state: LifeState, now: number): boolean {
  return state.invincibleUntil > now
}

/** No-ops if already out or currently invincible — safe to call on every overlap frame. */
export function applyHit(
  state: LifeState,
  now: number,
  invincibilityDurationMs: number = INVINCIBILITY_DURATION_MS,
): LifeState {
  if (state.isOut || isInvincible(state, now)) {
    return state
  }

  const lives = state.lives - 1
  return {
    ...state,
    lives,
    isOut: lives <= 0,
    invincibleUntil: now + invincibilityDurationMs,
  }
}

/** Item-pickup effect (Heart) — +1 life, capped at maxLives. */
export function grantLife(state: LifeState): LifeState {
  return { ...state, lives: Math.min(state.lives + 1, state.maxLives) }
}

/** Item-pickup effect (Heart Container strong item) / passive per-level growth — raises the cap and immediately fills the new capacity. */
export function increaseMaxLives(state: LifeState, amount: number): LifeState {
  const maxLives = state.maxLives + amount
  return { ...state, maxLives, lives: Math.min(state.lives + amount, maxLives) }
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
  return { ...state, lives: Math.min(RESPAWN_LIVES, state.maxLives), isOut: false, invincibleUntil: 0 }
}
