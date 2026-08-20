// Devil's Room's exclusive item pool (DESIGN.md §9) — pure data, no Phaser
// dependency, mirrors gameplay/items.ts's separation of data from the
// entity/scene code that consumes it. Deliberately its own small type, not
// folded into items.ts's ItemId — these never appear anywhere but Devil's
// Room, unlike every other item in the game.

export type DevilItemId = 'sharedConsumption' | 'bloodPact' | 'turretPact'

export interface DevilItemDefinition {
  id: DevilItemId
  label: string
  color: number
  /** Only offered when a teammate exists (co-op) — its whole effect is built around a second player to receive the union with. */
  requiresTeammate?: boolean
}

export const DEVIL_ITEMS: Record<DevilItemId, DevilItemDefinition> = {
  sharedConsumption: {
    id: 'sharedConsumption',
    label: '공유 소비 (서로의 강력한 아이템을 나눠 가짐, 둘 다 최대 생명력 1로 감소)',
    color: 0x882299,
    requiresTeammate: true,
  },
  bloodPact: {
    id: 'bloodPact',
    label: '피의 계약 (공격력 +50%, 팀원 최대 생명력 -1)',
    color: 0xcc2222,
  },
  turretPact: {
    id: 'turretPact',
    label: '포탑 계약 (오빗 실드 획득, 모든 오빗 실드가 포탑으로 변함, 팀원 최대 생명력 -1)',
    color: 0xff8800,
  },
}

export const DEVIL_ITEM_IDS = Object.keys(DEVIL_ITEMS) as DevilItemId[]

/** Solo has no teammate to pay/share with — sharedConsumption is excluded entirely, and bloodPact/turretPact's "teammate" cost falls back to the picking player themself (see GameSimulation's devilCostTarget). */
export function availableDevilItemIds(hasTeammate: boolean): DevilItemId[] {
  return hasTeammate ? DEVIL_ITEM_IDS : DEVIL_ITEM_IDS.filter((id) => !DEVIL_ITEMS[id].requiresTeammate)
}
