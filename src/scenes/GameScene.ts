import Phaser from 'phaser'
import Player, { PLAYER_HEIGHT } from '../entities/Player'
import Projectile from '../entities/Projectile'
import Enemy from '../entities/Enemy'
import NormalEnemy from '../entities/NormalEnemy'
import FastEnemy from '../entities/FastEnemy'
import GhostEnemy from '../entities/GhostEnemy'
import FlyerEnemy from '../entities/FlyerEnemy'
import EnemyProjectile from '../entities/EnemyProjectile'
import BossEnemy from '../entities/BossEnemy'
import RainProjectile from '../entities/RainProjectile'
import { TextureKeys, stageBackgroundKey } from '../config/textureKeys'
import type { PlatformConfig } from '../config/platformLayout'
import { PLATFORM_HEIGHT, GROUND_HEIGHT, findLandingPlatform } from '../config/platformLayout'
import type { EnemySpawnConfig } from '../config/stages'
import { stages } from '../config/stages'
import { getStageIntroDurationMs } from '../config/timing'
import { AudioKeys } from '../config/audioKeys'
import { playBgm, playSfx, stopBgm, START_BGM_VOLUME } from '../config/audio'

const DAMAGE_INVINCIBILITY_MS = 1000
const PATROL_EDGE_INSET = 40
const CAPTURE_CHASE_SPEED = 700
const STAGE_TRANSITION_DELAY_MS = 1500
const GROUND_ENEMY_SPAWN_Y = 490
const ELEVATED_ENEMY_SPAWN_OFFSET = 80
const BOSS_HALF_WIDTH = 50
const BOSS_ARENA_MARGIN = 10
const RAIN_PROJECTILE_COUNT = 14
const RAIN_PROJECTILE_SPAWN_INTERVAL_MS = 300
const RAIN_PROJECTILE_SPAWN_Y = -20
const MINION_SAFE_DISTANCE_FROM_PLAYER = 100
const MINION_SPAWN_PICK_ATTEMPTS = 5
const GROUND_LEVEL_THRESHOLD_Y = 500
const GROUND_LEVEL_FIRE_Y = 500
const TIER1_LEVEL_FIRE_Y = 380
const SPEED_BOOST_PER_PICKUP = 20
const PICKUP_SIZE = 50
const DIAMOND_PICKUP_SIZE = 70
const BOSS_DEFEAT_DIAMOND_DELAY_MS = 600

interface GameSceneData {
  stageIndex?: number
  score?: number
  playerHealth?: number
  speedBonus?: number
  pickupCount?: number
}

export default class GameScene extends Phaser.Scene {
  public score = 0
  public playerHealth = 3
  public pickupCount = 0
  private speedBonus = 0
  private stageIndex = 0
  private stagePlatforms: PlatformConfig[] = []
  private stageCleared = false
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private player!: Player
  private projectile?: Projectile
  private pickups!: Phaser.Physics.Arcade.Group
  private platforms!: Phaser.Physics.Arcade.StaticGroup
  private enemyGroup!: Phaser.GameObjects.Group
  private enemyProjectileGroup!: Phaser.GameObjects.Group
  private rainProjectileGroup!: Phaser.GameObjects.Group
  private capturingEnemy: Enemy | null = null
  private isPlayerInvincible = false
  private isGameOver = false
  private isGameWon = false
  private restartKey!: Phaser.Input.Keyboard.Key
  private isBossLevel = false
  private boss?: BossEnemy
  private heldEnemyIsBossMinion = false
  private isStageIntroActive = false

  constructor() {
    super({ key: 'GameScene' })
  }

  public get stageNumber(): number {
    return this.stageIndex + 1
  }

  public get stageCount(): number {
    return stages.length
  }

  public get stageName(): string {
    return stages[this.stageIndex].name
  }

