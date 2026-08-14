# Project Context

A Phaser 3 + Vite + TypeScript game hub (`src/scenes/MainMenuScene.ts`) hosting multiple small games under `src/games/`. Each game is routed to via `src/config/games.ts` and gets its own URL (`src/router.ts`).

Games currently in the hub:

- `src/games/thousandDays/` — "1000일의 모험", a single-player platformer (Hungry Monster clone). No dedicated CLAUDE.md yet.
- `src/games/teamGame/` — a 2-player online co-op roguelike (placeholder id/title, not yet renamed). **Has its own [CLAUDE.md](src/games/teamGame/CLAUDE.md) — read it before touching anything under that directory.** Don't modify the platformer's files while working on this game unless a task explicitly says to touch the shared main menu.
