// Host-only fire-rate bookkeeping (DESIGN.md §4). Mirrors gameplay/lives.ts's
// pure-state style. The joiner never checks this — it just reports "pointer
// is down, here's my aim" and trusts the host to decide whether a shot
// actually fires, so fire-rate can later become a role/boost-modified stat
// without the joiner needing to know the current rate.

export const DEFAULT_FIRE_RATE_MS = 500

export interface AttackState {
  /** Host's own scene clock (scene.time.now), like LifeState.invincibleUntil. */
  lastFiredAt: number
}

export function createAttackState(): AttackState {
  return { lastFiredAt: 0 }
}

export function canFire(state: AttackState, now: number, fireRateMs: number = DEFAULT_FIRE_RATE_MS): boolean {
  return now - state.lastFiredAt >= fireRateMs
}

export function recordFire(_state: AttackState, now: number): AttackState {
  return { lastFiredAt: now }
}
