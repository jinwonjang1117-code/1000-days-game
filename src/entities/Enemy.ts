import Phaser from 'phaser'

export default abstract class Enemy extends Phaser.Physics.Arcade.Sprite {
  canBeInhaled = true
  collidesWithPlatforms = true
  isBossMinion = false

  constructor(scene: Phaser.Scene, x: number, y: number, texture: string) {
    super(scene, x, y, texture)

    scene.add.existing(this)
    scene.physics.add.existing(this)
  }

  updateBehavior(_time: number, _delta: number): void {
    // Overridden by subclasses
  }
}
