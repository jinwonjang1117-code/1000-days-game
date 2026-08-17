import Phaser from 'phaser'
import type { DataConnection } from 'peerjs'
import { TeamGameScenes } from '../sceneKeys'
import { getConnection, getRole, disconnectPeer } from '../net/peerConnection'
import type {
  KeyState,
  InputMessage,
  PauseToggleMessage,
  ProjectileState,
  EnemyState,
  ItemPickupState,
  FollowerState,
  HazardZoneState,
  ChestState,
  DevilPedestalState,
} from '../net/syncProtocol'
import { isInputMessage, isPauseToggleMessage, isLevelStartMessage, isStateMessage } from '../net/syncProtocol'
import Player from '../entities/Player'
import Projectile from '../entities/Projectile'
import Enemy from '../entities/Enemy'
import ItemPickup from '../entities/ItemPickup'
import Buddy from '../entities/Buddy'
import OrbitingShield from '../entities/OrbitingShield'
import HazardZone from '../entities/HazardZone'
import Chest from '../entities/Chest'
import GambleShrine from '../entities/GambleShrine'
import DevilPedestal from '../entities/DevilPedestal'
import type { DevilItemId } from '../gameplay/devilItems'
import { ARCHETYPES } from '../gameplay/enemyArchetypes'
import { getItemLabel } from '../gameplay/items'
import type { RoleId } from '../gameplay/roles'
import type { Direction, RoomCoord } from '../rooms/floorLayout'
import { getRoomDefinition, hasNeighbor, coordsEqual } from '../rooms/floorLayout'
import type { MiniMapRoomInfo } from '../ui/MiniMap'
import { showPickupText, spawnExplosionEffect, playFartSound } from '../ui/cosmeticEffects'
import GameplayHud from '../ui/GameplayHud'
import type { RoomUiState } from '../simulation/GameSimulation'
import GameSimulation from '../simulation/GameSimulation'

const LEGEND_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
}

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
const ENEMY_PROJECTILE_COLOR = 0xff3366
/** Matches gameplay/items.ts's 'buddy' strong item color — joiner-side Buddy render, since the entity itself doesn't know its own item color. */
const BUDDY_COLOR = 0x33aaff
/** Matches simulation/GameSimulation.ts's ROCK_COLOR/WATER_COLOR — this is purely visual here, no physics, since the joiner never locally simulates collision. */
const ROCK_COLOR = 0x554433
const WATER_COLOR = 0x3366cc

const ORIGIN_COORD: RoomCoord = { x: 0, y: 0 }

function keysEqual(a: KeyState, b: KeyState): boolean {
  return a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right
}

/**
 * Co-op only (was "SyncTestScene," then a solo+co-op prototype — solo mode
 * moved out to PlayScene.ts). Host constructs a GameSimulation and feeds
 * it local input + the joiner's forwarded input, broadcasting its
 * `buildStateMessage()` output at a fixed rate. The joiner never
 * simulates anything — it has no GameSimulation, it just renders whatever
 * the host reports, eased toward the latest position, and keeps its own
 * render-only mirror of every entity Map (enemies/projectiles/pickups)
 * via create/destroy-on-presence reconciliation. Both roles share the
 * exact same presentation layer (`ui/GameplayHud.ts`, also used by
 * `PlayScene.ts`) — the joiner satisfies `RoomUiState` on itself (see the
 * `implements` below) since it has no `GameSimulation` to point at.
 */
export default class CoopPlayScene extends Phaser.Scene implements RoomUiState {
  private role: 'host' | 'joiner' = 'host'
  private connection: DataConnection | null = null
  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys
  private escKey!: Phaser.Input.Keyboard.Key

  private hud?: GameplayHud
  private legendObjects: Phaser.GameObjects.GameObject[] = []

  // ---- Host role only ----
  private simulation?: GameSimulation
  private broadcastTimer?: Phaser.Time.TimerEvent

