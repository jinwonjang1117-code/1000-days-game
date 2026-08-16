// Pure archetype data — no Phaser dependency, mirrors lives.ts/attack.ts's
// separation of data from the entity class (entities/Enemy.ts) that
// consumes it. DESIGN.md §9 specifies each archetype's role matchups but
// not its exact stats/movement, since roles don't exist yet either — the
// values here are first-pass calls made to give each archetype a distinct
// feel on nothing but the default attack; tune freely once roles land.
//
// Each of the 5 regular categories comes in a Weak and Strong tier of the
// same behavior (see rooms/floorGenerator.ts for how a level picks
// between them) — generated from one base stat block per category rather
// than 10 hand-authored entries, so tuning a category's feel only means
// touching BASE_STATS once. Boss stays a single, hand-authored tier.

export type ArchetypeCategory =
  | 'swarmer'
  | 'tank'
  | 'chaser'
  | 'rangedShooter'
  | 'splitter'
  | 'movingShooter'
  | 'erratic'
  | 'charger'
  | 'summoner'
  | 'spreadShooter'
  | 'berserker'
  | 'slime'
type ArchetypeTier = 'Weak' | 'Strong'
export type ArchetypeId = `${ArchetypeCategory}${ArchetypeTier}` | 'boss'

/** No Phaser dependency in this file, so a tiny local helper instead of Phaser.Math.DegToRad. */
function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

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
   * 'erratic': periodically retargets to a random direction/speed, ignores
   * the player entirely.
   * 'charge': idle until a player is in range, then telegraphs and dashes
   * in a straight line (see Enemy's charge state machine).
   */
  movement: 'bounce' | 'chase' | 'keepDistance' | 'erratic' | 'charge'
  /** If set, death spawns `splitCount` enemies of this archetype instead of just disappearing. */
  splitsOnDeath?: ArchetypeId
  splitCount?: number
  /** If set, periodically fires a projectile at the nearest in-range player (see Enemy.tryFireAt). shotCount/spreadRadians (Spread Shooter) fan multiple shots across an arc instead of firing one straight at the target. */
  ranged?: { fireRateMs: number; range: number; shotCount?: number; spreadRadians?: number }
  /** If set, death also hits any player within explosionRadius (see DevTestScene's handleProjectileHitEnemy) — a normal hit, no separate damage machinery. */
  explodesOnDeath?: boolean
  explosionRadius?: number
  /** 'charge' movement only — see Enemy's idle/telegraphing/dashing/cooldown state machine. */
  charge?: { triggerRange: number; telegraphMs: number; dashSpeed: number; dashDurationMs: number; cooldownMs: number }
  /** Periodically spawns `archetype` near itself, independent of player proximity (see Enemy.trySummonAt). */
  summons?: { archetypes: ArchetypeId[]; intervalMs: number }
  /** Speed multiplies by speedMultiplier once health drops to/below this fraction of max — a sustained state derived live from health, not a stored flag. */
  enrage?: { healthThreshold: number; speedMultiplier: number }
  /** While alive, periodically drops a lingering damage zone at its current position (see Enemy.tryDropHazardAt / GameSimulation.spawnHazardZone) — not on death. */
  hazard?: { radius: number; durationMs: number; intervalMs: number }
}

interface BaseStats {
  maxHealth: number
  speed: number
  size: number
  color: number
  movement: 'bounce' | 'chase' | 'keepDistance' | 'erratic' | 'charge'
  splitsOnDeath?: ArchetypeCategory
  splitCount?: number
  ranged?: { fireRateMs: number; range: number; shotCount?: number; spreadRadians?: number }
  charge?: { triggerRange: number; telegraphMs: number; dashSpeed: number; dashDurationMs: number; cooldownMs: number }
  summons?: { archetypes: ArchetypeId[]; intervalMs: number }
  enrage?: { healthThreshold: number; speedMultiplier: number }
  hazard?: { radius: number; durationMs: number; intervalMs: number }
}

