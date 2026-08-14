# Co-op Roguelike — Project Context

This file is persistent context for Claude Code. Read this before starting any task on the co-op roguelike. This game shares a repo with an existing platformer (Hungry Monster clone) — do not modify the platformer's files unless a task explicitly says to touch the shared main menu.

**Full design detail lives in [DESIGN.md](DESIGN.md)** (same directory) — the design doc, with the complete role/item/enemy/combo tables, run structure, and sprite checklist. This file is a condensed summary plus the engineering-specific decisions DESIGN.md doesn't cover (networking internals, build phases, working conventions). When the two disagree, DESIGN.md is the source of truth for game design; this file is the source of truth for how it's actually built so far.

## What this game is

A 2-player online co-op roguelike, shared-screen/shared-room (both players always in the same room together, not separate screens), inspired by The Binding of Isaac. One player hosts a room and shares a short room code; the other joins with that code. Runs are randomized and replayable: randomized item drops, randomized room enemy composition, seven selectable "roles" (elements) with mechanical synergies between them.

## Architecture decisions (settled — don't relitigate without asking)

- **Stack:** Vite + TypeScript + Phaser 3, same repo as the platformer, routed to via the existing main menu scene.
- **Physics:** Arcade Physics, gravity disabled (`{ x: 0, y: 0 }`) — this is a top-down game, not a platformer. 8-directional movement via velocity, with diagonal movement normalized so it isn't faster than cardinal movement.
- **Camera:** Static per room. The camera never scrolls or follows a player within a room — it only cuts/transitions between rooms. This is a deliberate Isaac-style choice and also sidesteps multiplayer camera-follow conflicts.
- **Networking:** PeerJS (WebRTC), host-authoritative. The host's game instance is the source of truth: it simulates both players, all enemies, and resolves all hits/collisions, and broadcasts authoritative state. The joiner sends only input (movement direction, attack triggers) to the host — the joiner never simulates their own movement locally; they render based on interpolated state received from the host, never local prediction.
- **Room code flow:** Host generates a short alphanumeric PeerJS id, displays it; joiner enters it to connect. Handle failed/nonexistent codes with a visible error, not a silent hang.
- **Pause:** Either player can pause (e.g. Esc) — pauses for both, opens a menu on both screens. Matters more than it sounds: single-sitting runs of 70-90 rooms (see Run Structure) need a real pause. Built — see the build-status entry below. Host-authoritative like everything else: the joiner's Esc is a request (`PauseToggleMessage`), only the host actually flips `isPaused` and freezes the world (`this.physics.pause()`), same as the platformer's `GameScene.ts` already does for its own freeze moments.
- Networking is layered UNDER regular gameplay code, not bolted on after. Player movement, attacks, and room logic should be written so they don't care whether input came from a local keypress or a forwarded network message — same input-handling code path either way.

## Lives & death (settled — DESIGN.md §3)

No HP pool — players have a direct life count, any hit removes exactly one life (no damage variance), with ~1-1.5s of post-hit invincibility (visual flicker) so overlapping hits can't delete multiple lives at once. Lives are per-player, not shared. Starting lives: 5. Running out takes you out for the rest of the current level (input ignored, sprite grayed out); you respawn at the start of the next level with a **fixed 3 lives** (not the starting 5, not inherited from your teammate — this was previously TBD, now settled). If both players are out within the same level, the run ends. Rare life-item drops on room-clear grant +1.

Prototyped ahead of real Player/enemy content in `DevTestScene.ts`:
- `src/games/teamGame/gameplay/lives.ts` — host-only pure state (`LifeState`, `applyHit`, `respawnForNextLevel`). The joiner never runs this, only renders what the host broadcasts.
- `src/games/teamGame/gameplay/flicker.ts` — reusable invincibility-flicker visual, driven locally on each client (not synced frame-by-frame — only the `isInvincible` boolean travels over the network).
- `respawnForNextLevel` exists but isn't wired to any trigger yet — there's no real level-clear event until Phase F+ builds actual rooms/floors.
- The debug enemy + Arcade overlap detection in `DevTestScene.ts` is the same collision pattern real enemies will reuse later, not a one-off hack.

