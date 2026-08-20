import Phaser from 'phaser'
import { getRoleColor } from '../gameplay/roles'

const ZONE_ALPHA = 0.45

export type StatusZoneEffect = 'slow' | 'poison'

export interface StatusZoneOptions {
  simulated: boolean
}

/**
 * A lingering zone that periodically applies a status *stack* (not direct
 * damage) to any enemy standing in it — DESIGN.md §6's Ice+Gravity ("brief
 * slowing ice patch") and Poison+Bomb ("poison cloud") combos. Same
 * static-body/no-interpolation shape as entities/HazardZone.ts (Slime's
 * player-damaging lingering zone), just enemy-targeting and stack-applying
 * instead of player-damaging — a separate class rather than overloading
 * HazardZone with an unrelated mode, matching this project's general
 * preference for small focused entity classes (Chest/DevilPedestal/
 * GambleShrine are all separate too, despite similar shapes).
 */
export default class StatusZone {
  readonly id: number
  readonly effect: StatusZoneEffect
  readonly shape: Phaser.GameObjects.Arc

  // Simulated (host) only — per-enemy re-apply cooldown, since Arcade
  // overlap fires every frame two bodies are touching, not once; without
  // this an enemy loitering in the zone would stack up far too fast.
  private readonly lastAppliedAt: Map<number, number> = new Map()

  constructor(scene: Phaser.Scene, id: number, effect: StatusZoneEffect, x: number, y: number, radius: number, options: StatusZoneOptions) {
    this.id = id
    this.effect = effect
    const color = effect === 'slow' ? getRoleColor('glue') : getRoleColor('poison')
    this.shape = scene.add.circle(x, y, radius, color, ZONE_ALPHA)

    if (options.simulated) {
      // Static body — the zone never moves, only needs overlap detection.
      scene.physics.add.existing(this.shape, true)
    }
  }

  get x(): number {
    return this.shape.x
  }

  get y(): number {
    return this.shape.y
  }

  get radius(): number {
    return this.shape.radius
  }

  /** Whether enough time has passed since this zone last applied a stack to this specific enemy. */
  canApplyToEnemy(enemyId: number, now: number, reapplyIntervalMs: number): boolean {
    const last = this.lastAppliedAt.get(enemyId)
    return last === undefined || now - last >= reapplyIntervalMs
  }

  recordApply(enemyId: number, now: number) {
    this.lastAppliedAt.set(enemyId, now)
  }

  destroy() {
    this.shape.destroy()
  }
}
