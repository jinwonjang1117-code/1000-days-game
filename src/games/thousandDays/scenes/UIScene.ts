import Phaser from 'phaser'
import { ThousandDaysScenes } from '../sceneKeys'
import GameScene from './GameScene'
import { stages } from '../config/stages'
import { TextureKeys } from '../config/textureKeys'
import { getDifficultySettings } from '../config/difficulty'

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

const WON_TEXT_PER_LETTER_DELAY_MS = 80
const WON_TEXT_FADE_DURATION_MS = 60
const WON_TEXT_ROW_GAP_MS = 500

const STAGE_INTRO_PER_LETTER_DELAY_MS = 90
const STAGE_INTRO_FADE_DURATION_MS = 70
const STAGE_INTRO_HOLD_MS = 800

const BOUNCING_ENEMY_MIN_SPEED = 120
const BOUNCING_ENEMY_MAX_SPEED = 200
const BOUNCING_ENEMY_CONFIGS: { key: string; width: number; height: number }[] = [
  { key: TextureKeys.Enemy, width: 40, height: 54 },
  { key: TextureKeys.Ghost, width: 48, height: 54 },
  { key: TextureKeys.Flyer, width: 70, height: 70 },
]

interface BouncingSprite {
  image: Phaser.GameObjects.Image
  vx: number
  vy: number
  halfWidth: number
  halfHeight: number
}

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
  private bouncingSprites: BouncingSprite[] = []
  private overlayBackground!: Phaser.GameObjects.Rectangle
  private overlayTitleText!: Phaser.GameObjects.Text
  private overlaySubtitleText!: Phaser.GameObjects.Text

  constructor() {
    super({ key: ThousandDaysScenes.UI })
  }

  create() {
    this.gameScene = this.scene.get(ThousandDaysScenes.Game) as GameScene

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
    this.gameScene.events.on('gameWon', this.handleGameWon, this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.gameScene.events.off('scoreChanged', this.updateScoreText, this)
      this.gameScene.events.off('pickupCountChanged', this.updatePickupText, this)
      this.gameScene.events.off('healthChanged', this.updateHealthText, this)
      this.gameScene.events.off('stageCleared', this.handleStageCleared, this)
      this.gameScene.events.off('gameOver', this.handleGameOver, this)
      this.gameScene.events.off('gameWon', this.handleGameWon, this)
    })
  }

  update(_time: number, delta: number) {
    if (this.bouncingSprites.length === 0) {
      return
    }

    const dt = delta / 1000
    for (const sprite of this.bouncingSprites) {
      sprite.image.x += sprite.vx * dt
      sprite.image.y += sprite.vy * dt

      if (sprite.image.x - sprite.halfWidth <= 0 || sprite.image.x + sprite.halfWidth >= 800) {
        sprite.vx *= -1
        sprite.image.x = Phaser.Math.Clamp(sprite.image.x, sprite.halfWidth, 800 - sprite.halfWidth)
      }
      if (sprite.image.y - sprite.halfHeight <= 0 || sprite.image.y + sprite.halfHeight >= 600) {
        sprite.vy *= -1
        sprite.image.y = Phaser.Math.Clamp(sprite.image.y, sprite.halfHeight, 600 - sprite.halfHeight)
      }
    }
  }

  private startBouncingEnemies() {
    BOUNCING_ENEMY_CONFIGS.forEach((config, i) => {
      const x = 250 + i * 150
      const y = 520
      const image = this.add.image(x, y, config.key).setDisplaySize(config.width, config.height)

      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const speed = Phaser.Math.Between(BOUNCING_ENEMY_MIN_SPEED, BOUNCING_ENEMY_MAX_SPEED)

      this.bouncingSprites.push({
        image,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        halfWidth: config.width / 2,
        halfHeight: config.height / 2,
      })
    })
  }

  private updateScoreText(_score: number) {
    // this.gameScene.score already includes the current stage's points once
    // it's been cleared (checkStageClear adds them before the scene restarts
    // and stageIndex advances), so only project them while still in progress
    // to avoid counting the same stage's points twice during that window.
    const projectedScore = this.gameScene.score + (this.gameScene.isStageCleared ? 0 : this.gameScene.stagePoints)
    this.scoreText.setText(`사귄 일수: ${projectedScore}일`)
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

    const introTextTiming = {
      perLetterDelay: STAGE_INTRO_PER_LETTER_DELAY_MS,
      fadeDuration: STAGE_INTRO_FADE_DURATION_MS,
    }

    const welcomeMessage = `Welcome to ${this.gameScene.stageName}`
    const { letters: welcomeLetters, completeAtMs: welcomeCompleteAtMs } =
      this.fadeInTextLeftToRight(welcomeMessage, 400, 330, HUD_TEXT_STYLE, introTextTiming)

    const projectedScore = this.gameScene.score + this.gameScene.stagePoints
    const { letters: scoreLetters, completeAtMs: scoreCompleteAtMs } = this.fadeInTextLeftToRight(
      `D+${projectedScore}`,
      400,
      370,
      HUD_TEXT_STYLE,
      { ...introTextTiming, startDelay: welcomeCompleteAtMs },
    )

    // Tied to when the text actually finishes animating (plus a hold), not
    // just a rough length-based estimate, so there's always a beat to read
    // both lines before they vanish.
    this.time.delayedCall(scoreCompleteAtMs + STAGE_INTRO_HOLD_MS, () => {
      this.overlayBackground.setVisible(false)
      this.overlayTitleText.setVisible(false)
      welcomeLetters.forEach((letter) => letter.destroy())
      scoreLetters.forEach((letter) => letter.destroy())
    })
  }

  private fadeInTextLeftToRight(
    message: string,
    centerX: number,
    y: number,
    style: Phaser.Types.GameObjects.Text.TextStyle,
    options: { startDelay?: number; perLetterDelay?: number; fadeDuration?: number } = {},
  ): { letters: Phaser.GameObjects.Text[]; completeAtMs: number } {
    const { startDelay = 0, perLetterDelay = 50, fadeDuration = 40 } = options

    const letters = message
      .split('')
      .map((char) => this.add.text(0, y, char, style).setOrigin(0.5, 0.5).setAlpha(0))

    const totalWidth = letters.reduce((sum, letter) => sum + letter.width, 0)
    let cursorX = centerX - totalWidth / 2
    letters.forEach((letter) => {
      letter.setX(cursorX + letter.width / 2)
      cursorX += letter.width
    })

    letters.forEach((letter, i) => {
      this.tweens.add({
        targets: letter,
        alpha: 1,
        duration: fadeDuration,
        delay: startDelay + i * perLetterDelay,
      })
    })

    const completeAtMs = startDelay + Math.max(0, letters.length - 1) * perLetterDelay + fadeDuration
    return { letters, completeAtMs }
  }

  private handleStageCleared(payload: StageClearedPayload) {
    this.overlayBackground.setAlpha(OVERLAY_ALPHA_DEFAULT).setVisible(true)
    this.overlayTitleText.setText(payload.isFinalStage ? '게임 클리어!' : '스테이지 완료!').setVisible(true)
    this.overlaySubtitleText.setText(`사귄 일수: ${this.gameScene.score}일`).setVisible(true)
  }

  private handleGameOver(finalScore: number) {
    this.overlayBackground.setAlpha(OVERLAY_ALPHA_DEFAULT).setVisible(true)
    this.overlayTitleText.setText('게임 오버').setVisible(true)
    this.overlaySubtitleText.setText(`사귄 일수: ${finalScore}일   —   스페이스를 눌러서 홈으로 돌아가기`).setVisible(true)
  }

  private handleGameWon(_finalScore: number) {
    this.overlayBackground.setAlpha(OVERLAY_ALPHA_DEFAULT).setVisible(true)
    this.overlayTitleText.setVisible(false)
    this.overlaySubtitleText.setVisible(false)

    const wonTextTiming = {
      perLetterDelay: WON_TEXT_PER_LETTER_DELAY_MS,
      fadeDuration: WON_TEXT_FADE_DURATION_MS,
    }

    const difficultySettings = getDifficultySettings()

    const title = this.fadeInTextLeftToRight(difficultySettings.winTitle, 400, 270, OVERLAY_TITLE_STYLE, wonTextTiming)
    const line1 = this.fadeInTextLeftToRight(difficultySettings.winLine1, 400, 330, HUD_TEXT_STYLE, {
      ...wonTextTiming,
      startDelay: title.completeAtMs + WON_TEXT_ROW_GAP_MS,
    })
    const line2 = this.fadeInTextLeftToRight(difficultySettings.winLine2, 400, 380, HUD_TEXT_STYLE, {
      ...wonTextTiming,
      startDelay: line1.completeAtMs + WON_TEXT_ROW_GAP_MS,
    })
    const pressSpaceLine = this.fadeInTextLeftToRight('스페이스를 눌러서 홈으로 돌아가기', 400, 480, HUD_TEXT_STYLE, {
      perLetterDelay: 0,
      fadeDuration: 0,
      startDelay: line2.completeAtMs + WON_TEXT_ROW_GAP_MS,
    })

    this.time.delayedCall(pressSpaceLine.completeAtMs, () => {
      this.startBouncingEnemies()
    })
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
        this.gameScene.scene.restart({ stageIndex: bossStageIndex, score: 0, playerHealth: getDifficultySettings().playerLives })
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

        this.gameScene.scene.restart({ stageIndex: stageNumber - 1, score: 0, playerHealth: getDifficultySettings().playerLives })
      })
  }
}
