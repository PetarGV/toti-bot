# Timer Panel — Design

**Status:** Spec
**Date:** 2026-05-15
**Scope:** Discord pinned panel that lets each member control their own personal recurring timer with buttons (Set / Pause / Stop / Status) instead of slash commands.

A follow-up "configuration GUI" project was deferred to a separate spec — this document is timer-only.

---

## 1. Goal

Give every alliance member a one-click way to start, pause, resume, and stop their personal recurring reminder, without typing `/timer set 10m`. The existing `/timer` slash command stays for power users; the panel is an additive, more discoverable surface.

Pause is a real pause — when resumed, the next ping fires after the time that was remaining at the moment of pause, then continues the normal interval.

## 2. User-facing surface

### 2.1 Deployment

A new panel type `timer`, deployed via `/setup timer` in whichever channel should host it (same flow as `/setup defense`, `/setup scout`, etc.). The panel is pinned and restored on bot boot by the existing [src/panel/deploy.js](../../../src/panel/deploy.js) machinery.

### 2.2 Embed (static)

> ⏱️ **Timer Control**
> Personal recurring reminder. Pick a preset to start, or use Custom… for any interval. Pause keeps the time left in the current cycle; Resume picks up from there. Stop clears your timer.
> *Your timer is private — clicks reply only to you.*

The embed is the same for every viewer (Discord pinned messages aren't personalized). Per-user state is communicated through ephemeral replies on each click.

### 2.3 Buttons

Two action rows:

| Row | Buttons |
|-----|---------|
| 1   | `7m` · `10m` · `13m` · `⚙️ Custom…` |
| 2   | `⏸️ Pause` · `⏹️ Stop` · `📊 Status` |

`Pause` is a toggle — when the user's timer is already paused, clicking it resumes. The button label on the panel stays `⏸️ Pause` (we can't personalize it); the ephemeral confirmation names the actual transition that happened.

### 2.4 Ephemeral reply copy

| Click & state | Reply |
|---------------|-------|
| Preset / Custom on empty state | `▶️ Timer started — every 10m · next ping <relative timestamp>` |
| Preset / Custom replacing existing | `▶️ Timer replaced — now every 10m · next ping <relative timestamp> · fires reset` |
| Pause while running | `⏸️ Paused · 4m 12s left in this cycle. Tap Pause again to resume.` |
| Pause while paused (resume) | `▶️ Resumed · next ping <relative timestamp>` |
| Pause / Stop / Status with no timer | `You have no active timer. Pick a preset (7m / 10m / 13m) or Custom… to start one.` |
| Stop while present | `⏹️ Timer stopped. Fired N time(s).` |
| Status while running | embed identical to today's `/timer status`, plus a `State` field reading `▶️ Running` or `⏸️ Paused` |

### 2.5 Channel selection

The timer's `channel_id` is set to the channel where the panel lives at the moment of Start (same convention as today's `/timer set` — captures the channel where the command was invoked). Pings fire in that channel, auto-deleted after 30 s by the existing tick job.

## 3. Data model

### 3.1 Schema changes

Two new columns on the existing `timers` table:

```sql
ALTER TABLE timers ADD COLUMN paused        INTEGER DEFAULT 0;
ALTER TABLE timers ADD COLUMN remaining_sec INTEGER;
```

- `paused` — `0` = running, `1` = paused. `DEFAULT 0` lets the migration run safely against existing rows; they remain running.
- `remaining_sec` — seconds left until the next ping at the moment of pause. `NULL` when running. Captured as `max(0, next_fire_at - now)` so a "paused-after-its-deadline" timer can't resume into the past.

### 3.2 State machine

| Action | `paused` | `next_fire_at` | `remaining_sec` | `fires_count` |
|--------|----------|----------------|------------------|----------------|
| Start (preset or custom, new) | 0 | `now + interval` | NULL | 0 |
| Start (replacing existing) | 0 | `now + interval` | NULL | 0 (reset) |
| Pause (was running) | 1 | unchanged (ignored while paused) | `max(0, next_fire_at - now)` | unchanged |
| Resume (was paused) | 0 | `now + remaining_sec` | NULL | unchanged |
| Stop | row deleted | — | — | — |
| Tick fires | 0 | `now + interval_sec` | NULL | `+= 1` |

