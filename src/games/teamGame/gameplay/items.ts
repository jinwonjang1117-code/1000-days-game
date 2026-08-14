// Pure item data — no Phaser dependency, mirrors enemyArchetypes.ts's
// separation of data from the entity class (entities/ItemPickup.ts) that
// consumes it. Room-clear rewards only, per DESIGN.md §7 — role items and
// holdables stay deferred until the role system exists (role items only
// make sense once there are roles to grant, and several holdables
// reference role-specific status effects that don't exist yet either).
//
// Ids are named after the stat they touch, not a flavor name — a flavor
// name (the old 'swiftBoots'/'rapidFire'/'extendedGrace') reads fine in
// isolation but doesn't disambiguate from a neighboring item with a
// near-synonym name (e.g. "rapid fire" vs "quick shot" — which one was
// fire rate and which was projectile speed?). `label` is where the
// flavor/effect text actually shown to the player lives, and states the
// mechanical effect directly (e.g. "이동속도 상승") rather than a name,
// since the mystery-pickup reveal is the player's only source of truth
// for what they just got. Labels are deliberately non-numeric — the exact
// magnitude is an internal tuning value, not something the reveal promises.

export type BoostItemId = 'speed' | 'fireRate' | 'damage' | 'projectileSpeed' | 'range' | 'size' | 'invincibility' | 'fart'
export type StrongItemId = 'multiShot' | 'pierce' | 'homing' | 'multiDirection'
export type ItemId = BoostItemId | StrongItemId | 'heart'

export interface PlayerStats {
  moveSpeedMultiplier: number
  /** Multiplies DEFAULT_FIRE_RATE_MS — below 1 fires faster. */
  potatoFireRateMultiplier: number
  potatoDamage: number
  potatoSpeedMultiplier: number
  potatoRangeMultiplier: number
  potatoSizeMultiplier: number
  invincibilityBonusMs: number
  /** Strong items are stored as counts so they can stack. */
  hasMultiShot: number
  hasPiercing: number
  hasHoming: number
  hasMultiDirection: number
}

export function createDefaultStats(): PlayerStats {
  return {
    moveSpeedMultiplier: 1,
    potatoFireRateMultiplier: 1,
    potatoDamage: 1,
    potatoSpeedMultiplier: 1,
    potatoRangeMultiplier: 1,
    potatoSizeMultiplier: 1,
    invincibilityBonusMs: 0,
    hasMultiShot: 0,
    hasPiercing: 0,
    hasHoming: 0,
    hasMultiDirection: 0,
  }
}

export interface ItemDefinition {
  id: BoostItemId | StrongItemId
  /** The mechanical effect, shown to the player on pickup (see DevTestScene's showPickupText) — not a flavor name. */
  label: string
  color: number
  /** Relative spawn weight when chosen from a pool. Higher => more likely. Defaults to 1. */
  weight?: number
  /** Returns a new PlayerStats — same immutable-update style as gameplay/lives.ts. */
  apply: (stats: PlayerStats) => PlayerStats
}

