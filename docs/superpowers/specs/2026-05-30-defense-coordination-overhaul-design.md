# Defense Coordination Overhaul — Design

**Date:** 2026-05-30
**Status:** Draft, awaiting implementation
**Supersedes:** Defense flow in [src/handlers/combat.js](../../../src/handlers/combat.js) (defense + reinforce + urgent buttons)

## Summary

Replace the current single-tier defense flow (Defense Call / URGENT / Reinforce free-text troops) with a role-tiered alliance-war coordination system covering:

1. Role-based access (Leadership / Defense Coordinator / Member)
2. Member-submitted **Incoming Attack Reports** (separate channel)
3. Leadership-only **Active Def** and **Perma Def** calls (separate channel)
4. Structured **Inf/Cav** responses with auto-calculated def value (`def = inf + 2·cav`)
5. **Threat detection** heuristics (fake / real / chief) with manual override
6. **Intelligence dashboard** (pinned + on-demand drill-down) in a leadership channel
7. **In-between def detection** from wave-spread timing on reports

URGENT (@everyone) ping is removed — every report already pings Leadership + Defense Coordinator, and every Active Def pings def-crew.

## Goals

- Speed up alliance response by structuring report submission and surfacing threat verdicts immediately.
- Give leadership operational visibility (hot targets, attacker focus, open calls) at a glance.
- Distinguish fake/scouted-only attacks from real threats and chief attempts without manual triage.
- Preserve the existing edit/add/withdraw response ergonomics members already know.

## Non-goals

- Auto-URGENT @everyone escalation (rejected — false positives too costly).
- Single-channel ephemeral leadership view (rejected — three dedicated channels keep audit trails).
- Offense / scout / resource flows — out of scope; only `defense` panel UX changes.
- Paste-from-rally-point parser — architecture prepared, implementation deferred to a follow-up task.

## Roles & Permissions

Two configurable Discord roles + everyone else = Member.

| Tier | Identified by | Capabilities |
|---|---|---|
| Leadership | `LEADERSHIP_ROLE_NAME` env var | Everything: post Active/Perma Def, escalate reports, reclassify threats, see leadership channel, all archives, configuration |
| Defense Coordinator | `DEF_COORD_ROLE_NAME` env var | Same as Leadership for incoming/response ops; can Reclassify; can Escalate |
| Member | (anyone else) | Submit Report Incoming, Send Def, Close own report |
| Def-crew (existing) | `DEF_ROLE_NAME` env var (unchanged) | Pinged on every Active Def call (no other privilege change) |

A single helper `getTier(guildMember)` returns `'leadership' | 'def_coord' | 'member'`. Highest matching role wins. Used by every button/modal/slash handler that needs gating. Non-permitted clicks reply ephemerally: `❌ Leadership / Def Coord only.`

## Channels & Panels

Three new panel types stored in the existing `panels` table.

| Panel type | Set via | Hosts |
|---|---|---|
| `reports` | `/setup reports` | 📢 Report Incoming button; member-submitted report embeds; Leadership + Def Coord pings |
| `def-calls` | `/setup def-calls` | 🛡️ Active Def + 🛡️ Perma Def buttons (leadership-gated); def call embeds; member Sending Def responses |
| `leadership` | `/setup leadership` | Pinned intel dashboard; filled-call archive; round leaderboard |

The bot resolves "which channel for X?" by looking up the panel of that type. If a panel is missing when the bot needs to post (e.g. no leadership panel deployed yet), it logs a warning and skips the secondary post — the primary flow (e.g. the def call itself) still works.

Existing `defense` panel-type rows are migrated to `def-calls` in a one-shot migration.

## Data Model

Hybrid approach: extend the existing `calls` + `pledges` tables for the def-call/response flow (they fit cleanly); add one new table `incoming_reports` for member reports (different shape — events, not calls).

### `calls` (existing — new `type` values)

| Field | Meaning |
|---|---|
| `type` | New values: `def_active`, `def_perma`. Legacy `defense`, `reinforce`, `urgent`, `offense`, `scout`, `push:*` remain. |
| `x`, `y` | Defender coordinates |
| `deadline` | Impact time (Active only; NULL for Perma) |
| `payload` (JSON) | `{ troops_needed: int, notes: string|null, source_report_id: int|null }` |
| `status` | `open` / `filled` / `closed` / `expired` (Perma never auto-expires) |