  // ---- Joiner role only: render-only mirrors of whatever the host broadcasts. ----
  // Also this class's own implementation of RoomUiState for the joiner
  // role — see isCurrentRoomBoss/isRoomClear/isDirectionOpen below.
  private hostPlayer?: Player
  private joinerPlayer?: Player
  private roomEnemies: Map<number, Enemy> = new Map()
  currentRoomCoord: RoomCoord = ORIGIN_COORD
  currentLevel = 1
  floorRoomEntries: MiniMapRoomInfo[] = []
  exploredRooms: RoomCoord[] = []
  isGameOver = false
  isPaused = false
  coins = 0
  keys = 0
  isInDevilRoom = false
  isDevilHoleAvailable = false
  private projectiles: Map<number, Projectile> = new Map()
  private enemyProjectiles: Map<number, Projectile> = new Map()
  private itemPickups: Map<number, ItemPickup> = new Map()
  /** Angel Room's pending options — a separate map/channel from itemPickups on purpose, see reconcileAngelPickups. */
  private angelPickups: Map<number, ItemPickup> = new Map()
  private buddies: Map<number, Buddy> = new Map()
  private shields: Map<number, OrbitingShield> = new Map()
  private hazardZones: Map<number, HazardZone> = new Map()
  private chests: Map<number, Chest> = new Map()
  private devilPedestals: Map<DevilItemId, DevilPedestal> = new Map()
  /** Purely visual — redrawn from floorRoomEntries whenever currentRoomCoord changes (see reconcileRoomObstacles). No physics: the joiner never locally simulates collision to begin with. */
  private roomObstacleGraphics: Phaser.GameObjects.Rectangle[] = []
  /** Purely visual, like roomObstacleGraphics — redrawn from floorRoomEntries whenever currentRoomCoord changes (see drawGambleShrine). No dynamic broadcast state (unlike Chest): the shrine never disappears mid-visit, so isGamble + chestAnchor alone are enough to know whether/where to draw it. */
  private gambleShrine: GambleShrine | null = null

  private lastSentKeys: KeyState = EMPTY_KEYS
  private lastSentFire = false
  private onData?: (data: unknown) => void
  private onClose?: () => void

