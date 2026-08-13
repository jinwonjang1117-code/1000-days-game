const STORAGE_KEY = 'playerName'

export function getPlayerName(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

export function setPlayerName(name: string) {
  localStorage.setItem(STORAGE_KEY, name)
}

export function clearPlayerName() {
  localStorage.removeItem(STORAGE_KEY)
}