## Attack system (settled — DESIGN.md §4)

Three distinct attack-input shapes, branching by equipped role — **architect this as three separate input handlers from the start**, not retrofitted onto one:

| Input pattern | Roles |
|---|---|
| Space → fire projectile toward the direction you're facing | Ice, Glue, Poison, Electric, Gravity |
| Space → instant line/beam in the direction you're facing, hits all enemies in path | Laser |
| Hold Space to charge → release to fire; charge duration sets travel speed | Bomb |

Every character has this baseline "default attack" (tears-style) before any role is equipped — a role changes *what the attack does and how it's fired*, not whether an attack exists. Aim is keyboard-driven (whichever way you're currently moving, or last moved) — no mouse involved anywhere in this game; settled, previously "click → fire toward cursor."

Only the first row (fire the default projectile) is built so far, prototyped in `DevTestScene.ts` the same way lives are — see the build-status entry below. Laser and Bomb wait for the role system to exist, since nothing can select them yet. `src/games/teamGame/gameplay/attack.ts` + `entities/Projectile.ts` are where the eventual branch point for the other two input shapes will go.

## The seven roles (settled — DESIGN.md §5)

Ice, Glue, Poison, Electric, Gravity, Laser, Bomb. Fire was considered and removed. Full effect/attack-shape/notes table in DESIGN.md — the one non-obvious one: **Bomb costs a full life** (not partial damage) if the player or teammate is caught in the blast, and only Electric can detonate a live bomb early.

### Role-change rule

- First role pick: free, near the start of the run.
- One additional free role change: offered specifically after clearing level 1 (not before, not automatically available earlier).
- Further changes: available via coins at a shop (shop system not yet designed/built — deferred, see below).
- Boost items that are role-specific becoming "orphaned"/useless after a role change is intentional — do not build any system to prevent, refund, or migrate stats on role change. This is a deliberate risk/cost of switching.

## Synergy / combo system (settled — DESIGN.md §6)

Status effects are shared world-state — either player's ability can trigger a combo off a status the *other* player applied, not just their own. A handful of marquee combos are designed (see DESIGN.md table, e.g. Ice+Electric = shatter, Gravity+Laser = cluster-then-sweep, Electric+Bomb = early detonation — the **only** role allowed to interact with Bomb's fuse). Not all 21 role pairs need a bespoke effect — most just fall back to "naturally synergistic," and that's fine.

## Item system (settled — DESIGN.md §7)

- **Default attack** — baseline, always present, not randomized.
- **Role items** — define/change a player's role. Scheduled drops at the end of levels 1, 2, 4, 6, 8 — only 5 opportunities across 7 roles, so no single run shows every role (intentional, for replayability).
- **Boost items** — role-agnostic stat ups (attack speed, move speed, damage, etc.) plus role-specific modifiers (e.g. "+15% freeze chance") in the same tier. Regular room-clear reward.
- **Holdable item** — a single equip slot, not a stacking collection. A new pickup auto-swaps and drops the old one on the ground (teammate can grab the discard). Each role has one signature holdable (DESIGN.md table); several universal/co-op holdables also compete for the same slot (self-immunity, teammate-immunity, Second Wind, etc.).
- **Life items** — rare, unscheduled room-clear drop, +1 life.

## Run structure (settled — DESIGN.md §8-9)

10 levels, 6-10 rooms each, mini-boss ending levels 1-9, final boss (with role-favoring phases) on level 10 with no regular rooms. Role item drops at the end of levels 1, 2, 4, 6, 8. Five enemy archetypes (Swarmer, Tank, Chaser, Ranged shooter, Splitter) introduced on a schedule across levels 1-9. Room archetype mixing ramps up with floor depth (not a flat rule): single-archetype rooms through level 6, mixed 2-archetype rooms start appearing at levels 7-8 (mix frequency TBD, needs real room generation to tune against), level 9 rooms freely combine 3+ archetypes. Single-sitting only — no save/resume across sessions.