const BASE_STATS: Record<ArchetypeCategory, BaseStats> = {
  // "Many weak, clustered" — the original placeholder's random-bounce
  // movement already reads as erratic swarming, so it's reused as-is.
  swarmer: {
    maxHealth: 1,
    speed: 200,
    size: 20,
    color: 0xffaa33,
    movement: 'bounce',
  },
  // "Single high-HP, slow" — relentless but outrunnable.
  tank: {
    maxHealth: 8,
    speed: 60,
    size: 40,
    color: 0x8855cc,
    movement: 'chase',
  },
  // "Fast, beelines at nearest player" — same pursuit logic as Tank, just
  // faster and squishier, so the two read as clearly different threats.
  chaser: {
    maxHealth: 2,
    speed: 150,
    size: 24,
    color: 0xff4444,
    movement: 'chase',
  },
  // "Stays at distance, fires at players" — backs off if a player gets
  // close, otherwise holds position and shoots on a cooldown.
  rangedShooter: {
    maxHealth: 2,
    speed: 90,
    size: 24,
    color: 0x44ccff,
    movement: 'keepDistance',
    ranged: { fireRateMs: 1400, range: 260 },
  },
  // "Moves while shooting" — actively pursues but also fires on a
  // cooldown, creating a mobile ranged threat that pressures players.
  movingShooter: {
    maxHealth: 2,
    speed: 120,
    size: 24,
    color: 0x55bbee,
    movement: 'chase',
    ranged: { fireRateMs: 1200, range: 220 },
  },
  // "Splits on death" — the generic tier-matched target (2 Swarmers of the
  // same tier) is overridden for the Strong tier below.
  splitter: {
    maxHealth: 3,
    speed: 130,
    size: 26,
    color: 0x66dd66,
    movement: 'chase',
    splitsOnDeath: 'swarmer',
    splitCount: 2,
  },
  // "Unpredictable, not tanky" — hard to lead shots against because it
  // ignores the player entirely, periodically picking a new random
  // direction and speed instead of beelining or holding position.
  erratic: {
    maxHealth: 2,
    speed: 160,
    size: 22,
    color: 0xddff44,
    movement: 'erratic',
  },
  // "Telegraphed burst threat" — mostly idle, but closing to melee range
  // triggers a brief wind-up (visible tell) then a committed straight-line
  // dash. Punishes standing still, rewards dodging on the tell.
  charger: {
    maxHealth: 3,
    speed: 40,
    size: 28,
    color: 0xff8800,
    movement: 'charge',
    charge: { triggerRange: 260, telegraphMs: 500, dashSpeed: 420, dashDurationMs: 500, cooldownMs: 900 },
  },
  // "Pressure via numbers" — keeps its distance like a Ranged shooter but
  // never attacks directly; instead it periodically spawns a Weak Swarmer
  // near itself, regardless of player proximity. Has to be prioritized or
  // the room snowballs.
  summoner: {
    maxHealth: 4,
    speed: 70,
    size: 30,
    color: 0xaa44ff,
    movement: 'keepDistance',
    summons: { archetypes: ['swarmerWeak'], intervalMs: 4500 },
  },
  // "Covers an arc, not a line" — a Ranged shooter variant whose shot is a
  // 3-projectile fan instead of one, mirroring the player's own Multi Shot
  // spread math. Forces repositioning, not just sidestepping.
  spreadShooter: {
    maxHealth: 2,
    speed: 90,
    size: 24,
    color: 0x44ffaa,
    movement: 'keepDistance',
    ranged: { fireRateMs: 1800, range: 240, shotCount: 3, spreadRadians: degToRad(40) },
  },
  // "Punishes slow chip damage" — a plain melee chaser until its health
  // drops to/below half, at which point its speed jumps and it stays
  // visibly tinted for the rest of the fight (see Enemy's enrage tint).
  berserker: {
    maxHealth: 5,
    speed: 110,
    size: 30,
    color: 0xcc2244,
    movement: 'chase',
    enrage: { healthThreshold: 0.5, speedMultiplier: 1.7 },
  },
  // "Area denial while alive" — a slow melee chaser that periodically drops
  // a lingering damage zone at its current position (not on death — dying
  // is just a normal death). Real hazard through a doorway or chokepoint.
  slime: {
    maxHealth: 3,
    speed: 70,
    size: 26,
    color: 0x33cc88,
    movement: 'chase',
    hazard: { radius: 50, durationMs: 3000, intervalMs: 2500 },
  },
}

const TIER_SCALE: Record<ArchetypeTier, { health: number; speed: number; size: number; fireRate: number; range: number }> = {
  Weak: { health: 0.6, speed: 0.85, size: 0.85, fireRate: 1.25, range: 0.85 },
  Strong: { health: 1.7, speed: 1.15, size: 1.15, fireRate: 0.8, range: 1.2 },
}

