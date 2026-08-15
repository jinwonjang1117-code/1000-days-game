import Phaser from 'phaser'
import { TeamGameScenes } from '../sceneKeys'
import { CoreScenes } from '../../../config/sceneKeys'
import { TEAM_GAME_TITLE } from '../gameId'
import { navigateToHub } from '../../../router'
import GameSimulation from '../simulation/GameSimulation'
import GameplayHud from '../ui/GameplayHud'
import type { KeyState } from '../net/syncProtocol'

/**
 * The real single-player game — built by extracting solo mode's code path
 * out of DevTestScene.ts into GameSimulation, which this scene just drives
 * and renders around via the shared GameplayHud (doors/minimap/pause
 * menu/game-over/dev item-menu — the exact same presentation code
 * DevTestScene.ts uses for co-op). No PeerJS involved anywhere in this
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

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e')

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
      onReturnToHub: () => this.returnToHub(),
      onRequestPause: () => this.requestTogglePause(),
      onGiveItem: (itemId) => this.simulation.giveItemToHostPlayer(itemId),
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
      if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.space)) {
        this.returnToHub()
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

  /** Shared by the "← 게임 허브" button and the game-over screen's Space shortcut. */
  private returnToHub() {
    navigateToHub()
    this.scene.start(CoreScenes.MainMenu)
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
