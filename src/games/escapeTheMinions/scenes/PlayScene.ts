import Phaser from 'phaser'
import { TeamGameScenes } from '../sceneKeys'
import { TEAM_GAME_TITLE } from '../gameId'
import { loadRoomBackgroundAssets, ROOM_BACKGROUND_KEY, ROOM_BACKGROUND_DEPTH } from '../assets'
import GameSimulation, { WORLD_WIDTH, WORLD_HEIGHT } from '../simulation/GameSimulation'
import { ARENA_MIN_X, ARENA_MAX_X, ARENA_MIN_Y, ARENA_MAX_Y } from '../rooms/roomLayouts'
import GameplayHud from '../ui/GameplayHud'
import type { KeyState } from '../net/syncProtocol'

/**
 * The real single-player game — built by extracting solo mode's code path
 * out of CoopPlayScene.ts into GameSimulation, which this scene just drives
 * and renders around via the shared GameplayHud (doors/minimap/pause
 * menu/game-over/dev item-menu — the exact same presentation code
 * CoopPlayScene.ts uses for co-op). No PeerJS involved anywhere in this
 * file. See CLAUDE.md's build-status entries for the split rationale.
 */
export default class PlayScene extends Phaser.Scene {
  private simulation!: GameSimulation
  private hud!: GameplayHud
  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys
  private escKey!: Phaser.Input.Keyboard.Key

  constructor() {
    super({ key: TeamGameScenes.Play })
  }

  preload() {
    loadRoomBackgroundAssets(this)
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e')
    // Kept as a fallback layer beneath the image (harmless if the image
    // ever fails to load) rather than replaced by it.
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, ROOM_BACKGROUND_KEY).setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT).setDepth(ROOM_BACKGROUND_DEPTH)

    // env-room-bg.png paints a solid wall border into the backdrop itself —
    // constrain physics to the actual floor (ARENA_MIN/MAX) instead of the
    // full canvas, so Player/Enemy's setCollideWorldBounds(true) stops them
    // at the wall instead of letting them walk into painted stone.
    this.physics.world.setBounds(ARENA_MIN_X, ARENA_MIN_Y, ARENA_MAX_X - ARENA_MIN_X, ARENA_MAX_Y - ARENA_MIN_Y)

    // Reset in case this scene instance is being re-entered — Phaser
    // reuses the same Scene instance across scene.start() calls, so a
    // stale GameSimulation/GameplayHud would otherwise leak into a fresh run.
    this.simulation?.destroy()
    this.hud?.destroy()

    this.cursorKeys = this.input.keyboard!.createCursorKeys()
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)

    this.hud = new GameplayHud({
      scene: this,
      title: TEAM_GAME_TITLE,
      subtitle: '화살표로 이동, 스페이스로 공격, ESC로 일시정지',
      onReturnToLobby: () => this.returnToLobby(),
      onRequestPause: () => this.requestTogglePause(),
      onGiveItem: (itemId) => this.simulation.giveItemToHostPlayer(itemId),
      onJumpToLevel: (level) => this.simulation.devJumpToLevel(level),
    })

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.simulation?.destroy()
      this.hud?.destroy()
    })

    this.simulation = new GameSimulation({ scene: this, hasJoiner: false })
    this.simulation.start()
    this.hud.refresh(this.simulation)
  }

  update() {
    if (this.simulation.isGameOver) {
      // Arcade physics overlap callbacks (which is where isGameOver actually
      // flips true, in handleHit) fire during Phaser's automatic physics
      // step, before this update() runs for that same frame — so the exact
      // transition frame would otherwise skip the refresh() call below
      // (normally reached after simulation.update()) and the game-over text
      // would never actually get shown. Refresh here too, safe since
      // GameplayHud.showGameOver() already no-ops once the text exists.
      this.hud.refresh(this.simulation)
      if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.space)) {
        this.returnToLobby()
      }
      return
    }

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.requestTogglePause()
    }

    if (this.simulation.isPaused) {
      return
    }

    const currentKeys: KeyState = {
      up: this.cursorKeys.up.isDown,
      down: this.cursorKeys.down.isDown,
      left: this.cursorKeys.left.isDown,
      right: this.cursorKeys.right.isDown,
    }
    this.simulation.update(this.time.now, currentKeys, this.cursorKeys.space.isDown)
    this.hud.refresh(this.simulation)
  }

  /** Shared by the pause menu's lobby button and the game-over screen's Space shortcut — back to the team game's own lobby, not the shared multi-game hub, so no navigateToHub()/URL change here. */
  private returnToLobby() {
    this.scene.start(TeamGameScenes.Lobby)
  }

  private requestTogglePause() {
    this.simulation.togglePause()
    if (this.simulation.isPaused) {
      this.hud.showPauseMenu()
    } else {
      this.hud.hidePauseMenu()
    }
  }
}
