# Co-op Roguelike — Project Context

This file is persistent context for Claude Code. Read this before starting any task on the co-op roguelike. This game shares a repo with an existing platformer (Hungry Monster clone) — do not modify the platformer's files unless a task explicitly says to touch the shared main menu.

## What this game is

A 2-player online co-op roguelike, shared-screen/shared-room (both players always in the same room together, not separate screens), inspired by The Binding of Isaac. One player hosts a room and shares a short room code; the other joins with that code. Runs are randomized and replayable: randomized item drops, randomized room enemy composition, six selectable "roles" (elements) with mechanical synergies between them.

## Architecture decisions (settled — don't relitigate without asking)

- **Stack:** Vite + TypeScript + Phaser 3, same repo as the platformer, routed to via the existing main menu scene.
- **Physics:** Arcade Physics, gravity disabled (`{ x: 0, y: 0 }`) — this is a top-down game, not a platformer. 8-directional movement via velocity, with diagonal movement normalized so it isn't faster than cardinal movement.
- **Camera:** Static per room. The camera never scrolls or follows a player within a room — it only cuts/transitions between rooms. This is a deliberate Isaac-style choice and also sidesteps multiplayer camera-follow conflicts.
- **Networking:** PeerJS (WebRTC), host-authoritative. The host's game instance is the source of truth: it simulates both players, resolves all hits and collisions, and broadcasts authoritative state. The joiner sends only input (movement direction, attack triggers) to the host — the joiner never simulates their own movement locally; they render based on state received from the host. Interpolate the joiner's rendered view (lerp toward the latest received position each frame) rather than snapping.
- **Room code flow:** Host generates a short alphanumeric PeerJS id, displays it; joiner enters it to connect. Handle failed/nonexistent codes with a visible error, not a silent hang.
- Networking is layered UNDER regular gameplay code, not bolted on after. Player movement, attacks, and room logic should be written so they don't care whether input came from a local keypress or a forwarded network message — same input-handling code path either way.

## Item system (settled)

Two tiers only — no separate "modifier" tier:

- **Default attack** — every character has a baseline projectile attack (mouse-aim, fire-rate as a tunable stat) that exists before any role is equipped. This is the "tears" system, Isaac-style.
- **Role items** — six roles, each redefining what the default attack does on hit (some change the attack's shape entirely, not just its effect — see Laser below). Roles are rolled/found during the run, not chosen upfront.
- **Boost items** — role-agnostic numeric/behavioral stat ups (attack speed, move speed, damage, projectile count, range, etc.). Role-specific modifiers (e.g. "+15% freeze chance") live in this same tier rather than a separate one — some boost items are only useful with a matching role equipped, and that's fine.

### The six roles

| Role | Effect | Notes |
|---|---|---|
| Ice | Chance to freeze enemy on hit (immobilize for a duration) | Chance-based |
| Electric | Chance to chain damage to a nearby enemy on hit | Chance-based |
| Bomb | Powerful AoE damage on hit; can damage the player or their teammate if too close to the blast | Risk/reward, only role with friendly-fire risk |
| Poison | Applies damage-over-time for N seconds | DoT |
| Laser | Attack becomes a narrow instant beam spanning the room in the aim direction, hitting all enemies in its path | Changes the attack's shape, not just its hit effect — needs its own code path in the fire-attack logic, not just an onHit hook |
| Gravity | Projectile pulls nearby enemies toward it while in flight | Ongoing per-frame effect, not just an on-hit trigger |

Fire was considered and removed — only these six exist.

### Role-change rule (settled)

- First role pick: free, near the start of the run.
- One additional free role change: offered specifically after clearing floor 1 (not before, not automatically available earlier).
- Further changes: available via coins at a shop (shop system not yet designed/built — hold this for later).
- Boost items that are role-specific becoming "orphaned"/useless after a role change is intentional — do not build any system to prevent, refund, or migrate stats on role change. This is a deliberate risk/cost of switching.

### Fun/universal item ideas (not yet built, for future reference)

- Immunity to teammate's friendly-fire damage (relevant mainly to Bomb)
- Increased probability of role's chance-based effects (Ice, Electric)
- Increased magnitude of role's effect (thicker Laser, stronger Gravity pull, longer Poison duration)

## Current build status

Networking-first build order (deliberately built before single-player game content, so the hardest architectural piece — sync — is proven against trivial content first):

- ✅ Phase A — Main menu wired to route into this game's scene(s)
- ✅ Phase B — PeerJS host/join lobby with room codes, connection confirmed end-to-end
- ✅ Phase C — Minimal synced movement proof-of-concept: two debug squares, host-authoritative, joiner input forwarded to host, host broadcasts positions ~20/sec. Interpolation deliberately NOT added yet at this stage (raw latency was intentionally left visible to establish a baseline).
- ✅ Phase D — Joiner-side interpolation: both squares ease toward the latest received position each frame (frame-rate-independent exponential smoothing, `INTERPOLATION_RATE` in `SyncTestScene.ts`) instead of snapping, except the very first update after connecting (snaps immediately so nothing slides in from spawn). Host-side rendering untouched — it's already smooth via local simulation.
- ⬜ Phase E — Replace debug squares with real Player entities (8-directional movement, real sprites), keeping the exact same networking pipeline unchanged
- ⬜ Phase F+ — Default attack (networked), role system (data-driven, see architecture above), basic enemies, room-clear loop, item pickups, floor/run structure, shop

## Working conventions

- Before any multi-file change, outline the plan (files touched, key types/interfaces introduced) and wait for confirmation before implementing.
- When touching the networking layer or physics/collision math, flag it explicitly in your summary — these are the areas most worth a careful diff review.
- If a task would require guessing at how the existing main menu, the platformer's code, or an earlier phase's implementation actually works, inspect the relevant files first rather than assuming.
