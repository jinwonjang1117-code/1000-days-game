import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'

const MAX_HP = 5
const DRIFT_SPEED = 40
const DASH_SPEED_MULTIPLIER = 3
const DASH_MIN_INTERVAL_MS = 6000
const DASH_MAX_INTERVAL_MS = 10000
const DASH_DURATION_MS = 1600
const MINION_SPAWN_INTERVAL_MS = 5000
const PROJECTILE_ATTACK_INTERVAL_MS = 3500
const TELEGRAPH_DURATION_MS = 400
const HIT_FLASH_DURATION_MS = 150
const DASH_TINT = 0xff8844
const HIT_TINT = 0xffffff

export interface BossArenaBounds {
  minX: number
  maxX: number
}

export type GetPlayerPosition = () => { x: number; y: number }
export type SpawnMinion = (x: number, y: number) => void
export type FireBossProjectile = (x: number, y: number, direction: -1 | 1) => void
export type OnBossDefeated = () => void

export default class BossEnemy extends Phaser.Physics.Arcade.Sprite {
  canBeInhaled = false
  hp = MAX_HP

  private minX: number
  private maxX: number
  private driftDirection: -1 | 1 = 1
  private isDashing = false
  private dashTimer = 0
  private nextDashInMs: number
  private minionSpawnTimer = 0
  private projectileAttackTimer = 0
  private isDefeated = false

  private getPlayerPosition: GetPlayerPosition
  private spawnMinion: SpawnMinion
  private fireProjectile: FireBossProjectile
  private onDefeated: OnBossDefeated

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    bounds: BossArenaBounds,
    getPlayerPosition: GetPlayerPosition,
    spawnMinion: SpawnMinion,
    fireProjectile: FireBossProjectile,
    onDefeated: OnBossDefeated,
  ) {
    super(scene, x, y, TextureKeys.Boss)

    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.minX = bounds.minX
    this.maxX = bounds.maxX
    this.getPlayerPosition = getPlayerPosition
    this.spawnMinion = spawnMinion
    this.fireProjectile = fireProjectile
    this.onDefeated = onDefeated

    this.setGravityY(0)
    this.setImmovable(true)
    this.setVelocityX(this.driftDirection * DRIFT_SPEED)

    this.nextDashInMs = Phaser.Math.Between(DASH_MIN_INTERVAL_MS, DASH_MAX_INTERVAL_MS)
  }

  updateBehavior(_time: number, delta: number): void {
    if (this.isDefeated) {
      return
    }

    this.updateMovement(delta)
    this.updateMinionSpawner(delta)
    this.updateProjectileAttack(delta)
  }

  takeDamage(): void {
    if (this.isDefeated) {
      return
    }

    this.hp -= 1
    this.setTint(HIT_TINT)
    this.scene.time.delayedCall(HIT_FLASH_DURATION_MS, () => {
      if (!this.isDefeated && !this.isDashing) {
        this.clearTint()
      }
    })

    if (this.hp <= 0) {
      this.defeat()
    }
  }

  private defeat(): void {
    this.isDefeated = true

    const body = this.body as Phaser.Physics.Arcade.Body | null
    body?.setVelocity(0, 0)

    this.scene.tweens.add({
      targets: this,
      scale: 0,
      alpha: 0,
      duration: 1000,
      onComplete: () => {
        this.onDefeated()
        this.destroy()
      },
    })
  }

  private updateMovement(delta: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body | null
    if (!body) {
      return
    }

    if (this.isDashing) {
      this.dashTimer -= delta
      if (this.dashTimer <= 0) {
        this.isDashing = false
        this.clearTint()
        body.velocity.x = this.driftDirection * DRIFT_SPEED
      }
    } else {
      this.nextDashInMs -= delta
      if (this.nextDashInMs <= 0) {
        this.isDashing = true
        this.dashTimer = DASH_DURATION_MS
        this.nextDashInMs = Phaser.Math.Between(DASH_MIN_INTERVAL_MS, DASH_MAX_INTERVAL_MS)
        this.setTint(DASH_TINT)
        body.velocity.x = this.driftDirection * DRIFT_SPEED * DASH_SPEED_MULTIPLIER
      }
    }

    if (this.x <= this.minX && body.velocity.x < 0) {
      this.driftDirection = 1
      body.velocity.x = Math.abs(body.velocity.x)
    } else if (this.x >= this.maxX && body.velocity.x > 0) {
      this.driftDirection = -1
      body.velocity.x = -Math.abs(body.velocity.x)
    }
  }

  private updateMinionSpawner(delta: number): void {
    this.minionSpawnTimer += delta
    if (this.minionSpawnTimer < MINION_SPAWN_INTERVAL_MS) {
      return
    }
    this.minionSpawnTimer = 0

    this.telegraph(() => {
      const spawnX = Phaser.Math.Between(this.minX, this.maxX)
      this.spawnMinion(spawnX, this.y)
    })
  }

  private updateProjectileAttack(delta: number): void {
    this.projectileAttackTimer += delta
    if (this.projectileAttackTimer < PROJECTILE_ATTACK_INTERVAL_MS) {
      return
    }
    this.projectileAttackTimer = 0

    this.telegraph(() => {
      const playerPos = this.getPlayerPosition()
      const direction: -1 | 1 = playerPos.x < this.x ? -1 : 1
      this.fireProjectile(this.x, this.y, direction)
    })
  }

  private telegraph(onComplete: () => void): void {
    this.setTint(0xffff00)
    this.scene.time.delayedCall(TELEGRAPH_DURATION_MS, () => {
      if (this.isDefeated) {
        return
      }
      if (!this.isDashing) {
        this.clearTint()
      }
      onComplete()
    })
  }
}
