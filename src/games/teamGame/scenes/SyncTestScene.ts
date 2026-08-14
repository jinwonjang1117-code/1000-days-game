import Phaser from 'phaser'
import type { DataConnection } from 'peerjs'
import { TeamGameScenes } from '../sceneKeys'
import { CoreScenes } from '../../../config/sceneKeys'
import { createAudioToggleButtons, TOGGLE_BUTTON_STYLE } from '../../../ui/audioToggles'
import { navigateToHub } from '../../../router'
import { getConnection, getRole, disconnectPeer } from '../net/peerConnection'
import type { KeyState, InputMessage, StateMessage, Vec2 } from '../net/syncProtocol'
import { isInputMessage, isStateMessage } from '../net/syncProtocol'

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '28px',
  color: '#ffffff',
}

const STATUS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#cccccc',
}

const LEGEND_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
}

const MOVE_SPEED = 200
const BROADCAST_INTERVAL_MS = 50
// Joiner-side smoothing rate (per second) for easing toward the latest
// received position instead of snapping to it. Higher = snappier/more
// jitter-prone, lower = smoother/more lag behind the true position.
const INTERPOLATION_RATE = 12
const SQUARE_SIZE = 40
const HOST_COLOR = 0x3355ff
const JOINER_COLOR = 0xff6633
const HOST_START = { x: 300, y: 320 }
const JOINER_START = { x: 500, y: 320 }
const EMPTY_KEYS: KeyState = { up: false, down: false, left: false, right: false }

interface WasdKeys {
  W: Phaser.Input.Keyboard.Key
  A: Phaser.Input.Keyboard.Key
  S: Phaser.Input.Keyboard.Key
  D: Phaser.Input.Keyboard.Key
}

function keysEqual(a: KeyState, b: KeyState): boolean {
  return a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right
}

function velocityFromKeys(keys: KeyState): { vx: number; vy: number } {
  const vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
  const vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0)
  return { vx: vx * MOVE_SPEED, vy: vy * MOVE_SPEED }
}

/**
 * Host-authoritative movement test: host simulates both squares and
 * broadcasts positions at a fixed rate; the joiner only ever sends input and
 * renders whatever position comes back — no local prediction, just eased
 * toward the latest reported position (see interpolateTowardLatestState).
 */
export default class SyncTestScene extends Phaser.Scene {
  private role: 'host' | 'joiner' = 'host'
  private connection: DataConnection | null = null
  private keys!: WasdKeys
  private hostSquare?: Phaser.GameObjects.Rectangle
  private joinerSquare?: Phaser.GameObjects.Rectangle
  private targetHostPos: Vec2 | null = null
  private targetJoinerPos: Vec2 | null = null
  private lastSentKeys: KeyState = EMPTY_KEYS
  private broadcastTimer?: Phaser.Time.TimerEvent
  private onData?: (data: unknown) => void
  private onClose?: () => void

  constructor() {
    super({ key: TeamGameScenes.SyncTest })
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e')
    createAudioToggleButtons(this)

    // Reset in case this scene instance is being re-entered (e.g. left and
    // re-hosted/re-joined) — stale targets from a prior session would
    // otherwise skip the "snap on first message" behavior below.
    this.targetHostPos = null
    this.targetJoinerPos = null

    const connection = getConnection()
    const role = getRole()

    // This scene is only ever reached right after a successful connect, so
    // both should already be set — bail to the lobby if that assumption ever breaks.
    if (!connection || !role) {
      this.scene.start(TeamGameScenes.Lobby)
      return
    }

    this.connection = connection
    this.role = role
    this.keys = this.input.keyboard!.addKeys('W,S,A,D') as unknown as WasdKeys

    this.add.text(400, 40, '동기화 테스트', TITLE_STYLE).setOrigin(0.5)
    this.add.text(400, 74, 'WASD로 이동', STATUS_STYLE).setOrigin(0.5)
    this.add.text(250, 104, '호스트', { ...LEGEND_STYLE, color: '#6688ff' }).setOrigin(0.5)
    this.add.text(550, 104, '참가자', { ...LEGEND_STYLE, color: '#ff9966' }).setOrigin(0.5)

    this.add
      .text(16, 588, '← 게임 허브', TOGGLE_BUTTON_STYLE)
      .setOrigin(0, 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (this.connection && this.onClose) {
          this.connection.off('close', this.onClose)
        }
        disconnectPeer()
        navigateToHub()
        this.scene.start(CoreScenes.MainMenu)
      })

    if (role === 'host') {
      this.setupHost(connection)
    } else {
      this.setupJoiner(connection)
    }

