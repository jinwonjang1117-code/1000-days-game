import Phaser from 'phaser'
import { TOGGLE_BUTTON_STYLE, createAudioToggleButtons } from '../../../ui/audioToggles'
import type { RoomUiState } from '../simulation/GameSimulation'
import { WORLD_WIDTH, WORLD_HEIGHT, DOOR_ZONES, BOSS_HOLE_CENTER, BOSS_HOLE_RADIUS } from '../simulation/GameSimulation'
import type { Direction } from '../rooms/floorLayout'
import { ALL_DIRECTIONS } from '../rooms/floorLayout'
import type { ItemId } from '../gameplay/items'
import { getItemLabel, BOOST_ITEM_IDS, STRONG_ITEM_IDS, STAT_ITEMS } from '../gameplay/items'
import MiniMap from './MiniMap'

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

const GAME_OVER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '48px',
  color: '#ff3333',
  backgroundColor: '#000000c0',
  padding: { x: 24, y: 16 },
}

const RESUME_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '20px',
  color: '#000000',
  backgroundColor: '#ffcc00',
  padding: { x: 20, y: 10 },
}

const DEV_GROUP_TITLE_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffffff',
}

const DEV_ITEM_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '13px',
  color: '#ffffff',
}

const LEVEL_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffcc66',
}

const PAUSE_BACKDROP_ALPHA = 0.6
const DOOR_OPEN_COLOR = 0x33cc55
const DOOR_CLOSED_COLOR = 0x663333
const BOSS_HOLE_COLOR = 0x110022
const MINI_MAP_MARGIN = 16

export interface GameplayHudOptions {
  scene: Phaser.Scene
  title: string
  subtitle: string
  onReturnToHub: () => void
  onRequestPause: () => void
  /** Provide to show the dev give-item menu (host/solo only) — gated on import.meta.env.DEV internally, not per call site. */
  onGiveItem?: (itemId: ItemId) => void
}

/**
 * The presentation layer shared by both `PlayScene.ts` (single-player)
 * and `DevTestScene.ts` (co-op, both roles) — doors, boss-hole, minimap,
 * level text, game-over text, and the pause menu (incl. dev item-menu).
 * Driven entirely by `RoomUiState`, so it doesn't know or care whether
 * it's reading a live `GameSimulation` (solo/host) or a joiner's
 * received-and-mirrored render-only state — both satisfy the same shape.
 *
 * Deliberately NOT here: the co-op host/joiner legend text (doesn't apply
 * to single-player) and the game-over Space-to-hub shortcut (input
 * handling, stays in each scene's own `update()`).
 */
export default class GameplayHud {
  private readonly scene: Phaser.Scene
  private readonly onRequestPause: () => void
  private readonly onGiveItem?: (itemId: ItemId) => void

  private readonly sharedUiObjects: Phaser.GameObjects.GameObject[] = []
  private readonly doorGraphics: Partial<Record<Direction, Phaser.GameObjects.Rectangle>> = {}
  private readonly bossHoleGraphic: Phaser.GameObjects.Arc
  private readonly miniMap: MiniMap
  private readonly levelText: Phaser.GameObjects.Text
  private gameOverText?: Phaser.GameObjects.Text
  private pauseMenuObjects: Phaser.GameObjects.GameObject[] = []
  private lastRenderedLevel = 0

  constructor(options: GameplayHudOptions) {
    this.scene = options.scene
    this.onRequestPause = options.onRequestPause
    this.onGiveItem = options.onGiveItem

    this.sharedUiObjects.push(
      this.scene.add.text(400, 40, options.title, TITLE_STYLE).setOrigin(0.5),
      this.scene.add.text(400, 74, options.subtitle, STATUS_STYLE).setOrigin(0.5),
      this.scene.add
        .text(16, 588, '← 게임 허브', TOGGLE_BUTTON_STYLE)
        .setOrigin(0, 1)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => options.onReturnToHub()),
    )

    for (const direction of ALL_DIRECTIONS) {
      const zone = DOOR_ZONES[direction]
      this.doorGraphics[direction] = this.scene.add.rectangle(
        zone.x + zone.width / 2,
        zone.y + zone.height / 2,
        zone.width,
        zone.height,
        DOOR_CLOSED_COLOR,
      )
    }
    this.bossHoleGraphic = this.scene.add
      .circle(BOSS_HOLE_CENTER.x, BOSS_HOLE_CENTER.y, BOSS_HOLE_RADIUS, BOSS_HOLE_COLOR)
      .setVisible(false)

