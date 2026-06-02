# Def-Call Picker — Full HH:MM:SS Precision + Modal Time Box

**Date:** 2026-06-02
**Status:** Approved (pending user review of spec doc)
**Scope:** Restore second-level precision in the def-call time picker (every minute 0-59, every second 0-59) and re-add an optional "Impact time" text input to the create-def-call modal as a typing shortcut.

## Motivation

Travian defense calls are timing-sensitive — single-second accuracy matters when coordinating waves of incoming attacks. The current picker (commit 85ead95) uses 5-minute step selects, which is too coarse: a call meant for `14:33:17` can only be expressed as `14:30:00` or `14:35:00` via clicks.

The pre-85ead95 spec already designed a tens/ones-digit picker that supports 0-59 precision, but it was simplified for fewer clicks. We're reverting that simplification — the precision win is worth the extra click.

Additionally, the original create-modal once had a free-text `arrival` field that was removed when the picker was introduced. Bringing it back as an **optional** field gives users a fast keyboard path when they know the exact time, while keeping the picker as the default click-driven flow.

## Decisions Summary

- **Picker**: two-page layout — page 1 picks date/hour/minute (via tens/ones digit selects); page 2 picks seconds (via tens/ones digit selects).
- **Modal**: re-add `arrival` as an **optional** 4th text input. Pre-filled with `formatDeadline(report.first_eta)` on the escalation path.
- **Modal submit flow**: if `arrival` is non-empty and parses to a future timestamp → create the call directly. Otherwise (empty / unparseable / past) → silently fall through to the picker. No error reply on bad parse.
- **Escape hatch**: the existing "Type instead" button on picker page 1 stays unchanged.
- **CustomID scheme**: replace `combat:newpick:minute` / `combat:newpick:second` with `combat:newpick:{mt,mo,st,so}`.
- **`def_perma`**, parser (`parseDeadline`), `/active-def` slash command, and the existing "Pick time" edit-deadline button (`combat:pick:<callId>`) are all **out of scope**.

## Why two pages

Discord enforces:

- Max **5 action rows** per message.
- Max **25 options** per string-select menu.
- An action row holds **either** ≤ 5 buttons **or** exactly 1 select (never two selects in the same row).

Full-precision minute (0-59) and second (0-59) each exceed the 25-option cap, so they must be split into tens-digit (0-5, 6 options) + ones-digit (0-9, 10 options) selects. The required rows are:

```
Date | Hour | Min-tens | Min-ones | Sec-tens | Sec-ones | buttons = 7 rows
```

That exceeds the 5-row limit by 2, so the picker is split:

- **Page 1** (5 rows): Date / Hour / Min-tens / Min-ones / [Type instead, Next]
- **Page 2** (3 rows): Sec-tens / Sec-ones / [Back, Create]

Alternative approaches considered and rejected:

- **Two selects on one row**: Discord forbids it.
- **Buttons for digits**: each row holds ≤ 5 buttons, so ones-digits (10 buttons) still spills to 2 rows. Net rows are equal or worse than selects.
- **Single-page, picker is HH:MM only, seconds via modal**: would force users to type the modal time box for second precision, defeating the click-driven goal.
- **Cascading single-page (re-render on each pick)**: visually disorienting; rejected for stability.

## Modal Change

### Affected modals

