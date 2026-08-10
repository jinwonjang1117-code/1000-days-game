import Phaser from 'phaser'
import PreloadScene from '../scenes/PreloadScene'
import StartScene from '../scenes/StartScene'
import GameScene from '../scenes/GameScene'
import UIScene from '../scenes/UIScene'

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
  scene: [PreloadScene, StartScene, GameScene, UIScene],
  backgroundColor: '#000000',
}

export default gameConfig
