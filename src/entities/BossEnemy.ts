import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'
import { WORLD_GRAVITY_Y } from '../config/physics'

const MAX_HP = 1
const BOSS_WIDTH = 100
const BOSS_HEIGHT = 200
const PATROL_SPEED = 50
const DASH_SPEED_MULTIPLIER = 3
const DASH_MIN_INTERVAL_MS = 6000
const DASH_MAX_INTERVAL_MS = 10000
const DASH_DURATION_MS = 1600
const MINION_SPAWN_INTERVAL_MS = 3000
const PROJECTILE_ATTACK_INTERVAL_MS = 2500
const RAIN_ATTACK_MIN_INTERVAL_MS = 8000
const RAIN_ATTACK_MAX_INTERVAL_MS = 12000
const TELEGRAPH_DURATION_MS = 400
const RAIN_TELEGRAPH_DURATION_MS = 700
const HIT_FLASH_DURATION_MS = 200
const DASH_TINT = 0xff8844
const HIT_TINT = 0xff2222
const ATTACK_TELEGRAPH_TINT = 0xffff00
const RAIN_TELEGRAPH_TINT = 0xff3333
const HP_BAR_WIDTH = 90
const HP_BAR_HEIGHT = 10
const HP_BAR_OFFSET_Y = 24
const HP_BAR_BACKGROUND_COLOR = 0x330000
const HP_BAR_FILL_COLOR = 0xff3333

export interface BossArenaBounds {
  minX: number
  maxX: number
}

export type GetPlayerPosition = () => { x: number; y: number }
export type SpawnMinion = () => void
export type FireBossProjectile = (x: number, y: number, direction: -1 | 1) => void
export type StartRainAttack = () => void
export type OnBossDefeated = () => void
export type OnBossDefeatStarted = () => void

export default class BossEnemy extends Phaser.Physics.Arcade.Sprite {
  canBeInhaled = false
  hp = MAX_HP

  private minX: number
  private maxX: number
  private patrolDirection: -1 | 1 = 1
  private isDashing = false
  private dashTimer = 0
  private nextDashInMs: number
  private minionSpawnTimer = 0
  private projectileAttackTimer = 0
  private rainAttackTimer = 0
  private nextRainAttackInMs: number
  private isDefeated = false

  private getPlayerPosition: GetPlayerPosition
  private spawnMinion: SpawnMinion
  private fireProjectile: FireBossProjectile
  private startRainAttack: StartRainAttack
  private onDefeatStarted: OnBossDefeatStarted
  private onDefeated: OnBossDefeated

  private hpBarBackground: Phaser.GameObjects.Rectangle
  private hpBarFill: Phaser.GameObjects.Rectangle

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    bounds: BossArenaBounds,
    getPlayerPosition: GetPlayerPosition,
    spawnMinion: SpawnMinion,
    fireProjectile: FireBossProjectile,
    startRainAttack: StartRainAttack,
    onDefeatStarted: OnBossDefeatStarted,
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
    this.startRainAttack = startRainAttack
    this.onDefeatStarted = onDefeatStarted
    this.onDefeated = onDefeated

    this.setDisplaySize(BOSS_WIDTH, BOSS_HEIGHT)
    this.setGravityY(WORLD_GRAVITY_Y)
    this.setCollideWorldBounds(true)
    this.setVelocityX(this.patrolDirection * PATROL_SPEED)

    this.nextDashInMs = Phaser.Math.Between(DASH_MIN_INTERVAL_MS, DASH_MAX_INTERVAL_MS)
    this.nextRainAttackInMs = Phaser.Math.Between(RAIN_ATTACK_MIN_INTERVAL_MS, RAIN_ATTACK_MAX_INTERVAL_MS)

    const barY = y - BOSS_HEIGHT / 2 - HP_BAR_OFFSET_Y
    this.hpBarBackground = scene.add.rectangle(x, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT, HP_BAR_BACKGROUND_COLOR, 0.8)
    this.hpBarFill = scene.add
      .rectangle(x - HP_BAR_WIDTH / 2, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT, HP_BAR_FILL_COLOR, 1)
      .setOrigin(0, 0.5)
  }

  updateBehavior(_time: number, delta: number): void {
    this.updateHealthBar()

    if (this.isDefeated) {
      return
    }

    this.updatePatrol(delta)
    this.updateMinionSpawner(delta)
    this.updateProjectileAttack(delta)
    this.updateRainAttack(delta)
  }

  private updateHealthBar(): void {
    const barY = this.y - this.displayHeight / 2 - HP_BAR_OFFSET_Y
    this.hpBarBackground.setPosition(this.x, barY)
    this.hpBarFill.setPosition(this.x - HP_BAR_WIDTH / 2, barY)
    this.hpBarFill.displayWidth = HP_BAR_WIDTH * Math.max(0, this.hp / MAX_HP)
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
    this.onDefeatStarted()

    this.hpBarBackground.destroy()
    this.hpBarFill.destroy()

    const body = this.body as Phaser.Physics.Arcade.Body | null
    body?.setVelocity(0, 0)
    body?.setAllowGravity(false)

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

  private updatePatrol(delta: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body | null
    if (!body) {
      return
    }

    if (this.isDashing) {
      this.dashTimer -= delta
      if (this.dashTimer <= 0) {
        this.isDashing = false
        this.clearTint()
        body.velocity.x = this.patrolDirection * PATROL_SPEED
      }
    } else {
      this.nextDashInMs -= delta
      if (this.nextDashInMs <= 0) {
        this.isDashing = true
        this.dashTimer = DASH_DURATION_MS
        this.nextDashInMs = Phaser.Math.Between(DASH_MIN_INTERVAL_MS, DASH_MAX_INTERVAL_MS)
        this.setTint(DASH_TINT)
        body.velocity.x = this.patrolDirection * PATROL_SPEED * DASH_SPEED_MULTIPLIER
      }
    }

    if (this.x <= this.minX && body.velocity.x < 0) {
      this.patrolDirection = 1
      body.velocity.x = Math.abs(body.velocity.x)
    } else if (this.x >= this.maxX && body.velocity.x > 0) {
      this.patrolDirection = -1
      body.velocity.x = -Math.abs(body.velocity.x)
    }

    this.setFlipX(body.velocity.x < 0)
  }

  private updateMinionSpawner(delta: number): void {
    this.minionSpawnTimer += delta
    if (this.minionSpawnTimer < MINION_SPAWN_INTERVAL_MS) {
      return
    }
    this.minionSpawnTimer = 0

    this.telegraph(() => {
      this.spawnMinion()
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

  private updateRainAttack(delta: number): void {
    this.rainAttackTimer += delta
    if (this.rainAttackTimer < this.nextRainAttackInMs) {
      return
    }
    this.rainAttackTimer = 0
    this.nextRainAttackInMs = Phaser.Math.Between(RAIN_ATTACK_MIN_INTERVAL_MS, RAIN_ATTACK_MAX_INTERVAL_MS)

    this.telegraph(() => {
      this.startRainAttack()
    }, RAIN_TELEGRAPH_TINT, RAIN_TELEGRAPH_DURATION_MS)
  }

  private telegraph(onComplete: () => void, tint: number = ATTACK_TELEGRAPH_TINT, duration: number = TELEGRAPH_DURATION_MS): void {
    this.setTint(tint)
    this.scene.time.delayedCall(duration, () => {
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
