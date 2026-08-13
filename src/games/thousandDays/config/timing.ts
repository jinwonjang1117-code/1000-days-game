// Kept as a rough length-based estimate (used by GameScene to know how long
// to keep gameplay frozen) padded to comfortably exceed the actual animation
// + hold time UIScene computes for the two-row stage intro (welcome message
// + projected score), so physics doesn't unfreeze before the overlay hides.
const STAGE_INTRO_BASE_DURATION_MS = 2500
const STAGE_INTRO_MS_PER_CHARACTER = 90

export function getStageIntroDurationMs(stageName: string): number {
  return STAGE_INTRO_BASE_DURATION_MS + stageName.length * STAGE_INTRO_MS_PER_CHARACTER
}
