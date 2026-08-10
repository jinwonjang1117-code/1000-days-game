import Phaser from 'phaser'
import GameScene from './GameScene'
import { stages } from '../config/stages'
import { TextureKeys } from '../config/textureKeys'
import { STAGE_INTRO_DURATION_MS } from '../config/timing'

const HUD_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '20px',
  color: '#ffffff',
}

const HUD_SIDE_PADDING = 48
const PICKUP_ICON_SIZE = 22
const PICKUP_ICON_TEXT_GAP = 6
const HEALTH_ICON_SIZE = 24
const HEALTH_ICON_GAP = 4

const OVERLAY_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '40px',
  color: '#ffffff',
}

const OVERLAY_ALPHA_DEFAULT = 0.6
const OVERLAY_ALPHA_WELCOME = 1

interface StageClearedPayload {
  isFinalStage: boolean
}

export default class UIScene extends Phaser.Scene {
  private gameScene!: GameScene
  private scoreText!: Phaser.GameObjects.Text
  private pickupText!: Phaser.GameObjects.Text
  private healthIcons: Phaser.GameObjects.Image[] = []
  private stageText!: Phaser.GameObjects.Text
  private stageNameText!: Phaser.GameObjects.Text
  private overlayBackground!: Phaser.GameObjects.Rectangle
  private overlayTitleText!: Phaser.GameObjects.Text
  private overlaySubtitleText!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'UIScene' })
  }

  create() {
    this.gameScene = this.scene.get('GameScene') as GameScene

    this.scoreText = this.add.text(HUD_SIDE_PADDING, 12, '', HUD_TEXT_STYLE)
    this.add.image(720 - HUD_SIDE_PADDING, 45 + 10, TextureKeys.Gem)
      .setDisplaySize(PICKUP_ICON_SIZE, PICKUP_ICON_SIZE)
      .setOrigin(0, 0.5)
    this.pickupText = this.add.text(
      720 - HUD_SIDE_PADDING + PICKUP_ICON_SIZE + PICKUP_ICON_TEXT_GAP,
      45,
      '',
      HUD_TEXT_STYLE,
    )
    this.stageText = this.add.text(400, 12, '', HUD_TEXT_STYLE).setOrigin(0.5, 0)
    this.stageNameText = this.add.text(400, 38, '', HUD_TEXT_STYLE).setOrigin(0.5, 0)

    this.overlayBackground = this.add.rectangle(400, 300, 800, 600, 0x000000, OVERLAY_ALPHA_DEFAULT).setVisible(false)
    this.overlayTitleText = this.add.text(400, 270, '', OVERLAY_TITLE_STYLE).setOrigin(0.5).setVisible(false)
    this.overlaySubtitleText = this.add.text(400, 330, '', HUD_TEXT_STYLE).setOrigin(0.5).setVisible(false)

    this.updateScoreText(this.gameScene.score)
    this.updatePickupText(this.gameScene.pickupCount)
    this.updateHealthText(this.gameScene.playerHealth)
    this.updateStageText()
    this.showStageIntro()

    if (import.meta.env.DEV) {
      this.createDevBossButton()
      this.createDevStageJumpButton()
    }

    this.gameScene.events.on('scoreChanged', this.updateScoreText, this)
    this.gameScene.events.on('pickupCountChanged', this.updatePickupText, this)
    this.gameScene.events.on('healthChanged', this.updateHealthText, this)
    this.gameScene.events.on('stageCleared', this.handleStageCleared, this)
    this.gameScene.events.on('gameOver', this.handleGameOver, this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.gameScene.events.off('scoreChanged', this.updateScoreText, this)
      this.gameScene.events.off('pickupCountChanged', this.updatePickupText, this)
      this.gameScene.events.off('healthChanged', this.updateHealthText, this)
      this.gameScene.events.off('stageCleared', this.handleStageCleared, this)
      this.gameScene.events.off('gameOver', this.handleGameOver, this)
    })
  }

  private updateScoreText(score: number) {
    this.scoreText.setText(`사귄 일수: ${score}일`)
  }

  private updatePickupText(pickupCount: number) {
    this.pickupText.setText(`x ${pickupCount}`)
  }

  private updateHealthText(health: number) {
    this.healthIcons.forEach((icon) => icon.destroy())
    this.healthIcons = []

    for (let i = 0; i < health; i++) {
      const x = 800 - HUD_SIDE_PADDING - i * (HEALTH_ICON_SIZE + HEALTH_ICON_GAP)
      const icon = this.add.image(x, 12 + HEALTH_ICON_SIZE / 2, TextureKeys.Life)
        .setDisplaySize(HEALTH_ICON_SIZE, HEALTH_ICON_SIZE)
        .setOrigin(1, 0.5)
      this.healthIcons.push(icon)
    }
  }

  private updateStageText() {
    this.stageText.setText(`스테이지 ${this.gameScene.stageNumber}`)
    this.stageNameText.setText(this.gameScene.stageName)
  }

  private showStageIntro() {
    this.overlayBackground.setAlpha(OVERLAY_ALPHA_WELCOME).setVisible(true)
    this.overlayTitleText.setText(`Stage ${this.gameScene.stageNumber}`).setVisible(true)
    this.overlaySubtitleText.setText(`Welcome to "${this.gameScene.stageName}"`).setVisible(true)

    this.time.delayedCall(STAGE_INTRO_DURATION_MS, () => {
      this.overlayBackground.setVisible(false)
      this.overlayTitleText.setVisible(false)
      this.overlaySubtitleText.setVisible(false)
    })
  }

  private handleStageCleared(payload: StageClearedPayload) {
    this.overlayBackground.setAlpha(OVERLAY_ALPHA_DEFAULT).setVisible(true)
    this.overlayTitleText.setText(payload.isFinalStage ? '게임 클리어!' : '스테이지 완료!').setVisible(true)
    this.overlaySubtitleText.setText(`사귄 일수: ${this.gameScene.score}일`).setVisible(true)
  }

  private handleGameOver(finalScore: number) {
    this.overlayBackground.setAlpha(OVERLAY_ALPHA_DEFAULT).setVisible(true)
    this.overlayTitleText.setText('게임 오버').setVisible(true)
    this.overlaySubtitleText.setText(`사귄 일수: ${finalScore}일   —   스페이스를 눌러서 다시 시작`).setVisible(true)
  }

  private createDevBossButton() {
    const bossStageIndex = stages.findIndex((stage) => stage.isBossLevel)
    if (bossStageIndex === -1) {
      return
    }

    this.add.text(784, 588, '[DEV] Skip to Boss', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffcc00',
      backgroundColor: '#000000',
      padding: { x: 6, y: 4 },
    })
      .setOrigin(1, 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this.gameScene.scene.restart({ stageIndex: bossStageIndex, score: 0, playerHealth: 3 })
      })
  }

  private createDevStageJumpButton() {
    this.add.text(16, 588, '[DEV] Jump to Stage', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffcc00',
      backgroundColor: '#000000',
      padding: { x: 6, y: 4 },
    })
      .setOrigin(0, 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        const input = window.prompt(`Stage number (1-${stages.length}):`)
        if (input === null) {
          return
        }

        const stageNumber = Number(input)
        if (!Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > stages.length) {
          return
        }

        this.gameScene.scene.restart({ stageIndex: stageNumber - 1, score: 0, playerHealth: 3 })
      })
  }
}