1. **Panel button** flow ([handleDefCallButton in src/handlers/defCalls.js:131-151](src/handlers/defCalls.js#L131-L151)).
2. **Report-escalation** flow ([showEscalateModal in src/handlers/defCalls.js:405-453](src/handlers/defCalls.js#L405-L453)).

Both currently have 3 components (coords, troops, notes). Discord allows 5. Adding one is fine.

### New field

```js
const arrival = new TextInputBuilder()
  .setCustomId('arrival')
  .setLabel('Impact time (UTC) — optional')
  .setStyle(TextInputStyle.Short)
  .setRequired(false)
  .setPlaceholder('or just type it here · 14:30:45 · in 2h30m')
  .setMaxLength(60);
```

- Label conveys optionality.
- Placeholder doubles as help text: "or just type it here" tells the user this is a typing shortcut; the examples show accepted formats.
- For escalation, pre-fill via `arrival.setValue(formatDeadline(report.first_eta))` when `report.first_eta` is set.

### Modal-submit behavior in `handleDefCallCreateModal`

After existing coords + troops validation:

```js
const arrivalRaw = interaction.fields.getTextInputValue('arrival') || '';
if (arrivalRaw.trim()) {
  const deadline = parseDeadline(arrivalRaw);
  if (deadline != null && deadline >= unixNow()) {
    // Fast path: skip picker entirely.
    const { callId, error } = await createDefCall(interaction, {
      type, x: coords.x, y: coords.y, deadline, troopsNeeded, notes, sourceReportId,
    });
    if (error) return interaction.reply({ content: error, ephemeral: true });
    return interaction.reply({ content: `✅ Call #${callId} posted.`, ephemeral: true });
  }
  // else: silent fall-through to picker (unparseable or past)
}
// Existing picker-page-1 flow continues here.
```

Silent fall-through means no error reply on bad parse — the user types, sees the picker appear with current empty state, and continues clicking. This matches the user's preference: "ignore the field and show picker anyway".

## Picker Change

### Page 1 layout (5 rows)

```
Header: "Pick impact time (UTC) — currently: ____-__-__ __:__:__"
        (escalation variant prepends: "Report ETA: 2026-06-02 14:30:45 UTC")

Row 1: [▼ Date         ]  Today / Tomorrow / Day after          (3 options)
Row 2: [▼ Hour         ]  00 … 23                               (24 options)
Row 3: [▼ Min tens     ]  0 1 2 3 4 5                           (6 options)
Row 4: [▼ Min ones     ]  0 1 2 3 4 5 6 7 8 9                   (10 options)
Row 5: [⌨️ Type instead]  [Next →]
```

Header re-renders on every select change. Unpicked slots render as underscores. With date=Today + hour=14 + mt=3 + mo=0, header shows `2026-06-02 14:30:__` (seconds still pending on page 2).

### Page 2 layout (3 rows)

```
Header: "Seconds (UTC) — currently: 2026-06-02 14:30:__"

Row 1: [▼ Sec tens     ]  0 1 2 3 4 5                           (6 options)
Row 2: [▼ Sec ones     ]  0 1 2 3 4 5 6 7 8 9                   (10 options)
Row 3: [← Back]  [✅ Create call]
```

Seconds are **optional on page 2** — Create with `st`/`so` unset defaults to `:00`. Back returns to page 1 preserving picked values.

### State shape change

Current `pickerState.get(msgId)` value (from [src/handlers/defCallPicker.js:165-184](src/handlers/defCallPicker.js#L165-L184)):

```js
{ type, x, y, troopsNeeded, notes, sourceReportId, reportFirstEta,
  dateOffset, hour, minute, second, createdAt, _pickerInteraction }
```

New shape:

```js
{ type, x, y, troopsNeeded, notes, sourceReportId, reportFirstEta,
  dateOffset, hour, mt, mo, st, so, createdAt, _pickerInteraction }
```

`mt`/`mo`/`st`/`so` are each `null | 0-9` (with `mt`/`st` constrained to `0-5` by their select options).

### Header derivation

```js
function pad2(n) { return String(n).padStart(2, '0'); }

export function buildHeaderText(state) {
  const datePart = (state.dateOffset == null) ? '____-__-__' : utcDateString(state.dateOffset);
  const hourPart = state.hour == null ? '__' : pad2(state.hour);
  const minPart = (state.mt == null || state.mo == null) ? '__' : `${state.mt}${state.mo}`;
  const secPart = (state.st == null || state.so == null) ? '__' : `${state.st}${state.so}`;
  return `${datePart} ${hourPart}:${minPart}:${secPart} UTC`;
}
```

### Resolve-to-unix change

```js
export function resolveStateToUnix(state) {
  if (state.dateOffset == null || state.hour == null) return null;
  if (state.mt == null || state.mo == null) return null;
  const minute = state.mt * 10 + state.mo;
  const second = (state.st != null && state.so != null) ? state.st * 10 + state.so : 0;
  const now = new Date();
  const utcMs = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + state.dateOffset,
    state.hour, minute, second,
  );
  return Math.floor(utcMs / 1000);
}
```

### CustomID scheme

```
combat:newpick:date:<msgId>                 (unchanged)
combat:newpick:hour:<msgId>                 (unchanged)
combat:newpick:mt:<msgId>                   NEW — replaces 'minute'
combat:newpick:mo:<msgId>                   NEW — replaces 'minute'
combat:newpick:st:<msgId>                   NEW — replaces 'second'
combat:newpick:so:<msgId>                   NEW — replaces 'second'
combat:newpick:next:<msgId>                 RE-ACTIVATED (currently a stub)
combat:newpick:back:<msgId>                 RE-ACTIVATED (currently a stub)
combat:newpick:type_instead:<msgId>         (unchanged)
combat:newpick:type_instead_submit:<msgId>  (unchanged)
combat:newpick:create:<msgId>               (unchanged)
```

### Handlers

`handlePickerSelect` switches on the 3rd customID segment, now one of `'date' | 'hour' | 'mt' | 'mo' | 'st' | 'so'`. Each writes to the corresponding state field, then re-renders the current page (page 1 if `mt`/`mo` field was picked; page 2 if `st`/`so`).

`handlePickerNextButton`:
```js
const state = pickerState.get(msgId);
if (state.dateOffset == null || state.hour == null || state.mt == null || state.mo == null) {
  return interaction.reply({ content: '❌ Pick date, hour, and minutes first.', ephemeral: true });
}
const payload = buildPickerPage2(msgId, state);
return interaction.update({ content: payload.content, components: payload.components });
```

`handlePickerBackButton`:
```js
const payload = buildPickerPage1(msgId, state);
return interaction.update({ content: payload.content, components: payload.components });
```

`handlePickerCreateButton` keeps its existing structure — `resolveStateToUnix` now handles the new state shape and returns `null` when date/hour/mt/mo aren't set, which the existing missing-state check translates into "Pick date, hour, and minutes first".

### Router

[src/handlers/router.js](src/handlers/router.js) currently routes `combat:newpick:minute:` and `combat:newpick:second:` to `handlePickerSelect`. Replace those with prefixes for `:mt:`, `:mo:`, `:st:`, `:so:`. The `:next:` / `:back:` routes already exist (they call current stub handlers) — no router change needed there; only the handler bodies change.

## Edge Cases

| Scenario | Behavior |
|---|---|
| Modal `arrival` empty | Picker page 1 shown (current behavior) |
| Modal `arrival` filled, parses, future | Call created directly; no picker shown |
| Modal `arrival` filled, unparseable | Silent fall-through to picker page 1 |
| Modal `arrival` filled, parses but in past | Silent fall-through to picker page 1 |
| Escalation modal `arrival` pre-filled from report.first_eta | User can edit or submit as-is; same submit logic applies |
| Picker `Next` without date/hour/mt/mo all set | Ephemeral "Pick date, hour, and minutes first" — stays on page 1 |
| Picker page 2 → `Create` without st/so set | Seconds default to `:00` (existing behavior preserved) |
| Picker `Back` from page 2 | Returns to page 1 with all picked values preserved |
| Resulting deadline < now | Existing "Impact time is in the past" ephemeral error |
| Picker state expired (>16 min) | Existing "session expired" handling unchanged |
| `def_perma` calls | Untouched — modal has no `arrival` field; the optional-time addition applies only to `def_active`'s modal entry points |

Note on `def_perma`: the modal in [handleDefCallButton](src/handlers/defCalls.js#L131-L151) is shared between `def_active` and `def_perma` via the `type` URL param. The new `arrival` field should only be added when `type === 'def_active'` (i.e., when `COMBAT_CONFIG[type].noDeadline` is false). For `def_perma`, the modal stays at 3 rows as today.

## Tests

### UPDATE [tests/defCallPicker.test.js](tests/defCallPicker.test.js)

Existing assertions about `state.minute === N` (where N is a 5-multiple) are replaced:

- **State updates**: each of `date`, `hour`, `mt`, `mo`, `st`, `so` select interactions writes the correct state field.
- **Page 1 → Next**: with date/hour/mt/mo set, Next renders page 2 (verify `Sec tens`, `Sec ones`, `Back`, `Create` are present in components).
- **Page 1 → Next blocked**: without any of date/hour/mt/mo set, Next replies with ephemeral error and does **not** transition to page 2.
- **Page 2 → Back**: returns to page 1; state preserved (asserted by re-rendering and checking selects show defaults for already-picked values).
- **Create with full state** (date=0, hour=14, mt=3, mo=0, st=4, so=5) → deadline equals today 14:30:45 UTC unix; call row inserted.
- **Create without st/so** → deadline equals today 14:30:00 UTC; seconds defaulted.
- **Create without mt/mo** → ephemeral "Pick date, hour, and minutes first"; no DB row.
- **Past-time create**: existing behavior, re-asserted.
- **State expiry**: existing test for `>16 min` ageing, unchanged in spirit.
- **NEW**: modal submit with empty `arrival` shows picker page 1 (existing flow, but assertion is added now that `arrival` exists in the modal).
- **NEW**: modal submit with `arrival = '2030-06-02 14:30:45'` creates the call directly with `deadline = Date.UTC(2030, 5, 2, 14, 30, 45)/1000`. Picker is **not** shown — assertion checks the reply is `'✅ Call #N posted.'`, not a picker payload.
- **NEW**: modal submit with `arrival = 'garbage'` falls through to picker page 1 with no extra ephemeral error. Assertion: reply is the picker page-1 payload, no DB row inserted, no separate error reply.
- **NEW**: modal submit with `arrival = '2000-01-01 00:00:00'` (past) falls through to picker page 1 with no extra error reply.

### UPDATE [tests/defCallsEscalate.test.js](tests/defCallsEscalate.test.js)

- Update modal-component expectations: the escalation modal now has **4 rows**, with the 4th being `arrival` pre-filled to `formatDeadline(report.first_eta)`.
- **NEW**: submitting the escalation modal without editing `arrival` (pre-fill stays) creates the call directly with the pre-filled deadline; picker is not shown.
- **NEW**: clearing `arrival` and submitting → picker page 1 shown (existing escalation flow).

### NO new test files

All changes land in the two existing test files above.

## Files Touched (full inventory)

- **UPDATE** [src/handlers/defCalls.js](src/handlers/defCalls.js)
  - `handleDefCallButton`: add `arrival` text input as 4th modal row (only for `def_active`, gated on `!config.noDeadline`).
  - `showEscalateModal`: add `arrival` row pre-filled with `formatDeadline(report.first_eta)`.
  - `handleDefCallCreateModal`: after coords/troops validation, branch on `arrival` value (empty → picker; parseable+future → direct create; else → silent fall-through to picker).

- **UPDATE** [src/handlers/defCallPicker.js](src/handlers/defCallPicker.js)
  - Remove `MINUTE_SECOND_STEPS`.
  - Change state shape: `minute`/`second` → `mt`/`mo`/`st`/`so`.
  - Rewrite `buildHeaderText` and `resolveStateToUnix` per spec.
  - Split single-page `buildPickerPage1` into two builders (`buildPickerPage1`, `buildPickerPage2`); page 1 emits date/hour/mt/mo + [Type instead, Next], page 2 emits st/so + [Back, Create].
  - Update `handlePickerSelect` switch to handle `mt`/`mo`/`st`/`so`; re-render the appropriate page.
  - Replace stub `handlePickerNextButton` and `handlePickerBackButton` with real implementations.
  - `handlePickerCreateButton` is unchanged in shape; missing-state error wording adjusted if needed.

- **UPDATE** [src/handlers/router.js](src/handlers/router.js)
  - Replace the route prefixes `combat:newpick:minute:` and `combat:newpick:second:` with `:mt:`, `:mo:`, `:st:`, `:so:` (all routed to `handlePickerSelect`).
  - `:next:` and `:back:` routes already exist; no change.

- **UPDATE** [tests/defCallPicker.test.js](tests/defCallPicker.test.js) — see Tests section.
- **UPDATE** [tests/defCallsEscalate.test.js](tests/defCallsEscalate.test.js) — see Tests section.

**No DB migration. No new files. No package.json changes.**

## Out of Scope

- `parseDeadline` / `formatDeadline` behavior — unchanged from the 2026-06-01 spec.
- `/active-def` and `/perma-def` slash commands — unchanged.
- The "Pick time" button on existing open def calls ([src/handlers/defCalls.js:111](src/handlers/defCalls.js#L111), `combat:pick:<callId>`) — a separate edit-deadline picker that shares the `combat:` namespace but routes to different handlers. Touching it is a follow-up if desired.
- `def_perma` modal — no `arrival` field added (perma calls have no deadline).
- Calendar surfaces, Discord Scheduled Events, external sync — explicitly out (per prior spec).
