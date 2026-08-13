import Phaser from 'phaser'
import { CoreScenes } from '../config/sceneKeys'
import { GAMES, getGameById, isGameLoaded, markGameLoaded } from '../config/games'
import type { GameDefinition } from '../config/games'

const LOADING_BAR_WIDTH = 300
const LOADING_BAR_HEIGHT = 24
const LOADING_RUNNER_WIDTH = 26
const LOADING_RUNNER_HEIGHT = 36
const MIN_LOADING_SCREEN_DURATION_MS = 1500
const POST_LOAD_HOLD_MS = 200

interface PreloadSceneData {
  gameId?: string
}

/**
 * Loads a single game's assets on demand. The hub hands it a gameId; nothing is
 * downloaded until a game is actually picked, and re-entering an already-loaded
 * game skips the loading screen entirely.
 */
export default class PreloadScene extends Phaser.Scene {
  private loadStartTime = 0
  private selectedGame!: GameDefinition
  private skippedLoading = false

  constructor() {
    super({ key: CoreScenes.Preload })
  }

  init(data: PreloadSceneData) {
    this.selectedGame = getGameById(data?.gameId ?? '') ?? GAMES[0]
    this.skippedLoading = isGameLoaded(this.selectedGame.id)
  }

  preload() {
    if (this.skippedLoading) {
      return
    }

    this.loadStartTime = Date.now()
    this.cameras.main.setBackgroundColor('#1a1a2e')
    this.createLoadingBar()
    this.selectedGame.loadAssets(this)
  }

  create() {
    if (this.skippedLoading) {
      this.scene.start(this.selectedGame.sceneKey)
      return
    }

    markGameLoaded(this.selectedGame.id)

    const elapsed = Date.now() - this.loadStartTime
    const remaining = Math.max(0, MIN_LOADING_SCREEN_DURATION_MS - elapsed) + POST_LOAD_HOLD_MS

    this.time.delayedCall(remaining, () => {
      this.scene.start(this.selectedGame.sceneKey)
    })
  }

  private createLoadingBar() {
    const centerX = 400
    const centerY = 300
    const barX = centerX - LOADING_BAR_WIDTH / 2
    const barY = centerY - LOADING_BAR_HEIGHT / 2

    this.add.text(centerX, barY - 40, '게임 로딩 중...', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5)

    this.add.rectangle(centerX, centerY, LOADING_BAR_WIDTH + 4, LOADING_BAR_HEIGHT + 4)
      .setStrokeStyle(2, 0xffcc00)

    const barFill = this.add.rectangle(barX, barY, 0, LOADING_BAR_HEIGHT, 0xffcc00).setOrigin(0, 0)

    const percentText = this.add.text(centerX, barY + LOADING_BAR_HEIGHT + 20, '0%', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    }).setOrigin(0.5)

    let runnerSprite: Phaser.GameObjects.Image | undefined

    const runnerTexture = this.selectedGame.loadingRunnerTexture
    if (runnerTexture) {
      this.load.once(`filecomplete-image-${runnerTexture}`, () => {
        runnerSprite = this.add.image(barX, centerY, runnerTexture)
          .setDisplaySize(LOADING_RUNNER_WIDTH, LOADING_RUNNER_HEIGHT)
      })
    }

    // Driven by a fixed-duration tween rather than real load progress so the
    // bar always sweeps smoothly from 0% to 100% over MIN_LOADING_SCREEN_DURATION_MS,
    // instead of jumping in uneven steps or finishing early on a fast connection.
    // create() still waits for the real load to finish before leaving this scene.
    this.tweens.addCounter({
      from: 0,
      to: 100,
      duration: MIN_LOADING_SCREEN_DURATION_MS,
      onUpdate: (tween) => {
        const progress = (tween.getValue() ?? 0) / 100
        barFill.width = LOADING_BAR_WIDTH * progress
        percentText.setText(`${Math.round(progress * 100)}%`)
        runnerSprite?.setX(barX + LOADING_BAR_WIDTH * progress)
      },
    })
  }
}
