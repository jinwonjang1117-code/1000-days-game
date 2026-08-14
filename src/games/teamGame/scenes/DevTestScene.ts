import Phaser from 'phaser'
import type { DataConnection } from 'peerjs'
import { TeamGameScenes } from '../sceneKeys'
import { CoreScenes } from '../../../config/sceneKeys'
import { createAudioToggleButtons, TOGGLE_BUTTON_STYLE } from '../../../ui/audioToggles'
import { navigateToHub } from '../../../router'
import { getConnection, getRole, disconnectPeer } from '../net/peerConnection'
import type {
  KeyState,
  InputMessage,
  PauseToggleMessage,
  LevelStartMessage,
  StateMessage,
  ProjectileState,
  EnemyState,
  Vec2,
} from '../net/syncProtocol'
import { isInputMessage, isPauseToggleMessage, isLevelStartMessage, isStateMessage } from '../net/syncProtocol'
import Player from '../entities/Player'
import Projectile from '../entities/Projectile'
import Enemy from '../entities/Enemy'
import type { EnemyArchetype } from '../gameplay/enemyArchetypes'
import { ARCHETYPES } from '../gameplay/enemyArchetypes'
import type { Direction, RoomCoord, RoomDefinition } from '../rooms/floorLayout'
import { ALL_DIRECTIONS, getRoomDefinition, getNeighborCoord, hasNeighbor, oppositeDirection, coordsEqual } from '../rooms/floorLayout'
import type { GeneratedFloor } from '../rooms/floorGenerator'
import { generateFloor } from '../rooms/floorGenerator'
import type { MiniMapRoomInfo } from '../ui/MiniMap'
import MiniMap from '../ui/MiniMap'

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

const PAUSE_BACKDROP_ALPHA = 0.6

const MOVE_SPEED = 200
const BROADCAST_INTERVAL_MS = 50
// Joiner-side smoothing rate (per second) for easing toward the latest
// received position instead of snapping to it. Higher = snappier/more
// jitter-prone, lower = smoother/more lag behind the true position.
const INTERPOLATION_RATE = 12
const HOST_COLOR = 0x3355ff
const JOINER_COLOR = 0xff6633
const HOST_START = { x: 300, y: 320 }
const JOINER_START = { x: 500, y: 320 }
const EMPTY_KEYS: KeyState = { up: false, down: false, left: false, right: false }

const WORLD_WIDTH = 800
const WORLD_HEIGHT = 600
const DOOR_SIZE = 70
const DOOR_DEPTH = 24
const DOOR_OPEN_COLOR = 0x33cc55
const DOOR_CLOSED_COLOR = 0x663333
const ENTRY_MARGIN = 90
const PLAYER_ENTRY_OFFSET = 30
const ENEMY_SPAWN_CENTER = { x: 400, y: 200 }
const ENEMY_SPAWN_SPACING = 60
const ENEMY_PROJECTILE_COLOR = 0xff3366
const ENEMY_PROJECTILE_SPEED = 240
/** Splitter's children spread out a little instead of stacking exactly on the death spot. */
const SPLIT_SPAWN_OFFSET = 20

const ORIGIN_COORD: RoomCoord = { x: 0, y: 0 }
const MINI_MAP_MARGIN = 16
const LEVEL_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffcc66',
}

/** The boss room has no directional doors — clearing it reveals this instead, in the room's center. */
const BOSS_HOLE_CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }
const BOSS_HOLE_RADIUS = 36
const BOSS_HOLE_COLOR = 0x110022

interface DoorZone {
  x: number
  y: number
  width: number
  height: number
}

const DOOR_ZONES: Record<Direction, DoorZone> = {
  north: { x: WORLD_WIDTH / 2 - DOOR_SIZE / 2, y: 0, width: DOOR_SIZE, height: DOOR_DEPTH },
  south: { x: WORLD_WIDTH / 2 - DOOR_SIZE / 2, y: WORLD_HEIGHT - DOOR_DEPTH, width: DOOR_SIZE, height: DOOR_DEPTH },
  east: { x: WORLD_WIDTH - DOOR_DEPTH, y: WORLD_HEIGHT / 2 - DOOR_SIZE / 2, width: DOOR_DEPTH, height: DOOR_SIZE },
  west: { x: 0, y: WORLD_HEIGHT / 2 - DOOR_SIZE / 2, width: DOOR_DEPTH, height: DOOR_SIZE },
}

function isInsideZone(x: number, y: number, zone: DoorZone): boolean {
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height
}

function getEntryCenter(edge: Direction): { x: number; y: number } {
  switch (edge) {
    case 'north':
      return { x: WORLD_WIDTH / 2, y: ENTRY_MARGIN }
    case 'south':
      return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - ENTRY_MARGIN }
    case 'east':
      return { x: WORLD_WIDTH - ENTRY_MARGIN, y: WORLD_HEIGHT / 2 }
    case 'west':
      return { x: ENTRY_MARGIN, y: WORLD_HEIGHT / 2 }
  }
}

