import Phaser from 'phaser'

const BGM_VOLUME = 0.5
const SFX_VOLUME = 0.7

let currentBgmKey: string | null = null
let currentBgm: Phaser.Sound.BaseSound | null = null

// Assets are loaded as runtime string paths (see PreloadScene) so a missing
// audio file just never registers in the cache — these guards keep playback
// a silent no-op instead of spamming Phaser's "no such key" console warnings
// until the real files are dropped in.
export function playBgm(scene: Phaser.Scene, key: string, volume: number = BGM_VOLUME) {
  if (currentBgmKey === key && currentBgm?.isPlaying) {
    return
  }

  currentBgm?.stop()
  currentBgm?.destroy()
  currentBgm = null
  currentBgmKey = null

  if (!scene.cache.audio.exists(key)) {
    return
  }

  currentBgm = scene.sound.add(key, { loop: true, volume })
  currentBgm.play()
  currentBgmKey = key
}

export function stopBgm() {
  currentBgm?.stop()
  currentBgm?.destroy()
  currentBgm = null
  currentBgmKey = null
}

export function playSfx(scene: Phaser.Scene, key: string, volume: number = SFX_VOLUME) {
  if (!scene.cache.audio.exists(key)) {
    return
  }
  scene.sound.play(key, { volume })
}
