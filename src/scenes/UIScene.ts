import Phaser from 'phaser'

export default class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' })
  }

  create() {
    console.log('UIScene launched')
  }
}