/** Two slightly-offset spawn points so both players don't land exactly on top of each other. */
function getEntryPositions(edge: Direction): [{ x: number; y: number }, { x: number; y: number }] {
  const center = getEntryCenter(edge)
  if (edge === 'north' || edge === 'south') {
    return [
      { x: center.x - PLAYER_ENTRY_OFFSET, y: center.y },
      { x: center.x + PLAYER_ENTRY_OFFSET, y: center.y },
    ]
  }
  return [
    { x: center.x, y: center.y - PLAYER_ENTRY_OFFSET },
    { x: center.x, y: center.y + PLAYER_ENTRY_OFFSET },
  ]
}

interface DevTestSceneData {
  solo?: boolean
}

function keysEqual(a: KeyState, b: KeyState): boolean {
  return a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right
}

/**
 * Host-authoritative gameplay prototype (was "SyncTestScene" — outgrew that
 * name a while ago). Host simulates both players, the current room's
 * enemies, and every projectile, broadcasting authoritative state at a
 * fixed rate; the joiner only ever sends input and renders whatever comes
 * back, eased toward the latest reported position — no local prediction.
 * "Solo" mode reuses the exact same host-simulated code path with no
 * connection and no joiner at all, for fast single-tab iteration (see
 * LobbyScene.ts's "솔로 테스트" button).
 *
 * Also prototypes the lives system (DESIGN.md §3), the default attack
 * (DESIGN.md §4 — arrow keys move, Space fires toward whichever direction
 * you're currently facing/last moved, no mouse involved), a networked
 * pause menu (DESIGN.md §2), and a small fixed room layout (rooms/floorLayout.ts)
 * with host-authoritative transitions: rooms hold a list of enemies
 * (entities/Enemy.ts) instead of just one, doors open once that list is
 * empty, and walking through an open door tears down the current room and
 * builds the next one for both players at once. Movement/life-state
 * bookkeeping lives in entities/Player.ts; projectile bookkeeping in
 * entities/Projectile.ts; enemy health/flash bookkeeping in
 * entities/Enemy.ts — none of it duplicated here per host/joiner.
 */
export default class DevTestScene extends Phaser.Scene {
  private role: 'host' | 'joiner' = 'host'
  private isSolo = false
  private connection: DataConnection | null = null
  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys
  private escKey!: Phaser.Input.Keyboard.Key

  private hostPlayer?: Player
  private joinerPlayer?: Player
  private gameOverText?: Phaser.GameObjects.Text
  private pauseMenuObjects: Phaser.GameObjects.GameObject[] = []
  private sharedUiObjects: Phaser.GameObjects.GameObject[] = []

  private roomEnemies: Map<number, Enemy> = new Map()
  private roomEnemyColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextEnemyId = 0
  private currentRoomCoord: RoomCoord = ORIGIN_COORD
  private doorGraphics: Partial<Record<Direction, Phaser.GameObjects.Rectangle>> = {}
  private bossHoleGraphic?: Phaser.GameObjects.Arc
  /** Host/solo-only: rooms whose enemies have already been cleared once — loadRoom skips (re)spawning enemies for these. */
  private clearedRooms: RoomCoord[] = []

  private currentLevel = 1
  /** Shared by host and joiner — drives hasNeighbor/door logic, boss-room lookup, and the minimap. Host populates it from `currentFloor`; joiner from the received LevelStartMessage. */
  private floorRoomEntries: MiniMapRoomInfo[] = []
  private exploredRooms: RoomCoord[] = []
  /** Host/solo-only — the full generated floor, including enemy compositions the joiner never needs locally. */
  private currentFloor?: GeneratedFloor
  private miniMap?: MiniMap
  private levelText?: Phaser.GameObjects.Text

  private projectiles: Map<number, Projectile> = new Map()
  private projectileColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextProjectileId = 0

  private enemyProjectiles: Map<number, Projectile> = new Map()
  private enemyProjectileColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextEnemyProjectileId = 0

  private isGameOver = false
  private isPaused = false
  /** Host-side: whether the joiner's fire key is currently held, per its last InputMessage. */
  private joinerFireHeld = false

  private lastSentKeys: KeyState = EMPTY_KEYS
  private lastSentFire = false
  private broadcastTimer?: Phaser.Time.TimerEvent
  private onData?: (data: unknown) => void
  private onClose?: () => void

  constructor() {
    super({ key: TeamGameScenes.DevTest })
  }