### `pledges` (existing — schema additions)

| Field | Meaning |
|---|---|
| `inf` INTEGER DEFAULT 0 | **NEW** infantry units the responder is sending |
| `cav` INTEGER DEFAULT 0 | **NEW** cavalry units the responder is sending |
| `amount` TEXT | **Legacy** — readers fall back to this if `inf` and `cav` are both 0. Never written by new code. |

Def value is **always computed at read time**: `def = inf + 2·cav`. Never stored as a column.

Constraint: `(inf > 0 OR cav > 0)` enforced in handler before insert, not at SQL level (avoids breaking legacy rows where both are 0 and `amount` is set).

### `incoming_reports` (NEW)

| Field | Type | Meaning |
|---|---|---|
| `id` | INTEGER PK | |
| `reporter_id` | TEXT | Discord user id of submitter |
| `defender_x`, `defender_y` | INTEGER | Defender coordinates |
| `attacker_x`, `attacker_y` | INTEGER | Attacker coordinates |
| `first_eta` | INTEGER | Unix timestamp of the **first** wave arrival |
| `waves` | INTEGER | Wave count (1–100) |
| `wave_spread_sec` | INTEGER NULL | Seconds from first wave to last wave (optional) |
| `notes` | TEXT NULL | |
| `threat_class` | TEXT | `fake` / `real` / `chief` / `unknown` — auto-computed |
| `threat_override` | TEXT NULL | Set by Def Coord; if non-null, used in place of `threat_class` for display |
| `escalated_call_id` | INTEGER NULL | FK to `calls.id` if a leader escalated this report into an Active/Perma Def |
| `status` | TEXT | `open` / `dismissed` |
| `reports_msg_id` | TEXT | Message id of the embed in the reports channel (for edits) |
| `created_at` | INTEGER | Unix timestamp |

Indexes:
- `(attacker_x, attacker_y, first_eta)` — for threat heuristic + intel attacker drill-down
- `(defender_x, defender_y, first_eta)` — for intel target drill-down
- `(created_at)` — for 24h window queries

### `config` additions

Seeded by migration with defaults:

| Key | Default | Meaning |
|---|---|---|
| `threat_chief_min_waves` | 4 | Wave count that triggers chief classification |
| `threat_chief_timing_sec` | 30 | Wave-spread window considered "tight timing" |
| `threat_focus_window_hrs` | 6 | Time window for relating reports against same defender |
| `threat_scatter_radius` | 5 | Chebyshev distance for "scattered" defender targeting |
| `threat_real_min_waves` | 2 | Minimum waves to lean "real" over "fake" |
| `inbetween_min_gap_sec` | 1 | Avg wave gap ≥ this enables in-between def flag |
| `leadership_channel_id` | (set by `/setup leadership`) | |
| `def_calls_channel_id` | (set by `/setup def-calls`) | |
| `reports_channel_id` | (set by `/setup reports`) | |
| `intel_dashboard_msg_id` | (set on first dashboard post) | |
| `round_start_at` | (set by `/admin reset-round`) | |
| `migrated_defense_to_def_calls` | `false` until migration ran | one-shot guard |

## Feature: Incoming Attack Reports

### Entry UX

