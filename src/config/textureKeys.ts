export const TextureKeys = {
  Player: 'player',
  PlayerInhaling: 'player-inhaling',
  PlayerFull: 'player-full',
  Enemy: 'enemy',
  Ghost: 'ghost',
  Flyer: 'flyer',
  EnemyProjectile: 'enemyProjectile',
  Projectile: 'projectile',
  Boss: 'boss',
  BossProjectile: 'boss-projectile',
  Gem: 'gem',
  Diamond: 'diamond',
  Platform: 'platform',
  Life: 'life',
}

export function stageBackgroundKey(level: number): string {
  return `stage-background-${level}`
}
