export interface PlatformConfig {
  x: number
  y: number
  width: number
  height?: number
}

export const PLATFORM_HEIGHT = 16
export const GROUND_HEIGHT = 40

export function findLandingPlatform(
  platforms: PlatformConfig[],
  x: number,
  y: number,
): PlatformConfig | undefined {
  return platforms
    .filter((platform) => x >= platform.x - platform.width / 2 && x <= platform.x + platform.width / 2 && platform.y >= y)
    .sort((a, b) => a.y - b.y)[0]
}
