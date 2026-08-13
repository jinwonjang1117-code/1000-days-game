import Phaser from 'phaser'
import type { DataConnection } from 'peerjs'
import { TeamGameScenes } from '../sceneKeys'
import { TEAM_GAME_TITLE } from '../gameId'
import { CoreScenes } from '../../../config/sceneKeys'
import { createAudioToggleButtons, TOGGLE_BUTTON_STYLE } from '../../../ui/audioToggles'
import { navigateToHub } from '../../../router'
import { hostGame, joinGame, disconnectPeer, exchangeNames } from '../net/peerConnection'
import { showTextInputOverlay } from '../../../ui/domOverlay'
import type { OverlayHandle } from '../../../ui/domOverlay'
import { getPlayerName } from '../../../config/playerProfile'

const FALLBACK_PLAYER_NAME = '플레이어'

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '40px',
  color: '#ffffff',
}

const MENU_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '22px',
  color: '#000000',
  backgroundColor: '#ffcc00',
  padding: { x: 28, y: 12 },
}

const CANCEL_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffffff',
  backgroundColor: '#00000080',
  padding: { x: 16, y: 8 },
}

const STATUS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '18px',
  color: '#cccccc',
  align: 'center',
}

const ERROR_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '18px',
  color: '#ff6666',
  align: 'center',
}

const CODE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '56px',
  color: '#ffcc00',
}

const CONNECTED_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '28px',
  color: '#66ff99',
}

const CODE_INPUT_MAX_LENGTH = 4

/**
 * Proves the host/join handshake works end-to-end (two tabs, one hosts, one
 * joins with the code, both see "Connected!"). No game logic lives here yet —
 * that comes once this is solid, per the plan to build networking on top of
 * a working core loop rather than alongside an unproven one.
 */
export default class LobbyScene extends Phaser.Scene {
  private stepObjects: Phaser.GameObjects.GameObject[] = []
  private overlay: OverlayHandle | null = null
  private activeConnection: DataConnection | null = null
  private onActiveConnectionClosed: (() => void) | null = null

