/**
 * Single source of truth for this game's identifying strings. Nothing else
 * in this game should hardcode 'escape-the-minions', 'teamGame', or the
 * title/description text.
 *
 * TEAM_GAME_ID drives the actual URL (`src/router.ts`/`config/games.ts` —
 * `navigateToGame` pushes `/${id}`) and now matches the public name, per an
 * explicit request — it happens to also match the `public/assets/
 * escape-the-minions/` folder (DESIGN.md §12), though that's a coincidence
 * of both being renamed to the same string, not a hard requirement.
 * TEAM_GAME_NAMESPACE deliberately stayed as the *internal* technical slug
 * (scene key prefix, PeerJS id prefix) — an internal codename that differs
 * from the public id is normal, and renaming it would cascade through every
 * scene key/PeerJS id in the game for no real benefit. Revisit only if
 * there's an actual reason it needs to match too.
 */
export const TEAM_GAME_ID = 'escape-the-minions'
export const TEAM_GAME_NAMESPACE = 'teamGame'
export const TEAM_GAME_TITLE = 'Escape the Minions'
export const TEAM_GAME_DESCRIPTION = '팀 게임 설명'