  create(data: GameSceneData) {
    this.stageIndex = data?.stageIndex ?? 0
    this.score = data?.score ?? 100
    this.playerHealth = data?.playerHealth ?? 3
    this.speedBonus = data?.speedBonus ?? 0
    this.pickupCount = data?.pickupCount ?? 0
    this.capturingEnemy = null
    this.isPlayerInvincible = false
    this.isGameOver = false
    this.isGameWon = false
    this.stageCleared = false
    this.projectile = undefined
    this.boss = undefined
    this.heldEnemyIsBossMinion = false

    const stage = stages[this.stageIndex]
    this.stagePlatforms = stage.platforms
    this.isBossLevel = stage.isBossLevel ?? false

    playBgm(this, this.isBossLevel ? AudioKeys.BossBgm : AudioKeys.GameplayBgm)

    this.scene.launch('UIScene')

    this.cameras.main.setBackgroundColor('#1a1a2e')

    const backgroundKey = stageBackgroundKey(stage.level)
    if (this.textures.exists(backgroundKey)) {
      this.add.image(400, 300, backgroundKey).setDisplaySize(800, 600)
    }

    this.physics.world.setBounds(0, 0, 800, 600)

    this.platforms = this.physics.add.staticGroup()
    stage.platforms.forEach((config) => {
      const platform = this.platforms.create(config.x, config.y, TextureKeys.Platform) as Phaser.Physics.Arcade.Sprite
      platform.setDisplaySize(config.width, config.height ?? PLATFORM_HEIGHT)
      platform.refreshBody()
    })

    this.player = new Player(this, stage.playerSpawnX ?? 400, 536)
    this.player.setSpeedBonus(this.speedBonus)

    this.pickups = this.physics.add.group()
    this.enemyGroup = this.add.group()
    this.enemyProjectileGroup = this.add.group()
    this.rainProjectileGroup = this.add.group()

    if (this.isBossLevel) {
      this.startBossEncounter()
    } else {
      this.spawnEnemiesFromConfig(stage.enemies)
    }

    this.physics.add.collider(this.player, this.platforms)
    this.physics.add.collider(
      this.enemyGroup,
      this.platforms,
      undefined,
      (enemyObj) => (enemyObj as Enemy).collidesWithPlatforms,
      this,
    )
    this.physics.add.collider(this.pickups, this.platforms)

    this.physics.add.collider(
      this.player,
      this.pickups,
      (_player: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
       pickup: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile) =>
        this.handlePickupCollision(_player, pickup),
      undefined,
      this,
    )

    this.physics.add.overlap(
      this.player,
      this.enemyGroup,
      this.handlePlayerEnemyContact,
      undefined,
      this,
    )

    this.physics.add.overlap(
      this.player,
      this.enemyProjectileGroup,
      this.handlePlayerProjectileContact,
      undefined,
      this,
    )

    this.physics.add.overlap(
      this.player,
      this.rainProjectileGroup,
      this.handlePlayerRainProjectileContact,
      undefined,
      this,
    )

    this.cursors = this.input.keyboard!.createCursorKeys()
    this.restartKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)

