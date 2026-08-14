# 2-Player Co-op Roguelike — Game Design Document

**Working title:** TBD
**Repo:** same repo as the platformer (1000-days-game), accessed via the existing main menu
**Stack:** Vite + TypeScript + Phaser 3, Arcade Physics (no gravity), PeerJS for networking

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
- **Life items** occasionally drop as a possible room-clear reward (rare/random chance, not scheduled like role items) — grant +1 life.

---

## 4. Attack System

Three distinct attack-input shapes, branching by equipped role — **this needs to be architected as three input handlers from the start**, not retrofitted:

| Input pattern | Roles |
|---|---|
| Space → fire projectile toward the direction you're currently facing | Ice, Glue, Poison, Electric, Gravity |
| Space → instant line/beam in the direction you're facing, hits all enemies in path | Laser |
| Hold Space to charge → release to fire; charge duration determines travel speed | Bomb |

Every character has this same baseline "default attack" (tears-style) before any role is equipped — role changes *what the attack does and how it's fired*, not whether an attack exists.

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

### Role-change rules
- First pick: free, near the start of the run.
- One additional free change: offered specifically **after clearing level 1** (not before).
- Further changes: via coins at a shop (shop system not yet designed — deferred).
- Role-specific boost items becoming useless after a switch is intentional — no migration/refund system.

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

Two tiers of regular pickups, plus a separate holdable slot:

1. **Default attack** — baseline, always present, not randomized.
2. **Role items** — define/change which of the 7 roles a player has. Scheduled drops: end of levels 1, 2, 4, 6, 8 (roughly once per level, front-loaded then spaced out). With 5 drop opportunities across 7 roles, no single run can show every role — reinforces replayability.
3. **Boost items** — role-agnostic stat ups (attack speed, move speed, damage, projectile count, range, etc.) plus role-specific modifiers (e.g. "+15% freeze chance") living in this same tier. Regular room-clear reward.
4. **Holdable item** — a **single equip slot** (not a stacking collection). Picking up a new holdable while the slot is full **auto-swaps and drops the old one on the ground** (teammate can pick up the discard if it suits their role). Drops randomly in regular rooms, same frequency class as other consumables — not mini-boss-exclusive.
5. **Life items** — rare, random chance on room-clear (not scheduled). Grants +1 life.

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
- **Role item** drop at the end of levels 1, 2, 4, 6, 8.
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

---

## 9. Enemy Archetypes

| Archetype | Behavior | Favors | Struggles against |
|---|---|---|---|
| Swarmer | Many weak, low HP, clustered | Bomb, Laser | Poison |
| Tank | Single high-HP, slow | Poison, Electric | Bomb (overkill) |
| Chaser | Fast, beelines at nearest player | Ice, Glue, Gravity | Laser (hard to line up) |
| Ranged shooter | Stays at distance, fires at players | Gravity (drag into range), Laser | Poison (too slow) |
| Splitter | Splits into two weaker enemies on death | Ice, Electric (control the split) | Bomb (can worsen the mess) |

---

## 10. Characters

- **Player 1:** reuse the existing wizard character (already fully designed/sprited from the other project).
- **Player 2:** needs a **new, visually distinct** design — different silhouette/color language from Player 1, so both players can be told apart at a glance during chaotic shared-screen combat with friendly-fire risk.

---

## 11. Sprite & Asset Checklist

Organized by priority — **Core** is what you need to start implementing gameplay; the rest can follow once the loop is fun.

### Core (needed early)
- [ ] **Player 1** — idle/move in 8 directions (or a simpler 4-direction + flip scheme), a "charging" pose (for Bomb), a hit-reaction frame
- [ ] **Player 2** — same animation set, visually distinct design from Player 1
- [ ] **Generic projectile base sprite** (can reskin/tint per role initially rather than 7 fully unique projectiles on day one)
- [ ] **Swarmer enemy** — idle/move, death
- [ ] **Chaser enemy** — idle/move, death
- [ ] Basic **floor/wall tileset** for rooms (one theme is enough to start)
- [ ] **Life/heart icon** (UI + pickup)
- [ ] **Coin icon** (simple, even though the shop is deferred — cheap to make now)

### Role-specific VFX (7 roles — can start as tinted/simple versions, polish later)
- [ ] Ice — projectile + freeze overlay effect on affected enemies
- [ ] Glue — projectile + slow/goo overlay effect
- [ ] Poison — projectile + DoT tick visual (cloud/particle)
- [ ] Electric — projectile + chain-arc visual between two enemies
- [ ] Gravity — projectile + pull/vortex visual
- [ ] Laser — beam visual (instant line, needs a charge-up or fire flash moment)
- [ ] Bomb — thrown-object sprite, fuse/countdown indicator, explosion VFX

### Item icons
- [ ] 7 role-item pickup icons (one per role, represents "you now have this role")
- [ ] 7 signature holdable icons (Absolute Zero, Molasses Trap, Plague Vial, Volatile Core, Overcharge Coil, Prism Beam, Singularity)
- [ ] ~8 universal/co-op holdable icons (Self-immunity, Teammate immunity, Second Wind, Extended Grace, Bonus Life, Bond, Amplifier, Shared Momentum)
- [ ] Generic boost item icons (attack speed, move speed, damage, projectile count, range — a handful of simple icons)

### Remaining enemies (needed by level 3+)
- [ ] Ranged shooter — idle/move, attack/fire animation
- [ ] Tank — idle/move (slow), hit-reaction
- [ ] Splitter — idle/move, death/split animation (splits into two)

### Bosses
- [ ] Mini-boss visuals for levels 1-9 — **consider palette-swapped/scaled-up versions of existing enemy archetypes** rather than 9 fully unique designs, to keep art scope reasonable
- [ ] Final boss (level 10) — ideally one base design with 3 distinguishable visual states for its phases (tint/silhouette changes are cheaper than 3 fully separate character designs)

### UI
- [ ] Life counter display (per player)
- [ ] Pause menu screen
- [ ] Room-clear reward selection UI
- [ ] Mini-boss / boss health bar (with phase indicators for the final boss)
- [ ] Current-role indicator per player (small icon near each player's life counter, so both players can see what role their partner currently has — supports the synergy gameplay)

---

## 12. Explicitly Deferred (not designed yet, don't build)

- Shop system (currency spending, role-change-for-coins)
- Local same-computer co-op mode (remote is being built first)
- Save/resume across sessions (explicitly rejected — single sitting only)
