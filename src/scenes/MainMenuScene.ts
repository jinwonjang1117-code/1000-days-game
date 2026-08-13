import Phaser from 'phaser'
import { CoreScenes } from '../config/sceneKeys'
import { GAMES } from '../config/games'
import type { GameDefinition } from '../config/games'
import { playBgm } from '../config/audio'
import { createAudioToggleButtons } from '../ui/audioToggles'

const HOME_BGM_KEY = 'bgm-home'

const TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '40px',
  color: '#ffffff',
}

const SUBTITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#cccccc',
}

const CARD_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '18px',
  color: '#ffcc00',
}

const CARD_BODY_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '13px',
  color: '#ffffff',
  align: 'center',
}

const PLACEHOLDER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#666666',
}

const CARD_SLOT_COUNT = 3
const CARD_X_POSITIONS = [200, 400, 600]
const CARD_Y = 330
const CARD_WIDTH = 190
const CARD_HEIGHT = 240
const CARD_THUMBNAIL_WIDTH = 60
const CARD_THUMBNAIL_HEIGHT = 100

export default class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: CoreScenes.MainMenu })
  }

  // Only the hub's own card thumbnails and BGM — deliberately tiny. Each
  // game's real assets (and its own BGM) load later, once that game is
  // actually picked.
  preload() {
    GAMES.forEach((game) => {
      this.load.image(game.thumbnail.key, game.thumbnail.path)
    })
    this.load.audio(HOME_BGM_KEY, 'assets/bgm-home.mp3')
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e')
    // Returning here mid-game switches straight back to the hub's own BGM —
    // playBgm() takes care of stopping whatever game BGM was playing.
    playBgm(this, HOME_BGM_KEY)
    createAudioToggleButtons(this)

    this.add.text(400, 90, '진원이와 지희의 게임 허브', TITLE_STYLE).setOrigin(0.5)
    this.add.text(400, 140, '플레이할 게임을 선택하세요', SUBTITLE_STYLE).setOrigin(0.5)

    for (let slot = 0; slot < CARD_SLOT_COUNT; slot++) {
      const game = GAMES[slot]
      if (game) {
        this.createGameCard(CARD_X_POSITIONS[slot], game)
      } else {
        this.createPlaceholderCard(CARD_X_POSITIONS[slot])
      }
    }
  }

  private createGameCard(x: number, game: GameDefinition) {
    const border = this.add
      .rectangle(x, CARD_Y, CARD_WIDTH, CARD_HEIGHT)
      .setStrokeStyle(2, 0x666666)
      .setInteractive({ useHandCursor: true })

    this.add
      .image(x, CARD_Y - 55, game.thumbnail.key)
      .setDisplaySize(CARD_THUMBNAIL_WIDTH, CARD_THUMBNAIL_HEIGHT)

    this.add.text(x, CARD_Y + 15, game.title, CARD_TITLE_STYLE).setOrigin(0.5, 0)
    this.add.text(x, CARD_Y + 48, game.description, CARD_BODY_STYLE).setOrigin(0.5, 0)

    border
      .on('pointerover', () => border.setStrokeStyle(3, 0xffcc00))
      .on('pointerout', () => border.setStrokeStyle(2, 0x666666))
      .on('pointerdown', () => this.scene.start(CoreScenes.Preload, { gameId: game.id }))
  }

  private createPlaceholderCard(x: number) {
    this.add.rectangle(x, CARD_Y, CARD_WIDTH, CARD_HEIGHT).setStrokeStyle(2, 0x333333)
    this.add.text(x, CARD_Y, '준비 중', PLACEHOLDER_STYLE).setOrigin(0.5)
  }
}
