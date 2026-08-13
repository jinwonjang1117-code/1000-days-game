import Phaser from 'phaser'
import { ThousandDaysScenes } from '../sceneKeys'
import { CoreScenes } from '../../../config/sceneKeys'
import { TextureKeys } from '../config/textureKeys'
import { AudioKeys } from '../config/audioKeys'
import { playBgm, START_BGM_VOLUME } from '../../../config/audio'
import { getDifficulty, setDifficulty, getDifficultySettings } from '../config/difficulty'
import { CHARACTERS, getSelectedCharacterId, setSelectedCharacterId } from '../config/characters'
import type { CharacterDefinition } from '../config/characters'
import { createAudioToggleButtons, TOGGLE_BUTTON_STYLE } from '../../../ui/audioToggles'
import { navigateToHub } from '../../../router'

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '44px',
  color: '#ffffff',
}

const INSTRUCTIONS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#cccccc',
}

const SECTION_HEADER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '20px',
  color: '#ffcc00',
}

const BODY_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffffff',
}

const HIGHLIGHT_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffcc00',
}

const START_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '26px',
  color: '#000000',
  backgroundColor: '#ffcc00',
  padding: { x: 28, y: 12 },
}

const DIFFICULTY_BUTTON_SELECTED_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#000000',
  backgroundColor: '#ffcc00',
  padding: { x: 16, y: 8 },
}

const DIFFICULTY_BUTTON_UNSELECTED_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffffff',
  backgroundColor: '#00000080',
  padding: { x: 16, y: 8 },
}

const CONTROLS = ['← →  :  이동', '↑  :  점프', 'Space (길게)  :  흡입/흡수', 'Space (짧게)  :  공격 발사']

const LEFT_COLUMN_X = 220
const RIGHT_COLUMN_X = 580
const CHARACTER_BOX_Y = 280
const CHARACTER_BOX_SIZE = 150
const CHARACTER_DISPLAY_WIDTH = 70
const CHARACTER_DISPLAY_HEIGHT = 130
const CHARACTER_FRAME_CYCLE_MS = 500
const CHARACTER_OPTION_X_POSITIONS = [250, 550]

const WALKING_ENEMY_MIN_SPEED = 60
const WALKING_ENEMY_MAX_SPEED = 100
const WALKING_ENEMY_WIDTH = 40
const WALKING_ENEMY_HEIGHT = 54
const WALKING_ENEMY_Y = 575

type StartScreenStep = 'instructions' | 'characterSelect'

interface WalkingSprite {
  image: Phaser.GameObjects.Image
  vx: number
  halfWidth: number
}

export default class StartScene extends Phaser.Scene {
  private currentStep: StartScreenStep = 'instructions'
  private stepObjects: Phaser.GameObjects.GameObject[] = []
  private characterCycleTimers: Phaser.Time.TimerEvent[] = []
  private walkingEnemy?: WalkingSprite

  constructor() {
    super({ key: ThousandDaysScenes.Start })
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e')
    playBgm(this, AudioKeys.StartBgm, START_BGM_VOLUME)
    createAudioToggleButtons(this)

    this.input.keyboard!.on('keydown-ENTER', () => this.handleAdvance())
    this.input.keyboard!.on('keydown-SPACE', () => this.handleAdvance())

    this.showInstructionsStep()
  }

  update(_time: number, delta: number) {
    if (!this.walkingEnemy) {
      return
    }

    const enemy = this.walkingEnemy
    const dt = delta / 1000
    enemy.image.x += enemy.vx * dt

    if (enemy.image.x - enemy.halfWidth <= 0 || enemy.image.x + enemy.halfWidth >= 800) {
      enemy.vx *= -1
      enemy.image.x = Phaser.Math.Clamp(enemy.image.x, enemy.halfWidth, 800 - enemy.halfWidth)
    }

    enemy.image.setFlipX(enemy.vx < 0)
  }