export const BOOST_ITEMS: Record<BoostItemId, ItemDefinition> = {
  speed: {
    id: 'speed',
    label: '이동속도 상승',
    color: 0x66ddff,
    weight: 1,
    apply: (stats) => ({ ...stats, moveSpeedMultiplier: stats.moveSpeedMultiplier * 1.15 }),
  },
  fireRate: {
    id: 'fireRate',
    label: '공격속도 상승',
    color: 0xffcc44,
    weight: 1,
    apply: (stats) => ({ ...stats, potatoFireRateMultiplier: stats.potatoFireRateMultiplier * 0.85 }),
  },
  damage: {
    id: 'damage',
    label: '공격력 상승',
    color: 0xff6666,
    weight: 0.25,
    apply: (stats) => ({ ...stats, potatoDamage: stats.potatoDamage + 1 }),
  },
  projectileSpeed: {
    id: 'projectileSpeed',
    label: '감자 속도 상승',
    color: 0xffee88,
    weight: 1,
    apply: (stats) => ({ ...stats, potatoSpeedMultiplier: stats.potatoSpeedMultiplier * 1.15 }),
  },
  range: {
    id: 'range',
    label: '사거리 상승',
    color: 0x88ff99,
    weight: 1,
    apply: (stats) => ({ ...stats, potatoRangeMultiplier: stats.potatoRangeMultiplier * 1.2 }),
  },
  size: {
    id: 'size',
    label: '감자 크기 상승',
    color: 0xcc99ff,
    weight: 0.75,
    apply: (stats) => ({ ...stats, potatoSizeMultiplier: stats.potatoSizeMultiplier * 1.3 }),
  },
  invincibility: {
    id: 'invincibility',
    label: '무적시간 상승',
    color: 0xffffff,
    weight: 0.5,
    apply: (stats) => ({ ...stats, invincibilityBonusMs: stats.invincibilityBonusMs + 300 }),
  },
  // No-op joke item — the whole point is you don't find out until you've
  // already grabbed it (see the mystery-pickup visual in ItemPickup.ts).
  // Label says so directly once revealed — the reveal *is* the punchline.
  fart: {
    id: 'fart',
    label: '뿌우웅..',
    color: 0x99aa77,
    weight: 1,
    apply: (stats) => stats,
  },
}

export const STRONG_ITEMS: Record<StrongItemId, ItemDefinition> = {
  multiShot: {
    id: 'multiShot',
    label: '멀티샷 (감자 추가 발사)',
    color: 0xff9933,
    apply: (stats) => ({ ...stats, hasMultiShot: stats.hasMultiShot + 1 }),
  },
  pierce: {
    id: 'pierce',
    label: '관통샷 (감자가 적을 관통)',
    color: 0x33ffcc,
    apply: (stats) => ({ ...stats, hasPiercing: stats.hasPiercing + 1 }),
  },
  homing: {
    id: 'homing',
    label: '유도샷 (발사체가 적을 추적)',
    color: 0xff66aa,
    apply: (stats) => ({ ...stats, hasHoming: stats.hasHoming + 1 }),
  },
  multiDirection: {
    id: 'multiDirection',
    label: '다방향 발사 (여러 방향으로 발사)',
    color: 0x66ff88,
    apply: (stats) => ({ ...stats, hasMultiDirection: stats.hasMultiDirection + 1 }),
  },
}

export const BOOST_ITEM_IDS = Object.keys(BOOST_ITEMS) as BoostItemId[]
export const STRONG_ITEM_IDS = Object.keys(STRONG_ITEMS) as StrongItemId[]

function weightedRandomFromRecord<T extends string>(record: Record<T, { weight?: number }>): T {
  const entries = Object.entries(record) as [T, { weight?: number }][]
  const total = entries.reduce((sum, [, v]) => sum + (v.weight ?? 1), 0)
  let r = Math.random() * total
  for (const [k, v] of entries) {
    const w = v.weight ?? 1
    if (r < w) return k
    r -= w
  }
  return entries[0][0]
}

export function randomBoostItemId(): BoostItemId {
  return weightedRandomFromRecord(BOOST_ITEMS)
}

export function randomStrongItemId(): StrongItemId {
  return weightedRandomFromRecord(STRONG_ITEMS)
}

/** Combined lookup for wherever a stat-mutating item (anything but 'heart') is applied — see entities/Player.ts's applyItem. */
export const STAT_ITEMS: Record<BoostItemId | StrongItemId, ItemDefinition> = { ...BOOST_ITEMS, ...STRONG_ITEMS }

/** Boss-tier only — regular-tier pickups always render as the shared mystery look, never their real color. */
export function getItemColor(id: StrongItemId): number {
  return STRONG_ITEMS[id].color
}

/** For the pickup-reveal text (shown on consumption, regardless of tier — see DevTestScene's showPickupText). */
export function getItemLabel(id: ItemId): string {
  if (id === 'heart') {
    return '하트 (생명 회복)'
  }
  return STAT_ITEMS[id].label
}

export function isKnownItemId(id: string): id is ItemId {
  return id === 'heart' || id in BOOST_ITEMS || id in STRONG_ITEMS
}
