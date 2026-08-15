import Phaser from 'phaser'
import { TOGGLE_BUTTON_STYLE, createAudioToggleButtons } from '../../../ui/audioToggles'
import type { RoomUiState } from '../simulation/GameSimulation'
import { WORLD_WIDTH, WORLD_HEIGHT, DOOR_ZONES, BOSS_HOLE_CENTER, BOSS_HOLE_RADIUS } from '../simulation/GameSimulation'
import type { Direction } from '../rooms/floorLayout'
import { ALL_DIRECTIONS, getNeighborCoord, getRoomDefinition } from '../rooms/floorLayout'
import type { BoostItemId, ItemId, StrongItemId } from '../gameplay/items'
import { BOOST_ITEM_IDS, STRONG_ITEM_IDS, STAT_ITEMS } from '../gameplay/items'
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

/** Dev menu shows raw item ids (e.g. "multiDirection"), not the long localized labels — much shorter, and the id is what you'd want to search the codebase for anyway. */
const DEV_ITEM_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '12px',
  color: '#ffffff',
}

const LEVEL_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffcc66',
}

/** Own hearts (top-left) — full size, this is "your" life total. */
const OWN_HEARTS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '24px',
}

/** Partner's hearts (top-right, above the minimap) — smaller, it's secondary at-a-glance info. */
const PARTNER_HEARTS_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
}

const FILLED_HEART = '❤️'
const EMPTY_HEART = '🤍'

const PAUSE_BACKDROP_ALPHA = 0.6
const DOOR_OPEN_COLOR = 0x33cc55
const DOOR_CLOSED_COLOR = 0x663333
/** Matches MiniMap.ts's GOLDEN_COLOR/BOSS_COLOR — a door leading to one of these rooms is tinted the same way the minimap already reveals it, open or not. */
const GOLDEN_DOOR_OPEN_COLOR = 0xffcc00
const GOLDEN_DOOR_CLOSED_COLOR = 0x665200
const BOSS_DOOR_OPEN_COLOR = 0xdd2222
const BOSS_DOOR_CLOSED_COLOR = 0x551111
const BOSS_HOLE_COLOR = 0x110022
const MINI_MAP_MARGIN = 16
const HEARTS_MARGIN = 16
/** Vertical space reserved for the partner-hearts row above the minimap — the minimap itself is pushed down by this much. */
const PARTNER_HEARTS_ROW_HEIGHT = 26

/** One filled heart per current life, one empty heart per remaining container up to the cap — e.g. 3/5 renders ❤️❤️❤️🤍🤍. */
function heartRow(lives: number, maxLives: number): string {
  const filled = Math.max(0, Math.min(lives, maxLives))
  const empty = Math.max(0, maxLives - filled)
  return FILLED_HEART.repeat(filled) + EMPTY_HEART.repeat(empty)
}