  create(data: DevTestSceneData) {
    this.cameras.main.setBackgroundColor('#1a1a2e')

    // Reset in case this scene instance is being re-entered (e.g. left and
    // re-hosted/re-joined/re-solo'd) — stale state from a prior session
    // would otherwise leak into a fresh one. Player instances are recreated
    // fresh in setupHost/setupJoiner/setupSolo below, so there's nothing to
    // reset for them specifically.
    this.isGameOver = false
    this.gameOverText?.destroy()
    this.gameOverText = undefined
    this.projectiles.forEach((projectile) => projectile.destroy())
    this.projectiles.clear()
    this.projectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.projectileColliders.clear()
    this.nextProjectileId = 0
    this.enemyProjectiles.forEach((projectile) => projectile.destroy())
    this.enemyProjectiles.clear()
    this.enemyProjectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.enemyProjectileColliders.clear()
    this.nextEnemyProjectileId = 0
    this.joinerFireHeld = false
    this.lastSentFire = false
    this.isPaused = false
    this.physics.resume()
    this.pauseMenuObjects.forEach((object) => object.destroy())
    this.pauseMenuObjects = []
    this.roomEnemyColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.roomEnemyColliders.clear()
    this.roomEnemies.forEach((enemy) => enemy.destroy())
    this.roomEnemies.clear()
    this.nextEnemyId = 0
    this.currentRoomCoord = ORIGIN_COORD
    Object.values(this.doorGraphics).forEach((rect) => rect?.destroy())
    this.doorGraphics = {}
    this.bossHoleGraphic?.destroy()
    this.bossHoleGraphic = undefined
    this.clearedRooms = []
    this.currentLevel = 1
    this.floorRoomEntries = []
    this.exploredRooms = []
    this.currentFloor = undefined
    this.miniMap?.destroy()
    this.miniMap = undefined
    this.sharedUiObjects.forEach((object) => object.destroy())
    this.sharedUiObjects = []
    this.isSolo = false

    this.cursorKeys = this.input.keyboard!.createCursorKeys()
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)

