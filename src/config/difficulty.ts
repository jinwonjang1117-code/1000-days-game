export type Difficulty = 'low' | 'high'

interface DifficultySettings {
  playerLives: number
  bossHp: number
  winTitle: string
  winLine1: string
  winLine2: string
}

const DIFFICULTY_SETTINGS: Record<Difficulty, DifficultySettings> = {
  low: {
    playerLives: 8,
    bossHp: 8,
    winTitle: '축하합니다! 1000일에 도달했습니다!',
    winLine1: '난이도 하 상품은...',
    winLine2: '주방 오븐 아래 서랍 안에 있습니다!',
  },
  high: {
    playerLives: 5,
    bossHp: 10,
    winTitle: '축하합니다! 1000일에 도달했습니다!',
    winLine1: '난이도 상 상품은...',
    winLine2: '2층 큰 방 서랍 안에 있습니다!',
  },
}

const DIFFICULTY_STORAGE_KEY = 'difficulty'

function loadStoredDifficulty(): Difficulty {
  try {
    const stored = localStorage.getItem(DIFFICULTY_STORAGE_KEY)
    return stored === 'low' || stored === 'high' ? stored : 'low'
  } catch {
    return 'low'
  }
}

let currentDifficulty: Difficulty = loadStoredDifficulty()

export function getDifficulty(): Difficulty {
  return currentDifficulty
}

export function setDifficulty(difficulty: Difficulty) {
  currentDifficulty = difficulty
  try {
    localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty)
  } catch {
    // Ignore storage failures (e.g. private browsing) — selection still
    // works for the current session via the in-memory value above.
  }
}

export function getDifficultySettings(): DifficultySettings {
  return DIFFICULTY_SETTINGS[currentDifficulty]
}
