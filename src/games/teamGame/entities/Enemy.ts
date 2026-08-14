import Phaser from 'phaser'
import type { EnemyState, Vec2 } from '../net/syncProtocol'
import type { EnemyArchetype } from '../gameplay/enemyArchetypes'
import type { AttackState } from '../gameplay/attack'
import { createAttackState, canFire, recordFire } from '../gameplay/attack'

const ENEMY_HIT_FLASH_COLOR = 0xffffff
const ENEMY_HIT_FLASH_MS = 80
const HEALTH_TEXT_OFFSET_BASE = 18

const HEALTH_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffcc66',
}

export interface EnemyOptions {
  simulated: boolean
}

/**
 * A real enemy archetype (DESIGN.md §9) — health/death, hit-flash, and
 * networking are all archetype-agnostic and unchanged from the original
 * placeholder; `archetype` only drives visuals/stats and movement/attack
 * behavior. Same simulated/render-only split as Player/Projectile. A room
 * can hold several at once, so each instance carries an id the same way
 * Projectile already does. Death is reported, not acted on — the scene
 * decides what happens next (removing it from the room's list, and, for
 * Splitter, spawning its children).
 */
export default class Enemy {
  readonly id: number
  readonly archetype: EnemyArchetype
  readonly square: Phaser.GameObjects.Rectangle
  private readonly healthText: Phaser.GameObjects.Text
  private readonly body: Phaser.Physics.Arcade.Body | null
  private readonly healthTextOffset: number

  // Simulated (host) only.
  private health: number
  private attackState: AttackState = createAttackState()

  // Render-only (joiner) only.
  private target: Vec2 | null = null

  constructor(scene: Phaser.Scene, id: number, archetype: EnemyArchetype, x: number, y: number, options: EnemyOptions) {
    this.id = id
    this.archetype = archetype
    this.health = archetype.maxHealth
    this.healthTextOffset = archetype.size / 2 + HEALTH_TEXT_OFFSET_BASE

    this.square = scene.add.rectangle(x, y, archetype.size, archetype.size, archetype.color)
    this.healthText = scene.add
      .text(x, y - this.healthTextOffset, `HP ${archetype.maxHealth}`, HEALTH_TEXT_STYLE)
      .setOrigin(0.5)

    if (options.simulated) {
      scene.physics.add.existing(this.square)
      this.body = this.square.body as Phaser.Physics.Arcade.Body
      this.body.setCollideWorldBounds(true)

      if (archetype.movement === 'bounce') {
        this.body.setBounce(1, 1)
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
        this.body.setVelocity(Math.cos(angle) * archetype.speed, Math.sin(angle) * archetype.speed)
      }
      // 'chase'/'keepDistance' start stationary — updateMovement sets their
      // velocity every frame once a target exists.
    } else {
      this.body = null
    }
  }

  get x(): number {
    return this.square.x
  }

  get y(): number {
    return this.square.y
  }

  // ---- Simulated (host) ----

  /**
   * Call every frame. No-ops for 'bounce' (Arcade physics owns its motion
   * once launched) and while there's no valid target to chase/flee from.
   */
  updateMovement(nearestPlayerPos: Vec2 | null) {
    if (!this.body || this.archetype.movement === 'bounce' || !nearestPlayerPos) {
      return
    }

    if (this.archetype.movement === 'chase') {
      const angle = Math.atan2(nearestPlayerPos.y - this.y, nearestPlayerPos.x - this.x)
      this.body.setVelocity(Math.cos(angle) * this.archetype.speed, Math.sin(angle) * this.archetype.speed)
      return
    }

    // 'keepDistance': back away once a player gets within half the firing
    // range, otherwise hold position.
    const retreatDistance = (this.archetype.ranged?.range ?? 200) / 2
    const distance = Phaser.Math.Distance.Between(this.x, this.y, nearestPlayerPos.x, nearestPlayerPos.y)
    if (distance < retreatDistance) {
      const angle = Math.atan2(this.y - nearestPlayerPos.y, this.x - nearestPlayerPos.x)
      this.body.setVelocity(Math.cos(angle) * this.archetype.speed, Math.sin(angle) * this.archetype.speed)
    } else {
      this.body.setVelocity(0, 0)
    }
  }

  /** Ranged archetypes only. Returns a fire angle if in range and off cooldown, else null. */
  tryFireAt(nearestPlayerPos: Vec2 | null, now: number): number | null {
    if (!this.body || !this.archetype.ranged || !nearestPlayerPos) {
      return null
    }
    const distance = Phaser.Math.Distance.Between(this.x, this.y, nearestPlayerPos.x, nearestPlayerPos.y)
    if (distance > this.archetype.ranged.range) {
      return null
    }
    if (!canFire(this.attackState, now, this.archetype.ranged.fireRateMs)) {
      return null
    }
    this.attackState = recordFire(this.attackState, now)
    return Math.atan2(nearestPlayerPos.y - this.y, nearestPlayerPos.x - this.x)
  }

  /** Returns true if this hit brought health to 0. */
  applyHit(damage = 1): boolean {
    this.health = Math.max(0, this.health - damage)
    this.syncHealthLabel()
    this.flashHit()
    return this.health <= 0
  }

  getNetworkState(): EnemyState {
    return { id: this.id, archetype: this.archetype.id, pos: { x: this.square.x, y: this.square.y }, health: this.health }
  }

  /** Call every frame — keeps the label glued to the moving square. */
  refreshVisuals() {
    this.syncHealthLabel()
  }

  // ---- Render-only (joiner) ----

  applyReceivedState(state: EnemyState) {
    if (!this.target) {
      this.square.setPosition(state.pos.x, state.pos.y)
    }
    this.target = state.pos
    this.health = state.health
    this.syncHealthLabel()
  }

  /** Call every frame with a frame-rate-independent lerp factor. */
  interpolate(t: number) {
    if (!this.target) {
      return
    }
    this.square.x = Phaser.Math.Linear(this.square.x, this.target.x, t)
    this.square.y = Phaser.Math.Linear(this.square.y, this.target.y, t)
    this.syncHealthLabel()
  }

  // ---- Shared ----

  private flashHit() {
    this.square.setFillStyle(ENEMY_HIT_FLASH_COLOR)
    this.square.scene.time.delayedCall(ENEMY_HIT_FLASH_MS, () => this.square.setFillStyle(this.archetype.color))
  }

  private syncHealthLabel() {
    this.healthText.setPosition(this.square.x, this.square.y - this.healthTextOffset)
    this.healthText.setText(`HP ${this.health}`)
  }

  destroy() {
    this.square.destroy()
    this.healthText.destroy()
  }
}