### 3.3 Tick query

[src/jobs/timerTick.js](../../../src/jobs/timerTick.js) gains a `paused = 0` clause:

```js
prepare('SELECT * FROM timers WHERE next_fire_at <= ? AND paused = 0').all(now);
```

Paused rows never fire and their `next_fire_at` is never advanced, even when due — the value is meaningless while paused. Pause time is preserved entirely in `remaining_sec`.

### 3.4 Migration

Added to [src/db/migrations.js](../../../src/db/migrations.js) using the existing `hasColumn(table, column)` guard pattern. Errors are caught and logged as warnings, matching the file's convention.

## 4. Code structure

No new files. Edits cluster into six existing modules:

### 4.1 [src/db/migrations.js](../../../src/db/migrations.js)

Two `if (!hasColumn(...))` blocks adding `paused` and `remaining_sec` to `timers`. Pattern follows the existing migration for `users.notify_pledges` and similar.

### 4.2 [src/handlers/timer.js](../../../src/handlers/timer.js)

Grows from three exports (`handleTimerCommand`) to add six panel-side handlers plus one shared internal helper:

| Export | Purpose |
|--------|---------|
| `handleTimerPanelStart(interaction, intervalSec, label)` | Preset buttons (7m/10m/13m) and the custom-modal submit both flow through this. Inserts or replaces. |
| `handleTimerPanelCustom(interaction)` | Opens the Custom… modal (interval + optional label). |
| `handleTimerPanelCustomModal(interaction)` | Modal submit — parses interval via the shared `parseDuration`, then calls `handleTimerPanelStart`. |
| `handleTimerPanelPause(interaction)` | Toggle pause/resume. |
| `handleTimerPanelStop(interaction)` | Same effect as `/timer stop`. |
| `handleTimerPanelStatus(interaction)` | Same effect as `/timer status`, plus the `State` field. |

The internal helper `startOrReplaceTimer({ userId, channelId, intervalSec, label })` holds the actual `INSERT OR REPLACE` and gets called by both `/timer set` and the panel start path, so behavior stays consistent.

The existing `handleTimerCommand` / `handleSet` / `handleStop` / `handleStatus` stay; `handleSet` is refactored to call `startOrReplaceTimer` rather than duplicating the SQL, and `handleStatus` gains the `State` field so its output is identical to the panel's Status reply.

### 4.3 [src/panel/types.js](../../../src/panel/types.js)

- Add `'timer'` to `PANEL_TYPES`.
- Add a `COLOR.timer` entry (suggested: `0xf1c40f`, distinct from existing panel colors).
- Add `titles.timer`, `descriptions.timer`, `footers.timer` matching the strings in §2.2.
- Add `rowBuilders.timer` producing the two button rows in §2.3.

### 4.4 [src/handlers/router.js](../../../src/handlers/router.js)

- In `routeButton`, add a `ns === 'timer'` block dispatching:
  - `timer:preset:7m` / `:10m` / `:13m` → `handleTimerPanelStart` with the corresponding seconds.
  - `timer:custom` → `handleTimerPanelCustom`.
  - `timer:pause` → `handleTimerPanelPause`.
  - `timer:stop` → `handleTimerPanelStop`.
  - `timer:status` → `handleTimerPanelStatus`.
- In `routeModal`, add `timer:custom_submit` → `handleTimerPanelCustomModal`.

### 4.5 [src/commands/definitions.js](../../../src/commands/definitions.js)

Extend the `/setup` subcommand list with `s.setName('timer').setDescription('Personal timer control panel')`.

`/timer set | stop | status` are not modified.

### 4.6 [src/jobs/timerTick.js](../../../src/jobs/timerTick.js)

Single change: add `AND paused = 0` to the SELECT in `fireDueTimers`.

## 5. Custom IDs

Following the established `ns:action[:subaction]` convention used everywhere else in the project:

| Custom ID | Surface |
|-----------|---------|
| `timer:preset:7m` / `timer:preset:10m` / `timer:preset:13m` | Preset buttons |
| `timer:custom` | Custom… button |
| `timer:custom_submit` | Custom… modal submit |
| `timer:pause` | Pause button (toggles based on state) |
| `timer:stop` | Stop button |
| `timer:status` | Status button |

## 6. Edge cases

1. **Pause/Stop/Status with no active timer** — ephemeral "no active timer" message in §2.4. No DB write.
2. **Pause when already paused** — interpreted as Resume; ephemeral confirms the transition.
3. **Preset clicked over an existing timer** — replace, identical to `/timer set` semantics; `ON CONFLICT(user_id) DO UPDATE` already handles this. `fires_count` resets to 0.
4. **Resume after a very long pause** — `remaining_sec` is whatever was captured at pause; next ping is `now + remaining_sec` regardless of elapsed wall time. No special handling.
5. **Forgotten pause** — by design. Status reply clearly shows `⏸️ Paused · 4m 12s left`, giving the user a signal. No auto-resume timeout (YAGNI).
6. **Channel disappears / unreachable** — existing `channel?.isTextBased?.()` guard in the tick job already advances `next_fire_at` to avoid hammering. Unchanged.
7. **Concurrent clicks** — sql.js + single-threaded JS = sequential interaction handling; second click sees first click's state. A double-tap on Pause just toggles back to running.
8. **Modal validation** — Custom… uses the same `parseDuration` parser as `/timer set` (60 s min, 24 h max, formats like `7m`, `1h30m`, `90s`). Identical error message on invalid input.
9. **Existing running timers at migration time** — `paused INTEGER DEFAULT 0` plus `remaining_sec INTEGER` (NULL by default) keeps them running. Zero-downtime migration.

## 7. Testing

Tests use the existing `node:test` + `tests/helpers/testDb.js` setup. Handler tests stub the `interaction` object directly (no Discord mocking framework) — pattern is established in [tests/handlers/translate.test.js](../../../tests/handlers/translate.test.js).

### 7.1 `tests/handlers/timerPanel.test.js` (new)

1. Preset `7m` on empty state → row created, `paused = 0`, `next_fire_at ≈ now + 420`, `fires_count = 0`.
2. Preset on existing running timer → row replaced, `fires_count` resets to 0, ephemeral reply names the replacement.
3. Pause while running → `paused = 1`, `remaining_sec` captured, `next_fire_at` unchanged.
4. Pause while paused (toggle/resume) → `paused = 0`, `next_fire_at = now + remaining_sec`, `remaining_sec` cleared.
5. Stop / Pause / Status with no row → ephemeral "no active timer", DB unchanged.
6. Status while paused → reply includes `State: ⏸️ Paused` with the remaining time.
7. Custom modal happy path → reuses `parseDuration`, ends up in the same `startOrReplaceTimer` helper.
8. Custom modal invalid interval → ephemeral parser error, no DB write.

### 7.2 `tests/timerTick.test.js` (new)

9. Tick fires running timers but skips paused ones. After a tick, the paused row's `next_fire_at` is unchanged and no message was sent. The running row advances normally.

### 7.3 `tests/migrations.test.js` (extend)

10. After migration, `PRAGMA table_info(timers)` lists `paused` and `remaining_sec` with the expected types and `paused` defaulting to `0`. A pre-existing running timer row stays running (paused = 0, remaining_sec NULL).

Skipped intentionally:

- Embed rendering tests for the panel (static text, no logic).
- Re-testing `/timer set | stop | status` paths that didn't change in behavior — only their `INSERT OR REPLACE` plumbing was extracted into `startOrReplaceTimer`, and the new handler tests cover the helper through the panel path.

## 8. Out of scope

- The configuration GUI for guild settings (server URL, channels, etc.). Deferred to a separate brainstorm.
- Multi-timer-per-user (still capped at one timer per user via the existing `user_id` PK).
- A shared "channel timer" that pings everyone (rejected during brainstorm — current value of personalized timers is higher).
- Auto-resume-after-Nh safety net for forgotten paused timers.
- Per-user notification preferences (DM vs channel) — pings still go to the channel where Start happened.

## 9. Open questions

None — all clarifications were resolved during brainstorming.
