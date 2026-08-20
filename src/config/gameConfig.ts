import Phaser from 'phaser'
import PreloadScene from '../scenes/PreloadScene'
import MainMenuScene from '../scenes/MainMenuScene'
import StartScene from '../games/thousandDays/scenes/StartScene'
import GameScene from '../games/thousandDays/scenes/GameScene'
import UIScene from '../games/thousandDays/scenes/UIScene'
import LobbyScene from '../games/escapeTheMinions/scenes/LobbyScene'
import PlayScene from '../games/escapeTheMinions/scenes/PlayScene'
import CoopPlayScene from '../games/escapeTheMinions/scenes/CoopPlayScene'

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  scale: {
    parent: 'app',
    mode: Phaser.Scale.ScaleModes.NONE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 600,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  render: {
    roundPixels: true,
  },
  // MainMenuScene boots first: the hub is light, and each game's assets are
  // fetched by PreloadScene only once that game is chosen.
  scene: [MainMenuScene, PreloadScene, StartScene, GameScene, UIScene, LobbyScene, PlayScene, CoopPlayScene],
  backgroundColor: '#000000',
}

export default gameConfig
