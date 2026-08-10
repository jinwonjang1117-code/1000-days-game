import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'
import { WORLD_GRAVITY_Y } from '../config/physics'
import { AudioKeys } from '../config/audioKeys'
import { playSfx } from '../config/audio'

export const PlayerState = {
  IDLE: 'idle',
  MOVING: 'moving',
  INHALING: 'inhaling',
  FULL: 'full',
} as const

export type PlayerStateType = 'idle' | 'moving' | 'inhaling' | 'full'

const PLAYER_WIDTH = 60
export const PLAYER_HEIGHT = 104
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
  private awaitingSpaceRelease = false
  private speedBonus = 0
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
    this.setDisplaySize(PLAYER_WIDTH, PLAYER_HEIGHT)
  }

  update(cursors: Phaser.Types.Input.Keyboard.CursorKeys) {
    const leftDown = cursors.left?.isDown ?? false
    const rightDown = cursors.right?.isDown ?? false

    if (this.awaitingSpaceRelease && !this.spaceKey.isDown) {
      this.awaitingSpaceRelease = false
    }

    const inhaleDown = !this.awaitingSpaceRelease && this.spaceKey.isDown && this.state !== PlayerState.FULL

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
      if (this.state !== PlayerState.INHALING) {
        playSfx(this.scene, AudioKeys.PlayerInhale)
      }
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
      playSfx(this.scene, AudioKeys.PlayerSpit)
    }

    const targetTextureKey = this.getTextureKeyForState()
    if (this.texture.key !== targetTextureKey) {
      this.setTexture(targetTextureKey)
      this.setDisplaySize(PLAYER_WIDTH, PLAYER_HEIGHT)
    }

    this.setFlipX(this.lastDirection === -1)

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
    this.awaitingSpaceRelease = true
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

  setSpeedBonus(amount: number) {
    this.speedBonus = amount
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
    const baseSpeed = PLAYER_SPEED + this.speedBonus
    return this.state === PlayerState.FULL
      ? baseSpeed * FULL_SPEED_MULTIPLIER
      : baseSpeed
  }

  private getTextureKeyForState(): string {
    if (this.state === PlayerState.FULL) {
      return TextureKeys.PlayerFull
    }
    if (this.state === PlayerState.INHALING) {
      return TextureKeys.PlayerInhaling
    }
    return TextureKeys.Player
  }
}
