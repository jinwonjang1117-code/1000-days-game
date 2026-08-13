import Phaser from 'phaser'
import { isBgmOn, setBgmEnabled, isSfxOn, setSfxEnabled } from '../config/audio'

export const TOGGLE_BUTTON_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffffff',
  backgroundColor: '#00000080',
  padding: { x: 8, y: 4 },
}

// Music/SFX are global settings, so every top-level screen (the hub and each
// game's start screen) offers the same pair of toggles in the same corner.
export function createAudioToggleButtons(scene: Phaser.Scene) {
  const musicButton = scene.add
    .text(784, 12, '', TOGGLE_BUTTON_STYLE)
    .setOrigin(1, 0)
    .setInteractive({ useHandCursor: true })

  const sfxButton = scene.add
    .text(784, 40, '', TOGGLE_BUTTON_STYLE)
    .setOrigin(1, 0)
    .setInteractive({ useHandCursor: true })

  const refresh = () => {
    musicButton.setText(`🎵 음악: ${isBgmOn() ? 'ON' : 'OFF'}`)
    sfxButton.setText(`🔊 효과음: ${isSfxOn() ? 'ON' : 'OFF'}`)
  }

  musicButton.on('pointerdown', () => {
    setBgmEnabled(!isBgmOn())
    refresh()
  })

  sfxButton.on('pointerdown', () => {
    setSfxEnabled(!isSfxOn())
    refresh()
  })

  refresh()

  return { musicButton, sfxButton }
}
