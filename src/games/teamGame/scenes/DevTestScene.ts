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
  ItemPickupState,
  Vec2,
} from '../net/syncProtocol'
import { isInputMessage, isPauseToggleMessage, isLevelStartMessage, isStateMessage } from '../net/syncProtocol'
import Player from '../entities/Player'
import Projectile, {
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_MAX_RANGE,
} from '../entities/Projectile'
import Enemy from '../entities/Enemy'
import ItemPickup from '../entities/ItemPickup'
import type { EnemyArchetype } from '../gameplay/enemyArchetypes'
import { ARCHETYPES } from '../gameplay/enemyArchetypes'
import type { ItemId } from '../gameplay/items'
import { getItemLabel, randomBoostItemId, randomStrongItemId, BOOST_ITEM_IDS, STRONG_ITEM_IDS, STAT_ITEMS } from '../gameplay/items'
import type { BoostItemId, StrongItemId } from '../gameplay/items'
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

const PICKUP_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffee88',
}

// (removed unused DEV_BUTTON_STYLE; using DEV_ITEM_TEXT_STYLE for labels)

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

const PAUSE_BACKDROP_ALPHA = 0.6
const EXPLOSION_COLOR = 0xff8800

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

/** Room-clear rewards (DESIGN.md §7, boost/life tier now; role items/holdables wait on the role system). */
const REGULAR_REWARD_SPACING = 50
const LIFE_ITEM_CHANCE = 0.15
/** Extra shots fired in a spread when a player has picked up Multi Shot, in addition to the center shot. */
const MULTI_SHOT_SPREAD_RADIANS = Phaser.Math.DegToRad(15)