    this.isStageIntroActive = true
    this.physics.world.pause()
    this.time.delayedCall(getStageIntroDurationMs(stage.name), () => {
      this.isStageIntroActive = false
      this.physics.world.resume()
    })
  }

  update(time: number, delta: number) {
    if (!this.cursors) {
      return
    }

    if (this.isGameOver || this.isGameWon) {
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        this.scene.stop('UIScene')
        this.scene.start('StartScene')
      }
      return
    }

    if (this.isStageIntroActive) {
      return
    }

    this.player.update(this.cursors)

    const enemies = this.enemyGroup.getChildren() as Enemy[]
    for (const enemy of enemies) {
      if (enemy === this.capturingEnemy) {
        continue
      }
      enemy.updateBehavior(time, delta)
    }

    if (this.capturingEnemy) {
      this.updateEnemyCapture(this.capturingEnemy)
    }

    this.boss?.updateBehavior(time, delta)

    const enemyProjectiles = this.enemyProjectileGroup.getChildren() as EnemyProjectile[]
    for (const enemyProjectile of enemyProjectiles) {
      if (enemyProjectile.x < -50 || enemyProjectile.x > 850) {
        enemyProjectile.destroy()
      }
    }

    const rainProjectiles = this.rainProjectileGroup.getChildren() as RainProjectile[]
    for (const rainProjectile of rainProjectiles) {
      if (rainProjectile.y > 620) {
        rainProjectile.destroy()
      }
    }

    if (this.player.isInhaling() && !this.capturingEnemy) {
      const inhaleBounds = this.player.getInhaleZone().getBounds()

      for (const enemy of enemies) {
        if (!enemy.active || !enemy.canBeInhaled) {
          continue
        }
        if (Phaser.Geom.Intersects.RectangleToRectangle(inhaleBounds, enemy.getBounds())) {
          this.startEnemyCapture(enemy)
          break
        }
      }
    }

    if (this.player.consumeSpitRequest() && this.player.isFull()) {
      this.spawnProjectile()
      this.player.releaseFull()
    }
  }

  private getPatrolBounds(x: number, y: number): { minX: number; maxX: number } {
    const wallMinX = PATROL_EDGE_INSET
    const wallMaxX = 800 - PATROL_EDGE_INSET
    const platform = findLandingPlatform(this.stagePlatforms, x, y)

    if (!platform) {
      return {
        minX: Phaser.Math.Clamp(x - 100, wallMinX, wallMaxX),
        maxX: Phaser.Math.Clamp(x + 100, wallMinX, wallMaxX),
      }
    }

    return {
      minX: Phaser.Math.Clamp(platform.x - platform.width / 2 + PATROL_EDGE_INSET, wallMinX, wallMaxX),
      maxX: Phaser.Math.Clamp(platform.x + platform.width / 2 - PATROL_EDGE_INSET, wallMinX, wallMaxX),
    }
  }

  private spawnEnemiesFromConfig(configs: EnemySpawnConfig[]) {
    const minX = PATROL_EDGE_INSET
    const maxX = 800 - PATROL_EDGE_INSET

    configs.forEach((config) => {
      let enemy: Enemy

      switch (config.type) {
        case 'normal': {
          const bounds = this.getPatrolBounds(config.x, config.y)
          enemy = new NormalEnemy(this, config.x, config.y, bounds.minX, bounds.maxX)
          break
        }
        case 'fast': {
          const bounds = this.getPatrolBounds(config.x, config.y)
          enemy = new FastEnemy(this, config.x, config.y, bounds.minX, bounds.maxX)
          break
        }
        case 'ghost':
          enemy = new GhostEnemy(this, config.x, config.y)
          break
        case 'flyer': {
          const bounds = {
            minX: Phaser.Math.Clamp(config.x - 150, minX, maxX),
            maxX: Phaser.Math.Clamp(config.x + 150, minX, maxX),
            minY: 140,
            maxY: 300,
          }
          enemy = new FlyerEnemy(
            this,
            config.x,
            config.y,
            bounds,
            () => ({ x: this.player.x, y: this.player.y }),
            (x, y, targetX, targetY) => this.fireEnemyProjectile(x, y, targetX, targetY),
          )
          break
        }
      }

      this.enemyGroup.add(enemy)
    })
  }

  private fireEnemyProjectile(x: number, y: number, targetX: number, targetY: number) {
    const direction: -1 | 1 = targetX < x ? -1 : 1
    const projectile = new EnemyProjectile(this, x, y, direction, TextureKeys.EnemyProjectile, { x: targetX, y: targetY })
    this.enemyProjectileGroup.add(projectile)
    playSfx(this, AudioKeys.FlyerProjectile)
  }

  private spawnProjectile() {
    const direction = this.player.getFacingDirection()
    const projectileX = this.player.x + direction * 32
    const projectileY = this.player.y - PLAYER_HEIGHT / 2

    if (this.projectile && this.projectile.active) {
      this.projectile.destroy()
    }

    this.projectile = new Projectile(this, projectileX, projectileY, direction)
    this.projectile.isBossMinionProjectile = this.heldEnemyIsBossMinion
    this.heldEnemyIsBossMinion = false

    this.physics.add.overlap(this.projectile, this.enemyGroup, this.handleProjectileEnemyCollision, undefined, this)

    if (this.boss) {
      this.physics.add.overlap(this.projectile, this.boss, this.handleProjectileBossCollision, undefined, this)
    }
  }

  private handleProjectileEnemyCollision(...args: unknown[]) {
    const projectile = args[0] as Projectile
    const enemy = args[1] as Enemy

    if (enemy === this.capturingEnemy) {
      return
    }

    projectile?.destroy()
    enemy?.destroy()
    playSfx(this, AudioKeys.EnemyHit)
    this.spawnPickup(enemy.x, enemy.y - 24)
    this.checkStageClear()
  }

  private spawnPickup(
    x: number,
    y: number,
    textureKey: string = TextureKeys.Gem,
    isWinPickup = false,
    size: number = PICKUP_SIZE,
  ) {
    const pickup = this.pickups.create(x, y, textureKey) as Phaser.Physics.Arcade.Image
    pickup.setDisplaySize(size, size)
    pickup.setBounce(0.6)
    pickup.setCollideWorldBounds(true)
    pickup.setVelocity(Phaser.Math.Between(-100, 100), -250)
    pickup.setData('isWinPickup', isWinPickup)
    return pickup
  }

  private handlePickupCollision(
    _player: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
    pickup: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
  ) {
    const pickupSprite = pickup as Phaser.Physics.Arcade.Image
    const isWinPickup = pickupSprite.getData('isWinPickup') === true
    pickupSprite.destroy()
    playSfx(this, AudioKeys.PickupConsume)

    if (isWinPickup) {
      this.handleGameWon()
      return
    }

    this.speedBonus += SPEED_BOOST_PER_PICKUP
    this.player.setSpeedBonus(this.speedBonus)

    this.pickupCount += 1
    this.events.emit('pickupCountChanged', this.pickupCount)
  }

  private handleGameWon() {
    this.isGameWon = true
    this.physics.world.pause()

    const victorySound = playSfx(this, AudioKeys.Victory)
    if (victorySound) {
      victorySound.once(Phaser.Sound.Events.COMPLETE, () => {
        playBgm(this, AudioKeys.StartBgm, START_BGM_VOLUME)
      })
    } else {
      playBgm(this, AudioKeys.StartBgm, START_BGM_VOLUME)
    }

    this.events.emit('gameWon', this.score)
  }

  private handlePlayerEnemyContact(...args: unknown[]) {
    const enemy = args[1] as Enemy
    if (enemy === this.capturingEnemy) {
      return
    }
    this.takeDamage()
  }

  private handlePlayerProjectileContact(...args: unknown[]) {
    const enemyProjectile = args[1] as EnemyProjectile
    enemyProjectile?.destroy()
    this.takeDamage()
  }

  private takeDamage() {
    if (this.isPlayerInvincible || this.isGameOver) {
      return
    }

    this.playerHealth = Math.max(0, this.playerHealth - 1)
    this.events.emit('healthChanged', this.playerHealth)
    playSfx(this, AudioKeys.PlayerHit)

    if (this.playerHealth === 0) {
      this.handleGameOver()
      return
    }

    this.isPlayerInvincible = true

    this.tweens.add({
      targets: this.player,
      alpha: 0.2,
      duration: 100,
      yoyo: true,
      repeat: 4,
      onComplete: () => {
        this.player.setAlpha(1)
      },
    })

    this.time.delayedCall(DAMAGE_INVINCIBILITY_MS, () => {
      this.isPlayerInvincible = false
    })
  }

  private handleGameOver() {
    this.isGameOver = true
    this.physics.world.pause()
    stopBgm()
    playSfx(this, AudioKeys.Lose)
    this.events.emit('gameOver', this.score)
  }

  private checkStageClear() {
    if (this.isBossLevel || this.stageCleared || this.enemyGroup.countActive(true) > 0) {
      return
    }

    this.stageCleared = true

    const clearedStage = stages[this.stageIndex]
    this.score += clearedStage.points
    this.events.emit('scoreChanged', this.score)

    const nextStageIndex = this.stageIndex + 1
    const isFinalStage = nextStageIndex >= stages.length

    this.events.emit('stageCleared', { isFinalStage })
    playSfx(this, AudioKeys.StageClear, 0.5)

    if (isFinalStage) {
      this.time.delayedCall(STAGE_TRANSITION_DELAY_MS, () => {
        this.scene.restart({ stageIndex: 0, score: 0, playerHealth: 3, speedBonus: 0, pickupCount: 0 })
      })
      return
    }

    this.time.delayedCall(STAGE_TRANSITION_DELAY_MS, () => {
      this.scene.restart({
        stageIndex: nextStageIndex,
        score: this.score,
        playerHealth: this.playerHealth,
        speedBonus: this.speedBonus,
        pickupCount: this.pickupCount,
      })
    })
  }

  private startEnemyCapture(enemy: Enemy) {
    if (this.capturingEnemy || this.player.isFull() || !enemy.canBeInhaled) {
      return
    }

    this.capturingEnemy = enemy

    const enemyBody = enemy.body as Phaser.Physics.Arcade.Body | null
    enemyBody?.setAllowGravity(false)
  }

  private updateEnemyCapture(enemy: Enemy) {
    if (Phaser.Geom.Intersects.RectangleToRectangle(enemy.getBounds(), this.player.getBounds())) {
      const enemyBody = enemy.body as Phaser.Physics.Arcade.Body | null
      enemyBody?.setVelocity(0, 0)
      this.heldEnemyIsBossMinion = enemy.isBossMinion
      this.player.captureEnemy(enemy)
      this.capturingEnemy = null
      this.checkStageClear()
      return
    }

    this.physics.moveToObject(enemy, this.player, CAPTURE_CHASE_SPEED)
  }

  private startBossEncounter() {
    // Confined to the right side of the arena — the left side hosts the
    // player's climbable staircase (up to x=310), which stays clear of the
    // boss's patrol so a low TIER1 step there never clips through it.
    const arenaMinX = 400
    const arenaMaxX = 800 - BOSS_HALF_WIDTH - BOSS_ARENA_MARGIN

    this.boss = new BossEnemy(
      this,
      650,
      420,
      { minX: arenaMinX, maxX: arenaMaxX },
      () => ({ x: this.player.x, y: this.player.y }),
      () => this.spawnBossMinion(),
      (x, y, direction) => this.fireBossProjectile(x, y, direction),
      () => this.startRainAttack(),
      () => this.handleBossDefeatStarted(),
      () => this.handleBossDefeated(),
    )

    this.physics.add.collider(this.boss, this.platforms)
    this.physics.add.overlap(this.player, this.boss, this.handlePlayerBossContact, undefined, this)
  }

  private pickXAwayFromPlayer(minX: number, maxX: number): number {
    for (let attempt = 0; attempt < MINION_SPAWN_PICK_ATTEMPTS; attempt++) {
      const x = Phaser.Math.Between(minX, maxX)
      if (Math.abs(x - this.player.x) >= MINION_SAFE_DISTANCE_FROM_PLAYER) {
        return x
      }
    }

    const farFromPlayer = this.player.x < (minX + maxX) / 2 ? maxX : minX
    return farFromPlayer
  }

  private spawnBossMinion() {
    const elevatedPlatforms = this.stagePlatforms.filter((p) => (p.height ?? PLATFORM_HEIGHT) !== GROUND_HEIGHT)
    const targetGround = elevatedPlatforms.length === 0 || Math.random() < 0.5

    let x: number
    let y: number

    if (targetGround) {
      const minX = PATROL_EDGE_INSET
      const maxX = 800 - PATROL_EDGE_INSET
      x = this.pickXAwayFromPlayer(minX, maxX)
      y = GROUND_ENEMY_SPAWN_Y
    } else {
      const platform = Phaser.Utils.Array.GetRandom(elevatedPlatforms)
      const minX = platform.x - platform.width / 2 + PATROL_EDGE_INSET
      const maxX = platform.x + platform.width / 2 - PATROL_EDGE_INSET
      x = this.pickXAwayFromPlayer(minX, maxX)
      y = platform.y - ELEVATED_ENEMY_SPAWN_OFFSET
    }

    const bounds = this.getPatrolBounds(x, y)
    const minion = new NormalEnemy(this, x, y, bounds.minX, bounds.maxX)
    minion.isBossMinion = true
    this.enemyGroup.add(minion)
  }

  private fireBossProjectile(x: number, _y: number, direction: -1 | 1) {
    const fireY = this.player.y >= GROUND_LEVEL_THRESHOLD_Y ? GROUND_LEVEL_FIRE_Y : TIER1_LEVEL_FIRE_Y
    const projectile = new EnemyProjectile(this, x, fireY, direction, TextureKeys.BossProjectile)
    this.enemyProjectileGroup.add(projectile)
    playSfx(this, AudioKeys.BossProjectile)
  }

  private startRainAttack() {
    playSfx(this, AudioKeys.BossRain)

    const minX = PATROL_EDGE_INSET
    const maxX = 800 - PATROL_EDGE_INSET
    const segmentWidth = (maxX - minX) / RAIN_PROJECTILE_COUNT

    // Divide the width into one segment per drop (guaranteeing full spread)
    // but shuffle the spawn order so it doesn't look like a mechanical sweep.
    const segmentIndices = Phaser.Utils.Array.Shuffle(
      Array.from({ length: RAIN_PROJECTILE_COUNT }, (_, i) => i),
    )

    segmentIndices.forEach((segmentIndex, order) => {
      const segmentStart = minX + segmentIndex * segmentWidth
      const x = Phaser.Math.Between(segmentStart, segmentStart + segmentWidth)

      this.time.delayedCall(order * RAIN_PROJECTILE_SPAWN_INTERVAL_MS, () => {
        if (this.isGameOver || this.stageCleared) {
          return
        }
        const rainProjectile = new RainProjectile(this, x, RAIN_PROJECTILE_SPAWN_Y)
        this.rainProjectileGroup.add(rainProjectile)
      })
    })
  }

  private handlePlayerBossContact() {
    this.takeDamage()
  }

  private handlePlayerRainProjectileContact(...args: unknown[]) {
    const rainProjectile = args[1] as RainProjectile
    rainProjectile?.destroy()
    this.takeDamage()
  }

  private handleProjectileBossCollision(...args: unknown[]) {
    const projectile = args[0] as Projectile

    if (!projectile?.isBossMinionProjectile) {
      return
    }

    projectile.destroy()
    this.boss?.takeDamage()
  }

  private handleBossDefeatStarted() {
    this.stageCleared = true
    stopBgm()

    const remainingEnemies = this.enemyGroup.getChildren() as Enemy[]
    remainingEnemies.forEach((enemy) => enemy.destroy())
    this.capturingEnemy = null

    const remainingEnemyProjectiles = this.enemyProjectileGroup.getChildren() as EnemyProjectile[]
    remainingEnemyProjectiles.forEach((projectile) => projectile.destroy())

    const remainingRainProjectiles = this.rainProjectileGroup.getChildren() as RainProjectile[]
    remainingRainProjectiles.forEach((projectile) => projectile.destroy())
  }

  private handleBossDefeated() {
    const diamondX = this.boss?.x ?? 650
    const diamondY = this.boss?.y ?? 420
    this.boss = undefined

    const clearedStage = stages[this.stageIndex]
    this.score += clearedStage.points
    this.events.emit('scoreChanged', this.score)

    this.time.delayedCall(BOSS_DEFEAT_DIAMOND_DELAY_MS, () => {
      this.spawnPickup(diamondX, diamondY, TextureKeys.Diamond, true, DIAMOND_PICKUP_SIZE)
    })
  }
}
