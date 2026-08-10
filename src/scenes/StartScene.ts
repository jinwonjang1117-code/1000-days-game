import Phaser from 'phaser'
import { TextureKeys } from '../config/textureKeys'
import { AudioKeys } from '../config/audioKeys'
import { playBgm, isBgmOn, setBgmEnabled, isSfxOn, setSfxEnabled } from '../config/audio'

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

const START_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '26px',
  color: '#000000',
  backgroundColor: '#ffcc00',
  padding: { x: 28, y: 12 },
}

const TOGGLE_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffffff',
  backgroundColor: '#00000080',
  padding: { x: 8, y: 4 },
}

const CONTROLS = ['← →  :  이동', '↑  :  점프', 'Space (길게)  :  흡입', 'Space (짧게)  :  흡입한 미니언 발사']

const LEFT_COLUMN_X = 220
const RIGHT_COLUMN_X = 580
const CHARACTER_BOX_Y = 260
const CHARACTER_BOX_SIZE = 150
const CHARACTER_DISPLAY_WIDTH = 70
const CHARACTER_DISPLAY_HEIGHT = 130

export default class StartScene extends Phaser.Scene {
  private musicToggleButton!: Phaser.GameObjects.Text
  private sfxToggleButton!: Phaser.GameObjects.Text

  constructor() {
    super({ key: 'StartScene' })
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e')
    playBgm(this, AudioKeys.StartBgm, 0.8)

    this.musicToggleButton = this.add.text(784, 12, '', TOGGLE_BUTTON_STYLE)
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        setBgmEnabled(!isBgmOn())
        this.updateMusicToggleButton()
      })
    this.updateMusicToggleButton()

    this.sfxToggleButton = this.add.text(784, 40, '', TOGGLE_BUTTON_STYLE)
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        setSfxEnabled(!isSfxOn())
        this.updateSfxToggleButton()
      })
    this.updateSfxToggleButton()

    this.add.text(400, 50, '1000일의 모험', TITLE_STYLE).setOrigin(0.5)
    this.add
      .text(400, 100, '미니언을 흡입해서 처치하고, 스테이지를 클리어하세요!', INSTRUCTIONS_STYLE)
      .setOrigin(0.5)

    this.add.text(LEFT_COLUMN_X, 150, '조작법', SECTION_HEADER_STYLE).setOrigin(0.5, 0)
    CONTROLS.forEach((line, i) => {
      this.add.text(LEFT_COLUMN_X, 190 + i * 30, line, BODY_TEXT_STYLE).setOrigin(0.5, 0)
    })

    this.add.text(RIGHT_COLUMN_X, 150, '캐릭터 선택', SECTION_HEADER_STYLE).setOrigin(0.5, 0)
    const characterBorder = this.add.rectangle(RIGHT_COLUMN_X, CHARACTER_BOX_Y, CHARACTER_BOX_SIZE, CHARACTER_BOX_SIZE)
    this.add
      .image(RIGHT_COLUMN_X, CHARACTER_BOX_Y, TextureKeys.Player)
      .setDisplaySize(CHARACTER_DISPLAY_WIDTH, CHARACTER_DISPLAY_HEIGHT)

    const selectedLabel = this.add
      .text(RIGHT_COLUMN_X, CHARACTER_BOX_Y + CHARACTER_BOX_SIZE / 2 + 44, '선택됨', BODY_TEXT_STYLE)
      .setOrigin(0.5, 0)
      .setVisible(false)

    let isCharacterSelected = false
    characterBorder
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => {
        if (!isCharacterSelected) {
          characterBorder.setStrokeStyle(3, 0x666666)
        }
      })
      .on('pointerout', () => {
        if (!isCharacterSelected) {
          characterBorder.setStrokeStyle(0)
        }
      })
      .on('pointerdown', () => {
        isCharacterSelected = true
        characterBorder.setStrokeStyle(3, 0xffcc00)
        selectedLabel.setVisible(true)
        this.selectCharacter(characterBorder)
      })

    this.add
      .text(RIGHT_COLUMN_X, CHARACTER_BOX_Y + CHARACTER_BOX_SIZE / 2 + 16, '지히 공주', BODY_TEXT_STYLE)
      .setOrigin(0.5, 0)

    this.add.text(LEFT_COLUMN_X, 330, '아이템', SECTION_HEADER_STYLE).setOrigin(0.5, 0)
    this.add.image(LEFT_COLUMN_X, 390, TextureKeys.Gem).setDisplaySize(44, 44)
    this.add
      .text(LEFT_COLUMN_X, 425, '초코우유 획득 시 이동 속도가 빨라집니다', BODY_TEXT_STYLE)
      .setOrigin(0.5, 0)

    this.add
      .text(400, 540, '게임 시작', START_BUTTON_STYLE)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.startGame())

    this.input.keyboard!.once('keydown-ENTER', () => this.startGame())
    this.input.keyboard!.once('keydown-SPACE', () => this.startGame())
  }

  private updateMusicToggleButton() {
    this.musicToggleButton.setText(`🎵 음악: ${isBgmOn() ? 'ON' : 'OFF'}`)
  }

  private updateSfxToggleButton() {
    this.sfxToggleButton.setText(`🔊 효과음: ${isSfxOn() ? 'ON' : 'OFF'}`)
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
    this.scene.start('GameScene', { stageIndex: 0, score: 0, playerHealth: 3, speedBonus: 0, pickupCount: 0 })
  }
}
