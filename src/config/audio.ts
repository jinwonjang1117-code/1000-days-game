import Phaser from 'phaser'

const BGM_VOLUME = 0.5
const SFX_VOLUME = 0.7
export const START_BGM_VOLUME = 0.8

let currentBgmKey: string | null = null
let currentBgm: Phaser.Sound.BaseSound | null = null

let bgmEnabled = true
let sfxEnabled = true

export function isBgmOn(): boolean {
  return bgmEnabled
}

export function setBgmEnabled(enabled: boolean) {
  bgmEnabled = enabled
  ;(currentBgm as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | null)?.setMute(!enabled)
}

export function isSfxOn(): boolean {
  return sfxEnabled
}

export function setSfxEnabled(enabled: boolean) {
  sfxEnabled = enabled
}

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

  currentBgm = scene.sound.add(key, { loop: true, volume, mute: !bgmEnabled })
  currentBgm.play()
  currentBgmKey = key
}

export function stopBgm() {
  currentBgm?.stop()
  currentBgm?.destroy()
  currentBgm = null
  currentBgmKey = null
}

export function playSfx(
  scene: Phaser.Scene,
  key: string,
  volume: number = SFX_VOLUME,
): Phaser.Sound.BaseSound | undefined {
  if (!sfxEnabled || !scene.cache.audio.exists(key)) {
    return undefined
  }

  const sound = scene.sound.add(key, { volume })
  sound.play()
  sound.once(Phaser.Sound.Events.COMPLETE, () => sound.destroy())
  return sound
}

// For SFX that should sustain for as long as an action is held (e.g. inhaling)
// rather than play once to completion. Only one looping SFX plays at a time.
let currentLoopingSfxKey: string | null = null
let currentLoopingSfx: Phaser.Sound.BaseSound | null = null

export function startLoopingSfx(scene: Phaser.Scene, key: string, volume: number = SFX_VOLUME) {
  if (currentLoopingSfxKey === key && currentLoopingSfx?.isPlaying) {
    return
  }

  stopLoopingSfx()

  if (!sfxEnabled || !scene.cache.audio.exists(key)) {
    return
  }

  currentLoopingSfx = scene.sound.add(key, { loop: true, volume })
  currentLoopingSfx.play()
  currentLoopingSfxKey = key
}

export function stopLoopingSfx() {
  currentLoopingSfx?.stop()
  currentLoopingSfx?.destroy()
  currentLoopingSfx = null
  currentLoopingSfxKey = null
}
