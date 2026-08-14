import Phaser from 'phaser'
import type { EnemyState, Vec2 } from '../net/syncProtocol'

const ENEMY_SIZE = 28
const ENEMY_COLOR = 0x999999
const ENEMY_HIT_FLASH_COLOR = 0xffffff
const ENEMY_HIT_FLASH_MS = 80
const ENEMY_SPEED = 160
const ENEMY_MAX_HEALTH = 3
const HEALTH_TEXT_OFFSET = 26

const HEALTH_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffcc66',
}

export interface EnemyOptions {
  simulated: boolean
}

/**
 * A bouncing placeholder enemy used to test hit detection, health/death,
 * and (now) room-clear detection, ahead of Phase F+'s real enemy
 * archetypes. Same simulated/render-only split as Player/Projectile. A
 * room can hold several at once (see DevTestScene's roomEnemies), so each
 * instance carries an id the same way Projectile already does. Death is
 * reported, not acted on — the scene decides what happens next (removing
 * it from the room's enemy list; no more auto-respawn now that room-clear
 * exists to replace it).
 */
export default class Enemy {
  readonly id: number
  readonly square: Phaser.GameObjects.Rectangle
  private readonly healthText: Phaser.GameObjects.Text
  private readonly body: Phaser.Physics.Arcade.Body | null

  // Simulated (host) only.
  private health = ENEMY_MAX_HEALTH

  // Render-only (joiner) only.
  private target: Vec2 | null = null

  constructor(scene: Phaser.Scene, id: number, x: number, y: number, options: EnemyOptions) {
    this.id = id
    this.square = scene.add.rectangle(x, y, ENEMY_SIZE, ENEMY_SIZE, ENEMY_COLOR)
    this.healthText = scene.add
      .text(x, y - HEALTH_TEXT_OFFSET, `HP ${ENEMY_MAX_HEALTH}`, HEALTH_TEXT_STYLE)
      .setOrigin(0.5)

    if (options.simulated) {
      scene.physics.add.existing(this.square)
      this.body = this.square.body as Phaser.Physics.Arcade.Body
      this.body.setCollideWorldBounds(true)
      this.body.setBounce(1, 1)
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      this.body.setVelocity(Math.cos(angle) * ENEMY_SPEED, Math.sin(angle) * ENEMY_SPEED)
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

  /** Returns true if this hit brought health to 0. */
  applyHit(damage = 1): boolean {
    this.health = Math.max(0, this.health - damage)
    this.syncHealthLabel()
    this.flashHit()
    return this.health <= 0
  }

  getNetworkState(): EnemyState {
    return { id: this.id, pos: { x: this.square.x, y: this.square.y }, health: this.health }
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
    this.square.scene.time.delayedCall(ENEMY_HIT_FLASH_MS, () => this.square.setFillStyle(ENEMY_COLOR))
  }

  private syncHealthLabel() {
    this.healthText.setPosition(this.square.x, this.square.y - HEALTH_TEXT_OFFSET)
    this.healthText.setText(`HP ${this.health}`)
  }

  destroy() {
    this.square.destroy()
    this.healthText.destroy()
  }
}