    this.onClose = () => {
      if (this.scene.isActive()) {
        this.scene.start(TeamGameScenes.Lobby)
      }
    }
    connection.once('close', this.onClose)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.broadcastTimer?.remove()
      this.broadcastTimer = undefined
      if (this.connection && this.onData) {
        this.connection.off('data', this.onData)
      }
      this.connection = null
    })
  }

  update(_time: number, delta: number) {
    if (!this.connection) {
      return
    }

    if (this.role === 'joiner') {
      this.interpolateTowardLatestState(delta)
    }

    const currentKeys: KeyState = {
      up: this.keys.W.isDown,
      down: this.keys.S.isDown,
      left: this.keys.A.isDown,
      right: this.keys.D.isDown,
    }

    if (this.role === 'host') {
      if (this.hostSquare) {
        const { vx, vy } = velocityFromKeys(currentKeys)
        ;(this.hostSquare.body as Phaser.Physics.Arcade.Body).setVelocity(vx, vy)
      }
      return
    }

    if (!keysEqual(currentKeys, this.lastSentKeys)) {
      this.lastSentKeys = currentKeys
      const message: InputMessage = { type: 'input', keys: currentKeys }
      this.connection.send(message)
    }
  }

  /**
   * Eases both squares toward the most recently received positions instead
   * of snapping — frame-rate independent exponential smoothing, so the same
   * INTERPOLATION_RATE looks the same regardless of the player's FPS.
   */
  private interpolateTowardLatestState(delta: number) {
    const t = 1 - Math.exp(-INTERPOLATION_RATE * (delta / 1000))

    if (this.targetHostPos && this.hostSquare) {
      this.hostSquare.x = Phaser.Math.Linear(this.hostSquare.x, this.targetHostPos.x, t)
      this.hostSquare.y = Phaser.Math.Linear(this.hostSquare.y, this.targetHostPos.y, t)
    }

    if (this.targetJoinerPos && this.joinerSquare) {
      this.joinerSquare.x = Phaser.Math.Linear(this.joinerSquare.x, this.targetJoinerPos.x, t)
      this.joinerSquare.y = Phaser.Math.Linear(this.joinerSquare.y, this.targetJoinerPos.y, t)
    }
  }

  /** Host simulates both squares: its own from local input, the joiner's from received input. */
  private setupHost(connection: DataConnection) {
    const hostSquare = this.add.rectangle(HOST_START.x, HOST_START.y, SQUARE_SIZE, SQUARE_SIZE, HOST_COLOR)
    this.physics.add.existing(hostSquare)
    ;(hostSquare.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true)

    const joinerSquare = this.add.rectangle(JOINER_START.x, JOINER_START.y, SQUARE_SIZE, SQUARE_SIZE, JOINER_COLOR)
    this.physics.add.existing(joinerSquare)
    ;(joinerSquare.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true)

    this.hostSquare = hostSquare

    this.onData = (data: unknown) => {
      if (isInputMessage(data)) {
        const { vx, vy } = velocityFromKeys(data.keys)
        ;(joinerSquare.body as Phaser.Physics.Arcade.Body).setVelocity(vx, vy)
      }
    }
    connection.on('data', this.onData)

    this.broadcastTimer = this.time.addEvent({
      delay: BROADCAST_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (!connection.open) {
          return
        }
        const message: StateMessage = {
          type: 'state',
          host: { x: hostSquare.x, y: hostSquare.y },
          joiner: { x: joinerSquare.x, y: joinerSquare.y },
        }
        connection.send(message)
      },
    })
  }

  /**
   * Joiner never simulates — it only sends input and renders whatever the
   * host reports back, eased toward each new position (see
   * interpolateTowardLatestState) rather than snapped.
   */
  private setupJoiner(connection: DataConnection) {
    const hostSquare = this.add.rectangle(HOST_START.x, HOST_START.y, SQUARE_SIZE, SQUARE_SIZE, HOST_COLOR)
    const joinerSquare = this.add.rectangle(JOINER_START.x, JOINER_START.y, SQUARE_SIZE, SQUARE_SIZE, JOINER_COLOR)

    this.hostSquare = hostSquare
    this.joinerSquare = joinerSquare

    this.onData = (data: unknown) => {
      if (isStateMessage(data)) {
        // Snap on the very first update only, so the squares don't visibly
        // slide in from their spawn point the moment you connect.
        if (!this.targetHostPos) {
          hostSquare.setPosition(data.host.x, data.host.y)
        }
        if (!this.targetJoinerPos) {
          joinerSquare.setPosition(data.joiner.x, data.joiner.y)
        }
        this.targetHostPos = data.host
        this.targetJoinerPos = data.joiner
      }
    }
    connection.on('data', this.onData)
  }
}
