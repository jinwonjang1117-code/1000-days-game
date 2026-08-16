# 2-Player Co-op Roguelike — Game Design Document

**Working title:** TBD
**Repo:** same repo as the platformer (1000-days-game), accessed via the existing main menu
**Stack:** Vite + TypeScript + Phaser 3, Arcade Physics (no gravity), PeerJS for networking

---

## Core Design Tenet: Build For Composability

**Roles, strong items, and boost items should stack together by default — not be siloed systems that only work in isolation.** The five status-effect roles (Ice/Glue/Poison/Electric/Gravity, §5) are on-hit effects layered onto the *same* default-attack projectile that Multi Shot multiplies, Homing steers, Pierce carries through extra enemies, and boost items scale (damage/speed/range/size). A player holding Ice + Multi Shot + a damage boost should get bigger, faster, freezing, multiplied shots — not have to pick a lane. This isn't a nice-to-have, it's a design requirement: **every new role, strong item, or boost item must be reviewed against this before it ships** — does it naturally inherit whatever else is already stacked, or does it need special-case wiring that quietly breaks composability?

Any item that deliberately opts out (e.g. Buddy's damage is fixed and does *not* scale with the owning player's stats, §7 — a deliberate balance call so it isn't just a second copy of your build) must say so explicitly as a **named exception**, not fall out of an implementation shortcut nobody noticed. When in doubt, an item should compose; breaking that needs a reason on the record, not silence.

---

## 1. Core Concept

A 2-player online co-op roguelike inspired by The Binding of Isaac. One player hosts, the other joins via a short room code. Both players share the same screen/room at all times (not separate explorable areas). Runs are randomized and replayable: randomized role drops, randomized room enemy composition, and mechanical synergies between seven roles.

**Theme:** Two apprentice mages pulled into a dungeon that reshuffles itself. Their magic is unstable and can affect each other (explains Bomb's friendly-fire risk as a world rule, not just a balance quirk).

---

## 2. Core Mechanics

- **Camera:** Static per room — never scrolls or follows a player mid-room. Only cuts/transitions between rooms.
- **Movement:** Top-down, 8-directional, no gravity. Diagonal movement normalized so it isn't faster than cardinal movement.
- **Networking:** Host-authoritative. Host simulates both players, all enemies, all hit resolution. Joiner sends only input (movement direction, attack triggers); joiner's screen renders from interpolated state received from host, never local prediction.
- **Pause:** Either player can pause (e.g. Esc) — pauses for both, opens a menu on both screens.

---

## 3. Lives & Death

- **No HP pool.** Players have a direct number of lives. Any hit from an enemy decrements a life directly (no damage-amount variance from regular hits — a hit is a hit).
- **Lives are per-player**, individual pools, not shared.
- **Starting lives: 5.** Needs **post-hit invincibility frames** (~1-1.5s, with a visual flicker) after any hit so overlapping enemy contact doesn't delete multiple lives at once.
- A player who runs out of lives is out for the **rest of the current level**, and respawns at the **start of the next level** with a **fixed 3 lives** — not the starting 5, and not inherited from the other player's current count. (Settled; previously TBD.)
- If **both** players are out of lives within the same level, the run ends immediately.
- **Life items** occasionally drop as a possible room-clear reward (rare/random chance, not scheduled like role items) — grant +1 life, capped at the player's current max (see Heart Containers below).

### Heart Containers (settled)

- Each player has a **max lives** cap in addition to their current count — starts equal to the starting 5. Life items top up toward the cap, they don't exceed it.
- The cap itself grows two ways:
  1. **Passively, +1 every 2 levels** — a guaranteed trickle of extra survivability over a run regardless of item luck. (Not how Isaac does it — Isaac's health growth is 100% item-driven, no depth-based scaling — this is a deliberate departure, not an attempt to match it.)
  2. **Heart Container item** (a strong item, see §7) — +2 max lives, and fills the new capacity immediately (you gain the 2 lives too, not just headroom).

---

## 4. Attack System

Three distinct attack-input shapes, branching by equipped role — **this needs to be architected as three input handlers from the start**, not retrofitted:

| Input pattern | Roles |
|---|---|
| Space → fire projectile toward the direction you're currently facing | Ice, Glue, Poison, Electric, Gravity |
| **Hold** Space → continuous beam in the direction you're facing for as long as it's held, hits all enemies in the line each tick | Laser |
| Hold Space to charge → release to fire; charge duration determines travel speed | Bomb |

Every character has this same baseline "default attack" (tears-style) before any role is equipped — role changes *what the attack does and how it's fired*, not whether an attack exists.

**Laser is a channel, not a discrete shot** (settled; previously "instant beam on tap") — holding Space keeps the beam firing continuously rather than a single line spawned per press. Beam thickness scales with the same size stat that scales projectile radius for every other attack shape — one stat means "how big is my attack," regardless of shape.

**Aim is keyboard-driven, not mouse-driven** (settled; previously "click → fire toward cursor"): movement is arrow keys, and aim is whichever direction you're currently moving, or the last direction you moved if you're standing still — there's no separate aiming input. Fully keyboard, no mouse involved anywhere in this game.

---

## 5. The Seven Roles

Fire was considered and removed. Final roster:

| Role | Effect | Attack shape | Notes |
|---|---|---|---|
| **Ice** | Chance to freeze enemy temporarily (n seconds) on hit | Space-fire projectile | Chance-based, swingy, big payoff |
| **Glue** | Applies a stacking slow on hit | Space-fire projectile | Reliable, always does *something* |
| **Poison** | Damage-over-time for n seconds | Space-fire projectile | Sustained damage |
| **Electric** | Chance to chain damage to a nearby enemy on hit | Space-fire projectile | Only role that can early-detonate a Bomb |
| **Gravity** | Pulls nearby enemies toward the projectile while in flight | Space-fire projectile | No direct damage identity on its own (by design — team-support role); its signature holdable adds one |
| **Laser** | Attack becomes an instant beam spanning the room, hits all enemies in the line | Space → instant beam | Changes attack *shape*, not just hit effect |
| **Bomb** | Powerful AoE on detonation; costs the player/teammate a **full life** if caught in the blast | Hold-charge → thrown, slides and decelerates, explodes after a timed fuse | Highest risk role. Only Electric can detonate it early. Player can move while charging. |

### Role acquisition (settled — supersedes the earlier "free pick at run start + shop" draft)

Roles are **found, not chosen up front.** A role is a single-equip item, mechanically its own category from stackable strong items (§7) even though both are discovered the same way — golden room and boss-room drops. Picking up a new role **replaces** whichever one you currently have (no migration/refund for anything that specialized around the old one — that loss is intentional, same spirit as the old shop-era rule). No free starting pick and no guaranteed early role — **playing the early game on nothing but the default attack is an accepted, expected part of a run**, not a bug. The old "free pick near run start, free change after level 1, further changes via shop" progression is retired along with the shop system it depended on.

---

## 6. Synergy / Combo System

Status effects exist as shared world-state — **any player's ability can trigger a combo off a status the other player applied**, not just their own.

| Combo | Effect |
|---|---|
| Ice + Electric | Frozen enemies take bonus chain damage and shatter (small AoE) on kill |
| Ice + Glue | Glued (slowed) enemies have a higher freeze chance |
| Ice + Gravity | Frozen enemies pulled by Gravity leave a brief slowing ice patch |
| Poison + Bomb | A poisoned enemy killed inside a Bomb blast releases its poison as a cloud |
| Gravity + Laser | Gravity clusters enemies right before a Laser sweep — marquee "setup + payoff" combo |
| Gravity + Bomb | Pulling enemies into your own Bomb blast — pulls them toward you too (risk/reward) |
| Poison + Electric | Chain damage on a poisoned enemy has a chance to spread the poison to the chain target |
| **Electric + Bomb** | Electric can detonate a live bomb early. **This is the only role allowed to interact with Bomb's fuse** — deliberately exclusive, not a general rule |

Not every one of the 21 possible role pairs needs a bespoke effect — a handful of marquee combos plus "naturally synergistic" for the rest is healthier scope than hand-designing all 21.

---

## 7. Item System

Regular pickups, a stackable strong-item pool, a single-equip role slot, and a separate holdable slot:

1. **Default attack** — baseline, always present, not randomized.
2. **Boost items** — role-agnostic stat ups (attack speed, move speed, damage, projectile count, range, etc.) plus role-specific modifiers (e.g. "+15% freeze chance") living in this same tier. Regular room-clear reward, deliberately rare on a normal clear (a low drop-chance roll, see build status) now that their per-pickup effect is a bit stronger than the original tuning — also part of the golden/boss room pool (below), where they're guaranteed instead of a coin-flip.
3. **Holdable item** — a **single equip slot** (not a stacking collection). Picking up a new holdable while the slot is full **auto-swaps and drops the old one on the ground** (teammate can pick up the discard if it suits their role). Drops randomly in regular rooms, same frequency class as other consumables — not mini-boss-exclusive.
4. **Life items** — rare, random chance on room-clear (not scheduled). Grants +1 life, capped at max (§3).
5. **Strong items** — a stackable pool sourced from golden-room and boss-room drops. Those rooms draw **2 distinct items** from a combined pool of strong items *and* boost items (never `heart`, and never gated by the regular pool's drop-chance roll) — a boost item found this way still renders with its normal mystery "?" look, only strong items are visually identified on the ground. Each strong item has a `weight` (rarer ones roll less often) and a `unique` flag: most stack freely (pick up Multi Shot twice, it compounds), a handful are capped at one per run. Current roster:
   - **Multi Shot** — extra projectiles per attack (stacks)
   - **Pierce** — a shot survives passing through an extra enemy (stacks)
   - **Homing** — shots steer toward the nearest enemy (stacks)
   - **Multi Direction** — fire in more directions at once (stacks)
   - **Heavy Shot** — big damage up, projectile size up, projectile speed down a lot (stacks) — strong vs. slow/tanky archetypes, weak vs. anything that just walks around a slow shot
   - **Buddy** (stacks) — a familiar that trails/follows the player Isaac-style and fires whenever you do, mirroring your aim direction. Small fixed projectile size, and its damage does **not** scale with the owning player's stats (flat, so it doesn't just become a second copy of whatever you've built) — collecting several stacks up to multiple buddies
   - **Orbiting Shield** (stacks) — a shield that circles the player and **damages enemies on contact**; multiple stacks add more shields circling at once, Isaac-orbital-style
   - **Heart Container** (stacks) — +2 max lives, fills the new capacity immediately (§3)
6. **Role items** — define/change which of the 7 roles a player has (§5). Sourced the same way as strong items (golden/boss rooms), but a **separate, single-equip category**: picking one up replaces whatever role you currently had, it doesn't stack. No scheduled drops anymore — purely find-based, including no role at all being a normal early-run state.
7. **Devil's Room items** — exclusive to the Devil's Room (§9), never found anywhere else. Deliberately risk/reward: most cost something real (usually a max heart container) for an outsized payoff.

**Mystery pickups** (settled): every regular-tier pickup (boost, life, and the joke Fart item below) looks identical on the ground — one generic unidentified visual — so the effect is only revealed on pickup, not before. Strong items, role items, and Devil's Room items are all the exception: they're visually identified, since they're an earned reward rather than a grab-bag roll.

**Fart** — a no-op regular-tier item (does nothing mechanically) that exists purely for the joke of an unlucky mystery pickup. Its color and payoff (a farting noise) are only revealed on pickup, same as everything else in the mystery pool.

### Signature holdables (one per role)

| Role | Holdable | Effect |
|---|---|---|
| Ice | *Absolute Zero* | Freeze chance & duration up; frozen enemies take bonus damage from any source |
| Glue | *Molasses Trap* | Slow splashes to nearby enemies |
| Poison | *Plague Vial* | Poison spreads to adjacent enemies on every tick, not just on death |
| Bomb | *Volatile Core* | Blast radius substantially increased (no self-damage reduction — leans into the risk) |
| Electric | *Overcharge Coil* | Chain jumps to 2 additional enemies instead of 1 |
| Laser | *Prism Beam* | Beam splits into 3 parallel lines |
| Gravity | *Singularity* | Pull radius/strength up; pulled enemies take continuous damage while dragged (gives Gravity a real damage identity) |

### Universal / co-op holdables (role-agnostic, compete for the same single slot)

- **Self-immunity** — no damage from your own attacks (huge for Bomb specifically)
- **Teammate immunity** — no damage *to* your teammate from your attacks
- **Second Wind** — prevents your next life loss, once per run
- **Extended Grace** — longer post-hit invincibility window
- **Bonus Life on Level Clear** — rare chance to gain a life at the end of a level
- **Bond** — bonus damage to enemies near your teammate
- **Amplifier** — bonus damage on your next hit against an enemy already affected by your *teammate's* status
- **Shared Momentum** — a kill grants a brief speed/fire-rate boost to both players

---

## 8. Run Structure

- **10 levels total**, each a mini-floor of **6-10 rooms**.
- **Mini-boss at the end of every level** (1-9); **final boss on level 10** (no regular rooms that level).
- **One Golden Room per level** (no fight, guaranteed strong/role item) — see §9.
- Role items no longer have scheduled drops (retired along with the old role-acquisition rules, §5) — purely sourced from golden/boss rooms now, same as strong items.
- **Enemy archetype introduction schedule:**

| Levels | New archetype introduced |
|---|---|
| 1-2 | Swarmers, Chasers |
| 3-4 | + Ranged shooters |
| 5-6 | + Tanks |
| 7-8 | + Splitters |
| 9 | Full mix, hardest regular level |
| 10 | Final boss only |

- **Room archetype mixing ramps up with floor depth** (settled; supersedes an earlier "levels 7-8 mixed, level 9 full mix" draft, now that real procedural generation exists to tune against — `rooms/floorGenerator.ts`):
  - Levels 1-3: each room stays single-archetype (matches the introduction schedule — a new archetype is learned in isolation before anything combines with it).
  - Level 4+: mixed rooms start appearing — mix chance ramps from there (`clamp((level-3)*0.2, 0, 0.8)`) up to a cap.
  - Level 8+: a smaller additional chance (~0.3) mixes 3 archetypes instead of 2, once enough are unlocked.
  - Enemy count per room also scales with level, so difficulty ramps via both variety and volume, not mixing alone.
- **Final boss** should have distinct phases that favor different roles (e.g. a Tank phase rewarding sustained DoT, a Swarm-summon phase rewarding AoE, a flee/snipe phase rewarding Gravity) so the fight doesn't just reward "whichever role does the most raw damage."
- **Single-sitting runs only** — no save/resume across sessions. This is why the pause system (section 2) matters — a 70-90 room run needs a real pause, not just a nice-to-have.
- **Room structure variety** (built — `rooms/roomLayouts.ts`, `rooms/floorGenerator.ts`'s `pickRoomObstacles`): most rooms stay open, but a room can get **rock pillars** (4-8, scattered, block movement *and* projectiles) or, if it rolled a `keepDistance`/ranged enemy group (currently just Ranged shooter), a **water split** instead (blocks movement only — shots pass over freely) that keeps that group genuinely out of melee reach on the far side. Start/boss/golden rooms always stay open. Layouts are room-intrinsic, not entry-direction-aware — a small accepted rough edge, not a bug.

---

## 9. Special Rooms

### Golden Room (settled)

- **One per level**, no fight — the room simply has no enemies, so it reads as instantly "cleared."
- Guaranteed drop: **2 distinct items**, drawn from strong items *and* boost items combined (or role items too, once those exist, §7) — never `heart`, and never gated by the regular pool's drop-chance roll. Boss rooms drop the same way.
- Doors behave like any other non-boss room (no special hole/portal) — finding it doesn't end the level, it's just a room on the path that happens to be a sure thing instead of a fight.

### Devil's Room (settled)

- **Trigger**: clearing the level's boss room **without taking a hit** during that fight. Miss the no-hit condition and the room simply isn't there this level — no consolation prize.
- **A real, separate room** (not just a reward screen) — reachable through a distinct door/portal in the boss room, deliberately its own space so it can eventually get its own visual/audio identity (lighting, BGM) instead of reusing a normal room's look.
- **Choice, not a pickup**: offers **2-3 options**, take exactly one. The others are gone once you choose — no "grab them all."
- **Devil's Room items are exclusive** — never appear anywhere else (not golden rooms, not boss rooms). Built around real risk, usually a permanent cost (most often a max heart container, §3) for an outsized payoff — meaningfully stronger and/or stranger than anything in the regular strong-item pool, since the cost is what justifies the power. First few concepts (not final): **Blood Pact** (-1 max heart container, +75% damage), **Demon's Eye** (-1 max heart container, gain/stack Homing), **Soul Siphon** (-1 max heart container, kills have a chance to drop a heart), **Reckless Vow** (no upfront cost — your next would-be-fatal hit this level instead triggers a big temporary buff).

---

## 10. Enemy Archetypes

| Archetype | Behavior | Favors | Struggles against |
|---|---|---|---|
| Swarmer | Many weak, low HP, clustered | Bomb, Laser | Poison |
| Tank | Single high-HP, slow | Poison, Electric | Bomb (overkill) |
| Chaser | Fast, beelines at nearest player | Ice, Glue, Gravity | Laser (hard to line up) |
| Ranged shooter | Stays at distance, fires at players | Gravity (drag into range), Laser | Poison (too slow) |
| Splitter | Splits into two weaker enemies on death | Ice, Electric (control the split) | Bomb (can worsen the mess) |

**Second wave (built)** — added because the original 5 read as too passive (a fixed-speed beeline or a stationary poke). Role-favor columns aren't filled in yet since roles don't exist as a build target — revisit once they do.

| Archetype | Behavior |
|---|---|
| Erratic | Ignores players entirely — periodically retargets to a random direction *and* random speed (50-100% of base). Hard to lead shots against; deliberately not tanky, since the difficulty is dodging it, not surviving it. |
| Charger | Idle until a player is within range, then telegraphs (brief pause + tint) before committing to a straight-line dash at high speed toward wherever they were standing — doesn't re-track mid-dash. Punishes standing still. |
| Summoner | Keeps its distance like a Ranged shooter but never attacks directly — periodically spawns a random pick from its summon pool near itself, regardless of player proximity (Weak: just Weak Swarmer; Strong: Weak Swarmer *or* Weak Moving Shooter, mixing real ranged pressure into the filler). Has to be prioritized or the room snowballs. |
| Spread Shooter | A Ranged shooter variant whose shot is a multi-projectile fan instead of one, mirroring the player's own Multi Shot spread math. Covers an arc, not a line. |
| Berserker | A plain melee chaser until health drops to/below half, at which point its speed jumps and it stays visibly tinted for the rest of the fight. Punishes slow chip damage. |
| Slime | A slow melee chaser that, while alive, periodically drops a lingering damage zone at its current position (a few seconds, then it fades). Death itself is just a normal death — the hazard is a while-alive mechanic, not an on-death one. Real area denial through a doorway or chokepoint. |

---

## 11. Characters

- **Player 1:** reuse the existing wizard character (already fully designed/sprited from the other project).
- **Player 2:** needs a **new, visually distinct** design — different silhouette/color language from Player 1, so both players can be told apart at a glance during chaotic shared-screen combat with friendly-fire risk.

---

## 12. Sprite, Sound & Music Checklist

Organized by priority — **Core** is what you need to start implementing gameplay; the rest can follow once the loop is fun. This whole section is explicitly the **last stage** of the roadmap (CLAUDE.md) — everything is deliberately colored rectangles/arcs and either silence or the reused hub track until then, and that's fine; don't let placeholder-art guilt pull this forward early.

### Sprites — Core (needed early)
- [ ] **Player 1** — idle/move in 8 directions (or a simpler 4-direction + flip scheme), a "charging" pose (for Bomb), a hit-reaction frame
- [ ] **Player 2** — same animation set, visually distinct design from Player 1
- [ ] **Generic projectile base sprite** (can reskin/tint per role initially rather than 7 fully unique projectiles on day one)
- [ ] **Swarmer enemy** — idle/move, death
- [ ] **Chaser enemy** — idle/move, death
- [ ] Basic **floor/wall tileset** for rooms (one theme is enough to start)
- [ ] **Life/heart icon** (UI + pickup)
- [ ] **Coin icon** (simple, even though the shop is deferred — cheap to make now)

### Sprites — Room structures (rocks/water, §8 — built as colored rectangles, this is the real-art follow-up)
- [ ] **Rock obstacle** — solid, blocks movement and shots
- [ ] **Water tile** — blocks movement only, needs to visually read as "walkable-looking but isn't" vs. rock's "obviously solid," since the two behave differently
- [ ] Both need edge/transition tiles against the plain floor, not just a flat color block, or the room reads as broken rather than intentional

### Sprites — Role-specific VFX (7 roles — can start as tinted/simple versions, polish later)
- [ ] Ice — projectile + freeze overlay effect on affected enemies
- [ ] Glue — projectile + slow/goo overlay effect
- [ ] Poison — projectile + DoT tick visual (cloud/particle)
- [ ] Electric — projectile + chain-arc visual between two enemies
- [ ] Gravity — projectile + pull/vortex visual
- [ ] Laser — continuous beam visual (channeled while held, not a single flash — needs a sustained look, not just a muzzle flash)
- [ ] Bomb — thrown-object sprite, fuse/countdown indicator, explosion VFX

### Sprites — Strong-item VFX
- [ ] Multi Shot / Multi Direction — no new sprite needed beyond more of the existing projectile, but worth a quick "extra shots" pass check once there are visibly many on screen at once
- [ ] Pierce — a passthrough flash/trail so a pierced hit reads differently from a normal one
- [ ] Homing — a subtle trail/glow so a curving shot doesn't look like a rendering bug
- [ ] Heavy Shot — visibly bigger/heavier projectile, distinct from Big Shot's size boost
- [ ] Buddy — its own small sprite, distinct from both players
- [ ] Orbiting Shield — the orbiting shield itself, plus a contact-hit flash
- [ ] Heart Container — pickup icon, distinct from the regular Heart

### Item icons
- [ ] Strong-item pickup icons, one per item (Multi Shot, Pierce, Homing, Multi Direction, Heavy Shot, Buddy, Orbiting Shield, Heart Container) — unlike boost items these are visually identified on the ground, not a mystery "?", so each needs its own distinct icon rather than sharing one generic look
- [ ] 7 role-item pickup icons (one per role, represents "you now have this role")
- [ ] 7 signature holdable icons (Absolute Zero, Molasses Trap, Plague Vial, Volatile Core, Overcharge Coil, Prism Beam, Singularity)
- [ ] ~8 universal/co-op holdable icons (Self-immunity, Teammate immunity, Second Wind, Extended Grace, Bonus Life, Bond, Amplifier, Shared Momentum)
- [ ] Generic boost item icons (attack speed, move speed, damage, projectile count, range — a handful of simple icons)
- [ ] Devil's Room item icons (count depends on the final roster, decided when that stage starts)

### Remaining enemies (needed by level 3+)
- [ ] Ranged shooter — idle/move, attack/fire animation
- [ ] Tank — idle/move (slow), hit-reaction
- [ ] Splitter — idle/move, death/split animation (splits into two)

### Bosses
- [ ] Mini-boss visuals for levels 1-9 — **consider palette-swapped/scaled-up versions of existing enemy archetypes** rather than 9 fully unique designs, to keep art scope reasonable
- [ ] Final boss (level 10) — ideally one base design with 3 distinguishable visual states for its phases (tint/silhouette changes are cheaper than 3 fully separate character designs)

### UI
- [ ] Life counter display (per player) — including empty/unfilled heart containers once those exist, not just a number
- [ ] Pause menu screen
- [ ] Room-clear reward selection UI
- [ ] Mini-boss / boss health bar (with phase indicators for the final boss)
- [ ] Current-role indicator per player (small icon near each player's life counter, so both players can see what role their partner currently has — supports the synergy gameplay)
- [ ] Minimap room-type legend (golden/boss/devil colors already exist functionally — worth a small key somewhere once there's real UI chrome)

### Sound effects
- [ ] Default attack fire + impact (generic, reused until roles have their own)
- [ ] Per-role attack sound (7 — fire and, where relevant, the effect landing: freeze crack, chain-zap, explosion, etc.)
- [ ] Per-archetype hit/death (Swarmer, Tank, Chaser, Ranged shooter, Splitter incl. its split-apart sound, Boss) — Weak/Strong tiers can likely share a sound with a pitch/volume difference rather than needing fully separate ones
- [ ] Strong-item pickup stinger (generic "you got something strong" sting, on top of the visual reveal text) — Fart already has its own synthesized sound, matches the tier
- [ ] Regular pickup sound (boost/heart, generic, quieter than the strong-item stinger so the tiers feel different by ear alone)
- [ ] Room-clear chime, door-open sound
- [ ] Player hit / player-out sounds
- [ ] Level-up (boss hole entered) sting
- [ ] Pause/unpause UI blips
- [ ] Game-over sting, run-complete/victory sting (once Stage 12's run-end state exists)
- [ ] Devil's Room entry sting and choice-confirm sound (fits the risk/reward moment — should feel distinct from a normal pickup)
- [ ] Buddy fire sound (quieter/smaller than the player's own, so a room full of buddies doesn't just double the normal fire sound's volume) and Orbiting Shield contact-hit sound

### Music (BGM)
- [ ] Right now every screen (hub, lobby, and all of gameplay) reuses the same single `bgm-home.mp3` — real gameplay needs its own track(s), distinct from the hub
- [ ] Normal room loop (the bulk of playtime — needs to hold up on repeat over a 70-90 room run)
- [ ] Boss room track (tenser, distinct enough to signal "this is different" the moment a boss room's doors close)
- [ ] Golden Room and Devil's Room stings/ambience — brief and distinct is fine, these rooms are short visits, not full loops (Devil's Room was explicitly called out early on as wanting its own identity, DESIGN.md §9)
- [ ] Game-over track/sting
- [ ] Victory/run-complete track (once level 10 and a real run-end exist)
- [ ] Consider whether the lobby should keep sharing the hub track permanently or eventually get something of its own — not urgent, just flagging it hasn't been revisited since the very first pass

---

## 13. Explicitly Deferred (not designed yet, don't build)

- Shop system (currency spending, role-change-for-coins)
- Local same-computer co-op mode (remote is being built first)
- Save/resume across sessions (explicitly rejected — single sitting only)
