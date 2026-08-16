import Phaser from 'phaser'

// Purely cosmetic, no gameplay state involved — plain functions rather
// than a class, since there's nothing to construct. Shared between
// simulation/GameSimulation.ts (host/solo, triggered directly from
// hit-resolution) and scenes/CoopPlayScene.ts (joiner, triggered from
// noticing something vanish in a reconciled broadcast) with no coupling
// between those two call sites.

const EXPLOSION_COLOR = 0xff8800

const PICKUP_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '16px',
  color: '#ffee88',
}

/**
 * Reveals what a mystery pickup actually was, the moment it's consumed —
 * a rising, fading text flash at the pickup point. Called for every item
 * (not just Fart), so this doubles as the "what did I just get" feedback
 * the mystery-pickup design needs since the ground visual never says.
 */
export function showPickupText(scene: Phaser.Scene, x: number, y: number, text: string) {
  const flash = scene.add.text(x, y - 20, text, PICKUP_TEXT_STYLE).setOrigin(0.5).setDepth(120)
  scene.tweens.add({
    targets: flash,
    y: y - 50,
    alpha: 0,
    duration: 900,
    onComplete: () => flash.destroy(),
  })
}

/** A quick expanding-and-fading ring at a death point (currently just Strong Swarmer). */
export function spawnExplosionEffect(scene: Phaser.Scene, x: number, y: number) {
  const ring = scene.add.circle(x, y, 8, EXPLOSION_COLOR, 0.7).setDepth(120)
  scene.tweens.add({
    targets: ring,
    radius: 50,
    alpha: 0,
    duration: 350,
    onComplete: () => ring.destroy(),
  })
}

/** A quick synthesized noise (Web Audio, no asset needed: a short sawtooth blast with a downward pitch bend, the classic cheap "fart synth" trick). */
export function playFartSound() {
  try {
    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioContextCtor()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sawtooth'
    oscillator.frequency.setValueAtTime(180, ctx.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.35)
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.35)
    oscillator.onended = () => ctx.close()
  } catch {
    // Web Audio unavailable in this environment — the text reveal still lands regardless.
  }
}
