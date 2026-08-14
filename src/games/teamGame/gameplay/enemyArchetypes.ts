// Pure archetype data — no Phaser dependency, mirrors lives.ts/attack.ts's
// separation of data from the entity class (entities/Enemy.ts) that
// consumes it. DESIGN.md §9 specifies each archetype's role matchups but
// not its exact stats/movement, since roles don't exist yet either — the
// values here are first-pass calls made to give each archetype a distinct
// feel on nothing but the default attack; tune freely once roles land.

export type ArchetypeId = 'swarmer' | 'tank' | 'chaser' | 'rangedShooter' | 'splitter'

export interface EnemyArchetype {
  id: ArchetypeId
  maxHealth: number
  speed: number
  size: number
  color: number
  /**
   * 'bounce': velocity set once at spawn, Arcade physics (setBounce) owns
   * the rest — no per-frame movement code needed.
   * 'chase'/'keepDistance': recomputed every host frame from the nearest
   * player's position (see Enemy.updateMovement).
   */
  movement: 'bounce' | 'chase' | 'keepDistance'
  /** If set, death spawns `splitCount` enemies of this archetype instead of just disappearing. */
  splitsOnDeath?: ArchetypeId
  splitCount?: number
  /** If set, periodically fires a projectile at the nearest in-range player (see Enemy.tryFireAt). */
  ranged?: { fireRateMs: number; range: number }
}

export const ARCHETYPES: Record<ArchetypeId, EnemyArchetype> = {
  // "Many weak, clustered" — the original placeholder's random-bounce
  // movement already reads as erratic swarming, so it's reused as-is.
  swarmer: {
    id: 'swarmer',
    maxHealth: 1,
    speed: 200,
    size: 20,
    color: 0xffaa33,
    movement: 'bounce',
  },
  // "Single high-HP, slow" — relentless but outrunnable.
  tank: {
    id: 'tank',
    maxHealth: 8,
    speed: 60,
    size: 40,
    color: 0x8855cc,
    movement: 'chase',
  },
  // "Fast, beelines at nearest player" — same pursuit logic as Tank, just
  // faster and squishier, so the two read as clearly different threats.
  chaser: {
    id: 'chaser',
    maxHealth: 2,
    speed: 150,
    size: 24,
    color: 0xff4444,
    movement: 'chase',
  },
  // "Stays at distance, fires at players" — backs off if a player gets
  // close, otherwise holds position and shoots on a cooldown.
  rangedShooter: {
    id: 'rangedShooter',
    maxHealth: 2,
    speed: 90,
    size: 24,
    color: 0x44ccff,
    movement: 'keepDistance',
    ranged: { fireRateMs: 1400, range: 260 },
  },
  // "Splits into two weaker enemies on death" — children are Swarmers
  // specifically (not more Splitters), so this can't recurse infinitely.
  splitter: {
    id: 'splitter',
    maxHealth: 3,
    speed: 130,
    size: 26,
    color: 0x66dd66,
    movement: 'chase',
    splitsOnDeath: 'swarmer',
    splitCount: 2,
  },
}
