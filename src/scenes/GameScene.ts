import Phaser from 'phaser'
import Player from '../entities/Player'
import { TextureKeys } from '../config/textureKeys'

const GRAVITY_Y = 800

export default class GameScene extends Phaser.Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private player!: Player
  private enemy!: Phaser.Physics.Arcade.Sprite
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

    this.physics.add.collider(this.player, ground)
    this.physics.add.collider(this.enemy, ground)

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
