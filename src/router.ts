import Phaser from 'phaser'
import { CoreScenes } from './config/sceneKeys'
import { getGameById } from './config/games'

function slugFromPath(pathname: string): string | null {
  const slug = pathname.replace(/^\/+|\/+$/g, '')
  return slug.length > 0 ? slug : null
}

/** The game id encoded in the current URL, or null if it names no known game. */
export function currentRouteGameId(): string | null {
  const slug = slugFromPath(window.location.pathname)
  return slug !== null && getGameById(slug) ? slug : null
}

export function navigateToGame(gameId: string) {
  history.pushState(null, '', `/${gameId}`)
}

export function navigateToHub() {
  history.pushState(null, '', '/')
}

/**
 * Browser back/forward changes the URL without touching Phaser's scene
 * manager, so popstate has to walk the new URL back into a matching scene by
 * hand. pushState (used by navigateToGame/navigateToHub above) never fires
 * popstate on its own, so this can't loop back on our own navigation.
 */
export function initRouter(game: Phaser.Game) {
  window.addEventListener('popstate', () => {
    const gameId = currentRouteGameId()
    if (gameId) {
      game.scene.start(CoreScenes.Preload, { gameId })
    } else {
      game.scene.start(CoreScenes.MainMenu)
    }
  })
}