    this.miniMap = new MiniMap(this.scene, WORLD_WIDTH - MINI_MAP_MARGIN, MINI_MAP_MARGIN)
    this.levelText = this.scene.add
      .text(WORLD_WIDTH - MINI_MAP_MARGIN, WORLD_HEIGHT, '', LEVEL_TEXT_STYLE)
      .setOrigin(1, 1)
      .setDepth(150)
    this.sharedUiObjects.push(this.levelText)
  }

  /** Call once per tick (host/solo: every frame) or once per received message (joiner) — redraws doors, refreshes the minimap/level text, and shows the game-over text once state.isGameOver. */
  refresh(state: RoomUiState) {
    const clear = state.isRoomClear()

    if (state.isCurrentRoomBoss()) {
      Object.values(this.doorGraphics).forEach((rect) => rect?.setVisible(false))
      this.bossHoleGraphic.setVisible(clear)
    } else {
      this.bossHoleGraphic.setVisible(false)
      for (const direction of ALL_DIRECTIONS) {
        const rect = this.doorGraphics[direction]
        if (!rect) {
          continue
        }
        rect.setVisible(state.isDirectionOpen(direction))
        rect.setFillStyle(clear ? DOOR_OPEN_COLOR : DOOR_CLOSED_COLOR)
      }
    }

    if (state.currentLevel !== this.lastRenderedLevel) {
      this.lastRenderedLevel = state.currentLevel
      this.miniMap.setFloor(state.floorRoomEntries, state.currentRoomCoord)
      this.levelText.setText(`레벨 ${state.currentLevel}`)
    }
    this.miniMap.refresh(state.exploredRooms, state.currentRoomCoord)

    if (state.isGameOver) {
      this.showGameOver()
    }
  }

  private showGameOver() {
    if (this.gameOverText) {
      return
    }
    this.gameOverText = this.scene.add.text(400, 300, '게임 오버', GAME_OVER_STYLE).setOrigin(0.5).setDepth(100)
  }

  showPauseMenu() {
    if (this.pauseMenuObjects.length > 0) {
      return
    }

    const backdrop = this.scene.add.rectangle(400, 300, 800, 600, 0x000000, PAUSE_BACKDROP_ALPHA).setDepth(200)
    const title = this.scene.add.text(400, 220, '일시정지', TITLE_STYLE).setOrigin(0.5).setDepth(200)
    const resumeButton = this.scene.add
      .text(400, 280, '계속하기 (ESC)', RESUME_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(200)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onRequestPause())
    const { musicButton, sfxButton } = createAudioToggleButtons(this.scene, { x: 400, y: 340, originX: 0.5 })
    musicButton.setDepth(200)
    sfxButton.setDepth(200)

    this.pauseMenuObjects = [backdrop, title, resumeButton, musicButton, sfxButton]

    // Dev-only: quick give-item buttons, for testing item effects without earning the drop.
    if (import.meta.env.DEV && this.onGiveItem) {
      const onGiveItem = this.onGiveItem
      const devTitle = this.scene.add
        .text(400, 400, 'DEV: Give Items', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' })
        .setOrigin(0.5)
        .setDepth(210)
      this.pauseMenuObjects.push(devTitle)

      const boostBg = this.scene.add.rectangle(240, 500, 320, 160, 0x222233, 0.6).setDepth(205)
      const strongBg = this.scene.add.rectangle(560, 500, 320, 160, 0x332222, 0.6).setDepth(205)
      this.pauseMenuObjects.push(boostBg, strongBg)

      const boostTitle = this.scene.add.text(240, 450, 'Boosts', DEV_GROUP_TITLE_STYLE).setOrigin(0.5).setDepth(210)
      const strongTitle = this.scene.add.text(560, 450, 'Strong Items', DEV_GROUP_TITLE_STYLE).setOrigin(0.5).setDepth(210)
      this.pauseMenuObjects.push(boostTitle, strongTitle)

      let idx = 0
      for (const id of BOOST_ITEM_IDS) {
        const col = idx % 2
        const row = Math.floor(idx / 2)
        const x = 240 + (col === 0 ? -80 : 80)
        const y = 480 + row * 28
        const sw = this.scene.add.rectangle(x - 80, y, 14, 14, STAT_ITEMS[id].color).setDepth(210)
        const btn = this.scene.add
          .text(x - 54, y, getItemLabel(id), DEV_ITEM_TEXT_STYLE)
          .setOrigin(0, 0.5)
          .setDepth(210)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => onGiveItem(id))
        this.pauseMenuObjects.push(sw, btn)
        idx++
      }

      let sidx = 0
      for (const id of STRONG_ITEM_IDS) {
        const col = sidx % 2
        const row = Math.floor(sidx / 2)
        const x = 560 + (col === 0 ? -80 : 80)
        const y = 480 + row * 28
        const sw = this.scene.add.rectangle(x - 80, y, 14, 14, STAT_ITEMS[id].color).setDepth(210)
        const btn = this.scene.add
          .text(x - 54, y, getItemLabel(id), DEV_ITEM_TEXT_STYLE)
          .setOrigin(0, 0.5)
          .setDepth(210)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => onGiveItem(id))
        this.pauseMenuObjects.push(sw, btn)
        sidx++
      }
    }
  }

  hidePauseMenu() {
    this.pauseMenuObjects.forEach((object) => object.destroy())
    this.pauseMenuObjects = []
  }

  destroy() {
    // this.levelText is already in sharedUiObjects — not destroyed again here.
    this.sharedUiObjects.forEach((object) => object.destroy())
    Object.values(this.doorGraphics).forEach((rect) => rect?.destroy())
    this.bossHoleGraphic.destroy()
    this.miniMap.destroy()
    this.gameOverText?.destroy()
    this.hidePauseMenu()
  }
}
