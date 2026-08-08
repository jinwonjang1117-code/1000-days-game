import Phaser from 'phaser'
import BootScene from '../scenes/BootScene'

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  scene: [BootScene],
  backgroundColor: '#000000',
}

export default gameConfig