function buildArchetype(category: ArchetypeCategory, tier: ArchetypeTier): EnemyArchetype {
  const base = BASE_STATS[category]
  const scale = TIER_SCALE[tier]
  return {
    id: `${category}${tier}`,
    maxHealth: Math.max(1, Math.round(base.maxHealth * scale.health)),
    speed: Math.round(base.speed * scale.speed),
    size: Math.round(base.size * scale.size),
    color: base.color,
    movement: base.movement,
    splitsOnDeath: base.splitsOnDeath ? `${base.splitsOnDeath}${tier}` : undefined,
    splitCount: base.splitCount,
    ranged: base.ranged
      ? {
          fireRateMs: Math.round(base.ranged.fireRateMs * scale.fireRate),
          range: Math.round(base.ranged.range * scale.range),
          shotCount: base.ranged.shotCount,
          spreadRadians: base.ranged.spreadRadians,
        }
      : undefined,
    charge: base.charge
      ? {
          triggerRange: base.charge.triggerRange,
          telegraphMs: Math.round(base.charge.telegraphMs * scale.fireRate),
          dashSpeed: Math.round(base.charge.dashSpeed * scale.speed),
          dashDurationMs: base.charge.dashDurationMs,
          cooldownMs: base.charge.cooldownMs,
        }
      : undefined,
    summons: base.summons
      ? { archetypes: base.summons.archetypes, intervalMs: Math.round(base.summons.intervalMs * scale.fireRate) }
      : undefined,
    enrage: base.enrage,
    hazard: base.hazard
      ? {
          radius: Math.round(base.hazard.radius * scale.size),
          durationMs: base.hazard.durationMs,
          intervalMs: Math.round(base.hazard.intervalMs * scale.fireRate),
        }
      : undefined,
  }
}

export const ARCHETYPES: Record<ArchetypeId, EnemyArchetype> = {
  swarmerWeak: buildArchetype('swarmer', 'Weak'),
  // Strong Swarmer's one escalation: it goes out with a bang, hitting
  // anyone standing too close when it dies.
  swarmerStrong: { ...buildArchetype('swarmer', 'Strong'), explodesOnDeath: true, explosionRadius: 60 },
  tankWeak: buildArchetype('tank', 'Weak'),
  tankStrong: buildArchetype('tank', 'Strong'),
  chaserWeak: buildArchetype('chaser', 'Weak'),
  chaserStrong: buildArchetype('chaser', 'Strong'),
  rangedShooterWeak: buildArchetype('rangedShooter', 'Weak'),
  rangedShooterStrong: buildArchetype('rangedShooter', 'Strong'),
  splitterWeak: buildArchetype('splitter', 'Weak'),
  // Strong Splitter's one escalation: its children are 2 Weak Chasers
  // instead of 2 Strong Swarmers — fast-and-real rather than squishy
  // fodder, without stacking two full Strong Chasers from one kill.
  splitterStrong: { ...buildArchetype('splitter', 'Strong'), splitsOnDeath: 'chaserWeak', splitCount: 2 },
  movingShooterWeak: buildArchetype('movingShooter', 'Weak'),
  movingShooterStrong: buildArchetype('movingShooter', 'Strong'),
  erraticWeak: buildArchetype('erratic', 'Weak'),
  erraticStrong: buildArchetype('erratic', 'Strong'),
  chargerWeak: buildArchetype('charger', 'Weak'),
  chargerStrong: buildArchetype('charger', 'Strong'),
  summonerWeak: buildArchetype('summoner', 'Weak'),
  // Strong Summoner's one escalation: it summons from a mixed pool (Weak
  // Swarmer *and* Weak Moving Shooter, picked at random each time — see
  // Enemy.trySummonAt) instead of just Weak Swarmers — real ranged
  // pressure mixed into the filler, same "Strong gets a nastier
  // summon/split," not just bigger numbers, idea Strong Splitter already
  // established.
  summonerStrong: {
    ...buildArchetype('summoner', 'Strong'),
    summons: { archetypes: ['swarmerWeak', 'movingShooterWeak'], intervalMs: buildArchetype('summoner', 'Strong').summons!.intervalMs },
  },
  spreadShooterWeak: buildArchetype('spreadShooter', 'Weak'),
  spreadShooterStrong: buildArchetype('spreadShooter', 'Strong'),
  berserkerWeak: buildArchetype('berserker', 'Weak'),
  berserkerStrong: buildArchetype('berserker', 'Strong'),
  slimeWeak: buildArchetype('slime', 'Weak'),
  slimeStrong: buildArchetype('slime', 'Strong'),
  // Boss-room placeholder — a plain melee chaser, just much bigger and
  // tougher than anything else, so a room clearly reads as "the big one."
  // No ranged/split, single tier, no per-level scaling yet — a real boss
  // (phases, attacks) is explicitly deferred; this only exists to give
  // "clear the boss room" something real to fight until then.
  boss: {
    id: 'boss',
    maxHealth: 30,
    speed: 70,
    size: 64,
    color: 0xdd2222,
    movement: 'chase',
  },
}
