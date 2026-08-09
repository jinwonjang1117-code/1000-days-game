import Phaser from 'phaser'
import GameScene from './GameScene'

const HUD_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '20px',
  color: '#ffffff',
}

const OVERLAY_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '40px',
  color: '#ffffff',
}

interface StageClearedPayload {
  isFinalStage: boolean
}

export default class UIScene extends Phaser.Scene {
  private gameScene!: GameScene
  private scoreText!: Phaser.GameObjects.Text
  private healthText!: Phaser.GameObjects.Text
  private stageText!: Phaser.GameObjects.Text
  private overlayBackground!: Phaser.GameObjects.Rectangle
  private overlayTitleText!: Phaser.GameObjects.Text
  private overlaySubtitleText!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'UIScene' })
  }

  create() {
    this.gameScene = this.scene.get('GameScene') as GameScene

    this.scoreText = this.add.text(16, 12, '', HUD_TEXT_STYLE)
    this.healthText = this.add.text(784, 12, '', HUD_TEXT_STYLE).setOrigin(1, 0)
    this.stageText = this.add.text(400, 12, '', HUD_TEXT_STYLE).setOrigin(0.5, 0)

    this.overlayBackground = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.6).setVisible(false)
    this.overlayTitleText = this.add.text(400, 270, '', OVERLAY_TITLE_STYLE).setOrigin(0.5).setVisible(false)
    this.overlaySubtitleText = this.add.text(400, 330, '', HUD_TEXT_STYLE).setOrigin(0.5).setVisible(false)

    this.updateScoreText(this.gameScene.score)
    this.updateHealthText(this.gameScene.playerHealth)
    this.updateStageText()

    this.gameScene.events.on('scoreChanged', this.updateScoreText, this)
    this.gameScene.events.on('healthChanged', this.updateHealthText, this)
    this.gameScene.events.on('stageCleared', this.handleStageCleared, this)
    this.gameScene.events.on('gameOver', this.handleGameOver, this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.gameScene.events.off('scoreChanged', this.updateScoreText, this)
      this.gameScene.events.off('healthChanged', this.updateHealthText, this)
      this.gameScene.events.off('stageCleared', this.handleStageCleared, this)
      this.gameScene.events.off('gameOver', this.handleGameOver, this)
    })
  }

  private updateScoreText(score: number) {
    this.scoreText.setText(`점수: ${score}`)
  }

  private updateHealthText(health: number) {
    this.healthText.setText(`목숨: ${health}`)
  }

  private updateStageText() {
    this.stageText.setText(`스테이지 ${this.gameScene.stageNumber}/${this.gameScene.stageCount}`)
  }

  private handleStageCleared(payload: StageClearedPayload) {
    this.overlayBackground.setVisible(true)
    this.overlayTitleText.setText(payload.isFinalStage ? '게임 클리어!' : '스테이지 완료!').setVisible(true)
    this.overlaySubtitleText.setText(`Score: ${this.gameScene.score}`).setVisible(true)
  }

  private handleGameOver(finalScore: number) {
    this.overlayBackground.setVisible(true)
    this.overlayTitleText.setText('게임 오버').setVisible(true)
    this.overlaySubtitleText.setText(`점수: ${finalScore}   —   스페이스를 눌러서 다시 시작`).setVisible(true)
  }
}
