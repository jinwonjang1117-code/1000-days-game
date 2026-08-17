// The 7 roles (DESIGN.md §5) — pure data, no Phaser dependency, mirrors
// gameplay/devilItems.ts's separation of data from the entity/scene code
// that consumes it. A role is single-equip and mutually exclusive with the
// others (see Player.equipRole) — not a stacking item like the strong pool.

export type RoleId = 'ice' | 'glue' | 'poison' | 'electric' | 'gravity' | 'laser' | 'bomb'

export interface RoleDefinition {
  id: RoleId
  /** Shown on pickup (see gameplay/items.ts's getItemLabel), same spirit as ItemDefinition.label — states the mechanical effect, not a flavor name. */
  label: string
  color: number
}

export const ROLES: Record<RoleId, RoleDefinition> = {
  ice: {
    id: 'ice',
    label: '아이스 (적중 시 확률로 빙결)',
    color: 0x66ddff,
  },
  glue: {
    id: 'glue',
    label: '글루 (적중 시 중첩 둔화)',
    color: 0x88cc44,
  },
  poison: {
    id: 'poison',
    label: '포이즌 (적중 시 지속 피해)',
    color: 0x66cc66,
  },
  electric: {
    id: 'electric',
    label: '일렉트릭 (적중 시 확률로 주변 적에게 연쇄 피해)',
    color: 0xffee44,
  },
  gravity: {
    id: 'gravity',
    label: '그래비티 (비행 중 주변 적을 끌어당김)',
    color: 0x9966ff,
  },
  // Not buildable yet (see NOT_YET_BUILDABLE_ROLES) — replaces the attack
  // shape entirely (hold-to-channel beam) rather than decorating the
  // existing default projectile, a separate follow-up stage's worth of
  // input-model work. Data entry exists now so the roster/labels are
  // settled ahead of time, same as every other DESIGN.md table.
  laser: {
    id: 'laser',
    label: '레이저 (공격이 지속 광선으로 변함)',
    color: 0xff66ff,
  },
  bomb: {
    id: 'bomb',
    label: '봄 (적중 시 폭발, 광역 피해, 아군도 피해 받음)',
    color: 0xff4444,
  },
}

export const ROLE_IDS = Object.keys(ROLES) as RoleId[]

/** Excluded from every acquisition pool (golden/boss/Angel) until its own follow-up stage builds the attack-shape replacement it needs — see DESIGN.md/CLAUDE.md's Role System roadmap entry. Bomb no longer needs this (see BOMB_BLAST_RADIUS's note) — it turned out to reuse the same Space-fire input as every other role once its design simplified away from hold-to-charge. */
export const NOT_YET_BUILDABLE_ROLES: ReadonlySet<RoleId> = new Set(['laser'])

/** The 6 roles this stage actually implements (all but Laser). */
export const BUILDABLE_ROLE_IDS = ROLE_IDS.filter((id) => !NOT_YET_BUILDABLE_ROLES.has(id))

export function isRoleId(id: string): id is RoleId {
  return id in ROLES
}

export function getRoleLabel(id: RoleId): string {
  return ROLES[id].label
}

export function getRoleColor(id: RoleId): number {
  return ROLES[id].color
}

// ---- Tuning (first-pass, tune freely once there's been actual playtesting — same spirit as every other archetype/item table in this project) ----

/** Ice: on freeze, velocity is forced to 0 — a full stop, not a slow (that's Glue's job) — see Enemy.updateMovement. */
export const ICE_FREEZE_CHANCE = 0.3
export const ICE_FREEZE_DURATION_MS = 1000

/** Glue: each hit adds one independently-expiring stack (not a flat refresh) up to the cap. Reliable, always does *something*, per DESIGN.md. */
export const GLUE_SLOW_PER_STACK = 0.12
export const GLUE_MAX_STACKS = 5
export const GLUE_STACK_DURATION_MS = 3000

/** Poison: damage per tick scales with current stack count (2 stacks = 2 dmg/tick), same independently-expiring-stack shape as Glue. */
export const POISON_DAMAGE_PER_TICK = 1
export const POISON_TICK_INTERVAL_MS = 500
export const POISON_STACK_DURATION_MS = 3000
export const POISON_MAX_STACKS = 5

/**
 * Electric: chain deals the same damage as the original hit to the nearest
 * *other* living enemy in range — see GameSimulation.applyElectricChain.
 * One ELECTRIC_CHAIN_CHANCE roll per hit (not per hop) — on success, the
 * chain is guaranteed to reach up to ELECTRIC_CHAIN_MAX_HOPS additional
 * enemies (fewer only if it runs out of enemies in range). This value (2)
 * used to be exclusively the signature holdable's (Overcharge Coil,
 * DESIGN.md §7 — "2 additional instead of 1") — now the base role's own
 * number, per an explicit call to move it there ahead of holdables
 * actually being built. Revisit Overcharge Coil's own text once that
 * stage starts, since "2 instead of 1" no longer describes an upgrade.
 */
export const ELECTRIC_CHAIN_CHANCE = 0.3
export const ELECTRIC_CHAIN_RADIUS = 140
export const ELECTRIC_CHAIN_MAX_HOPS = 2

/** Gravity: an additive per-frame velocity nudge toward the in-flight projectile, on top of whatever the enemy's own movement already set that frame — no on-hit bonus of its own (DESIGN.md: "no direct damage identity on its own by design"). */
export const GRAVITY_PULL_RADIUS = 120
export const GRAVITY_PULL_STRENGTH = 60

/**
 * Bomb: explodes the instant its shot touches an enemy — no charge, no
 * fuse, same Space-fire input as every other role (design simplified away
 * from DESIGN.md's original hold-to-charge/timed-fuse concept before this
 * was built). The blast hits every enemy *and* every player (including the
 * shooter — no self-exemption, "highest risk role" per DESIGN.md) within
 * this radius — see GameSimulation.applyBombExplosion. A shot that never
 * touches an enemy (hits a rock, or reaches max range) just fizzles like
 * any other shot, no explosion.
 */
export const BOMB_BLAST_RADIUS = 100