/** Golden/boss destinations get their own tint (matching the minimap's colors) even before the current room is cleared — same "reveal as soon as known" spirit the minimap already uses for adjacent rooms, just applied to the door itself. */
function doorColorFor(neighbor: { isBoss: boolean; isGolden: boolean } | undefined, roomClear: boolean): number {
  if (neighbor?.isBoss) {
    return roomClear ? BOSS_DOOR_OPEN_COLOR : BOSS_DOOR_CLOSED_COLOR
  }
  if (neighbor?.isGolden) {
    return roomClear ? GOLDEN_DOOR_OPEN_COLOR : GOLDEN_DOOR_CLOSED_COLOR
  }
  return roomClear ? DOOR_OPEN_COLOR : DOOR_CLOSED_COLOR
}

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
  private readonly ownHeartsText: Phaser.GameObjects.Text
  private readonly partnerHeartsText: Phaser.GameObjects.Text
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

    // Minimap is pushed down to leave room for the partner-hearts row above it.
    this.miniMap = new MiniMap(this.scene, WORLD_WIDTH - MINI_MAP_MARGIN, MINI_MAP_MARGIN + PARTNER_HEARTS_ROW_HEIGHT)
    this.levelText = this.scene.add
      .text(WORLD_WIDTH - MINI_MAP_MARGIN, WORLD_HEIGHT, '', LEVEL_TEXT_STYLE)
      .setOrigin(1, 1)
      .setDepth(150)
    this.ownHeartsText = this.scene.add.text(HEARTS_MARGIN, HEARTS_MARGIN, '', OWN_HEARTS_STYLE).setOrigin(0, 0).setDepth(150)
    this.partnerHeartsText = this.scene.add
      .text(WORLD_WIDTH - MINI_MAP_MARGIN, MINI_MAP_MARGIN, '', PARTNER_HEARTS_STYLE)
      .setOrigin(1, 0)
      .setDepth(150)
    this.sharedUiObjects.push(this.levelText, this.ownHeartsText, this.partnerHeartsText)
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
        const neighbor = getRoomDefinition(state.floorRoomEntries, getNeighborCoord(state.currentRoomCoord, direction))
        rect.setFillStyle(doorColorFor(neighbor, clear))
      }
    }

    if (state.currentLevel !== this.lastRenderedLevel) {
      this.lastRenderedLevel = state.currentLevel
      this.miniMap.setFloor(state.floorRoomEntries, state.currentRoomCoord)
      this.levelText.setText(`레벨 ${state.currentLevel}`)
    }
    this.miniMap.refresh(state.exploredRooms, state.currentRoomCoord)

    this.ownHeartsText.setText(heartRow(state.ownLives, state.ownMaxLives))
    this.partnerHeartsText.setText(state.partnerLives === null ? '' : heartRow(state.partnerLives, state.partnerMaxLives ?? 0))

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

      this.renderDevItemGroup(240, 'Boosts', BOOST_ITEM_IDS, 0x222233, onGiveItem)
      this.renderDevItemGroup(560, 'Strong Items', STRONG_ITEM_IDS, 0x332222, onGiveItem)
    }
  }

  /**
   * One dev give-item column, sized to however many ids it's given instead
   * of a fixed box — as the strong-item pool grows (8 and counting) a fixed
   * height either clips items or leaves the labels cramped. Shows each
   * item's raw id (e.g. "multiDirection") rather than its full localized
   * label — much shorter, and it's what you'd grep the codebase for anyway.
   */
  private renderDevItemGroup(
    centerX: number,
    title: string,
    ids: (BoostItemId | StrongItemId)[],
    bgColor: number,
    onGiveItem: (id: ItemId) => void,
  ) {
    const columns = 2
    const boxWidth = 320
    const rowHeight = 20
    const headerHeight = 34
    const boxTop = 410
    const rows = Math.max(1, Math.ceil(ids.length / columns))
    const boxHeight = headerHeight + rows * rowHeight
    const boxCenterY = boxTop + boxHeight / 2

    const bg = this.scene.add.rectangle(centerX, boxCenterY, boxWidth, boxHeight, bgColor, 0.6).setDepth(205)
    const groupTitle = this.scene.add.text(centerX, boxTop + 14, title, DEV_GROUP_TITLE_STYLE).setOrigin(0.5).setDepth(210)
    this.pauseMenuObjects.push(bg, groupTitle)

    const colWidth = boxWidth / columns
    ids.forEach((id, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      const colLeft = centerX - boxWidth / 2 + col * colWidth
      const x = colLeft + 12
      const y = boxTop + headerHeight + row * rowHeight + rowHeight / 2
      const sw = this.scene.add.rectangle(x, y, 10, 10, STAT_ITEMS[id].color).setDepth(210)
      const btn = this.scene.add
        .text(x + 10, y, id, DEV_ITEM_TEXT_STYLE)
        .setOrigin(0, 0.5)
        .setDepth(210)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => onGiveItem(id))
      this.pauseMenuObjects.push(sw, btn)
    })
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
