import Phaser from 'phaser'
import Player from '../entities/Player'
import Projectile from '../entities/Projectile'
import { TextureKeys } from '../config/textureKeys'

const GRAVITY_Y = 800
const WALL_THICKNESS = 32

export default class GameScene extends Phaser.Scene {
  public score = 0
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private player!: Player
  private enemy!: Phaser.Physics.Arcade.Sprite
  private projectile?: Projectile
  private pickups!: Phaser.Physics.Arcade.Group
  private walls!: Phaser.Physics.Arcade.StaticGroup
  private isCapturingEnemy = false

  constructor() {
    super({ key: 'GameScene' })
  }

  create() {
    this.scene.launch('UIScene')

    this.cameras.main.setBackgroundColor('#1a1a2e')

    this.physics.world.setBounds(0, 0, 800, 600)

    const ground = this.physics.add.staticSprite(400, 580, '')
    ground.setDisplaySize(800, 40)
    ground.refreshBody()

    this.player = new Player(this, 400, 536)
    this.player.setCollideWorldBounds(true)
    this.player.setGravityY(GRAVITY_Y)
    this.player.setBounce(0)

    this.enemy = this.physics.add.sprite(500, 520, TextureKeys.Enemy)
    this.enemy.setImmovable(true)
    this.enemy.setGravityY(0)

    this.pickups = this.physics.add.group()
    this.walls = this.physics.add.staticGroup()
    this.walls.create(0, 300, '').setOrigin(0, 0.5).setDisplaySize(WALL_THICKNESS, 600).refreshBody()
    this.walls.create(800 - WALL_THICKNESS, 300, '').setOrigin(0, 0.5).setDisplaySize(WALL_THICKNESS, 600).refreshBody()

    this.physics.add.collider(this.player, ground)
    this.physics.add.collider(this.enemy, ground)
    this.physics.add.collider(this.pickups, ground)

    this.physics.add.collider(this.pickups, this.walls)

    this.physics.add.collider(
      this.player,
      this.pickups,
      (_player: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
       pickup: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile) =>
        this.handlePickupCollision(_player, pickup),
      undefined,
      this,
    )
    this.physics.add.collider(
      this.enemy,
      this.walls,
      (enemy: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
       wall: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile) =>
        this.handleEnemyWallCollision(enemy, wall),
      undefined,
      this,
    )

    this.cursors = this.input.keyboard!.createCursorKeys()
  }

  update() {
    if (!this.cursors) {
      return
    }

    this.player.update(this.cursors)

    if (
      this.player.isInhaling() &&
      !this.isCapturingEnemy &&
      this.enemy.active
    ) {
      const inhaleBounds = this.player.getInhaleZone().getBounds()
      const enemyBounds = this.enemy.getBounds()

      if (Phaser.Geom.Intersects.RectangleToRectangle(inhaleBounds, enemyBounds)) {
        this.startEnemyCapture(this.enemy)
      }
    }

    if (this.player.consumeSpitRequest() && this.player.isFull()) {
      this.spawnProjectile()
      this.player.releaseFull()
    }
  }

  private spawnProjectile() {
    const direction = this.player.getFacingDirection()
    const projectileX = this.player.x + direction * 32
    const projectileY = this.player.y - 16

    if (this.projectile && this.projectile.active) {
      this.projectile.destroy()
    }

    this.projectile = new Projectile(this, projectileX, projectileY, direction)
    this.physics.add.collider(this.projectile, this.walls, this.handleProjectileWallCollision, undefined, this)
    this.physics.add.collider(this.projectile, this.enemy, this.handleProjectileEnemyCollision, undefined, this)
  }

  private handleProjectileWallCollision(...args: unknown[]) {
    const projectile = args[0] as Projectile
    projectile?.bounceOffWall()
  }

  private handleProjectileEnemyCollision(...args: unknown[]) {
    const projectile = args[0] as Projectile
    const enemy = args[1] as Phaser.Physics.Arcade.Sprite

    projectile?.destroy()
    enemy?.destroy()
    this.spawnPickup(this.player.x, this.player.y - 24)
    this.score += 100
    console.log('Score:', this.score)
  }

  private spawnPickup(x: number, y: number) {
    const pickup = this.pickups.create(x, y, TextureKeys.Gem) as Phaser.Physics.Arcade.Image
    pickup.setBounce(0.6)
    pickup.setCollideWorldBounds(true)
    pickup.setVelocity(Phaser.Math.Between(-100, 100), -250)
  }

  private handlePickupCollision(
    _player: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
    pickup: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
  ) {
    const pickupSprite = pickup as Phaser.Physics.Arcade.Image
    pickupSprite.destroy()
  }

  private handleEnemyWallCollision(
    _enemy: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
    _wall: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | Phaser.Tilemaps.Tile,
  ) {
    const enemySprite = _enemy as Phaser.Physics.Arcade.Sprite
    if (!enemySprite.body) {
      return
    }
    enemySprite.setVelocityX(-enemySprite.body.velocity.x)
  }

  private startEnemyCapture(enemy?: Phaser.Physics.Arcade.Sprite) {
    if (this.isCapturingEnemy || this.player.isFull()) {
      return
    }

    const target = enemy ?? this.enemy
    if (!target.active) {
      return
    }

    this.isCapturingEnemy = true

    this.tweens.add({
      targets: target,
      x: this.player.x,
      y: this.player.y,
      duration: 300,
      ease: 'Power2',
      onComplete: () => {
        this.player.captureEnemy(target)
        this.isCapturingEnemy = false
      },
    })
  }
}