The `reports` panel has a single button `📢 Report Incoming` (visible to everyone). Clicking it opens an **ephemeral chooser** (Discord's nearest equivalent to tabs):

```
How do you want to file this report?
[📋 Paste from rally point]   [✍️ Enter manually]
```

- `📋 Paste from rally point` — stubbed. Replies ephemerally: `🚧 Paste mode coming soon. Use "Enter manually" for now.`
- `✍️ Enter manually` — opens the manual modal.

### Manual modal fields

| Field | Required | Notes |
|---|---|---|
| Defender coordinates | ✅ | Prefilled from member's profile home coords if available |
| Attacker coordinates | ✅ | |
| First wave ETA (UTC) | ✅ | Existing parser: `14:30:45` / `in 2h30m` / `2026-05-30 14:30:45` |
| Number of waves | ✅ | Integer 1–100 |
| Wave spread (seconds) | ⬜ | Seconds from first wave to last wave. Reporter reads from rally point and subtracts. Used for in-between def detection. |
| Notes | ⬜ | Free text |

### On submit

1. Validate; reject invalid coords/ETA/wave count with ephemeral error.
2. Insert into `incoming_reports`.
3. Run threat heuristic (see Threat Detection below) → set `threat_class`.
4. Cascade re-classification: any related reports (same attacker, tight timing) that don't have a `threat_override` are upgraded to `chief` and their embeds re-rendered.
5. Build embed; post to reports channel with content `<@&Leadership> <@&DefCoord>` and `allowedMentions.parse: ['roles']`.
6. Persist `reports_msg_id`.
7. Trigger intel dashboard rebuild.

### Embed layout

```
📥 INCOMING ATTACK  [🟢 LIKELY FAKE | 🟠 LIKELY REAL | 🔴 CHIEF ATTEMPT]
Reporter:  @user
Defender:  (-12|34) — PlayerName [ALLY]      [Map]
Attacker:  (56|-78) — AttackerName [ENEMY]   [Map]
Impact:    Sat 2026-05-30 14:30:45 UTC (in 2h 14m)
Waves:     4
⏱️ Wave timing: 4 waves over 6s (avg gap ~2s)  🛡️ IN-BETWEEN DEF POSSIBLE
Notes:     "saw scouts 30min ago"
─────────────────────────────────────
Report ID: 42
```

The "Wave timing" line is omitted if `wave_spread_sec` is null. If avg gap < `inbetween_min_gap_sec`, the line still shows the timing but without the IN-BETWEEN DEF POSSIBLE flag (replaced by `— no in-between window`).

x_world enrichment (player + alliance) follows the same lookup pattern as the existing combat embed in [src/handlers/combat.js](../../../src/handlers/combat.js).

### Buttons on the report embed

| Button | Visible to | Action |
|---|---|---|
| ⚔️ Escalate → Active Def | Leadership, Def Coord | Opens Active Def modal pre-filled with defender coords + first-wave ETA. Notes pre-fill includes "Wave gap ~Ns — in-between def possible" if applicable. On submit, the Active Def call's `payload.source_report_id` is set, and the report embed is edited to show `✅ Escalated → Call #N`. |
| 🛡️ Escalate → Perma Def | Leadership, Def Coord | Opens Perma Def modal pre-filled with defender coords. Same source_report_id wiring. |
| 🔄 Reclassify | Leadership, Def Coord | Ephemeral select: Fake / Real / Chief / Auto. Auto clears `threat_override`. Any other value sets it. Embed re-renders with badge `🔴 CHIEF (manual)` to make overrides visible. |
| 🔒 Close Report | Reporter, Leadership, Def Coord | Sets `status='dismissed'`. Embed greyed out, buttons disabled. |

Custom IDs:
- `report:choose` (panel button → opens chooser)
- `report:manual` (chooser button → opens manual modal)
- `report:paste` (chooser button → "coming soon" reply for now)
- `report:manual_submit` (manual modal submit)
- `report:escalate_active:<reportId>` / `report:escalate_perma:<reportId>`
- `report:reclassify:<reportId>` (button) → `report:reclassify_pick:<reportId>` (select)
- `report:close:<reportId>`

## Feature: Active Def & Perma Def Calls

### Entry

Panel `def-calls` has two buttons:
- 🛡️ Active Def → modal
- 🛡️ Perma Def → modal

Both are bot-gated to Leadership / Def Coord. Members clicking get the standard ephemeral `❌ Leadership / Def Coord only.`

Buttons are also reachable from a report embed's escalate buttons (pre-filled).

### Modal fields

**Active Def:**

| Field | Required |
|---|---|
| Defender coordinates | ✅ |
| Troops needed | ✅ (integer — see validation note) |
| Impact time | ✅ |
| Notes | ⬜ |

**Perma Def:** same minus Impact time. `calls.deadline` is NULL.

Troops-needed validation: integer between 1 and 10,000,000. Reject non-integers / negatives ephemerally.

### On submit

1. Insert into `calls` with `type = 'def_active'` or `'def_perma'`, `channel_id` = `def_calls_channel_id`.
2. Build embed; post to def-calls channel with content `<@&def-crew>` (via existing `getDefRoleMention`).
3. Persist `calls.message_id`.
4. If the call was opened from a Report Incoming (source_report_id present), patch the report row's `escalated_call_id` and edit the report embed to show `✅ Escalated → Call #N`.
5. Trigger intel dashboard rebuild.

### Call embed layout

```
🛡️ ACTIVE DEFENSE — needs 15000 def
Author:   @leadership-user
Defender: (-12|34) — PlayerName [ALLY]  [Map] [Send Troops]
Impact:   Sat 2026-05-30 14:30:45 UTC (in 2h 14m)   ← omitted for perma
Needed:   15000 def
Notes:    "chief expected"
─────────────────────────────────────
Responders (3):
  @alice  — 1000 inf / 500 cav = 2000 def
  @bob    — 2000 inf /   0 cav = 2000 def
  @carol  —    0 inf / 1500 cav = 3000 def
─────────────────────────────────────
Total: 3000 inf / 2000 cav = 7000 def / 15000 needed (47%)  ███░░░░░
Call ID: 17
```

Per-responder lines capped at 15; if more, last line is `_... and N more_`. Progress bar uses block characters in 12.5% increments.

### Response — `🛟 Sending Def` button

Modal fields:
- Inf (integer ≥ 0, max 10,000,000)
- Cav (integer ≥ 0, max 10,000,000)

Validation: at least one must be > 0.

### Edit / Add / Withdraw

Mirrors the existing pattern in [src/handlers/combat.js](../../../src/handlers/combat.js):

- First click → modal opens directly.
- Subsequent click → ephemeral choice: `✏️ Edit pledge` / `➕ Add to pledge`.
- **Edit** = replace `inf` and `cav` values with the new ones.
- **Add** = `inf += new_inf; cav += new_cav`. Numeric addition is cleaner than today's text concatenation.
- **Withdraw** deletes the pledge row.

Each pledge change recomputes `Σ def`, refreshes the call embed, fires existing notify hooks (`notifyAuthorOfPledge`, `notifyAuthorIfMilestone`), and triggers intel dashboard rebuild.

### Filled lifecycle

When `Σ def ≥ troops_needed`:
1. Set `calls.status = 'filled'`.
2. Edit the def-calls embed: title prefix `✅ FILLED — `, all action buttons disabled (the Map and Send Troops link buttons remain).
3. Post a summary embed to the leadership channel: final responders, totals, link back to the original call message, source report link if any.
4. **Late additions:** the filled call itself stays locked. If leadership wants to call for more (e.g. partial losses), they open a fresh Active Def from the panel — no "reopen" mutation on the filled call. (A "Reopen" button on the leadership archive is listed in Follow-ups; not built in this task.)

### Other lifecycle

- **Active Def expiry:** the existing expiry cron (the job that sets old calls to `expired` once their deadline passes) is extended to recognize `def_active`. Implementation: anywhere the cron whitelists call types, add `def_active`.
- **Perma Def:** no auto-expiry. Manual `🔒 Close` only (author or admin), reusing the existing close handler logic.

### Custom IDs

- `call:def_active`, `call:def_perma` (panel buttons)
- `combat:create:def_active`, `combat:create:def_perma` (modal submits) — reuses the existing handler dispatch; `def_active` and `def_perma` are added to `COMBAT_CONFIG` so the existing `handleCombatCreateModal` / `createCombatCall` path handles them with minimal new code.
- `combat:send_def:<callId>` (Sending Def button) → opens modal `combat:send_def_submit:<callId>`
- `combat:send_def_edit:<callId>` / `combat:send_def_add:<callId>` (ephemeral choice buttons)
- `combat:withdraw:<callId>` / `combat:close:<callId>` / `combat:update:<callId>` — existing handlers reused.

## Feature: Threat Detection

Heuristic runs on:
- Every report submit (classifies the new report).
- Every reclassify (re-runs auto when override set to `auto`).
- Cascade: when report R is classified `chief`, any related reports without an override are upgraded.

All thresholds live in `config` (see Data Model) and are read on each invocation — tunable without code changes.

### Classification logic

Top-to-bottom, first match wins:

```
related_attacker = reports with same (attacker_x, attacker_y)
                   AND ABS(first_eta - R.first_eta) <= threat_chief_timing_sec
                   (excluding R itself)

if R.waves >= threat_chief_min_waves
   OR (count(related_attacker against same defender as R) >= threat_chief_min_waves - 1):
       → 'chief'

elif R.waves >= threat_real_min_waves:
       → 'real'

else (R.waves == 1):
   focus_window_reports = reports with same attacker, eta within ±threat_focus_window_hrs
   distinct_defenders = SELECT DISTINCT (defender_x, defender_y) FROM focus_window_reports
   if any pair of distinct_defenders has chebyshev_distance > threat_scatter_radius:
       → 'fake'   # scattered single waves = classic fakes
   else:
       → 'real'   # focused single wave (sniper or single-target probe)
```

Chebyshev distance: `max(|x1 - x2|, |y1 - y2|)`.

### Manual override

- Def Coord clicks `🔄 Reclassify` on a report embed → ephemeral string select with values `fake`, `real`, `chief`, `auto`.
- `auto` clears `threat_override` and re-runs the heuristic.
- Any other value sets `threat_override = <value>`.
- The embed's badge displays the effective class. If override is non-null, append `(manual)` to the badge label.

### Visible effects

- Report embed badge color/text.
- Intel dashboard tally (Section: Intelligence).
- No ping behavior change (auto-URGENT was explicitly rejected).

## Feature: Intelligence Dashboard

Pinned message in the leadership channel. One embed, edited in place. Dashboard message id stored in `config.intel_dashboard_msg_id`.

### Rebuild triggers

- Every new incoming report.
- Every reclassify.
- Every def call status change (open / filled / expired / closed).
- The `🔄 Refresh` button on the dashboard.
- A 5-minute cron tick (catches "ETA passed" transitions without waiting for the next user event).

Window: rolling 24h. Computed from `now() - 86400` on each rebuild.

### Layout

```
🧠 ALLIANCE INTEL — last 24h          updated <t:R>
─────────────────────────────────────
🔥 Hot targets (most reports against)
  (-12|34) PlayerA — 8 reports, 3 chief, peak ETA Sat 14:30
  (45|-7)  PlayerB — 5 reports, 1 chief
  (78|10)  PlayerC — 3 reports, 0 chief

⚔️ Top attackers
  (56|-78) Enemy1 [ENMY] — 12 reports across 4 defenders (scattered)
  (90|22)  Enemy2 [ENMY] — 7 reports across 2 defenders (focused)

🛡️ Open def calls
  #17 Active Def  (-12|34)  47% (7000/15000 def) — ETA in 2h 14m
  #19 Perma Def   (45|-7)   0% (0/10000 def) — no ETA

📊 Threat tally
  🟢 Fake 14   🟠 Real 9   🔴 Chief 3   ⚪ Unknown 0

⏱️ In-between def opportunities
  (-12|34) ← (56|-78): 4 waves over 6s (~2s gap) — Sat 14:30
─────────────────────────────────────
Round leaderboard (top defenders, since round start)
  @alice — 28k def sent across 6 calls
  @bob   — 19k def sent across 4 calls
  @carol — 12k def sent across 3 calls
```

Each section capped at top 5. Empty sections are omitted (not shown as "*none*"). Total embed never exceeds Discord's 6000-char limit; if a section's full content would exceed remaining budget, it truncates with `_... and N more_`.

### Hot-target ranking

`score = report_count * 2 + chief_count * 5`. Tiebreaker: most recent peak ETA.

### Focus vs scatter (attacker)

Within window: collect distinct defender coords. If all pairs have chebyshev ≤ `threat_scatter_radius`, label `(focused)`. Otherwise `(scattered)`.

### In-between def opportunities

Reports in window with `wave_spread_sec` set AND `avg_gap = wave_spread_sec / (waves - 1) >= inbetween_min_gap_sec`. Cap top 5 by ETA proximity (soonest first).

### Round leaderboard

```
SELECT user_id, SUM(inf + 2*cav) AS def_sent, COUNT(DISTINCT call_id) AS calls
FROM pledges p
JOIN calls c ON p.call_id = c.id
WHERE c.type IN ('def_active','def_perma')
  AND c.created_at > config.round_start_at
GROUP BY user_id ORDER BY def_sent DESC LIMIT 5
```

If `config.round_start_at` is unset, treats it as "since bot install" (epoch 0).

### Dashboard buttons

One row beneath the embed:

```
[🔄 Refresh]  [🎯 Target drill-down]  [⚔️ Attacker drill-down]  [📅 Wider window]
```

All Leadership / Def Coord only.

| Button | Behavior |
|---|---|
| 🔄 Refresh | Rebuilds the pinned dashboard immediately. |
| 🎯 Target drill-down | Modal with one field: `Defender coords (x\|y)`. On submit → ephemeral reply with same content as `/intel target:<x,y>`. |
| ⚔️ Attacker drill-down | Modal with one field: `Attacker coords (x\|y)`. On submit → ephemeral reply with `/intel attacker:<x,y>` content. |
| 📅 Wider window | Ephemeral select (1d / 3d / 7d / 14d / 30d). Picking renders the dashboard at the chosen window **as an ephemeral message** — the pinned 24h view stays untouched. |

### `/intel` slash command

Leadership / Def Coord only, ephemeral.

| Subcommand | Behavior |
|---|---|
| `/intel` | Same content as the pinned dashboard, on-demand. |
| `/intel days:<n>` | Widen window from 24h to N days (1–30). |
| `/intel target:<coords>` | Drill-down: every report against this defender, threat breakdown, who attacked when, current def calls against the defender. |
| `/intel attacker:<coords>` | Drill-down: every report from this attacker, which defenders, scatter/focus pattern. |

Both the slash and the dashboard buttons call the same internal render functions — `renderDashboard(windowSec)`, `renderTargetIntel(x, y, windowSec)`, `renderAttackerIntel(x, y, windowSec)` — so formatting code is never duplicated.

### Custom IDs

- `intel:refresh`
- `intel:target` (button) → modal `intel:target_submit`
- `intel:attacker` (button) → modal `intel:attacker_submit`
- `intel:window` (button) → select `intel:window_pick`

## Slash Commands

New (parity with every new panel button):

| Command | Tier | Equivalent to |
|---|---|---|
| `/report-incoming` | Member | 📢 Report Incoming → manual modal |
| `/active-def` | Leadership / Def Coord | 🛡️ Active Def button |
| `/perma-def` | Leadership / Def Coord | 🛡️ Perma Def button |
| `/sending-def call:<id>` | Member | 🛟 Sending Def button on the named call |
| `/intel` (+ subcommands) | Leadership / Def Coord | Dashboard buttons |
| `/reclassify report:<id> as:<fake\|real\|chief\|auto>` | Leadership / Def Coord | 🔄 Reclassify button |

Removed (no longer registered):
- `/defense` — replaced by `/active-def` + `/perma-def`
- `/reinforce` — folded into Perma Def conceptually; reinforce calls are not part of the new model

Unchanged:
- `/offense` — out of scope; offense panel untouched.
- All other slash commands.

## Migration

Idempotent steps in `src/db/migrations.js`:

1. `ALTER TABLE pledges ADD COLUMN inf INTEGER DEFAULT 0`
2. `ALTER TABLE pledges ADD COLUMN cav INTEGER DEFAULT 0`
3. `CREATE TABLE IF NOT EXISTS incoming_reports (...)` with all columns + indexes from Data Model.
4. Seed `config` defaults for all `threat_*` and `inbetween_*` keys (insert-or-ignore).
5. **One-shot panel rename** (guarded by `config.migrated_defense_to_def_calls`):
   ```sql
   UPDATE panels SET type = 'def-calls' WHERE type = 'defense';
   UPDATE calls  SET type = 'def_active' WHERE type = 'defense' AND status = 'open';
   ```
   Then set `config.migrated_defense_to_def_calls = 'true'`.
6. Open `reinforce` and `urgent` calls in DB are **not** modified — they remain queryable for archive rendering. Their renderers stay registered in `combat.js`.

After deploy, leadership runs `/setup reports` and `/setup leadership` in the new channels. Existing `defense` panels become `def-calls` panels automatically.

## File Layout

New files:

| Path | Responsibility |
|---|---|
| `src/handlers/incomingReports.js` | Report panel button, chooser, manual modal, embed builder, threat classifier, `createIncomingReport(...)`, stub `parseRallyPointPaste(...)` |
| `src/handlers/defCalls.js` | Active/Perma Def buttons, modals, `🛟 Sending Def` flow (modal + edit/add/withdraw choice), Inf/Cav math, filled lifecycle, leadership-archive copy |
| `src/handlers/intel.js` | Dashboard render, drill-down render, `/intel` command, dashboard buttons, modal submits |
| `src/handlers/threat.js` | Pure classifier + cascade reclassify (no Discord deps, easy to unit-test) |
| `src/utils/tier.js` | `getTier(member)` helper |
| `tests/threat.test.js` | Unit tests for classifier across the truth table |

Modified files:

| Path | Change |
|---|---|
| `src/handlers/combat.js` | Drop write-paths for `defense`, `reinforce`, `urgent`. Keep renderer registrations for archive. Remove `Defense Call` / `URGENT` / `Reinforce` panel handlers. |
| `src/handlers/router.js` | Wire up new ns: `report:*`, `combat:send_def*`, `intel:*`. Remove dead routes. |
| `src/panel/types.js` | Replace `defense` panel with `def-calls`. Add `reports`, `leadership` panel types. |
| `src/panel/deploy.js` | Validate against new `PANEL_TYPES` list (add the three new types). |
| `src/commands/definitions.js` | Add new slash commands, remove `/defense` and `/reinforce`. |
| `src/db/migrations.js` | Steps above. |
| `src/db/schema.sql` | Add `incoming_reports` + `inf`/`cav` columns (so fresh installs don't need migrations). |
| `src/jobs/*` | Extend the expiry cron to include `def_active`. Add the 5-minute intel dashboard tick. |

## Testing Strategy

Unit-testable:
- `classifyThreat(report, allReports, thresholds)` — pure function, exhaustive truth table covering single-wave-scattered (fake), single-wave-focused (real), waves≥2 (real), waves≥4 (chief), cascade-from-related (chief).
- `computeDefValue(inf, cav)` — trivial but pinned in tests.
- `chebyshev(a, b)` — pinned.
- `parseRallyPointPaste(text)` — returns null for now; test verifies it never throws.

Integration-testable (with discord.js mocks already present in `tests/`):
- Report submit → embed has correct badge.
- Active Def submit → embed shows 0 / needed; first Sending Def updates totals.
- Pledge Edit / Add / Withdraw recomputes totals correctly.
- Filled threshold triggers status change + leadership archive post.

Manual smoke test (deploy checklist):
1. `/setup reports`, `/setup def-calls`, `/setup leadership` in three test channels.
2. Submit a 1-wave report from a Member account → expect 🟢 LIKELY FAKE badge.
3. Submit a 4-wave report → expect 🔴 CHIEF ATTEMPT badge.
4. Escalate the chief report → Active Def call appears in def-calls channel; source link wired up.
5. Send Def with `inf=1000, cav=500` → embed shows `2000 def`.
6. Add more sends until `Σ def >= troops_needed` → call locks, summary lands in leadership channel.
7. Open dashboard → confirm all sections render, drill-down modals work.
8. Reclassify the chief to `fake` → badge updates to `🟢 LIKELY FAKE (manual)`.

## Follow-ups (not in this task)

- **Paste-from-rally-point**: implement `parseRallyPointPaste()` and wire the `report:paste` modal. Architecture is already in place — the parser just needs to return the same shape that `createIncomingReport` expects.
- **Cross-report wave timeline reconstruction** in intel drill-down: when multiple members reported the same attacker→defender with different first-wave ETAs, show the full reconstructed timeline.
- **Reopen button** on filled-call leadership archive: for post-loss partial-fill scenarios.
- **`/admin set-intel-thresholds`** command for tuning config values without DB editing.

## Open Decisions

None — every design choice was confirmed during brainstorming.