    this.sharedUiObjects.push(
      this.add.text(400, 40, '개발 테스트', TITLE_STYLE).setOrigin(0.5),
      this.add.text(400, 74, '화살표로 이동, 스페이스로 공격, ESC로 일시정지', STATUS_STYLE).setOrigin(0.5),
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
        }),
    )

    this.createDoorVisuals()
    this.miniMap = new MiniMap(this, WORLD_WIDTH - MINI_MAP_MARGIN, MINI_MAP_MARGIN)
    this.levelText = this.add
      .text(WORLD_WIDTH - MINI_MAP_MARGIN, WORLD_HEIGHT, '', LEVEL_TEXT_STYLE)
      .setOrigin(1, 1)
      .setDepth(150)
    this.sharedUiObjects.push(this.levelText)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.broadcastTimer?.remove()
      this.broadcastTimer = undefined
      if (this.connection && this.onData) {
        this.connection.off('data', this.onData)
      }
      this.connection = null
      this.hostPlayer?.destroy()
      this.joinerPlayer?.destroy()
      this.projectiles.forEach((projectile) => projectile.destroy())
      this.projectiles.clear()
      this.projectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
      this.projectileColliders.clear()
      this.enemyProjectiles.forEach((projectile) => projectile.destroy())
      this.enemyProjectiles.clear()
      this.enemyProjectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
      this.enemyProjectileColliders.clear()
      this.roomEnemyColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
      this.roomEnemyColliders.clear()
      this.roomEnemies.forEach((enemy) => enemy.destroy())
      this.roomEnemies.clear()
    })

    if (data?.solo) {
      this.isSolo = true
      this.role = 'host'
      this.setupSolo()
      return
    }

    const connection = getConnection()
    const role = getRole()

    // This scene is only ever reached right after a successful connect (or
    // with solo:true), so both should already be set — bail to the lobby if
    // that assumption ever breaks.
    if (!connection || !role) {
      this.scene.start(TeamGameScenes.Lobby)
      return
    }

    this.connection = connection
    this.role = role

    this.sharedUiObjects.push(
      this.add.text(250, 104, '호스트', { ...LEGEND_STYLE, color: '#6688ff' }).setOrigin(0.5),
      this.add.text(550, 104, '참가자', { ...LEGEND_STYLE, color: '#ff9966' }).setOrigin(0.5),
    )

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
  }

  update(_time: number, delta: number) {
    if (!this.isSolo && !this.connection) {
      return
    }

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.requestTogglePause()
    }

    if (this.isPaused) {
      return
    }

    if (this.role === 'joiner') {
      const t = 1 - Math.exp(-INTERPOLATION_RATE * (delta / 1000))
      this.hostPlayer?.interpolate(t)
      this.joinerPlayer?.interpolate(t)
      this.roomEnemies.forEach((enemy) => enemy.interpolate(t))
      this.projectiles.forEach((projectile) => projectile.interpolate(t))
      this.enemyProjectiles.forEach((projectile) => projectile.interpolate(t))
    }

    const currentKeys: KeyState = {
      up: this.cursorKeys.up.isDown,
      down: this.cursorKeys.down.isDown,
      left: this.cursorKeys.left.isDown,
      right: this.cursorKeys.right.isDown,
    }

    if (this.role === 'host') {
      this.updateHostFrame(currentKeys)
      return
    }

    if (!this.connection) {
      return
    }

    const currentFire = this.cursorKeys.space.isDown
    if (!keysEqual(currentKeys, this.lastSentKeys) || currentFire !== this.lastSentFire) {
      this.lastSentKeys = currentKeys
      this.lastSentFire = currentFire
      const message: InputMessage = { type: 'input', keys: currentKeys, fire: currentFire }
      this.connection.send(message)
    }
  }

  private updateHostFrame(currentKeys: KeyState) {
    this.hostPlayer?.setVelocityFromKeys(currentKeys, MOVE_SPEED)

    const now = this.time.now
    this.hostPlayer?.refreshVisuals(now)
    this.joinerPlayer?.refreshVisuals(now)

    this.roomEnemies.forEach((enemy) => {
      const nearest = this.getNearestPlayerPos(enemy.x, enemy.y)
      enemy.updateMovement(nearest)
      const fireAngle = enemy.tryFireAt(nearest, now)
      if (fireAngle !== null) {
        this.spawnEnemyProjectile(enemy.x, enemy.y, fireAngle)
      }
      enemy.refreshVisuals()
    })

    this.tryFirePlayer(this.hostPlayer, this.cursorKeys.space.isDown, now)
    this.tryFirePlayer(this.joinerPlayer, this.joinerFireHeld, now)

    this.projectiles.forEach((projectile, id) => {
      if (projectile.hasExpired()) {
        this.destroyProjectile(id)
      }
    })
    this.enemyProjectiles.forEach((projectile, id) => {
      if (projectile.hasExpired()) {
        this.destroyEnemyProjectile(id)
      }
    })

    this.updateDoorVisuals()
    this.checkRoomTransition()

    if (this.isGameOver) {
      this.showGameOver()
    }
  }

  /** Host-only: nearest of whichever players exist and aren't out-of-lives — dead players aren't valid targets. */
  private getNearestPlayerPos(x: number, y: number): Vec2 | null {
    const candidates = [this.hostPlayer, this.joinerPlayer].filter(
      (player): player is Player => !!player && !player.isOut,
    )
    if (candidates.length === 0) {
      return null
    }
    let nearest = candidates[0]
    let nearestDist = Phaser.Math.Distance.Between(x, y, nearest.x, nearest.y)
    for (const player of candidates.slice(1)) {
      const dist = Phaser.Math.Distance.Between(x, y, player.x, player.y)
      if (dist < nearestDist) {
        nearest = player
        nearestDist = dist
      }
    }
    return { x: nearest.x, y: nearest.y }
  }

  /** Host-only: fires toward whichever direction the player is currently facing, if its cooldown allows. */
  private tryFirePlayer(player: Player | undefined, firing: boolean, now: number) {
    if (!player || !firing) {
      return
    }
    if (player.tryFire(now)) {
      this.spawnProjectile(player.x, player.y, player.getFacingAngle())
    }
  }

  private showGameOver() {
    if (this.gameOverText) {
      return
    }
    this.gameOverText = this.add.text(400, 300, '게임 오버', GAME_OVER_STYLE).setOrigin(0.5).setDepth(100)
  }

  /**
   * Either role calls this on Esc or a resume-button click. Host (and solo,
   * which reuses the host role) is the only one who actually decides — the
   * joiner just asks and waits for the next broadcast to reflect it, same
   * as every other piece of authoritative state.
   */
  private requestTogglePause() {
    if (this.role === 'host') {
      this.togglePauseHost()
      return
    }
    const message: PauseToggleMessage = { type: 'pauseToggle' }
    this.connection?.send(message)
  }

  /** Host-only: flips the authoritative pause state and freezes/resumes the whole physics world at once. */
  private togglePauseHost() {
    this.isPaused = !this.isPaused
    if (this.isPaused) {
      this.physics.pause()
      this.showPauseMenu()
    } else {
      this.physics.resume()
      this.hidePauseMenu()
    }
  }

  private showPauseMenu() {
    if (this.pauseMenuObjects.length > 0) {
      return
    }

    const backdrop = this.add.rectangle(400, 300, 800, 600, 0x000000, PAUSE_BACKDROP_ALPHA).setDepth(200)
    const title = this.add.text(400, 220, '일시정지', TITLE_STYLE).setOrigin(0.5).setDepth(200)
    const resumeButton = this.add
      .text(400, 280, '계속하기 (ESC)', RESUME_BUTTON_STYLE)
      .setOrigin(0.5)
      .setDepth(200)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.requestTogglePause())
    const { musicButton, sfxButton } = createAudioToggleButtons(this, { x: 400, y: 340, originX: 0.5 })
    musicButton.setDepth(200)
    sfxButton.setDepth(200)

    this.pauseMenuObjects = [backdrop, title, resumeButton, musicButton, sfxButton]
  }

  private hidePauseMenu() {
    this.pauseMenuObjects.forEach((object) => object.destroy())
    this.pauseMenuObjects = []
  }

  // ---- Doors / rooms ----

  private createDoorVisuals() {
    for (const direction of ALL_DIRECTIONS) {
      const zone = DOOR_ZONES[direction]
      this.doorGraphics[direction] = this.add.rectangle(
        zone.x + zone.width / 2,
        zone.y + zone.height / 2,
        zone.width,
        zone.height,
        DOOR_CLOSED_COLOR,
      )
    }
    this.bossHoleGraphic = this.add
      .circle(BOSS_HOLE_CENTER.x, BOSS_HOLE_CENTER.y, BOSS_HOLE_RADIUS, BOSS_HOLE_COLOR)
      .setVisible(false)
  }

  /** True once the current room's floorRoomEntries entry is marked isBoss (both host and joiner have this list populated). */
  private isCurrentRoomBoss(): boolean {
    return getRoomDefinition(this.floorRoomEntries, this.currentRoomCoord)?.isBoss ?? false
  }

  private updateDoorVisuals() {
    const clear = this.roomEnemies.size === 0
    if (clear && !this.clearedRooms.some((cleared) => coordsEqual(cleared, this.currentRoomCoord))) {
      this.clearedRooms.push(this.currentRoomCoord)
    }

    if (this.isCurrentRoomBoss()) {
      Object.values(this.doorGraphics).forEach((rect) => rect?.setVisible(false))
      this.bossHoleGraphic?.setVisible(clear)
      return
    }

    this.bossHoleGraphic?.setVisible(false)
    for (const direction of ALL_DIRECTIONS) {
      const rect = this.doorGraphics[direction]
      if (!rect) {
        continue
      }
      rect.setVisible(hasNeighbor(this.floorRoomEntries, this.currentRoomCoord, direction))
      rect.setFillStyle(clear ? DOOR_OPEN_COLOR : DOOR_CLOSED_COLOR)
    }
  }

  private getTouchedDoorDirection(x: number, y: number): Direction | undefined {
    for (const direction of ALL_DIRECTIONS) {
      if (!hasNeighbor(this.floorRoomEntries, this.currentRoomCoord, direction)) {
        continue
      }
      if (isInsideZone(x, y, DOOR_ZONES[direction])) {
        return direction
      }
    }
    return undefined
  }

  /** Host-only: only checked once the room is clear — closed doors/the boss hole don't trigger anything before then. */
  private checkRoomTransition() {
    if (this.roomEnemies.size > 0) {
      return
    }

    if (this.isCurrentRoomBoss()) {
      for (const player of [this.hostPlayer, this.joinerPlayer]) {
        if (!player) {
          continue
        }
        if (Phaser.Math.Distance.Between(player.x, player.y, BOSS_HOLE_CENTER.x, BOSS_HOLE_CENTER.y) < BOSS_HOLE_RADIUS) {
          this.startLevel(this.currentLevel + 1)
          return
        }
      }
      return
    }

    for (const player of [this.hostPlayer, this.joinerPlayer]) {
      if (!player) {
        continue
      }
      const direction = this.getTouchedDoorDirection(player.x, player.y)
      if (direction) {
        this.loadRoom(getNeighborCoord(this.currentRoomCoord, direction), oppositeDirection(direction))
        return
      }
    }
  }

  /**
   * Host/solo-only: generates a fresh floor for `level` and enters its
   * start room. Called once for the very first level (from setupSolo/
   * setupHost) and again every time a boss hole is stepped through, so
   * players are explicitly re-teleported to their normal spawn points here
   * — loadRoom only repositions players when given an `enteredFrom` edge,
   * which a brand-new floor's start room doesn't have.
   */
  private startLevel(level: number) {
    this.currentLevel = level
    this.currentFloor = generateFloor(level)
    this.floorRoomEntries = this.currentFloor.rooms.map((room) => ({ coord: room.coord, isBoss: !!room.isBoss }))
    this.exploredRooms = [this.currentFloor.startCoord]
    this.clearedRooms = []

    this.hostPlayer?.teleport(HOST_START.x, HOST_START.y)
    this.joinerPlayer?.teleport(JOINER_START.x, JOINER_START.y)

    this.miniMap?.setFloor(this.floorRoomEntries, this.currentFloor.startCoord)
    this.levelText?.setText(`레벨 ${level}`)

    this.loadRoom(this.currentFloor.startCoord)

    if (this.connection?.open) {
      const message: LevelStartMessage = {
        type: 'levelStart',
        level,
        startCoord: this.currentFloor.startCoord,
        rooms: this.floorRoomEntries,
      }
      this.connection.send(message)
    }
  }

  /**
   * Host-only: tears down the current room's enemies/projectiles and builds
   * the next one. `enteredFrom` is the edge of the *new* room being entered
   * through — omitted for the very first room, since freshly-constructed
   * Players are already at their normal spawn points.
   */
  private loadRoom(coord: RoomCoord, enteredFrom?: Direction) {
    this.roomEnemyColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.roomEnemyColliders.clear()
    this.roomEnemies.forEach((enemy) => enemy.destroy())
    this.roomEnemies.clear()

    // Projectiles don't carry through a door.
    this.projectiles.forEach((projectile) => projectile.destroy())
    this.projectiles.clear()
    this.projectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.projectileColliders.clear()
    this.enemyProjectiles.forEach((projectile) => projectile.destroy())
    this.enemyProjectiles.clear()
    this.enemyProjectileColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.enemyProjectileColliders.clear()

    if (enteredFrom) {
      const [posA, posB] = getEntryPositions(enteredFrom)
      this.hostPlayer?.teleport(posA.x, posA.y)
      this.joinerPlayer?.teleport(posB.x, posB.y)
    }

    this.currentRoomCoord = coord
    if (!this.exploredRooms.some((explored) => coordsEqual(explored, coord))) {
      this.exploredRooms.push(coord)
    }
    this.miniMap?.refresh(this.exploredRooms, coord)

    const room = getRoomDefinition(this.currentFloor?.rooms ?? [], coord)
    const alreadyCleared = this.clearedRooms.some((cleared) => coordsEqual(cleared, coord))
    if (room && !alreadyCleared) {
      this.spawnRoomEnemies(room)
    }
    this.updateDoorVisuals()
  }

  /** Host-only: one room-clear spawn wave, grouped by archetype. */
  private spawnRoomEnemies(room: RoomDefinition) {
    let index = 0
    const total = room.enemies.reduce((sum, group) => sum + group.count, 0)
    for (const group of room.enemies) {
      const archetype = ARCHETYPES[group.archetype]
      for (let i = 0; i < group.count; i++) {
        const x = ENEMY_SPAWN_CENTER.x + (index - (total - 1) / 2) * ENEMY_SPAWN_SPACING
        this.spawnEnemy(archetype, x, ENEMY_SPAWN_CENTER.y)
        index++
      }
    }
  }

  /** Host-only: registers overlap against whichever of hostPlayer/joinerPlayer exist (solo has only one). Also used by the split-on-death path. */
  private spawnEnemy(archetype: EnemyArchetype, x: number, y: number) {
    const id = this.nextEnemyId++
    const enemy = new Enemy(this, id, archetype, x, y, { simulated: true })
    this.roomEnemies.set(id, enemy)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    const hostPlayer = this.hostPlayer
    if (hostPlayer) {
      colliders.push(this.physics.add.overlap(hostPlayer.square, enemy.square, () => this.handleHit(hostPlayer)))
    }
    const joinerPlayer = this.joinerPlayer
    if (joinerPlayer) {
      colliders.push(this.physics.add.overlap(joinerPlayer.square, enemy.square, () => this.handleHit(joinerPlayer)))
    }
    this.roomEnemyColliders.set(id, colliders)
  }

  // ---- Projectiles ----

  /** Host-only: spawns a projectile and wires overlap detection against every enemy currently in the room. */
  private spawnProjectile(x: number, y: number, angle: number) {
    const id = this.nextProjectileId++
    const projectile = new Projectile(this, id, x, y, angle, { simulated: true })
    this.projectiles.set(id, projectile)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    this.roomEnemies.forEach((enemy, enemyId) => {
      colliders.push(
        this.physics.add.overlap(projectile.shape, enemy.square, () => {
          this.handleProjectileHitEnemy(id, enemyId)
        }),
      )
    })
    this.projectileColliders.set(id, colliders)
  }

  private destroyProjectile(id: number) {
    this.projectiles.get(id)?.destroy()
    this.projectiles.delete(id)
    this.projectileColliders.get(id)?.forEach((collider) => collider.destroy())
    this.projectileColliders.delete(id)
  }

  /** Host-only: applies damage; if lethal, removes the enemy from the room's list for good (and spawns split children, if any). */
  private handleProjectileHitEnemy(projectileId: number, enemyId: number) {
    this.destroyProjectile(projectileId)

    const enemy = this.roomEnemies.get(enemyId)
    if (!enemy) {
      return
    }
    const died = enemy.applyHit()
    if (died) {
      const { splitsOnDeath, splitCount } = enemy.archetype
      const deathX = enemy.x
      const deathY = enemy.y

      this.roomEnemyColliders.get(enemyId)?.forEach((collider) => collider.destroy())
      this.roomEnemyColliders.delete(enemyId)
      enemy.destroy()
      this.roomEnemies.delete(enemyId)

      if (splitsOnDeath && splitCount) {
        const childArchetype = ARCHETYPES[splitsOnDeath]
        for (let i = 0; i < splitCount; i++) {
          const angle = (i / splitCount) * Math.PI * 2
          this.spawnEnemy(
            childArchetype,
            deathX + Math.cos(angle) * SPLIT_SPAWN_OFFSET,
            deathY + Math.sin(angle) * SPLIT_SPAWN_OFFSET,
          )
        }
      }
    }
  }

  /** Host-only: spawns an enemy shot and wires overlap detection against whichever players currently exist. */
  private spawnEnemyProjectile(x: number, y: number, angle: number) {
    const id = this.nextEnemyProjectileId++
    const projectile = new Projectile(this, id, x, y, angle, {
      simulated: true,
      color: ENEMY_PROJECTILE_COLOR,
      speed: ENEMY_PROJECTILE_SPEED,
    })
    this.enemyProjectiles.set(id, projectile)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    const hostPlayer = this.hostPlayer
    if (hostPlayer) {
      colliders.push(
        this.physics.add.overlap(projectile.shape, hostPlayer.square, () =>
          this.handleEnemyProjectileHitPlayer(id, hostPlayer),
        ),
      )
    }
    const joinerPlayer = this.joinerPlayer
    if (joinerPlayer) {
      colliders.push(
        this.physics.add.overlap(projectile.shape, joinerPlayer.square, () =>
          this.handleEnemyProjectileHitPlayer(id, joinerPlayer),
        ),
      )
    }
    this.enemyProjectileColliders.set(id, colliders)
  }

  private destroyEnemyProjectile(id: number) {
    this.enemyProjectiles.get(id)?.destroy()
    this.enemyProjectiles.delete(id)
    this.enemyProjectileColliders.get(id)?.forEach((collider) => collider.destroy())
    this.enemyProjectileColliders.delete(id)
  }

  /** Host-only: an enemy shot connecting is the same hit as contact damage, just via a projectile instead of overlap-with-the-enemy-itself. */
  private handleEnemyProjectileHitPlayer(projectileId: number, player: Player) {
    this.destroyEnemyProjectile(projectileId)
    this.handleHit(player)
  }

  /** Host-only: applies a hit and checks for a simultaneous both-out game over (solo: hostPlayer alone). */
  private handleHit(player: Player) {
    player.applyHit(this.time.now)

    const hostOut = this.hostPlayer?.isOut ?? false
    const joinerOut = this.joinerPlayer ? this.joinerPlayer.isOut : true
    if (hostOut && joinerOut) {
      this.isGameOver = true
    }
  }

  // ---- Setup ----

  /** Solo: exact same simulation as host, minus a connection and a joiner. */
  private setupSolo() {
    this.hostPlayer = new Player(this, HOST_START.x, HOST_START.y, HOST_COLOR, { simulated: true })
    this.startLevel(1)
  }

  /** Host simulates both players, the current room, and every projectile; joiner's input arrives via 'data'. */
  private setupHost(connection: DataConnection) {
    const hostPlayer = new Player(this, HOST_START.x, HOST_START.y, HOST_COLOR, { simulated: true })
    const joinerPlayer = new Player(this, JOINER_START.x, JOINER_START.y, JOINER_COLOR, { simulated: true })
    this.hostPlayer = hostPlayer
    this.joinerPlayer = joinerPlayer

    this.startLevel(1)

    this.onData = (data: unknown) => {
      if (isInputMessage(data)) {
        joinerPlayer.setVelocityFromKeys(data.keys, MOVE_SPEED)
        this.joinerFireHeld = data.fire
        return
      }
      if (isPauseToggleMessage(data)) {
        this.togglePauseHost()
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
        const now = this.time.now
        const message: StateMessage = {
          type: 'state',
          host: hostPlayer.getNetworkState(now),
          joiner: joinerPlayer.getNetworkState(now),
          roomCoord: this.currentRoomCoord,
          enemies: Array.from(this.roomEnemies.values()).map((enemy) => enemy.getNetworkState()),
          projectiles: Array.from(this.projectiles.entries()).map(([id, projectile]) => ({
            id,
            pos: { x: projectile.x, y: projectile.y },
          })),
          enemyProjectiles: Array.from(this.enemyProjectiles.entries()).map(([id, projectile]) => ({
            id,
            pos: { x: projectile.x, y: projectile.y },
          })),
          exploredRooms: this.exploredRooms,
          isGameOver: this.isGameOver,
          isPaused: this.isPaused,
        }
        connection.send(message)
      },
    })
  }

  /**
   * Joiner never simulates — it only sends input and renders whatever the
   * host reports back, eased toward each new position rather than snapped.
   */
  private setupJoiner(connection: DataConnection) {
    const hostPlayer = new Player(this, HOST_START.x, HOST_START.y, HOST_COLOR, { simulated: false })
    const joinerPlayer = new Player(this, JOINER_START.x, JOINER_START.y, JOINER_COLOR, { simulated: false })
    this.hostPlayer = hostPlayer
    this.joinerPlayer = joinerPlayer

    this.onData = (data: unknown) => {
      if (isLevelStartMessage(data)) {
        this.currentLevel = data.level
        this.floorRoomEntries = data.rooms
        this.exploredRooms = [data.startCoord]
        this.miniMap?.setFloor(this.floorRoomEntries, data.startCoord)
        this.levelText?.setText(`레벨 ${data.level}`)
        return
      }

      if (!isStateMessage(data)) {
        return
      }

      // A room change is a cut, not a pan — snap both players to their new
      // position instead of easing from the old room's coordinates.
      if (!coordsEqual(data.roomCoord, this.currentRoomCoord)) {
        hostPlayer.resetInterpolation()
        joinerPlayer.resetInterpolation()
        this.currentRoomCoord = data.roomCoord
      }

      hostPlayer.applyReceivedState(data.host)
      joinerPlayer.applyReceivedState(data.joiner)

      this.reconcileRoomEnemies(data.enemies)
      this.reconcileProjectiles(data.projectiles)
      this.reconcileEnemyProjectiles(data.enemyProjectiles)
      this.exploredRooms = data.exploredRooms
      this.miniMap?.refresh(this.exploredRooms, data.roomCoord)
      this.updateDoorVisuals()

      if (data.isGameOver) {
        this.showGameOver()
      }

      this.isPaused = data.isPaused
      if (data.isPaused) {
        this.showPauseMenu()
      } else {
        this.hidePauseMenu()
      }
    }
    connection.on('data', this.onData)
  }

  /** Joiner-only: destroys any local enemy the host no longer reports, creates/updates the rest. */
  private reconcileRoomEnemies(received: EnemyState[]) {
    const receivedIds = new Set(received.map((enemy) => enemy.id))

    for (const [id, enemy] of this.roomEnemies) {
      if (!receivedIds.has(id)) {
        enemy.destroy()
        this.roomEnemies.delete(id)
      }
    }

    for (const state of received) {
      let enemy = this.roomEnemies.get(state.id)
      if (!enemy) {
        enemy = new Enemy(this, state.id, ARCHETYPES[state.archetype], state.pos.x, state.pos.y, { simulated: false })
        this.roomEnemies.set(state.id, enemy)
      }
      enemy.applyReceivedState(state)
    }
  }

  /** Joiner-only: destroys any local projectile the host no longer reports, creates/updates the rest. */
  private reconcileProjectiles(received: ProjectileState[]) {
    const receivedIds = new Set(received.map((projectile) => projectile.id))

    for (const [id, projectile] of this.projectiles) {
      if (!receivedIds.has(id)) {
        projectile.destroy()
        this.projectiles.delete(id)
      }
    }

    for (const state of received) {
      let projectile = this.projectiles.get(state.id)
      if (!projectile) {
        projectile = new Projectile(this, state.id, state.pos.x, state.pos.y, 0, { simulated: false })
        this.projectiles.set(state.id, projectile)
      }
      projectile.applyReceivedPos(state.pos)
    }
  }

  /** Joiner-only: same reconciliation as reconcileProjectiles, mirrored for enemy-fired shots. */
  private reconcileEnemyProjectiles(received: ProjectileState[]) {
    const receivedIds = new Set(received.map((projectile) => projectile.id))

    for (const [id, projectile] of this.enemyProjectiles) {
      if (!receivedIds.has(id)) {
        projectile.destroy()
        this.enemyProjectiles.delete(id)
      }
    }

    for (const state of received) {
      let projectile = this.enemyProjectiles.get(state.id)
      if (!projectile) {
        projectile = new Projectile(this, state.id, state.pos.x, state.pos.y, 0, {
          simulated: false,
          color: ENEMY_PROJECTILE_COLOR,
        })
        this.enemyProjectiles.set(state.id, projectile)
      }
      projectile.applyReceivedPos(state.pos)
    }
  }
}