  constructor() {
    super({ key: TeamGameScenes.Lobby })
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e')
    createAudioToggleButtons(this)
    this.showMenuStep()

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.overlay?.destroy()
      this.overlay = null
      this.forgetActiveConnection()
    })
  }

  /** Stops listening for the current connection's close, e.g. before we close it ourselves. */
  private forgetActiveConnection() {
    if (this.activeConnection && this.onActiveConnectionClosed) {
      this.activeConnection.off('close', this.onActiveConnectionClosed)
    }
    this.activeConnection = null
    this.onActiveConnectionClosed = null
  }

  private addStepObject<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.stepObjects.push(object)
    return object
  }

  private clearStepObjects() {
    this.stepObjects.forEach((object) => object.destroy())
    this.stepObjects = []
    this.overlay?.destroy()
    this.overlay = null
  }

  private addBackToHubButton() {
    this.addStepObject(
      this.add
        .text(16, 588, '← 게임 허브', TOGGLE_BUTTON_STYLE)
        .setOrigin(0, 1)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.returnToHub()),
    )
  }

  private returnToHub() {
    this.forgetActiveConnection()
    disconnectPeer()
    navigateToHub()
    this.scene.start(CoreScenes.MainMenu)
  }

  private showMenuStep() {
    this.clearStepObjects()

    this.addStepObject(this.add.text(400, 140, TEAM_GAME_TITLE, TITLE_STYLE).setOrigin(0.5))

    this.addStepObject(
      this.add
        .text(400, 280, '방 만들기', MENU_BUTTON_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.startHosting()),
    )

    this.addStepObject(
      this.add
        .text(400, 360, '방 참가하기', MENU_BUTTON_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.startJoining()),
    )

    this.addBackToHubButton()
  }

  private startHosting() {
    this.clearStepObjects()

    this.addStepObject(this.add.text(400, 120, TEAM_GAME_TITLE, TITLE_STYLE).setOrigin(0.5))
    const statusText = this.addStepObject(
      this.add.text(400, 220, '코드 생성 중...', STATUS_STYLE).setOrigin(0.5),
    )
    const codeText = this.addStepObject(this.add.text(400, 300, '', CODE_STYLE).setOrigin(0.5))

    this.addStepObject(
      this.add
        .text(400, 460, '취소', CANCEL_BUTTON_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.forgetActiveConnection()
          disconnectPeer()
          this.showMenuStep()
        }),
    )

    this.addBackToHubButton()

    hostGame((code) => {
      statusText.setStyle(STATUS_STYLE).setText('상대방이 코드를 입력하면 연결됩니다')
      codeText.setText(code)
    })
      .then((connection) => this.handleConnected(connection))
      .catch((err) => {
        statusText.setStyle(ERROR_STYLE).setText(errorMessage(err))
        codeText.setText('')
      })
  }

  private startJoining() {
    this.clearStepObjects()

    this.addStepObject(this.add.text(400, 140, TEAM_GAME_TITLE, TITLE_STYLE).setOrigin(0.5))
    const statusText = this.addStepObject(
      this.add.text(400, 260, '방 코드를 입력하세요', STATUS_STYLE).setOrigin(0.5),
    )

    this.addStepObject(
      this.add
        .text(400, 460, '취소', CANCEL_BUTTON_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.showMenuStep()),
    )

    this.addBackToHubButton()
    this.promptForCode(statusText, '연결')
  }

  private promptForCode(statusText: Phaser.GameObjects.Text, submitLabel: string) {
    this.overlay = showTextInputOverlay({
      placeholder: '0000',
      submitLabel,
      cancelLabel: '취소',
      maxLength: CODE_INPUT_MAX_LENGTH,
      onSubmit: (rawCode) => {
        this.overlay?.destroy()
        this.overlay = null
        this.attemptJoin(rawCode.trim(), statusText)
      },
      onCancel: () => this.showMenuStep(),
    })
  }

  private attemptJoin(code: string, statusText: Phaser.GameObjects.Text) {
    statusText.setStyle(STATUS_STYLE).setText('연결 중...')

    joinGame(code)
      .then((connection) => this.handleConnected(connection))
      .catch((err) => {
        statusText.setStyle(ERROR_STYLE).setText(errorMessage(err))
        this.promptForCode(statusText, '다시 시도')
      })
  }

  private handleConnected(connection: DataConnection) {
    console.log('[teamGame] connected', connection)
    this.clearStepObjects()

    this.addStepObject(this.add.text(400, 260, 'Connected!', CONNECTED_STYLE).setOrigin(0.5))
    const peerNameText = this.addStepObject(
      this.add.text(400, 310, '상대방 이름 확인 중...', STATUS_STYLE).setOrigin(0.5),
    )

    this.addStepObject(
      this.add
        .text(400, 380, '동기화 테스트 시작', MENU_BUTTON_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.scene.start(TeamGameScenes.SyncTest)),
    )

    this.addBackToHubButton()

    const myName = getPlayerName().trim() || FALLBACK_PLAYER_NAME
    exchangeNames(connection, myName).then((peerName) => {
      // The player may have already left this screen (back to hub, etc.) by
      // the time the peer's name arrives — don't touch a destroyed text object.
      if (this.scene.isActive()) {
        peerNameText.setText(`상대: ${peerName || connection.peer}`)
      }
    })

    this.activeConnection = connection
    this.onActiveConnectionClosed = () => {
      this.activeConnection = null
      this.onActiveConnectionClosed = null
      if (this.scene.isActive()) {
        this.showDisconnectedStep()
      }
    }
    connection.once('close', this.onActiveConnectionClosed)
  }

  private showDisconnectedStep() {
    this.clearStepObjects()

    this.addStepObject(this.add.text(400, 140, TEAM_GAME_TITLE, TITLE_STYLE).setOrigin(0.5))
    this.addStepObject(
      this.add.text(400, 260, '상대방과의 연결이 끊어졌습니다', ERROR_STYLE).setOrigin(0.5),
    )

    this.addStepObject(
      this.add
        .text(400, 340, '메인으로', MENU_BUTTON_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.showMenuStep()),
    )

    this.addBackToHubButton()
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === 'room not found') {
      return '방을 찾을 수 없습니다'
    }
    if (err.message === 'connection timed out') {
      return '연결 시간이 초과되었습니다'
    }
    return `오류: ${err.message}`
  }
  return '알 수 없는 오류가 발생했습니다'
}