## Characters

- **Player 1:** reuses the existing wizard character (already designed/sprited elsewhere).
- **Player 2:** needs a new, visually distinct design — different silhouette/color language, so both players are readable at a glance during shared-screen combat with friendly-fire risk (relevant to Bomb).

## Explicitly deferred (not designed yet, don't build)

- Shop system (currency spending, role-change-for-coins)
- Local same-computer co-op mode (remote is being built first)
- Save/resume across sessions (explicitly rejected — single sitting only)

## Current build status

Networking-first build order (deliberately built before single-player game content, so the hardest architectural piece — sync — is proven against trivial content first):

- ✅ Phase A — Main menu wired to route into this game's scene(s)
- ✅ Phase B — PeerJS host/join lobby with room codes, connection confirmed end-to-end
- ✅ Phase C — Minimal synced movement proof-of-concept: two debug squares, host-authoritative, joiner input forwarded to host, host broadcasts positions ~20/sec. Interpolation deliberately NOT added yet at this stage (raw latency was intentionally left visible to establish a baseline).
- ✅ Phase D — Joiner-side interpolation: both squares ease toward the latest received position each frame (frame-rate-independent exponential smoothing, `INTERPOLATION_RATE` in `DevTestScene.ts`) instead of snapping, except the very first update after connecting (snaps immediately so nothing slides in from spawn). Host-side rendering untouched — it's already smooth via local simulation.
- ✅ Lives system (DESIGN.md §3) — prototyped on the same debug squares ahead of real Phase E/F+ content: per-player lives, post-hit invincibility with flicker, out-of-lives freeze/gray-out, a bouncing debug enemy + Arcade overlap standing in for real hit detection, all riding in the same `StateMessage` broadcast as position. See "Lives & death" above for the module breakdown. Not a numbered phase of its own — it's built across whatever the current phase is.
- 🟡 Phase E (sprite-free slice done) — `src/games/teamGame/entities/Player.ts` is a real entity now (still a colored `Rectangle`, no texture yet): movement, life state, invincibility flicker, and gray-out all live on it instead of duplicated host/joiner fields in `DevTestScene.ts`. Diagonal movement is now normalized (`setVelocityFromKeys`), closing the gap noted below in earlier phases. Same `simulated: boolean` split as before (host owns physics + `LifeState` per player; joiner renders received `PlayerState` and interpolates). Still outstanding for Phase E to be fully done: real sprites/art once available — nothing else about the entity should need to change when that lands.
- ✅ Default attack, fire-the-projectile only (DESIGN.md §4) — prototyped ahead of the numbered phases, same as lives. Space fires toward whichever direction the player is currently facing (`Player.getFacingAngle()`, derived from the same movement `KeyState` already used for velocity — no separate aim input exists), host-authoritative fire-rate (`gameplay/attack.ts`, mirrors `gameplay/lives.ts`'s pure-state style; `Player.tryFire`), host-simulated `Projectile` entities (`entities/Projectile.ts`, same `simulated: boolean` split as `Player`) that despawn past a max range rather than colliding with world bounds. Joiner never picks whether a shot fires — it just reports its held/not-held fire state as one more field on the regular `InputMessage` (`fire: boolean`, sent on change same as movement) and lets the host's cooldown decide; there's no separate `AttackMessage`/resend-timer, since aim has no continuous component to poll now that it's derived from discrete key state. Never hits either player (only Bomb has friendly-fire per DESIGN.md). `StateMessage.projectiles` is the protocol's first dynamic-length array field — real enemies will follow the same pattern. Laser and Bomb (the other two input shapes) are NOT built — nothing exists yet to select a role, so there'd be nothing to trigger them.
- ✅ Enemy health & death — enemies are a real `entities/Enemy.ts` (same `simulated: boolean` split as `Player`/`Projectile`): 3 HP, flashes and ticks down on each hit. Superseded by the room work below: death no longer respawns the same enemy — a killed enemy is just removed from its room's list for good, since "room clear" (the list is empty) is now the real mechanic that used to be stood in for by a respawn timer.
- ✅ Fixed room layout + transitions (step 1 of 3: fixed layout → real archetypes → procedural generation) — `rooms/floorLayout.ts` is a small hand-authored 2x2 room grid (`TEST_FLOOR`), shared compile-time knowledge on both host and joiner so only the *current* room coord needs to go over the wire (`StateMessage.roomCoord`), not the layout itself. A room now holds a *list* of enemies (`roomEnemies: Map<number, Enemy>`, `StateMessage.enemies: EnemyState[]` — enemies gained an `id` the same reason `Projectile` has one), and doors (4 fixed screen-edge zones, no physics body — checked by position, not Arcade overlap, since they're not obstacles) open once that list is empty. Walking into an open door is host-authoritative: `loadRoom()` tears down the current room's enemies/colliders and every live projectile (they don't carry through a door), teleports both players (`Player.teleport()`, new) to an entry point on the far side, and spawns the next room. On the joiner, a `roomCoord` change first calls `Player.resetInterpolation()` (new) on both players so the transition is a cut, not a slide, then the existing create/destroy-on-presence reconciliation (already used for projectiles) handles the enemy-list churn with no special-casing. Deliberately simplified for this first slice: closed doors don't block movement (no wall-collision system exists), no special room types (item/shop/mini-boss) yet.
- ✅ Solo test mode — `LobbyScene.ts`'s "솔로 테스트 (개발용)" button starts `DevTestScene` with `{ solo: true }`, skipping `peerConnection.ts` entirely (no `Peer` ever created). Reuses the host's simulation code path as-is (`role` stays `'host'`; a separate `isSolo` flag only relaxes the top-level connection guard) with no `joinerPlayer` at all — not an idle stand-in, genuinely absent. Two spots needed auditing because they used to assume both players exist together: room-enemy collider registration (now two independent `if (this.hostPlayer)`/`if (this.joinerPlayer)` checks) and the game-over check in `handleHit` (a missing joiner now counts as vacuously already-out, so dying alone correctly ends a solo run).
- ✅ Networked pause (DESIGN.md §2) — Esc or a "계속하기" button in `DevTestScene.ts`; joiner's press is a `PauseToggleMessage` request, only the host flips `isPaused` and calls `this.physics.pause()`/`.resume()` (freezes both players, every enemy, and every live projectile in one call — nothing needed individual pause-awareness). `StateMessage.isPaused` broadcasts it, mirrored the same way `isGameOver` already is. All per-frame gameplay logic (movement, firing, sending, interpolation) short-circuits on `isPaused` for both roles; UI buttons keep working since they're event-driven, not gated by `update()`. The always-visible music/sfx toggle buttons were removed from teamGame (`LobbyScene.ts` and `DevTestScene.ts` — hub and the platformer's `StartScene` still have theirs, untouched) and now live inside this pause menu instead; `ui/audioToggles.ts`'s `createAudioToggleButtons` gained an optional position param to support that without changing its other call sites.
- ⬜ Step 2 — real enemy archetypes (Swarmer, Tank, Chaser, Ranged shooter, Splitter) replacing the placeholder `Enemy`, plus the room archetype-mixing ramp settled in "Run structure" below.
- ⬜ Step 3 — procedural floor generation, replacing `rooms/floorLayout.ts`'s hand-authored `TEST_FLOOR`. Only makes sense once step 2 gives it real content to generate variety with.
- ⬜ Phase F+ — Role system (data-driven, seven roles, unlocks Laser/Bomb attack shapes), room-clear loop rewards, item pickups, full run structure (including wiring up `respawnForNextLevel`), shop

## Working conventions

- Before any multi-file change, outline the plan (files touched, key types/interfaces introduced) and wait for confirmation before implementing.
- When touching the networking layer or physics/collision math, flag it explicitly in your summary — these are the areas most worth a careful diff review.
- If a task would require guessing at how the existing main menu, the platformer's code, or an earlier phase's implementation actually works, inspect the relevant files first rather than assuming.