  constructor() {
    super({ key: TeamGameScenes.CoopPlay })
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e')

    // Reset in case this scene instance is being re-entered — Phaser
    // reuses the same Scene instance across scene.start() calls, so stale
    // state would otherwise leak into a fresh session.
    this.simulation?.destroy()
    this.simulation = undefined
    this.hud?.destroy()
    this.hud = undefined
    this.legendObjects.forEach((object) => object.destroy())
    this.legendObjects = []
    this.broadcastTimer?.remove()
    this.broadcastTimer = undefined
    this.isGameOver = false
    this.hostPlayer?.destroy()
    this.hostPlayer = undefined
    this.joinerPlayer?.destroy()
    this.joinerPlayer = undefined
    this.roomEnemies.forEach((enemy) => enemy.destroy())
    this.roomEnemies.clear()
    this.projectiles.forEach((projectile) => projectile.destroy())
    this.projectiles.clear()
    this.enemyProjectiles.forEach((projectile) => projectile.destroy())
    this.enemyProjectiles.clear()
    this.itemPickups.forEach((pickup) => pickup.destroy())
    this.itemPickups.clear()
    this.angelPickups.forEach((pickup) => pickup.destroy())
    this.angelPickups.clear()
    this.buddies.forEach((buddy) => buddy.destroy())
    this.buddies.clear()
    this.shields.forEach((shield) => shield.destroy())
    this.shields.clear()
    this.hazardZones.forEach((zone) => zone.destroy())
    this.hazardZones.clear()
    this.chests.forEach((chest) => chest.destroy())
    this.chests.clear()
    this.devilPedestals.forEach((pedestal) => pedestal.destroy())
    this.devilPedestals.clear()
    this.roomObstacleGraphics.forEach((rect) => rect.destroy())
    this.roomObstacleGraphics = []
    this.gambleShrine?.destroy()
    this.gambleShrine = null
    this.currentRoomCoord = ORIGIN_COORD
    this.currentLevel = 1
    this.floorRoomEntries = []
    this.exploredRooms = []
    this.isPaused = false
    this.physics.resume()
    this.lastSentFire = false

    this.cursorKeys = this.input.keyboard!.createCursorKeys()
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.broadcastTimer?.remove()
      this.broadcastTimer = undefined
      if (this.connection && this.onData) {
        this.connection.off('data', this.onData)
      }
      this.connection = null
      this.simulation?.destroy()
      this.simulation = undefined
      this.hud?.destroy()
      this.hud = undefined
      this.hostPlayer?.destroy()
      this.joinerPlayer?.destroy()
      this.roomEnemies.forEach((enemy) => enemy.destroy())
      this.roomEnemies.clear()
      this.projectiles.forEach((projectile) => projectile.destroy())
      this.projectiles.clear()
      this.enemyProjectiles.forEach((projectile) => projectile.destroy())
      this.enemyProjectiles.clear()
      this.itemPickups.forEach((pickup) => pickup.destroy())
      this.itemPickups.clear()
      this.buddies.forEach((buddy) => buddy.destroy())
      this.buddies.clear()
      this.shields.forEach((shield) => shield.destroy())
      this.shields.clear()
      this.hazardZones.forEach((zone) => zone.destroy())
      this.hazardZones.clear()
      this.chests.forEach((chest) => chest.destroy())
      this.chests.clear()
      this.devilPedestals.forEach((pedestal) => pedestal.destroy())
      this.devilPedestals.clear()
      this.roomObstacleGraphics.forEach((rect) => rect.destroy())
      this.roomObstacleGraphics = []
      this.gambleShrine?.destroy()
      this.gambleShrine = null
    })

    const connection = getConnection()
    const role = getRole()

    // This scene is only ever reached right after a successful connect, so
    // both should already be set — bail to the lobby if that ever breaks.
    if (!connection || !role) {
      this.scene.start(TeamGameScenes.Lobby)
      return
    }

    this.connection = connection
    this.role = role

    this.hud = new GameplayHud({
      scene: this,
      title: '개발 테스트',
      subtitle: '화살표로 이동, 스페이스로 공격, ESC로 일시정지',
      onReturnToLobby: () => this.returnToLobby(),
      onRequestPause: () => this.requestTogglePause(),
      onGiveItem: role === 'host' ? (itemId) => this.simulation?.giveItemToHostPlayer(itemId) : undefined,
      onJumpToLevel: role === 'host' ? (level) => this.simulation?.devJumpToLevel(level) : undefined,
    })

    this.legendObjects.push(
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
    if (!this.connection) {
      return
    }

    const state = this.currentState()

    if (state.isGameOver) {
      // Host only, in practice: the joiner's isGameOver flips inside the
      // onData handler, which already calls hud.refresh() right there. The
      // host's own isGameOver flips inside handleHit, reached via an Arcade
      // physics overlap callback — those fire during Phaser's automatic
      // physics step, before this update() runs for that same frame, so the
      // exact transition frame would otherwise skip the refresh() call
      // below (normally reached inside the role==='host' branch further
      // down) and the host would never actually see the game-over text.
      // Safe to call unconditionally either way — GameplayHud.showGameOver()
      // already no-ops once the text exists.
      this.hud?.refresh(state)
      if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.space)) {
        this.returnToLobby()
      }
      return
    }

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.requestTogglePause()
    }

    if (state.isPaused) {
      return
    }

    if (this.role === 'joiner') {
      const t = 1 - Math.exp(-INTERPOLATION_RATE * (delta / 1000))
      this.hostPlayer?.interpolate(t)
      this.joinerPlayer?.interpolate(t)
      this.roomEnemies.forEach((enemy) => enemy.interpolate(t))
      this.projectiles.forEach((projectile) => projectile.interpolate(t))
      this.enemyProjectiles.forEach((projectile) => projectile.interpolate(t))
      this.buddies.forEach((buddy) => buddy.interpolate(t))
      this.shields.forEach((shield) => shield.interpolate(t))
    }

    const currentKeys: KeyState = {
      up: this.cursorKeys.up.isDown,
      down: this.cursorKeys.down.isDown,
      left: this.cursorKeys.left.isDown,
      right: this.cursorKeys.right.isDown,
    }

    if (this.role === 'host') {
      this.simulation?.update(this.time.now, currentKeys, this.cursorKeys.space.isDown)
      if (this.simulation) {
        this.hud?.refresh(this.simulation)
      }
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

  /** Host reads the real GameSimulation; joiner reads itself (see the RoomUiState implementation below). */
  private currentState(): RoomUiState {
    return this.role === 'host' && this.simulation ? this.simulation : this
  }

  // ---- RoomUiState (joiner role only — host role uses GameSimulation's own implementation instead) ----

  /** This implementation of RoomUiState is only ever read for the joiner role — "own" is always joinerPlayer (the joiner's own controlled square), "partner" the host's. */
  get ownLives(): number {
    return this.joinerPlayer?.getLives() ?? 0
  }

  get ownMaxLives(): number {
    return this.joinerPlayer?.getMaxLives() ?? 0
  }

  get partnerLives(): number | null {
    return this.hostPlayer?.getLives() ?? null
  }

  get partnerMaxLives(): number | null {
    return this.hostPlayer?.getMaxLives() ?? null
  }

  get ownRole(): RoleId | null {
    return this.joinerPlayer?.getCurrentRole() ?? null
  }

  get partnerRole(): RoleId | null {
    return this.hostPlayer?.getCurrentRole() ?? null
  }

  isCurrentRoomBoss(): boolean {
    return getRoomDefinition(this.floorRoomEntries, this.currentRoomCoord)?.isBoss ?? false
  }

  isRoomClear(): boolean {
    for (const enemy of this.roomEnemies.values()) {
      if (enemy.countsForClear) {
        return false
      }
    }
    return true
  }

  isDirectionOpen(direction: Direction): boolean {
    return hasNeighbor(this.floorRoomEntries, this.currentRoomCoord, direction)
  }

  currentRoomPlaceholderLabel(): string | null {
    const room = getRoomDefinition(this.floorRoomEntries, this.currentRoomCoord)
    if (room?.noEnemyVariant === 'empty') {
      return 'FREE ROOM'
    }
    if (room?.isGamble) {
      return 'GAMBLE ROOM'
    }
    return null
  }

  /** Shared by the pause menu's lobby button and the game-over screen's Space shortcut — back to the team game's own lobby, not the shared multi-game hub, so no navigateToHub()/URL change here (same as the onClose/no-connection fallbacks elsewhere in this scene). */
  private returnToLobby() {
    if (this.connection && this.onClose) {
      this.connection.off('close', this.onClose)
    }
    disconnectPeer()
    this.scene.start(TeamGameScenes.Lobby)
  }

  /**
   * Either role calls this on Esc or a resume-button click. Host is the
   * only one who actually decides — the joiner just asks and waits for
   * the next broadcast to reflect it, same as every other piece of
   * authoritative state.
   */
  private requestTogglePause() {
    if (this.role === 'host') {
      this.simulation?.togglePause()
      if (this.simulation?.isPaused) {
        this.hud?.showPauseMenu()
      } else {
        this.hud?.hidePauseMenu()
      }
      return
    }
    const message: PauseToggleMessage = { type: 'pauseToggle' }
    this.connection?.send(message)
  }

  // ---- Setup ----

  /** Host constructs one GameSimulation and feeds it local + forwarded input; broadcasts its state at a fixed rate. */
  private setupHost(connection: DataConnection) {
    const simulation = new GameSimulation({ scene: this, hasJoiner: true })
    this.simulation = simulation

    simulation.setOnLevelStart((message) => {
      if (connection.open) {
        connection.send(message)
      }
    })
    simulation.setOnGameOver(() => {
      // Stop broadcasting and notify the joiner immediately instead of
      // waiting for the next scheduled tick.
      if (connection.open) {
        connection.send(simulation.buildStateMessage(this.time.now))
      }
      this.broadcastTimer?.remove()
      this.broadcastTimer = undefined
    })

    simulation.start()
    this.hud?.refresh(simulation)

    this.onData = (data: unknown) => {
      if (isInputMessage(data)) {
        simulation.applyJoinerInput(data.keys, data.fire)
        return
      }
      if (isPauseToggleMessage(data)) {
        simulation.togglePause()
        if (simulation.isPaused) {
          this.hud?.showPauseMenu()
        } else {
          this.hud?.hidePauseMenu()
        }
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
        connection.send(simulation.buildStateMessage(this.time.now))
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
        this.drawRoomObstacles()
        this.drawGambleShrine()
      }

      hostPlayer.applyReceivedState(data.host)
      joinerPlayer.applyReceivedState(data.joiner)

      this.reconcileRoomEnemies(data.enemies)
      this.reconcileProjectiles(data.projectiles)
      this.reconcileEnemyProjectiles(data.enemyProjectiles)
      this.reconcileItemPickups(data.itemPickups)
      this.reconcileAngelPickups(data.angelPickups)
      this.reconcileBuddies(data.buddies)
      this.reconcileShields(data.shields)
      this.reconcileHazardZones(data.hazardZones)
      this.reconcileChests(data.chests)
      this.reconcileDevilPedestals(data.devilPedestals)
      this.exploredRooms = data.exploredRooms

      this.isGameOver = data.isGameOver
      this.isPaused = data.isPaused
      this.coins = data.coins
      this.keys = data.keys
      this.isInDevilRoom = data.isInDevilRoom
      this.isDevilHoleAvailable = data.isDevilHoleAvailable
      if (data.isPaused) {
        this.hud?.showPauseMenu()
      } else {
        this.hud?.hidePauseMenu()
      }

      this.hud?.refresh(this)
    }
    connection.on('data', this.onData)
  }

  /** Joiner-only: destroys any local enemy the host no longer reports, creates/updates the rest. */
  private reconcileRoomEnemies(received: EnemyState[]) {
    const receivedIds = new Set(received.map((enemy) => enemy.id))

    for (const [id, enemy] of this.roomEnemies) {
      if (!receivedIds.has(id)) {
        if (enemy.archetype.explodesOnDeath) {
          spawnExplosionEffect(this, enemy.x, enemy.y)
        }
        enemy.destroy()
        this.roomEnemies.delete(id)
      }
    }

    for (const state of received) {
      let enemy = this.roomEnemies.get(state.id)
      if (!enemy) {
        enemy = new Enemy(this, state.id, ARCHETYPES[state.archetype], state.pos.x, state.pos.y, {
          simulated: false,
          countsForClear: state.countsForClear,
        })
        this.roomEnemies.set(state.id, enemy)
      }
      enemy.applyReceivedState(state)
    }
  }

  /** Joiner-only: destroys any local projectile the host no longer reports, creates/updates the rest. */
  /**
   * Bomb (DESIGN.md §5) has no dedicated broadcast field the way Angel
   * Room/Devil's Room do — it's inferred the same way explodesOnDeath's
   * explosion already is (see the enemy-reconciliation call below): a
   * bomb-tagged projectile vanishing from the broadcast means it just
   * detonated, so this shows the blast VFX at its last known position
   * before actually destroying it.
   */
  private reconcileProjectiles(received: ProjectileState[]) {
    const receivedIds = new Set(received.map((projectile) => projectile.id))

    for (const [id, projectile] of this.projectiles) {
      if (!receivedIds.has(id)) {
        if (projectile.roleEffect === 'bomb') {
          spawnExplosionEffect(this, projectile.x, projectile.y)
        }
        projectile.destroy()
        this.projectiles.delete(id)
      }
    }

    for (const state of received) {
      let projectile = this.projectiles.get(state.id)
      if (!projectile) {
        projectile = new Projectile(this, state.id, state.pos.x, state.pos.y, 0, {
          simulated: false,
          radius: state.radius,
          color: state.color,
          roleEffect: state.isBomb ? 'bomb' : null,
        })
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
          radius: state.radius,
        })
        this.enemyProjectiles.set(state.id, projectile)
      }
      projectile.applyReceivedPos(state.pos)
    }
  }

  /**
   * Joiner-only: same create/destroy-on-presence reconciliation as
   * reconcileProjectiles, but pickups never move (no interpolation, no
   * applyReceivedState). Detects a pickup vanishing as "someone collected
   * it" and reveals what it was the same way GameSimulation's
   * handleItemPickup does on the host side, so both players see the
   * reveal (and hear the Fart, if that's what it was) regardless of who
   * actually grabbed it.
   */
  private reconcileItemPickups(received: ItemPickupState[]) {
    const receivedIds = new Set(received.map((pickup) => pickup.id))

    for (const [id, pickup] of this.itemPickups) {
      if (!receivedIds.has(id)) {
        showPickupText(this, pickup.x, pickup.y, getItemLabel(pickup.itemId))
        if (pickup.itemId === 'fart') {
          playFartSound()
        }
        pickup.destroy()
        this.itemPickups.delete(id)
      }
    }

    for (const state of received) {
      if (!this.itemPickups.has(state.id)) {
        this.itemPickups.set(
          state.id,
          new ItemPickup(this, state.id, state.itemId, state.pos.x, state.pos.y, { simulated: false }),
        )
      }
    }
  }

  /**
   * Joiner-only: same create/destroy-on-presence shape as
   * reconcileItemPickups, but deliberately no reveal-text-on-disappear —
   * choosing one Angel Room option destroys all 2-3 at once, and that
   * inference (any single id vanishing means "picked up") would fire once
   * per option instead of once per actual choice if this reused that logic.
   */
  private reconcileAngelPickups(received: ItemPickupState[]) {
    const receivedIds = new Set(received.map((pickup) => pickup.id))

    for (const [id, pickup] of this.angelPickups) {
      if (!receivedIds.has(id)) {
        pickup.destroy()
        this.angelPickups.delete(id)
      }
    }

    for (const state of received) {
      if (!this.angelPickups.has(state.id)) {
        this.angelPickups.set(
          state.id,
          new ItemPickup(this, state.id, state.itemId, state.pos.x, state.pos.y, { simulated: false }),
        )
      }
    }
  }

  /** Joiner-only: same create/destroy-on-presence reconciliation as reconcileItemPickups — hazard zones don't move either, so no interpolation. */
  private reconcileHazardZones(received: HazardZoneState[]) {
    const receivedIds = new Set(received.map((zone) => zone.id))

    for (const [id, zone] of this.hazardZones) {
      if (!receivedIds.has(id)) {
        zone.destroy()
        this.hazardZones.delete(id)
      }
    }

    for (const state of received) {
      if (!this.hazardZones.has(state.id)) {
        this.hazardZones.set(state.id, new HazardZone(this, state.id, state.pos.x, state.pos.y, state.radius, { simulated: false }))
      }
    }
  }

  /** Joiner-only: same create/destroy-on-presence reconciliation as reconcileHazardZones — at most one entry, but shares the same array-based reconciliation shape as everything else rather than special-casing a single nullable field. */
  private reconcileChests(received: ChestState[]) {
    const receivedIds = new Set(received.map((chest) => chest.id))

    for (const [id, chest] of this.chests) {
      if (!receivedIds.has(id)) {
        chest.destroy()
        this.chests.delete(id)
      }
    }

    for (const state of received) {
      if (!this.chests.has(state.id)) {
        this.chests.set(state.id, new Chest(this, state.id, state.pos.x, state.pos.y, { simulated: false }))
      }
    }
  }

  /** Joiner-only: same create/destroy-on-presence reconciliation as reconcileChests — id doubles as the DevilItemId (see DevilPedestalState), so it works as a Map key directly. */
  private reconcileDevilPedestals(received: DevilPedestalState[]) {
    const receivedIds = new Set(received.map((pedestal) => pedestal.id))

    for (const [id, pedestal] of this.devilPedestals) {
      if (!receivedIds.has(id)) {
        pedestal.destroy()
        this.devilPedestals.delete(id)
      }
    }

    for (const state of received) {
      if (!this.devilPedestals.has(state.id)) {
        this.devilPedestals.set(state.id, new DevilPedestal(this, state.id, state.pos.x, state.pos.y, { simulated: false }))
      }
    }
  }

  /** Joiner-only: same reconciliation as reconcileProjectiles — Buddies persist across rooms host-side, but this side just tracks whatever ids are currently reported. */
  private reconcileBuddies(received: FollowerState[]) {
    const receivedIds = new Set(received.map((buddy) => buddy.id))

    for (const [id, buddy] of this.buddies) {
      if (!receivedIds.has(id)) {
        buddy.destroy()
        this.buddies.delete(id)
      }
    }

    for (const state of received) {
      let buddy = this.buddies.get(state.id)
      if (!buddy) {
        buddy = new Buddy(this, state.id, state.pos.x, state.pos.y, { simulated: false, color: BUDDY_COLOR })
        this.buddies.set(state.id, buddy)
      }
      buddy.applyReceivedState(state.pos)
    }
  }

  /** Joiner-only: same reconciliation as reconcileBuddies, mirrored for Orbiting Shields. */
  private reconcileShields(received: FollowerState[]) {
    const receivedIds = new Set(received.map((shield) => shield.id))

    for (const [id, shield] of this.shields) {
      if (!receivedIds.has(id)) {
        shield.destroy()
        this.shields.delete(id)
      }
    }

    for (const state of received) {
      let shield = this.shields.get(state.id)
      if (!shield) {
        shield = new OrbitingShield(this, state.id, state.pos.x, state.pos.y, { simulated: false })
        this.shields.set(state.id, shield)
      }
      shield.applyReceivedState(state.pos)
    }
  }

  /** Joiner-only, purely visual — redraws this room's obstacle rects from floorRoomEntries (already carries obstacles alongside isBoss/isGolden). No physics: the joiner never locally simulates collision to begin with. */
  private drawRoomObstacles() {
    this.roomObstacleGraphics.forEach((rect) => rect.destroy())
    this.roomObstacleGraphics = []

    const room = getRoomDefinition(this.floorRoomEntries, this.currentRoomCoord)
    room?.obstacles.forEach((obstacle) => {
      const color = obstacle.type === 'rock' ? ROCK_COLOR : WATER_COLOR
      const alpha = obstacle.type === 'rock' ? 1 : 0.6
      this.roomObstacleGraphics.push(
        this.add.rectangle(
          obstacle.x + obstacle.width / 2,
          obstacle.y + obstacle.height / 2,
          obstacle.width,
          obstacle.height,
          color,
          alpha,
        ),
      )
    })
  }

  /** Joiner-only, purely visual — see the field comment on gambleShrine for why this doesn't need broadcast reconciliation like Chest does. */
  private drawGambleShrine() {
    this.gambleShrine?.destroy()
    this.gambleShrine = null

    const room = getRoomDefinition(this.floorRoomEntries, this.currentRoomCoord)
    if (room?.isGamble) {
      this.gambleShrine = new GambleShrine(this, room.chestAnchor.x, room.chestAnchor.y, { simulated: false })
    }
  }
}
