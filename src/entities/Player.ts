import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'
import { WORLD_GRAVITY_Y } from '../config/physics'

export const PlayerState = {
  IDLE: 'idle',
  MOVING: 'moving',
  INHALING: 'inhaling',
  FULL: 'full',
} as const

export type PlayerStateType = 'idle' | 'moving' | 'inhaling' | 'full'

const PLAYER_HEIGHT = 48
const PLAYER_SPEED = 240
const FULL_SPEED_MULTIPLIER = 0.5
const JUMP_VELOCITY = 640
const INHALE_ZONE_WIDTH = 120
const INHALE_ZONE_HEIGHT = 64
const INHALE_OFFSET = 56

export default class Player extends Phaser.Physics.Arcade.Sprite {
  state: PlayerStateType = PlayerState.IDLE
  private lastDirection: -1 | 1 = 1
  private heldEnemy = false
  private spaceKey: Phaser.Input.Keyboard.Key
  private spitRequested = false
  private inhaleZone: Phaser.GameObjects.Zone

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TextureKeys.Player)

    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.spaceKey = scene.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    )

    this.inhaleZone = scene.add
      .zone(x + INHALE_OFFSET, y - PLAYER_HEIGHT / 2, INHALE_ZONE_WIDTH, INHALE_ZONE_HEIGHT)
      .setOrigin(0.5)
      .setVisible(false)

    this.setCollideWorldBounds(true)
    this.setGravityY(WORLD_GRAVITY_Y)
    this.setBounce(0)
    this.setOrigin(0.5, 1)
    this.setScale(1)
  }

  update(cursors: Phaser.Types.Input.Keyboard.CursorKeys) {
    const leftDown = cursors.left?.isDown ?? false
    const rightDown = cursors.right?.isDown ?? false
    const inhaleDown = this.spaceKey.isDown && this.state !== PlayerState.FULL

    const body = this.body as Phaser.Physics.Arcade.Body
    const isGrounded = body.blocked.down || body.touching.down
    if (cursors.up && Phaser.Input.Keyboard.JustDown(cursors.up) && isGrounded) {
      this.setVelocityY(-JUMP_VELOCITY)
    }

    if (leftDown) {
      this.lastDirection = -1
      this.setVelocityX(-this.getCurrentSpeed())
      if (!inhaleDown && this.state !== PlayerState.FULL) {
        this.state = PlayerState.MOVING
      }
    } else if (rightDown) {
      this.lastDirection = 1
      this.setVelocityX(this.getCurrentSpeed())
      if (!inhaleDown && this.state !== PlayerState.FULL) {
        this.state = PlayerState.MOVING
      }
    } else {
      this.setVelocityX(0)
      if (!inhaleDown && this.state !== PlayerState.FULL) {
        this.state = PlayerState.IDLE
      }
    }

    if (inhaleDown) {
      this.state = PlayerState.INHALING
      this.activateInhaleZone()
    } else {
      this.deactivateInhaleZone()
      if (this.state === PlayerState.INHALING) {
        this.state = this.heldEnemy ? PlayerState.FULL : this.state
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) && this.state === PlayerState.FULL) {
      this.spitRequested = true
    }

    const targetScale = this.state === PlayerState.FULL ? 1.3 : 1
    if (this.scaleX !== targetScale) {
      this.setScale(targetScale)
    }

    if (this.state === PlayerState.FULL) {
      this.setTint(0x88ff88)
    } else {
      this.clearTint()
    }

    this.updateInhaleZonePosition()
  }

  getInhaleZone(): Phaser.GameObjects.Zone {
    return this.inhaleZone
  }

  consumeSpitRequest(): boolean {
    const requested = this.spitRequested
    this.spitRequested = false
    return requested
  }

  releaseFull() {
    this.heldEnemy = false
    this.state = PlayerState.IDLE
    this.clearTint()
  }

  getFacingDirection(): -1 | 1 {
    return this.lastDirection
  }

  captureEnemy(enemy: Phaser.Physics.Arcade.Sprite) {
    if (this.heldEnemy) {
      return
    }

    this.heldEnemy = true
    this.state = PlayerState.FULL
    this.deactivateInhaleZone()
    enemy.destroy()
  }

  isInhaling(): boolean {
    return this.state === PlayerState.INHALING
  }

  isFull(): boolean {
    return this.state === PlayerState.FULL
  }

  private activateInhaleZone() {
    this.inhaleZone.setVisible(true)
  }

  private deactivateInhaleZone() {
    this.inhaleZone.setVisible(false)
  }

  private updateInhaleZonePosition() {
    this.inhaleZone.setPosition(
      this.x + this.lastDirection * INHALE_OFFSET,
      this.y - (this.displayHeight / 2),
    )
  }

  private getCurrentSpeed(): number {
    return this.state === PlayerState.FULL
      ? PLAYER_SPEED * FULL_SPEED_MULTIPLIER
      : PLAYER_SPEED
  }
}
