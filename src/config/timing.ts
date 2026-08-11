const STAGE_INTRO_BASE_DURATION_MS = 1000
const STAGE_INTRO_MS_PER_CHARACTER = 60

export function getStageIntroDurationMs(stageName: string): number {
  return STAGE_INTRO_BASE_DURATION_MS + stageName.length * STAGE_INTRO_MS_PER_CHARACTER
}
