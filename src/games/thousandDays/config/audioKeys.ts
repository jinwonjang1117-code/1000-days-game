/**
 * Phaser audio keys share one global cache across every game in the hub, so
 * BGM keys are prefixed to stay collision-free (mirrors sceneKeys.ts). SFX
 * are left unprefixed since their names are already specific enough.
 */
export const AudioKeys = {
  StartBgm: 'thousandDays.bgm-start',
  GameplayBgm: 'thousandDays.bgm-gameplay',
  BossBgm: 'thousandDays.bgm-boss',
  FlyerProjectile: 'sfx-flyer-projectile',
  BossProjectile: 'sfx-boss-projectile',
  BossRain: 'sfx-boss-rain',
  PickupConsume: 'sfx-pickup',
  PlayerInhale: 'sfx-player-inhale',
  PlayerSwallow: 'sfx-player-swallow',
  PlayerSpit: 'sfx-player-spit',
  PlayerHit: 'sfx-player-hit',
  EnemyHit: 'sfx-enemy-hit',
  StageClear: 'sfx-stage-clear',
  Victory: 'sfx-victory',
  Lose: 'sfx-lose',
}