function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2
  let n = a % twoPi
  if (n < 0) n += twoPi
  return Number(n.toFixed(4))
}

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
  /**
   * True only during the exact frame trackRoomCleared() detects a fresh
   * clear — checkRoomTransition holds off for that one frame so a
   * just-spawned reward can't be destroyed (via a door/hole transition)
   * before it's ever visible, e.g. a player already standing inside the
   * boss hole's radius the instant the boss dies.
   */
  private roomJustCleared = false

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

  private itemPickups: Map<number, ItemPickup> = new Map()
  private itemPickupColliders: Map<number, Phaser.Physics.Arcade.Collider[]> = new Map()
  private nextItemPickupId = 0

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
    this.itemPickups.forEach((pickup) => pickup.destroy())
    this.itemPickups.clear()
    this.itemPickupColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.itemPickupColliders.clear()
    this.nextItemPickupId = 0
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
    this.roomJustCleared = false
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
        .on('pointerdown', () => this.returnToHub()),
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
      this.itemPickups.forEach((pickup) => pickup.destroy())
      this.itemPickups.clear()
      this.itemPickupColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
      this.itemPickupColliders.clear()
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

    if (this.isGameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.space)) {
        this.returnToHub()
      }
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
      // Update cumulative path-length for range expiry (host simulated only).
      if (typeof (projectile as any).updateTravelledDistance === 'function') {
        ;(projectile as any).updateTravelledDistance()
      }
      // steer homing projectiles toward the nearest enemy (only if any exist)
      if (typeof (projectile as any).isHoming === 'function' && (projectile as any).isHoming()) {
        if (this.roomEnemies.size > 0) {
          let nearest: Enemy | null = null
          let nearestDist = Infinity
          for (const enemy of this.roomEnemies.values()) {
            const d = Phaser.Math.Distance.Between(projectile.x, projectile.y, enemy.x, enemy.y)
            if (d < nearestDist) {
              nearest = enemy
              nearestDist = d
            }
          }
          if (nearest && typeof (projectile as any).steerTo === 'function') {
            ;(projectile as any).steerTo({ x: nearest.x, y: nearest.y })
          }
        }
      }
      // If this projectile is attached to an enemy, apply periodic ticks
      if (typeof (projectile as any).isAttached === 'function' && (projectile as any).isAttached()) {
        const attachedId = (projectile as any).getAttachedEnemyId()
        if (attachedId !== null) {
          const attachedEnemy = this.roomEnemies.get(attachedId)
          if (!attachedEnemy) {
            // Target died — detach and destroy projectile
            ;(projectile as any).detach()
            this.destroyProjectile(id)
            return
          }
          // Apply periodic attached damage
          if (typeof (projectile as any).shouldTickAttached === 'function' && (projectile as any).shouldTickAttached(this.time.now)) {
            const tickDamage = projectile.damage
            const diedByTick = attachedEnemy.applyHit(tickDamage)
            if (diedByTick) {
              const { splitsOnDeath, splitCount, explodesOnDeath, explosionRadius } = attachedEnemy.archetype
              const deathX = attachedEnemy.x
              const deathY = attachedEnemy.y
              this.roomEnemyColliders.get(attachedId)?.forEach((collider) => collider.destroy())
              this.roomEnemyColliders.delete(attachedId)
              attachedEnemy.destroy()
              this.roomEnemies.delete(attachedId)

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

              if (explodesOnDeath) {
                const radius = explosionRadius ?? 0
                for (const player of [this.hostPlayer, this.joinerPlayer]) {
                  if (player && !player.isOut && Phaser.Math.Distance.Between(player.x, player.y, deathX, deathY) <= radius) {
                    this.handleHit(player)
                  }
                }
                this.spawnExplosionEffect(deathX, deathY)
              }
            }
          }
          // Attached projectiles do not expire by range; keep them until explicitly destroyed
          return
        }
      }

      if (projectile.hasExpired()) {
        this.destroyProjectile(id)
      }
    })
    this.enemyProjectiles.forEach((projectile, id) => {
      if (projectile.hasExpired()) {
        this.destroyEnemyProjectile(id)
      }
    })

    this.trackRoomCleared()
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

  /** Host-only: fires toward whichever direction the player is currently facing, if its cooldown allows. Multi Shot adds two extra shots in a spread. */
  private tryFirePlayer(player: Player | undefined, firing: boolean, now: number) {
    if (!player || !firing) {
      return
    }
    if (!player.tryFire(now)) {
      return
    }
    const facing = player.getFacingAngle()
    const stats = player.getStats()
    // Compose base firing angles first based on Four Way stacking, then
    // expand each base by Multi Shot stacking so the two effects compose
    // naturally (e.g. four-way + multi-shot => multiple shots per dir).
    const baseAngles: number[] = []
    const fw = stats.hasMultiDirection
    if (fw <= 0) {
      baseAngles.push(facing)
    } else if (fw === 1) {
      // front/back
      baseAngles.push(facing, normalizeAngle(facing + Math.PI))
    } else if (fw === 2) {
      // cardinal four
      baseAngles.push(0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2)
    } else {
      // 8 directions (every 45deg)
      for (let i = 0; i < 8; i++) baseAngles.push((i / 8) * Math.PI * 2)
    }

    const anglesSet = new Set<number>()
    const ms = Math.min(stats.hasMultiShot, 2) // cap at 2 so shots per base are 1/2/3
    for (const base of baseAngles) {
      if (ms === 0) {
        anglesSet.add(normalizeAngle(base))
      } else if (ms === 1) {
        // two-shot: symmetric around base with half-spread
        anglesSet.add(normalizeAngle(base - MULTI_SHOT_SPREAD_RADIANS / 2))
        anglesSet.add(normalizeAngle(base + MULTI_SHOT_SPREAD_RADIANS / 2))
      } else {
        // three-shot: left, center, right
        anglesSet.add(normalizeAngle(base - MULTI_SHOT_SPREAD_RADIANS))
        anglesSet.add(normalizeAngle(base))
        anglesSet.add(normalizeAngle(base + MULTI_SHOT_SPREAD_RADIANS))
      }
    }

    for (const a of anglesSet) this.spawnProjectile(player, a)
  }

  private showGameOver() {
    if (this.gameOverText) {
      return
    }
    this.gameOverText = this.add.text(400, 300, '게임 오버', GAME_OVER_STYLE).setOrigin(0.5).setDepth(100)
  }

  /** Shared by the "← 게임 허브" button and the game-over screen's Space shortcut. */
  private returnToHub() {
    if (this.connection && this.onClose) {
      this.connection.off('close', this.onClose)
    }
    disconnectPeer()
    navigateToHub()
    this.scene.start(CoreScenes.MainMenu)
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

    // Dev-only: quick give-item buttons (host only)
    if (import.meta.env.DEV && (this.role === 'host' || this.isSolo)) {
      const devTitle = this.add
        .text(400, 400, 'DEV: Give Items', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' })
        .setOrigin(0.5)
        .setDepth(210)
      this.pauseMenuObjects.push(devTitle)

      // Group backgrounds
      const boostBg = this.add.rectangle(240, 500, 320, 160, 0x222233, 0.6).setDepth(205)
      const strongBg = this.add.rectangle(560, 500, 320, 160, 0x332222, 0.6).setDepth(205)
      this.pauseMenuObjects.push(boostBg, strongBg)

      // Group titles
      const boostTitle = this.add.text(240, 450, 'Boosts', DEV_GROUP_TITLE_STYLE).setOrigin(0.5).setDepth(210)
      const strongTitle = this.add.text(560, 450, 'Strong Items', DEV_GROUP_TITLE_STYLE).setOrigin(0.5).setDepth(210)
      this.pauseMenuObjects.push(boostTitle, strongTitle)

      // Layout boosts in two columns inside left group
      let idx = 0
      for (const id of BOOST_ITEM_IDS) {
        const col = idx % 2
        const row = Math.floor(idx / 2)
        const x = 240 + (col === 0 ? -80 : 80)
        const y = 480 + row * 28
        const sw = this.add.rectangle(x - 80, y, 14, 14, STAT_ITEMS[id as BoostItemId].color).setDepth(210)
        const btn = this.add
          .text(x - 54, y, getItemLabel(id), DEV_ITEM_TEXT_STYLE)
          .setOrigin(0, 0.5)
          .setDepth(210)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => this.giveItemToHost(id))
        this.pauseMenuObjects.push(sw, btn)
        idx++
      }

      // Strong items in the right group
      let sidx = 0
      for (const id of STRONG_ITEM_IDS) {
        const col = sidx % 2
        const row = Math.floor(sidx / 2)
        const x = 560 + (col === 0 ? -80 : 80)
        const y = 480 + row * 28
        const sw = this.add.rectangle(x - 80, y, 14, 14, STAT_ITEMS[id as StrongItemId].color).setDepth(210)
        const btn = this.add
          .text(x - 54, y, getItemLabel(id as any), DEV_ITEM_TEXT_STYLE)
          .setOrigin(0, 0.5)
          .setDepth(210)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => this.giveItemToHost(id as any))
        this.pauseMenuObjects.push(sw, btn)
        sidx++
      }
    }
  }

  private hidePauseMenu() {
    this.pauseMenuObjects.forEach((object) => object.destroy())
    this.pauseMenuObjects = []
  }

  private giveItemToHost(itemId: ItemId) {
    if (this.role !== 'host' && !this.isSolo) {
      return
    }
    const host = this.hostPlayer
    if (!host) {
      return
    }
    if (itemId === 'heart') {
      host.grantLife()
    } else {
      host.applyItem(itemId)
    }
    this.showPickupText(host.x, host.y, getItemLabel(itemId))
    if (itemId === 'fart') {
      this.playFartSound()
    }
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

  /**
   * Detects the moment a room's enemy list first empties out — updates
   * clearedRooms (so loadRoom won't respawn enemies here again) and, on
   * the host/solo side only, rolls a room-clear reward. Split out from
   * updateDoorVisuals because this has a real gameplay side effect
   * (spawning a pickup), not just a visual one, even though both are
   * driven by the same "is this room clear" check and called from the
   * same two spots (updateHostFrame, and the joiner's onData handler).
   */
  private trackRoomCleared() {
    // Reset every call so checkRoomTransition only ever sees this true for
    // the exact frame a fresh clear happened, not stale from an earlier one.
    this.roomJustCleared = false

    const clear = this.roomEnemies.size === 0
    const wasAlreadyCleared = this.clearedRooms.some((cleared) => coordsEqual(cleared, this.currentRoomCoord))
    if (!clear || wasAlreadyCleared) {
      return
    }

    this.clearedRooms.push(this.currentRoomCoord)
    this.roomJustCleared = true
    // Only the host/solo side ever decides a reward — the joiner calls
    // this too (for its own clearedRooms bookkeeping), but must never
    // independently roll its own pickup.
    if (this.role === 'host') {
      this.rollRoomClearReward(this.currentRoomCoord)
    }
  }

  private updateDoorVisuals() {
    const clear = this.roomEnemies.size === 0

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
    // Same-frame guard: this must run after trackRoomCleared() every
    // frame (see updateHostFrame) so a room that JUST became clear gets
    // one frame before its door/hole can be walked through — otherwise a
    // player already standing in range (very plausible for the boss hole,
    // dead center of the room) would tear down the reward that was just
    // spawned this same frame before ever seeing it.
    if (this.roomEnemies.size > 0 || this.roomJustCleared) {
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

    // Uncollected pickups don't carry through a door either — same reasoning as projectiles.
    this.itemPickups.forEach((pickup) => pickup.destroy())
    this.itemPickups.clear()
    this.itemPickupColliders.forEach((colliders) => colliders.forEach((collider) => collider.destroy()))
    this.itemPickupColliders.clear()

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
    this.trackRoomCleared()
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

  // ---- Item pickups ----

  /** Host-only: called exactly once, the moment a room's enemy list first empties. Start room never drops anything. */
  private rollRoomClearReward(coord: RoomCoord) {
    if (!this.currentFloor || coordsEqual(coord, this.currentFloor.startCoord)) {
      return
    }

    if (this.isCurrentRoomBoss()) {
      const itemId = randomStrongItemId()
      this.spawnItemPickup(itemId, BOSS_HOLE_CENTER.x, BOSS_HOLE_CENTER.y - REGULAR_REWARD_SPACING)
      return
    }

    const boostId = randomBoostItemId()
    this.spawnItemPickup(boostId, ENEMY_SPAWN_CENTER.x - REGULAR_REWARD_SPACING / 2, ENEMY_SPAWN_CENTER.y)

    if (Math.random() < LIFE_ITEM_CHANCE) {
      this.spawnItemPickup('heart', ENEMY_SPAWN_CENTER.x + REGULAR_REWARD_SPACING / 2, ENEMY_SPAWN_CENTER.y)
    }
  }

  /** Host-only: registers overlap against whichever of hostPlayer/joinerPlayer exist. */
  private spawnItemPickup(itemId: ItemId, x: number, y: number) {
    const id = this.nextItemPickupId++
    const pickup = new ItemPickup(this, id, itemId, x, y, { simulated: true })
    this.itemPickups.set(id, pickup)

    const colliders: Phaser.Physics.Arcade.Collider[] = []
    const hostPlayer = this.hostPlayer
    if (hostPlayer) {
      colliders.push(
        this.physics.add.overlap(hostPlayer.square, pickup.shape, () => this.handleItemPickup(id, itemId, hostPlayer)),
      )
    }
    const joinerPlayer = this.joinerPlayer
    if (joinerPlayer) {
      colliders.push(
        this.physics.add.overlap(joinerPlayer.square, pickup.shape, () =>
          this.handleItemPickup(id, itemId, joinerPlayer),
        ),
      )
    }
    this.itemPickupColliders.set(id, colliders)
  }

  private destroyItemPickup(id: number) {
    this.itemPickups.get(id)?.destroy()
    this.itemPickups.delete(id)
    this.itemPickupColliders.get(id)?.forEach((collider) => collider.destroy())
    this.itemPickupColliders.delete(id)
  }

  /** Host-only: applies the effect to whichever specific player touched it. */
  private handleItemPickup(pickupId: number, itemId: ItemId, player: Player) {
    this.destroyItemPickup(pickupId)

    if (itemId === 'heart') {
      player.grantLife()
    } else {
      player.applyItem(itemId)
    }

    this.showPickupText(player.x, player.y, getItemLabel(itemId))
    if (itemId === 'fart') {
      this.playFartSound()
    }
  }

  /**
   * Reveals what a mystery pickup actually was, the moment it's consumed
   * — a rising, fading text flash at the pickup point. Called for every
   * item (not just Fart), so this doubles as the "what did I just get"
   * feedback the mystery-pickup design needs since the ground visual
   * never says. Called locally by whichever client's overlap/
   * reconciliation notices the pickup, so both host and joiner see it
   * regardless of who actually grabbed it.
   */
  private showPickupText(x: number, y: number, text: string) {
    const flash = this.add.text(x, y - 20, text, PICKUP_TEXT_STYLE).setOrigin(0.5).setDepth(120)
    this.tweens.add({
      targets: flash,
      y: y - 50,
      alpha: 0,
      duration: 900,
      onComplete: () => flash.destroy(),
    })
  }

  /**
   * Cosmetic only, purely local — a quick expanding-and-fading ring at a
   * death point (currently just Strong Swarmer). Called directly from
   * handleProjectileHitEnemy on the host/solo side; the joiner triggers
   * the same call from reconcileRoomEnemies when it notices the enemy
   * vanished, same "notice it happened locally" pattern as the item
   * pickup reveal/Fart sound.
   */
  private spawnExplosionEffect(x: number, y: number) {
    const ring = this.add.circle(x, y, 8, EXPLOSION_COLOR, 0.7).setDepth(120)
    this.tweens.add({
      targets: ring,
      radius: 50,
      alpha: 0,
      duration: 350,
      onComplete: () => ring.destroy(),
    })
  }

  /** Cosmetic-only, no protocol involved — a quick synthesized noise (Web Audio, no asset needed: a short sawtooth blast with a downward pitch bend, the classic cheap "fart synth" trick). */
  private playFartSound() {
    try {
      const AudioContextCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioContextCtor()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sawtooth'
      oscillator.frequency.setValueAtTime(180, ctx.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.35)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.35)
      oscillator.onended = () => ctx.close()
    } catch {
      // Web Audio unavailable in this environment — the text reveal still lands regardless.
    }
  }

  // ---- Projectiles ----

  /** Host-only: spawns a projectile (reading the firing player's item-boosted stats) and wires overlap detection against every enemy currently in the room. */
  private spawnProjectile(player: Player, angle: number) {
    const id = this.nextProjectileId++
    const stats = player.getStats()
    const projectile = new Projectile(this, id, player.x, player.y, angle, {
      simulated: true,
      damage: stats.potatoDamage,
      speed: PROJECTILE_SPEED * stats.potatoSpeedMultiplier,
      radius: PROJECTILE_RADIUS * stats.potatoSizeMultiplier,
      range: PROJECTILE_MAX_RANGE * stats.potatoRangeMultiplier,
      pierceCount: stats.hasPiercing,
      homingStrength: stats.hasHoming,
    })
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

  /**
   * Host-only: applies damage; if lethal, removes the enemy from the
   * room's list for good (and spawns split children, if any). Looks the
   * projectile up (rather than destroying it immediately) because a
   * piercing shot survives a hit — Arcade overlap fires every frame two
   * bodies are touching, not once, so hasHitEnemy/recordEnemyHit guard
   * against re-applying damage to the same enemy while a pierced shot is
   * still passing through it.
   */
  private handleProjectileHitEnemy(projectileId: number, enemyId: number) {
    const projectile = this.projectiles.get(projectileId)
    const enemy = this.roomEnemies.get(enemyId)
    if (!projectile || !enemy || projectile.hasHitEnemy(enemyId)) {
      return
    }
    projectile.recordEnemyHit(enemyId)

    // If projectile can attach (homing+pierce), attach and start periodic ticks
    if ((projectile as any).shouldAttachOnHit && (projectile as any).shouldAttachOnHit()) {
      ;(projectile as any).attachTo(enemyId)
    }

    const died = enemy.applyHit(projectile.damage)
    if (died) {
      const { splitsOnDeath, splitCount, explodesOnDeath, explosionRadius } = enemy.archetype
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

      // Strong Swarmer's escalation — a normal hit (DESIGN.md §3, no
      // damage variance), just triggered by proximity at death instead of
      // contact while alive. Reuses handleHit, so invincibility frames
      // already apply for free.
      if (explodesOnDeath) {
        const radius = explosionRadius ?? 0
        for (const player of [this.hostPlayer, this.joinerPlayer]) {
          if (player && !player.isOut && Phaser.Math.Distance.Between(player.x, player.y, deathX, deathY) <= radius) {
            this.handleHit(player)
          }
        }
        this.spawnExplosionEffect(deathX, deathY)
      }
    }

    if (projectile.consumePierce()) {
      // If it attached, keep the projectile around to tick attached damage
      if (!(projectile as any).isAttached()) {
        this.destroyProjectile(projectileId)
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
      this.showGameOver()
      // Stop simulation on the host and notify the joiner immediately.
      this.physics.pause()
      this.sendStateSnapshot()
      this.broadcastTimer?.remove()
      this.broadcastTimer = undefined
    }
  }

  /** Host-only: build and send one authoritative StateMessage immediately. */
  private sendStateSnapshot() {
    if (!this.connection || !this.connection.open) {
      return
    }
    const now = this.time.now
    const message: StateMessage = {
      type: 'state',
      host: this.hostPlayer ? this.hostPlayer.getNetworkState(now) : { pos: { x: 0, y: 0 }, lives: 0, isOut: true, isInvincible: false },
      joiner: this.joinerPlayer ? this.joinerPlayer.getNetworkState(now) : { pos: { x: 0, y: 0 }, lives: 0, isOut: true, isInvincible: false },
      roomCoord: this.currentRoomCoord,
      enemies: Array.from(this.roomEnemies.values()).map((enemy) => enemy.getNetworkState()),
      projectiles: Array.from(this.projectiles.entries()).map(([id, projectile]) => ({ id, pos: { x: projectile.x, y: projectile.y }, radius: projectile.radius })),
      enemyProjectiles: Array.from(this.enemyProjectiles.entries()).map(([id, projectile]) => ({ id, pos: { x: projectile.x, y: projectile.y }, radius: projectile.radius })),
      exploredRooms: this.exploredRooms,
      itemPickups: Array.from(this.itemPickups.values()).map((pickup) => ({ id: pickup.id, itemId: pickup.itemId, pos: { x: pickup.x, y: pickup.y } })),
      isGameOver: this.isGameOver,
      isPaused: this.isPaused,
    }
    this.connection.send(message)
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
            radius: projectile.radius,
          })),
          enemyProjectiles: Array.from(this.enemyProjectiles.entries()).map(([id, projectile]) => ({
            id,
            pos: { x: projectile.x, y: projectile.y },
            radius: projectile.radius,
          })),
          exploredRooms: this.exploredRooms,
          itemPickups: Array.from(this.itemPickups.values()).map((pickup) => ({
            id: pickup.id,
            itemId: pickup.itemId,
            pos: { x: pickup.x, y: pickup.y },
          })),
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
      this.reconcileItemPickups(data.itemPickups)
      this.exploredRooms = data.exploredRooms
      this.miniMap?.refresh(this.exploredRooms, data.roomCoord)
      this.trackRoomCleared()
      this.updateDoorVisuals()

      this.isGameOver = data.isGameOver
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
        if (enemy.archetype.explodesOnDeath) {
          this.spawnExplosionEffect(enemy.x, enemy.y)
        }
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
        projectile = new Projectile(this, state.id, state.pos.x, state.pos.y, 0, {
          simulated: false,
          radius: state.radius,
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
   * it" and reveals what it was the same way handleItemPickup does on the
   * host side, so both players see the reveal (and hear the Fart, if
   * that's what it was) regardless of who actually grabbed it.
   */
  private reconcileItemPickups(received: ItemPickupState[]) {
    const receivedIds = new Set(received.map((pickup) => pickup.id))

    for (const [id, pickup] of this.itemPickups) {
      if (!receivedIds.has(id)) {
        this.showPickupText(pickup.x, pickup.y, getItemLabel(pickup.itemId))
        if (pickup.itemId === 'fart') {
          this.playFartSound()
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
}