  private spawnWalkingEnemy() {
    const image = this.addStepObject(
      this.add
        .image(100, WALKING_ENEMY_Y, TextureKeys.Enemy)
        .setDisplaySize(WALKING_ENEMY_WIDTH, WALKING_ENEMY_HEIGHT),
    )

    const speed = Phaser.Math.Between(WALKING_ENEMY_MIN_SPEED, WALKING_ENEMY_MAX_SPEED)

    this.walkingEnemy = {
      image,
      vx: speed,
      halfWidth: WALKING_ENEMY_WIDTH / 2,
    }
  }

  private handleAdvance() {
    if (this.currentStep === 'instructions') {
      this.showCharacterSelectStep()
    } else {
      this.startGame()
    }
  }

  private addStepObject<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.stepObjects.push(object)
    return object
  }

  private clearStepObjects() {
    this.stepObjects.forEach((object) => object.destroy())
    this.stepObjects = []
    this.characterCycleTimers.forEach((timer) => timer.remove())
    this.characterCycleTimers = []
    this.walkingEnemy = undefined
  }

  private showInstructionsStep() {
    this.clearStepObjects()
    this.currentStep = 'instructions'

    this.addStepObject(this.add.text(400, 100, '1000일의 모험', TITLE_STYLE).setOrigin(0.5))
    this.addStepObject(
      this.add.text(400, 150, '미니언을 처치하고, 스테이지를 클리어해서 1000일에 도달하세요!', INSTRUCTIONS_STYLE).setOrigin(0.5),
    )

    this.addStepObject(this.add.text(LEFT_COLUMN_X, 200, '조작법', SECTION_HEADER_STYLE).setOrigin(0.5, 0))
    CONTROLS.forEach((line, i) => {
      this.addStepObject(this.add.text(LEFT_COLUMN_X, 240 + i * 30, line, BODY_TEXT_STYLE).setOrigin(0.5, 0))
    })

    this.addStepObject(this.add.text(RIGHT_COLUMN_X, 200, '아이템', SECTION_HEADER_STYLE).setOrigin(0.5, 0))
    this.addStepObject(this.add.image(RIGHT_COLUMN_X, 260, TextureKeys.Gem).setDisplaySize(44, 44))
    this.addStepObject(
      this.add
        .text(RIGHT_COLUMN_X, 300, '초코우유 획득 시 이동 속도가 빨라집니다', BODY_TEXT_STYLE)
        .setOrigin(0.5, 0)
        .setAlign('center'),
    )

    this.addStepObject(this.add.text(400, 380, '난이도', SECTION_HEADER_STYLE).setOrigin(0.5, 0))

    const lowDifficultyButton = this.addStepObject(
      this.add
        .text(360, 435, '하', DIFFICULTY_BUTTON_UNSELECTED_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          setDifficulty('low')
          updateDifficultyButtonStyles()
        }),
    )

    const highDifficultyButton = this.addStepObject(
      this.add
        .text(440, 435, '상', DIFFICULTY_BUTTON_UNSELECTED_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          setDifficulty('high')
          updateDifficultyButtonStyles()
        }),
    )

    const updateDifficultyButtonStyles = () => {
      const difficulty = getDifficulty()
      lowDifficultyButton.setStyle(difficulty === 'low' ? DIFFICULTY_BUTTON_SELECTED_STYLE : DIFFICULTY_BUTTON_UNSELECTED_STYLE)
      highDifficultyButton.setStyle(difficulty === 'high' ? DIFFICULTY_BUTTON_SELECTED_STYLE : DIFFICULTY_BUTTON_UNSELECTED_STYLE)
    }
    updateDifficultyButtonStyles()

    this.addStepObject(
      this.add.text(400, 485, '난이도에 따라 승리 시 상품이 달라집니다', INSTRUCTIONS_STYLE).setOrigin(0.5),
    )

    this.addStepObject(
      this.add
        .text(400, 540, '다음', START_BUTTON_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.showCharacterSelectStep()),
    )

    this.addStepObject(
      this.add
        .text(16, 588, '← 게임 허브', TOGGLE_BUTTON_STYLE)
        .setOrigin(0, 1)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          navigateToHub()
          this.scene.start(CoreScenes.MainMenu)
        }),
    )

    this.spawnWalkingEnemy()
  }

  private showCharacterSelectStep() {
    this.clearStepObjects()
    this.currentStep = 'characterSelect'

    this.addStepObject(this.add.text(400, 100, '캐릭터를 선택하세요', TITLE_STYLE).setOrigin(0.5))

    const options: { character: CharacterDefinition; border: Phaser.GameObjects.Rectangle; selectedLabel: Phaser.GameObjects.Text }[] = []

    const applySelection = (id: string) => {
      options.forEach((option) => {
        const isSelected = option.character.id === id
        option.border.setStrokeStyle(isSelected ? 3 : 0, 0xffcc00)
        option.selectedLabel.setVisible(isSelected)
      })
    }

    CHARACTERS.forEach((character, index) => {
      const x = CHARACTER_OPTION_X_POSITIONS[index]

      this.addStepObject(this.add.text(x, 180, character.name, BODY_TEXT_STYLE).setOrigin(0.5, 0))

      const border = this.addStepObject(this.add.rectangle(x, CHARACTER_BOX_Y, CHARACTER_BOX_SIZE, CHARACTER_BOX_SIZE))

      const image = this.addStepObject(
        this.add
          .image(x, CHARACTER_BOX_Y, character.normalTexture)
          .setDisplaySize(CHARACTER_DISPLAY_WIDTH, CHARACTER_DISPLAY_HEIGHT),
      )

      const frames = [character.normalTexture, character.inhalingTexture, character.fullTexture]
      let frameIndex = 0
      this.characterCycleTimers.push(
        this.time.addEvent({
          delay: CHARACTER_FRAME_CYCLE_MS,
          loop: true,
          callback: () => {
            frameIndex = (frameIndex + 1) % frames.length
            image.setTexture(frames[frameIndex]).setDisplaySize(CHARACTER_DISPLAY_WIDTH, CHARACTER_DISPLAY_HEIGHT)
          },
        }),
      )

      this.addStepObject(
        this.add
          .text(x, CHARACTER_BOX_Y + CHARACTER_BOX_SIZE / 2 + 16, character.subtitle, BODY_TEXT_STYLE)
          .setOrigin(0.5, 0)
          .setWordWrapWidth(190, true),
      )

      const selectedLabel = this.addStepObject(
        this.add
          .text(x, CHARACTER_BOX_Y + CHARACTER_BOX_SIZE / 2 + 76, '선택됨', HIGHLIGHT_TEXT_STYLE)
          .setOrigin(0.5, 0)
          .setVisible(character.id === getSelectedCharacterId()),
      )

      options.push({ character, border, selectedLabel })

      if (character.id === getSelectedCharacterId()) {
        border.setStrokeStyle(3, 0xffcc00)
      }

      border
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => {
          if (character.id !== getSelectedCharacterId()) {
            border.setStrokeStyle(3, 0x666666)
          }
        })
        .on('pointerout', () => {
          if (character.id !== getSelectedCharacterId()) {
            border.setStrokeStyle(0)
          }
        })
        .on('pointerdown', () => {
          setSelectedCharacterId(character.id)
          applySelection(character.id)
          this.selectCharacter(border)
        })
    })

    this.addStepObject(
      this.add
        .text(16, 588, '← 뒤로', TOGGLE_BUTTON_STYLE)
        .setOrigin(0, 1)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.showInstructionsStep()),
    )

    this.addStepObject(
      this.add
        .text(400, 540, '게임 시작', START_BUTTON_STYLE)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.startGame()),
    )
  }

  private selectCharacter(border: Phaser.GameObjects.Rectangle) {
    this.tweens.add({
      targets: border,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 90,
      yoyo: true,
    })
  }

  private startGame() {
    this.scene.start(ThousandDaysScenes.Game, {
      stageIndex: 0,
      score: 0,
      playerHealth: getDifficultySettings().playerLives,
      speedBonus: 0,
      pickupCount: 0,
    })
  }
}
