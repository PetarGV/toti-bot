# Def-Call Picker Full Precision + Modal Time Box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore second-level precision in the def-call time picker (every minute 0-59, every second 0-59) using a two-page tens/ones-digit layout, and re-add an optional `arrival` text input to the create-def-call modal as a typing shortcut.

**Architecture:** State-driven picker keyed by ephemeral message ID; the existing single-page picker (5-minute steps) becomes two pages — page 1 covers date/hour/minute (via tens+ones-digit selects), page 2 covers seconds (via tens+ones-digit selects). The modal gets an optional `arrival` field; if filled and parseable, it bypasses the picker entirely.

**Tech Stack:** Node.js, discord.js 14.14.1, better-sqlite3 (via sql.js), `node:test`, chrono-node (existing).

**Spec:** [docs/superpowers/specs/2026-06-02-def-call-picker-full-precision-design.md](docs/superpowers/specs/2026-06-02-def-call-picker-full-precision-design.md)

---

## File Structure

- **MODIFY** [src/handlers/defCallPicker.js](src/handlers/defCallPicker.js) — state shape (`mt`/`mo`/`st`/`so`), header derivation, resolver, page-1 + page-2 builders, select/next/back/create handlers.
- **MODIFY** [src/handlers/defCalls.js](src/handlers/defCalls.js) — add optional `arrival` field to `handleDefCallButton` and `showEscalateModal`; branch in `handleDefCallCreateModal` on parseable arrival.
- **MODIFY** [tests/defCallPicker.test.js](tests/defCallPicker.test.js) — update existing tests to new state shape; add tests for page 2, Next/Back transitions, and st/so selects.
- **MODIFY** [tests/defCallsEscalate.test.js](tests/defCallsEscalate.test.js) — modal now has `arrival` field; update assertions; add tests for fast-path and silent-fall-through behaviors.

**No router changes.** The button router already dispatches `combat:newpick:*` via `id.split(':')[2]` ([src/handlers/router.js:244-250](src/handlers/router.js#L244-L250)), and the select router uses the generic prefix `combat:newpick:` ([src/handlers/router.js:294](src/handlers/router.js#L294)). New select sub-paths `mt`/`mo`/`st`/`so` are picked up automatically.

---

### Task 1: Update `buildHeaderText` to derive minute/second from tens/ones

**Files:**
- Modify: `src/handlers/defCallPicker.js:51-59`
- Test: `tests/defCallPicker.test.js:28-40`

- [ ] **Step 1: Update existing header tests to new state shape**

In `tests/defCallPicker.test.js`, replace the three `buildHeaderText` tests at lines 28-40 with:

```js
test('buildHeaderText: all unpicked', () => {
  assert.equal(buildHeaderText({}), '____-__-__ __:__:__ UTC');
});

test('buildHeaderText: partial — date + hour', () => {
  const header = buildHeaderText({ dateOffset: 0, hour: 14 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:__:__ UTC$/);
});

test('buildHeaderText: partial — minute tens only renders as __', () => {
  const header = buildHeaderText({ dateOffset: 0, hour: 14, mt: 3 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:__:__ UTC$/);
});

test('buildHeaderText: full minute (mt+mo), no seconds', () => {
  const header = buildHeaderText({ dateOffset: 0, hour: 14, mt: 3, mo: 0 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:30:__ UTC$/);
});

test('buildHeaderText: full — all components', () => {
  const header = buildHeaderText({ dateOffset: 1, hour: 14, mt: 3, mo: 0, st: 4, so: 5 });
  assert.match(header, /^\d{4}-\d{2}-\d{2} 14:30:45 UTC$/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: the four updated/new `buildHeaderText` tests fail because the current implementation reads `state.minute` and `state.second`, not `mt`/`mo`/`st`/`so`.

- [ ] **Step 3: Rewrite `buildHeaderText`**

In `src/handlers/defCallPicker.js`, replace lines 51-59 with:

```js
// Format the partial-state header text. Unpicked slots render as underscores.
export function buildHeaderText(state) {
  const datePart = (state.dateOffset == null)
    ? '____-__-__'
    : utcDateString(state.dateOffset);
  const hourPart = state.hour == null ? '__' : String(state.hour).padStart(2, '0');
  const minPart = (state.mt == null || state.mo == null) ? '__' : `${state.mt}${state.mo}`;
  const secPart = (state.st == null || state.so == null) ? '__' : `${state.st}${state.so}`;
  return `${datePart} ${hourPart}:${minPart}:${secPart} UTC`;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: all five `buildHeaderText` tests pass. (Other tests in the file will still fail — that's expected; they'll be fixed in later tasks.)

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "refactor(defCallPicker): buildHeaderText reads mt/mo/st/so digit state"
```

---

### Task 2: Update `resolveStateToUnix` to combine tens/ones into minute and second

**Files:**
- Modify: `src/handlers/defCallPicker.js:63-75`
- Test: `tests/defCallPicker.test.js:42-52, 65-70`

- [ ] **Step 1: Update existing resolver tests to new state shape**

In `tests/defCallPicker.test.js`, replace the three `resolveStateToUnix` tests at lines 42-52 and 65-70 with:

```js
test('resolveStateToUnix: incomplete state returns null', () => {
  assert.equal(resolveStateToUnix({ dateOffset: 0, hour: 14 }), null);
  assert.equal(resolveStateToUnix({ dateOffset: 0, hour: 14, mt: 3 }), null);
  assert.equal(resolveStateToUnix({}), null);
});

test('resolveStateToUnix: defaults seconds to 00 when st/so unset', () => {
  const got = resolveStateToUnix({ dateOffset: 0, hour: 14, mt: 3, mo: 0 });
  const now = new Date();
  const want = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14, 30, 0) / 1000;
  assert.equal(got, want);
});

test('resolveStateToUnix: explicit seconds applied correctly', () => {
  const got = resolveStateToUnix({ dateOffset: 0, hour: 14, mt: 3, mo: 0, st: 1, so: 5 });
  const now = new Date();
  const want = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14, 30, 15) / 1000;
  assert.equal(got, want);
});

test('resolveStateToUnix: partial seconds (st set, so unset) defaults to :00', () => {
  const got = resolveStateToUnix({ dateOffset: 0, hour: 14, mt: 3, mo: 0, st: 4 });
  const now = new Date();
  const want = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14, 30, 0) / 1000;
  assert.equal(got, want);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: the four resolver tests fail because the current implementation reads `state.minute`/`state.second`.

- [ ] **Step 3: Rewrite `resolveStateToUnix`**

In `src/handlers/defCallPicker.js`, replace lines 63-75 with:

```js
// Resolve picker state to a unix timestamp. Requires date/hour/mt/mo to be set.
// Seconds default to :00 if either st or so is unset.
export function resolveStateToUnix(state) {
  if (state.dateOffset == null || state.hour == null) return null;
  if (state.mt == null || state.mo == null) return null;
  const minute = state.mt * 10 + state.mo;
  const second = (state.st != null && state.so != null) ? state.st * 10 + state.so : 0;
  const now = new Date();
  const utcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + state.dateOffset,
    state.hour,
    minute,
    second,
  );
  return Math.floor(utcMs / 1000);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: all four `resolveStateToUnix` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "refactor(defCallPicker): resolveStateToUnix combines tens/ones digits"
```

---

### Task 3: Rewrite `buildPickerPage1` to use mt/mo selects + Next button

**Files:**
- Modify: `src/handlers/defCallPicker.js:84-148`
- Test: `tests/defCallPicker.test.js:54-63`

- [ ] **Step 1: Update existing page-1 tests + add component-shape assertions**

In `tests/defCallPicker.test.js`, replace lines 54-63 with:

```js
test('buildPickerPage1: emits 5 action rows', () => {
  const payload = buildPickerPage1('msg-1', {});
  assert.equal(payload.components.length, 5);
  assert.equal(payload.ephemeral, true);
});

test('buildPickerPage1: components are date/hour/mt/mo selects + type_instead/next buttons', () => {
  const payload = buildPickerPage1('msg-1', {});
  const customIds = payload.components.flatMap(row => row.components).map(c => c.data?.custom_id);
  assert.ok(customIds.includes('combat:newpick:date:msg-1'), 'date select missing');
  assert.ok(customIds.includes('combat:newpick:hour:msg-1'), 'hour select missing');
  assert.ok(customIds.includes('combat:newpick:mt:msg-1'),   'mt select missing');
  assert.ok(customIds.includes('combat:newpick:mo:msg-1'),   'mo select missing');
  assert.ok(customIds.includes('combat:newpick:type_instead:msg-1'), 'type_instead button missing');
  assert.ok(customIds.includes('combat:newpick:next:msg-1'), 'next button missing');
});

test('buildPickerPage1: mt select has 6 options (0-5), mo select has 10 options (0-9)', () => {
  const payload = buildPickerPage1('msg-1', {});
  const all = payload.components.flatMap(row => row.components);
  const mt = all.find(c => c.data?.custom_id === 'combat:newpick:mt:msg-1');
  const mo = all.find(c => c.data?.custom_id === 'combat:newpick:mo:msg-1');
  assert.equal(mt.options.length, 6);
  assert.equal(mo.options.length, 10);
});

test('buildPickerPage1: includes report ETA when escalation state present', () => {
  const payload = buildPickerPage1('msg-1', { reportFirstEta: 1_900_000_000 });
  assert.match(payload.content, /Report ETA: 2030-03-17 17:46:40 UTC/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: the new component-shape tests fail (current page 1 has `minute`/`second` selects, not `mt`/`mo`, and no `next` button).

- [ ] **Step 3: Rewrite `buildPickerPage1`**

In `src/handlers/defCallPicker.js`, replace the `MINUTE_SECOND_STEPS` constant (line 85) and the entire `buildPickerPage1` function (lines 87-148) with:

```js
// Page 1: date, hour, minute (tens + ones) + Type instead / Next buttons.
export function buildPickerPage1(msgId, state) {
  const reportLine = state.reportFirstEta
    ? `Report ETA: ${formatDeadline(state.reportFirstEta)} UTC\n`
    : '';
  const content = `${reportLine}Pick impact time (UTC) — currently: \`${buildHeaderText(state)}\``;

  const dateSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:date:${msgId}`)
    .setPlaceholder(state.dateOffset == null ? 'Date' : dateLabel(state.dateOffset))
    .addOptions([0, 1, 2].map(o => ({
      label: dateLabel(o),
      value: String(o),
      default: state.dateOffset === o,
    })));

  const hourSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:hour:${msgId}`)
    .setPlaceholder(state.hour == null ? 'Hour (UTC)' : `Hour: ${String(state.hour).padStart(2, '0')}`)
    .addOptions(Array.from({ length: 24 }, (_, h) => ({
      label: String(h).padStart(2, '0'),
      value: String(h),
      default: state.hour === h,
    })));

  const mtSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:mt:${msgId}`)
    .setPlaceholder(state.mt == null ? 'Minute (tens)' : `Min tens: ${state.mt}`)
    .addOptions([0, 1, 2, 3, 4, 5].map(d => ({
      label: String(d),
      value: String(d),
      default: state.mt === d,
    })));

  const moSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:mo:${msgId}`)
    .setPlaceholder(state.mo == null ? 'Minute (ones)' : `Min ones: ${state.mo}`)
    .addOptions(Array.from({ length: 10 }, (_, d) => ({
      label: String(d),
      value: String(d),
      default: state.mo === d,
    })));

  const typeBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:type_instead:${msgId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Type instead')
    .setEmoji('⌨️');

  const nextBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:next:${msgId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('Next')
    .setEmoji('➡️');

  return {
    content,
    ephemeral: true,
    components: [
      new ActionRowBuilder().addComponents(dateSelect),
      new ActionRowBuilder().addComponents(hourSelect),
      new ActionRowBuilder().addComponents(mtSelect),
      new ActionRowBuilder().addComponents(moSelect),
      new ActionRowBuilder().addComponents(typeBtn, nextBtn),
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: all four `buildPickerPage1` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "refactor(defCallPicker): page 1 emits mt/mo selects + Next button"
```

---

### Task 4: Add `buildPickerPage2` with st/so selects + Back/Create buttons

**Files:**
- Modify: `src/handlers/defCallPicker.js` (add new exported function near `buildPickerPage1`)
- Test: `tests/defCallPicker.test.js` (add new tests)

- [ ] **Step 1: Add failing tests for page 2**

In `tests/defCallPicker.test.js`, locate the existing import block at line 22-26:

```js
import {
  buildHeaderText,
  resolveStateToUnix,
  buildPickerPage1,
} from '../src/handlers/defCallPicker.js';
```

Change it to include `buildPickerPage2`:

```js
import {
  buildHeaderText,
  resolveStateToUnix,
  buildPickerPage1,
  buildPickerPage2,
} from '../src/handlers/defCallPicker.js';
```

Then after the page-1 tests, add:

```js
test('buildPickerPage2: emits 3 action rows', () => {
  const payload = buildPickerPage2('msg-1', { dateOffset: 0, hour: 14, mt: 3, mo: 0 });
  assert.equal(payload.components.length, 3);
  assert.equal(payload.ephemeral, true);
});

test('buildPickerPage2: components are st/so selects + back/create buttons', () => {
  const payload = buildPickerPage2('msg-1', { dateOffset: 0, hour: 14, mt: 3, mo: 0 });
  const customIds = payload.components.flatMap(r => r.components).map(c => c.data?.custom_id);
  assert.ok(customIds.includes('combat:newpick:st:msg-1'),     'st select missing');
  assert.ok(customIds.includes('combat:newpick:so:msg-1'),     'so select missing');
  assert.ok(customIds.includes('combat:newpick:back:msg-1'),   'back button missing');
  assert.ok(customIds.includes('combat:newpick:create:msg-1'), 'create button missing');
});

test('buildPickerPage2: st has 6 options (0-5), so has 10 options (0-9)', () => {
  const payload = buildPickerPage2('msg-1', { dateOffset: 0, hour: 14, mt: 3, mo: 0 });
  const all = payload.components.flatMap(r => r.components);
  const st = all.find(c => c.data?.custom_id === 'combat:newpick:st:msg-1');
  const so = all.find(c => c.data?.custom_id === 'combat:newpick:so:msg-1');
  assert.equal(st.options.length, 6);
  assert.equal(so.options.length, 10);
});

test('buildPickerPage2: content shows seconds header with current partial time', () => {
  const payload = buildPickerPage2('msg-1', { dateOffset: 0, hour: 14, mt: 3, mo: 0 });
  assert.match(payload.content, /Seconds/);
  assert.match(payload.content, /14:30:__/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: the four new tests fail with "buildPickerPage2 is not exported" or similar.

- [ ] **Step 3: Implement `buildPickerPage2`**

In `src/handlers/defCallPicker.js`, add this function immediately after `buildPickerPage1`:

```js
// Page 2: seconds (tens + ones) + Back / Create buttons.
export function buildPickerPage2(msgId, state) {
  const content = `Seconds (UTC) — currently: \`${buildHeaderText(state)}\``;

  const stSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:st:${msgId}`)
    .setPlaceholder(state.st == null ? 'Second (tens)' : `Sec tens: ${state.st}`)
    .addOptions([0, 1, 2, 3, 4, 5].map(d => ({
      label: String(d),
      value: String(d),
      default: state.st === d,
    })));

  const soSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:so:${msgId}`)
    .setPlaceholder(state.so == null ? 'Second (ones, or skip for :00)' : `Sec ones: ${state.so}`)
    .addOptions(Array.from({ length: 10 }, (_, d) => ({
      label: String(d),
      value: String(d),
      default: state.so === d,
    })));

  const backBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:back:${msgId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Back')
    .setEmoji('⬅️');

  const createBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:create:${msgId}`)
    .setStyle(ButtonStyle.Success)
    .setLabel('Create call')
    .setEmoji('✅');

  return {
    content,
    ephemeral: true,
    components: [
      new ActionRowBuilder().addComponents(stSelect),
      new ActionRowBuilder().addComponents(soSelect),
      new ActionRowBuilder().addComponents(backBtn, createBtn),
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: all four new page-2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "feat(defCallPicker): add page 2 builder with st/so selects + Back/Create"
```

---

### Task 5: Update `handlePickerSelect` to handle mt/mo/st/so and re-render correct page

**Files:**
- Modify: `src/handlers/defCallPicker.js:165-184`
- Test: `tests/defCallPicker.test.js:82-94, 128-158`

- [ ] **Step 1: Update existing select tests and add new ones**

In `tests/defCallPicker.test.js`:

Replace the test at lines 82-94 (`handlePickerSelect: date select updates state and re-renders page 1`) — assertion stays the same since `dateOffset` is unchanged, but ensure the seed state uses new shape. Replace with:

```js
test('handlePickerSelect: date select updates state and re-renders page 1', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-A', {
    type: 'def_active', x: 0, y: 0, troopsNeeded: 100, notes: null,
    dateOffset: null, hour: null, mt: null, mo: null, st: null, so: null,
    createdAt: Date.now(),
  });
  const interaction = fakeSelectInteraction('combat:newpick:date:msg-A', 1);
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-A').dateOffset, 1);
  assert.equal(interaction._updated.components.length, 5);
  assert.match(interaction._updated.content, /Pick impact time/);
});
```

Replace the tests at lines 128-158 (`minute select`, `second select`) with these four tests:

```js
test('handlePickerSelect: mt select updates state and re-renders page 1', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-S1', {
    type: 'def_active', dateOffset: 0, hour: 14, mt: null, mo: null, st: null, so: null,
    createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:mt:msg-S1',
    values: ['3'],
    update: async function (payload) { this._updated = payload; },
  };
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-S1').mt, 3);
  assert.equal(interaction._updated.components.length, 5, 'page 1 should re-render');
});

test('handlePickerSelect: mo select updates state and re-renders page 1', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-S2', {
    type: 'def_active', dateOffset: 0, hour: 14, mt: 3, mo: null, st: null, so: null,
    createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:mo:msg-S2',
    values: ['0'],
    update: async function (payload) { this._updated = payload; },
  };
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-S2').mo, 0);
  assert.equal(interaction._updated.components.length, 5, 'page 1 should re-render');
});

test('handlePickerSelect: st select updates state and re-renders page 2', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-S3', {
    type: 'def_active', dateOffset: 0, hour: 14, mt: 3, mo: 0, st: null, so: null,
    createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:st:msg-S3',
    values: ['4'],
    update: async function (payload) { this._updated = payload; },
  };
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-S3').st, 4);
  assert.equal(interaction._updated.components.length, 3, 'page 2 should re-render');
});

test('handlePickerSelect: so select updates state and re-renders page 2', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-S4', {
    type: 'def_active', dateOffset: 0, hour: 14, mt: 3, mo: 0, st: 4, so: null,
    createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:so:msg-S4',
    values: ['5'],
    update: async function (payload) { this._updated = payload; },
  };
  await handlePickerSelect(interaction);
  assert.equal(_getPickerStateForTests('msg-S4').so, 5);
  assert.equal(interaction._updated.components.length, 3, 'page 2 should re-render');
});
```

The "expired state" test at lines 96-102 is unchanged.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: the four new mt/mo/st/so select tests fail because the current `handlePickerSelect` only handles `'date' | 'hour' | 'minute' | 'second'`.

- [ ] **Step 3: Rewrite `handlePickerSelect`**

In `src/handlers/defCallPicker.js`, replace lines 165-184 with:

```js
export async function handlePickerSelect(interaction) {
  const id = interaction.customId;
  const part = id.split(':')[2];           // 'date' | 'hour' | 'mt' | 'mo' | 'st' | 'so'
  const msgId = _parseMsgId(id);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  const value = parseInt(interaction.values[0], 10);
  switch (part) {
    case 'date': state.dateOffset = value; break;
    case 'hour': state.hour = value; break;
    case 'mt':   state.mt = value; break;
    case 'mo':   state.mo = value; break;
    case 'st':   state.st = value; break;
    case 'so':   state.so = value; break;
    default:
      return interaction.update({ content: '❌ Unknown picker control.', components: [] });
  }

  // Re-render the page the user is currently on:
  //   mt/mo and date/hour are on page 1; st/so are on page 2.
  const onPage2 = part === 'st' || part === 'so';
  const payload = onPage2 ? buildPickerPage2(msgId, state) : buildPickerPage1(msgId, state);
  await interaction.update({ content: payload.content, components: payload.components });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: all five `handlePickerSelect` tests (date, mt, mo, st, so, expired) pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "refactor(defCallPicker): handlePickerSelect dispatches to correct page"
```

---

### Task 6: Replace `handlePickerNextButton` stub with real page transition

**Files:**
- Modify: `src/handlers/defCallPicker.js:213-218`
- Test: `tests/defCallPicker.test.js:114-119`

- [ ] **Step 1: Replace the legacy-stub test with real-flow tests**

In `tests/defCallPicker.test.js`, replace the test at lines 114-119 (`handlePickerNextButton: returns expired message (legacy button)`) with:

```js
test('handlePickerNextButton: with full page-1 state transitions to page 2', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-N1', {
    type: 'def_active', dateOffset: 0, hour: 14, mt: 3, mo: 0, st: null, so: null,
    createdAt: Date.now(),
  });
  const interaction = fakeButtonInteraction('combat:newpick:next:msg-N1');
  await handlePickerNextButton(interaction);
  assert.equal(interaction._updated.components.length, 3, 'page 2 should be rendered');
  assert.match(interaction._updated.content, /Seconds/);
});

test('handlePickerNextButton: without complete page-1 state replies with error', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-N2', {
    type: 'def_active', dateOffset: 0, hour: 14, mt: null, mo: null, st: null, so: null,
    createdAt: Date.now(),
  });
  const interaction = fakeButtonInteraction('combat:newpick:next:msg-N2');
  await handlePickerNextButton(interaction);
  assert.ok(interaction._replied, 'expected an ephemeral reply');
  assert.match(interaction._replied.content, /Pick date, hour, and minutes/);
});

test('handlePickerNextButton: expired state returns friendly error', async () => {
  _resetPickerStateForTests();
  const interaction = fakeButtonInteraction('combat:newpick:next:msg-N3-MISSING');
  await handlePickerNextButton(interaction);
  assert.equal(interaction._updated.components.length, 0);
  assert.match(interaction._updated.content, /expired/i);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: the three Next button tests fail because the current stub always returns "expired".

- [ ] **Step 3: Implement real `handlePickerNextButton`**

In `src/handlers/defCallPicker.js`, replace lines 213-218 (the stub) with:

```js
export async function handlePickerNextButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  if (state.dateOffset == null || state.hour == null || state.mt == null || state.mo == null) {
    return interaction.reply({
      content: '❌ Pick date, hour, and minutes first.',
      ephemeral: true,
    });
  }

  const payload = buildPickerPage2(msgId, state);
  await interaction.update({ content: payload.content, components: payload.components });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: all three Next button tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "feat(defCallPicker): Next button transitions page 1 -> page 2"
```

---

### Task 7: Replace `handlePickerBackButton` stub with real page transition

**Files:**
- Modify: `src/handlers/defCallPicker.js:220-225`
- Test: `tests/defCallPicker.test.js:121-126`

- [ ] **Step 1: Replace the legacy-stub test with real-flow tests**

In `tests/defCallPicker.test.js`, replace the test at lines 121-126 (`handlePickerBackButton: returns expired message (legacy button)`) with:

```js
test('handlePickerBackButton: with state returns to page 1 preserving values', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-B1', {
    type: 'def_active', dateOffset: 0, hour: 14, mt: 3, mo: 0, st: 4, so: 5,
    createdAt: Date.now(),
  });
  const interaction = fakeButtonInteraction('combat:newpick:back:msg-B1');
  await handlePickerBackButton(interaction);
  assert.equal(interaction._updated.components.length, 5, 'page 1 should be rendered');
  assert.match(interaction._updated.content, /Pick impact time/);
  // State preserved
  const state = _getPickerStateForTests('msg-B1');
  assert.equal(state.mt, 3);
  assert.equal(state.mo, 0);
  assert.equal(state.st, 4);
  assert.equal(state.so, 5);
});

test('handlePickerBackButton: expired state returns friendly error', async () => {
  _resetPickerStateForTests();
  const interaction = fakeButtonInteraction('combat:newpick:back:msg-B2-MISSING');
  await handlePickerBackButton(interaction);
  assert.equal(interaction._updated.components.length, 0);
  assert.match(interaction._updated.content, /expired/i);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: the "with state returns to page 1" test fails because the current stub always returns "expired".

- [ ] **Step 3: Implement real `handlePickerBackButton`**

In `src/handlers/defCallPicker.js`, replace lines 220-225 (the stub) with:

```js
export async function handlePickerBackButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  const payload = buildPickerPage1(msgId, state);
  await interaction.update({ content: payload.content, components: payload.components });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: both Back button tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCallPicker.js tests/defCallPicker.test.js
git commit -m "feat(defCallPicker): Back button returns page 2 -> page 1 preserving state"
```

---

### Task 8: Update `handlePickerCreateButton` tests to new state shape

**Files:**
- Test: `tests/defCallPicker.test.js:165-228` (no source code change — `handlePickerCreateButton` already uses `resolveStateToUnix`, which now handles the new shape)

- [ ] **Step 1: Update the three Create-button tests to new state shape**

In `tests/defCallPicker.test.js`, replace the three Create tests at lines 165-228 with:

```js
test('handlePickerCreateButton: rejects incomplete state', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-C1', {
    type: 'def_active', dateOffset: null, hour: 14, mt: 3, mo: 0, createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:create:msg-C1',
    reply: async function (p) { this._replied = p; },
    update: async function (p) { this._updated = p; },
  };
  await handlePickerCreateButton(interaction);
  assert.match(interaction._replied.content, /Pick date, hour, and minutes/);
});

test('handlePickerCreateButton: rejects past deadlines', async () => {
  _resetPickerStateForTests();
  _setPickerStateForTests('msg-C2', {
    type: 'def_active', dateOffset: -1, hour: 0, mt: 0, mo: 0, st: 0, so: 0,
    createdAt: Date.now(),
  });
  const interaction = {
    customId: 'combat:newpick:create:msg-C2',
    reply: async function (p) { this._replied = p; },
    update: async function (p) { this._updated = p; },
  };
  await handlePickerCreateButton(interaction);
  assert.ok(interaction._replied, 'expected a reply for past deadline');
  assert.match(interaction._replied.content, /past/);
});

test('handlePickerCreateButton: creates call on full state', async () => {
  await setupTestDb();
  resetTables();
  _resetPickerStateForTests();
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  const state = {
    type: 'def_active',
    x: -12, y: 34, troopsNeeded: 5000, notes: 'pls help', sourceReportId: null,
    dateOffset: 1,   // tomorrow — always in the future
    hour: 12,
    mt: 0, mo: 0,
    st: 0, so: 0,
    createdAt: Date.now(),
  };
  _setPickerStateForTests('msg-C3', state);

  const guild = { id: 'guild-1', roles: { cache: { find: () => null }, fetch: async () => ({ find: () => null }) } };
  const interaction = {
    customId: 'combat:newpick:create:msg-C3',
    user: { id: 'coord-1' },
    guild,
    client: { channels: { fetch: async () => ({ guild, send: async () => ({ id: 'sent-1' }) }) } },
    reply: async function (p) { this._replied = p; },
    update: async function (p) { this._updated = p; },
  };

  await handlePickerCreateButton(interaction);
  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.ok(call, 'expected call inserted');
  assert.equal(call.x, -12);
  assert.equal(call.y, 34);
  assert.match(interaction._updated.content, /Call #\d+ posted/);
  assert.equal(_getPickerStateForTests('msg-C3'), undefined, 'state should be reaped');
});

test('handlePickerCreateButton: creates call with full HH:MM:SS precision', async () => {
  await setupTestDb();
  resetTables();
  _resetPickerStateForTests();
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  // Build state for tomorrow 12:34:45 UTC — exercises every digit.
  const state = {
    type: 'def_active',
    x: 1, y: 2, troopsNeeded: 100, notes: null, sourceReportId: null,
    dateOffset: 1, hour: 12,
    mt: 3, mo: 4,
    st: 4, so: 5,
    createdAt: Date.now(),
  };
  _setPickerStateForTests('msg-C4', state);

  const guild = { id: 'g', roles: { cache: { find: () => null }, fetch: async () => ({ find: () => null }) } };
  const interaction = {
    customId: 'combat:newpick:create:msg-C4',
    user: { id: 'coord-1' },
    guild,
    client: { channels: { fetch: async () => ({ guild, send: async () => ({ id: 'sent-1' }) }) } },
    reply: async function (p) { this._replied = p; },
    update: async function (p) { this._updated = p; },
  };

  await handlePickerCreateButton(interaction);
  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  const now = new Date();
  const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12, 34, 45) / 1000;
  assert.equal(call.deadline, expected, 'deadline should include the full :45 seconds');
});
```

- [ ] **Step 2: Run tests to verify pass (no source change needed)**

Run: `npm test -- tests/defCallPicker.test.js`
Expected: all four Create-button tests pass. `handlePickerCreateButton` doesn't need changes — it already delegates state validation to `resolveStateToUnix`, which we updated in Task 2.

- [ ] **Step 3: Commit**

```bash
git add tests/defCallPicker.test.js
git commit -m "test(defCallPicker): Create-button tests use new mt/mo/st/so state shape"
```

---

### Task 9: Add optional `arrival` field to the panel-button modal in `handleDefCallButton`

**Files:**
- Modify: `src/handlers/defCalls.js:131-151`
- Test: `tests/defCallsEscalate.test.js` (add new tests at end of file)

- [ ] **Step 1: Add failing tests for the panel-button modal**

In `tests/defCallsEscalate.test.js`, append these tests after the existing ones:

```js
test('def_active panel button opens modal with optional arrival field', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';

  const interaction = {
    customId: 'call:def_active',
    member: fakeMember(['Leadership']),
    user: { id: 'leader-1' },
    showModal: async modal => { interaction.modal = modal; },
  };
  await routeButton(interaction);

  assert.ok(interaction.modal, 'expected a modal');
  const json = interaction.modal.toJSON();
  const arrival = componentById(json, 'arrival');
  assert.ok(arrival, 'arrival field should be present for def_active');
  assert.equal(arrival.required, false);
  assert.match(arrival.placeholder, /or just type it here/);
});

test('def_perma panel button modal has no arrival field', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';

  const interaction = {
    customId: 'call:def_perma',
    member: fakeMember(['Leadership']),
    user: { id: 'leader-1' },
    showModal: async modal => { interaction.modal = modal; },
  };
  await routeButton(interaction);

  assert.ok(interaction.modal, 'expected a modal');
  const json = interaction.modal.toJSON();
  assert.equal(componentById(json, 'arrival'), undefined, 'def_perma has no deadline, no arrival field');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallsEscalate.test.js`
Expected: the `def_active panel button opens modal with optional arrival field` test fails because the current modal has only coords/troops/notes.

- [ ] **Step 3: Add the optional arrival row to `handleDefCallButton`**

In `src/handlers/defCalls.js`, replace lines 131-151 with:

```js
// ── Panel entry: call:def_active or call:def_perma ───────────────────────────
export async function handleDefCallButton(interaction) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const type = interaction.customId.split(':')[1]; // 'def_active' or 'def_perma'
  const config = COMBAT_CONFIG[type];
  if (!config) return interaction.reply({ content: '❌ Unknown call type.', ephemeral: true });

  const modal = new ModalBuilder().setCustomId(`combat:create_def:${type}`).setTitle(config.label);

  const coords = new TextInputBuilder().setCustomId('coords').setLabel('Defender coordinates').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('(-12|34)').setMaxLength(20);
  const troops = new TextInputBuilder().setCustomId('troops_needed').setLabel('Troops needed (def value)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 15000').setMaxLength(10);
  const notes  = new TextInputBuilder().setCustomId('notes').setLabel('Notes').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coords),
    new ActionRowBuilder().addComponents(troops),
    new ActionRowBuilder().addComponents(notes),
  );

  // def_active gets an optional Impact-time text box; def_perma has no deadline.
  if (!config.noDeadline) {
    const arrival = new TextInputBuilder()
      .setCustomId('arrival')
      .setLabel('Impact time (UTC) — optional')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('or just type it here · 14:30:45 · in 2h30m')
      .setMaxLength(60);
    modal.addComponents(new ActionRowBuilder().addComponents(arrival));
  }

  await interaction.showModal(modal);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallsEscalate.test.js`
Expected: both new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCalls.js tests/defCallsEscalate.test.js
git commit -m "feat(defCalls): optional arrival field on def_active panel modal"
```

---

### Task 10: Add pre-filled `arrival` field to the escalation modal in `showEscalateModal`

**Files:**
- Modify: `src/handlers/defCalls.js:405-453`
- Test: `tests/defCallsEscalate.test.js:50-74`

- [ ] **Step 1: Update the existing escalation-modal test**

In `tests/defCallsEscalate.test.js`, replace lines 50-74 (the test `report escalate active button opens a pre-filled def call modal`) with:

```js
test('report escalate active button opens a pre-filled def call modal', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';

  const reportId = insertReport();
  const interaction = {
    customId: `report:escalate_active:${reportId}`,
    member: fakeMember(['Leadership']),
    user: { id: 'leader-1' },
    showModal: async modal => { interaction.modal = modal; },
    reply: async payload => { interaction.replyPayload = payload; },
  };

  await routeButton(interaction);

  assert.ok(interaction.modal, 'expected router to show an escalation modal');
  const json = interaction.modal.toJSON();
  assert.equal(json.custom_id, `combat:create_def_from_report:def_active:${reportId}`);
  assert.equal(componentById(json, 'coords').value, '(-12|34)');
  assert.match(componentById(json, 'notes').value, /Wave spread 6s/);
  assert.match(componentById(json, 'notes').value, /in-between def possible/);

  // arrival is now present, pre-filled with the report's first_eta as a UTC timestamp.
  const arrival = componentById(json, 'arrival');
  assert.ok(arrival, 'arrival field should be present');
  assert.equal(arrival.required, false);
  assert.equal(arrival.value, '2030-03-17 17:46:40', 'arrival pre-fill should equal formatDeadline(first_eta)');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallsEscalate.test.js`
Expected: the updated escalation-modal test fails — current `showEscalateModal` has no `arrival` field.

- [ ] **Step 3: Add the pre-filled arrival row to `showEscalateModal`**

In `src/handlers/defCalls.js`, replace lines 405-453 with:

```js
async function showEscalateModal(interaction, type, reportId) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }

  const report = prepare('SELECT * FROM incoming_reports WHERE id = ?').get(reportId);
  if (!report) return interaction.reply({ content: 'Report not found.', ephemeral: true });

  const config = COMBAT_CONFIG[type];
  if (!config) return interaction.reply({ content: '❌ Unknown call type.', ephemeral: true });

  const modal = new ModalBuilder()
    .setCustomId(`combat:create_def_from_report:${type}:${reportId}`)
    .setTitle(`${config.label} (from #${reportId})`);

  const coords = new TextInputBuilder()
    .setCustomId('coords')
    .setLabel('Defender coordinates')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(formatCoords(report.defender_x, report.defender_y))
    .setMaxLength(20);
  modal.addComponents(new ActionRowBuilder().addComponents(coords));

  const troops = new TextInputBuilder()
    .setCustomId('troops_needed')
    .setLabel('Troops needed (def value)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g. 15000')
    .setMaxLength(10);
  modal.addComponents(new ActionRowBuilder().addComponents(troops));

  const inbetweenMin = Number(prepare('SELECT value FROM config WHERE key=?').get('inbetween_min_gap_sec')?.value ?? '1');
  const hasWindow = report.waves > 1 && report.wave_spread_sec != null && report.wave_spread_sec >= inbetweenMin;
  let notesPrefill = '';
  if (hasWindow) notesPrefill = `Wave spread ${report.wave_spread_sec}s — in-between def possible`;

  const notes = new TextInputBuilder()
    .setCustomId('notes')
    .setLabel('Notes')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
  if (notesPrefill) notes.setValue(notesPrefill);
  modal.addComponents(new ActionRowBuilder().addComponents(notes));

  // Optional arrival field, pre-filled from the report's first_eta.
  if (!config.noDeadline) {
    const arrival = new TextInputBuilder()
      .setCustomId('arrival')
      .setLabel('Impact time (UTC) — optional')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('or just type it here · 14:30:45 · in 2h30m')
      .setMaxLength(60);
    if (report.first_eta) arrival.setValue(formatDeadline(report.first_eta));
    modal.addComponents(new ActionRowBuilder().addComponents(arrival));
  }

  return interaction.showModal(modal);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallsEscalate.test.js`
Expected: the escalation-modal test passes.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCalls.js tests/defCallsEscalate.test.js
git commit -m "feat(defCalls): pre-fill arrival from report.first_eta on escalation"
```

---

### Task 11: Branch on `arrival` in `handleDefCallCreateModal` — fast path

**Files:**
- Modify: `src/handlers/defCalls.js:207-260`
- Test: `tests/defCallsEscalate.test.js:76-120`

- [ ] **Step 1: Update the existing from-report modal test + add fast-path test**

In `tests/defCallsEscalate.test.js`, replace the test at lines 76-120 (`from-report def call modal replies with picker page 1 instead of creating call`) with two tests:

```js
test('from-report def call modal with empty arrival shows picker page 1', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  delete process.env.DEF_ROLE_NAME;

  const reportId = insertReport();
  prepare('INSERT INTO panels (type, channel_id, message_id) VALUES (?, ?, ?)').run('def-calls', 'def-channel', 'panel-msg');
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  const interaction = {
    customId: `combat:create_def_from_report:def_active:${reportId}`,
    member: fakeMember(['Defense Coordinator']),
    user: { id: 'coord-1' },
    fields: {
      getTextInputValue(name) {
        return {
          coords: '(-12|34)',
          troops_needed: '5,000',
          notes: 'Wave gap ~2.0s - in-between def possible',
          arrival: '',          // ← empty arrival forces the picker
        }[name] ?? '';
      },
    },
    client: { channels: { fetch: async () => ({}) } },
    _editedTo: null,
    reply: async () => { return { id: 'eph-1' }; },
    editReply: async (payload) => { interaction._editedTo = payload; },
  };

  await routeModal(interaction);

  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.equal(call, undefined, 'no call should be created when picker is shown');
  assert.ok(interaction._editedTo, 'expected editReply to be invoked');
  assert.equal(interaction._editedTo.components.length, 5);
  assert.match(interaction._editedTo.content, /Report ETA: 2030-03-17 17:46:40 UTC/);
  assert.match(interaction._editedTo.content, /Pick impact time/);
});

test('from-report def call modal with valid future arrival creates call directly', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  delete process.env.DEF_ROLE_NAME;

  const reportId = insertReport();
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  const futureIso = new Date(Date.now() + 3600_000).toISOString();
  const guild = { id: 'g', roles: { cache: { find: () => null }, fetch: async () => ({ find: () => null }) } };
  const interaction = {
    customId: `combat:create_def_from_report:def_active:${reportId}`,
    member: fakeMember(['Defense Coordinator']),
    user: { id: 'coord-1' },
    guild,
    fields: {
      getTextInputValue(name) {
        return {
          coords: '(-12|34)',
          troops_needed: '5000',
          notes: '',
          arrival: futureIso,
        }[name] ?? '';
      },
    },
    client: { channels: { fetch: async () => ({ guild, send: async () => ({ id: 'sent-1' }) }) } },
    reply: async function (p) { this._replied = p; },
  };

  await routeModal(interaction);

  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.ok(call, 'expected call to be created directly');
  assert.equal(call.x, -12);
  assert.equal(call.y, 34);
  assert.match(interaction._replied.content, /Call #\d+ posted/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/defCallsEscalate.test.js`
Expected: the new "valid future arrival creates call directly" test fails (current modal handler always shows picker).

- [ ] **Step 3: Add fast-path branch to `handleDefCallCreateModal`**

In `src/handlers/defCalls.js`, locate `handleDefCallCreateModal` (lines 207-260). After the existing coords + troops + notes validation but before `if (config.noDeadline)`, insert the arrival fast-path. Replace lines 207-260 with:

```js
// ── Modal submit: combat:create_def:<type> ───────────────────────────────────
export async function handleDefCallCreateModal(interaction, sourceReportId = null) {
  if (!isLeadershipOrCoord(interaction.member)) {
    return interaction.reply({ content: '❌ Leadership / Def Coord only.', ephemeral: true });
  }
  const type = interaction.customId.split(':')[2];
  const config = COMBAT_CONFIG[type];
  if (!config) return interaction.reply({ content: '❌ Unknown call type.', ephemeral: true });

  const coordsStr = interaction.fields.getTextInputValue('coords');
  const coords = parseCoords(coordsStr);
  if (!coords) return interaction.reply({ content: `❌ Invalid coords: \`${coordsStr}\``, ephemeral: true });

  const troopsStr = interaction.fields.getTextInputValue('troops_needed').trim().replace(/[, ]/g, '');
  const troopsNeeded = parseInt(troopsStr, 10);
  if (!Number.isInteger(troopsNeeded) || troopsNeeded < 1 || troopsNeeded > 10_000_000) {
    return interaction.reply({ content: '❌ Troops needed must be a positive integer (1–10,000,000).', ephemeral: true });
  }

  const notes = interaction.fields.getTextInputValue('notes') || null;

  // def_perma has no deadline — create directly, no picker.
  if (config.noDeadline) {
    const { callId, error } = await createDefCall(interaction, {
      type, x: coords.x, y: coords.y, deadline: null, troopsNeeded, notes, sourceReportId,
    });
    if (error) return interaction.reply({ content: error, ephemeral: true });
    return interaction.reply({ content: `✅ Call #${callId} posted.`, ephemeral: true });
  }

  // Fast path: optional `arrival` field on the modal. If it parses to a future
  // timestamp, skip the picker entirely. Unparseable/past values silently fall
  // through to the picker (per design — the user can correct via clicks).
  let arrivalRaw = '';
  try { arrivalRaw = interaction.fields.getTextInputValue('arrival') ?? ''; } catch { /* field absent — older modal */ }
  if (arrivalRaw.trim()) {
    const deadline = parseDeadline(arrivalRaw);
    if (deadline != null && deadline >= unixNow()) {
      const { callId, error } = await createDefCall(interaction, {
        type, x: coords.x, y: coords.y, deadline, troopsNeeded, notes, sourceReportId,
      });
      if (error) return interaction.reply({ content: error, ephemeral: true });
      return interaction.reply({ content: `✅ Call #${callId} posted.`, ephemeral: true });
    }
    // else: silent fall-through to picker
  }

  // def_active: stash state, reply with picker page 1.
  const reportFirstEta = sourceReportId
    ? prepare('SELECT first_eta FROM incoming_reports WHERE id = ?').get(sourceReportId)?.first_eta ?? null
    : null;

  // Dynamic import: defCallPicker.js imports createDefCall from this file, so a
  // top-level import would create a circular dependency.
  const picker = await import('./defCallPicker.js');
  const sent = await interaction.reply({ content: 'Building picker…', ephemeral: true, fetchReply: true });
  if (!sent?.id) {
    return interaction.editReply({ content: '❌ Could not initialize picker. Please try again.', components: [] });
  }
  const msgId = sent.id;
  const state = {
    type, x: coords.x, y: coords.y, troopsNeeded, notes, sourceReportId,
    reportFirstEta,
    dateOffset: null, hour: null, mt: null, mo: null, st: null, so: null,
    createdAt: Date.now(),
    _pickerInteraction: interaction,
  };
  picker.setPickerState(msgId, state);
  const payload = picker.buildPickerPage1(msgId, state);
  await interaction.editReply({ content: payload.content, components: payload.components });
  return sent.id;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- tests/defCallsEscalate.test.js`
Expected: both updated tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/defCalls.js tests/defCallsEscalate.test.js
git commit -m "feat(defCalls): valid arrival in modal creates call directly (skip picker)"
```

---

### Task 12: Silent fall-through for unparseable / past arrival

**Files:**
- Modify: `src/handlers/defCalls.js` (no change needed — Task 11 already implemented silent fall-through)
- Test: `tests/defCallsEscalate.test.js` (add two new tests)

- [ ] **Step 1: Add failing tests for fall-through behaviors**

In `tests/defCallsEscalate.test.js`, append these tests at the end:

```js
test('from-report def call modal with unparseable arrival silently shows picker', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  delete process.env.DEF_ROLE_NAME;

  const reportId = insertReport();
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  const interaction = {
    customId: `combat:create_def_from_report:def_active:${reportId}`,
    member: fakeMember(['Defense Coordinator']),
    user: { id: 'coord-1' },
    fields: {
      getTextInputValue(name) {
        return {
          coords: '(-12|34)',
          troops_needed: '5000',
          notes: '',
          arrival: 'xyzzy not a real date',
        }[name] ?? '';
      },
    },
    client: { channels: { fetch: async () => ({}) } },
    _editedTo: null,
    _replied: null,
    reply: async () => ({ id: 'eph-1' }),
    editReply: async (payload) => { interaction._editedTo = payload; },
  };

  await routeModal(interaction);

  // No call inserted, no error reply, picker shown.
  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.equal(call, undefined);
  assert.ok(interaction._editedTo, 'picker should be rendered via editReply');
  assert.equal(interaction._editedTo.components.length, 5);
  assert.match(interaction._editedTo.content, /Pick impact time/);
});

test('from-report def call modal with past arrival silently shows picker', async () => {
  await setupTestDb();
  resetTables();
  process.env.LEADERSHIP_ROLE_NAME = 'Leadership';
  process.env.DEF_COORD_ROLE_NAME = 'Defense Coordinator';
  delete process.env.DEF_ROLE_NAME;

  const reportId = insertReport();
  prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('def_calls_channel_id', 'def-channel');

  const interaction = {
    customId: `combat:create_def_from_report:def_active:${reportId}`,
    member: fakeMember(['Defense Coordinator']),
    user: { id: 'coord-1' },
    fields: {
      getTextInputValue(name) {
        return {
          coords: '(-12|34)',
          troops_needed: '5000',
          notes: '',
          arrival: '2000-01-01 00:00:00',   // far past
        }[name] ?? '';
      },
    },
    client: { channels: { fetch: async () => ({}) } },
    _editedTo: null,
    reply: async () => ({ id: 'eph-1' }),
    editReply: async (payload) => { interaction._editedTo = payload; },
  };

  await routeModal(interaction);

  const call = prepare('SELECT * FROM calls WHERE type = ?').get('def_active');
  assert.equal(call, undefined);
  assert.ok(interaction._editedTo, 'picker should be rendered via editReply');
  assert.equal(interaction._editedTo.components.length, 5);
});
```

- [ ] **Step 2: Run tests to verify pass**

Run: `npm test -- tests/defCallsEscalate.test.js`
Expected: both tests pass — Task 11's implementation already handles unparseable and past timestamps via the silent fall-through branch.

If a test fails: re-check the implementation of `handleDefCallCreateModal` from Task 11 — the silent fall-through must NOT call `interaction.reply` with an error before reaching the picker path.

- [ ] **Step 3: Commit**

```bash
git add tests/defCallsEscalate.test.js
git commit -m "test(defCalls): silent fall-through for unparseable/past arrival"
```

---

### Task 13: Full regression sweep

**Files:** none modified

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests across all files pass.

If any unrelated test fails (e.g., a test that hard-coded `combat:newpick:minute:` strings outside the two files we modified), grep for the stale identifier:

```
grep -r "newpick:minute" tests/ src/
grep -r "newpick:second" tests/ src/
grep -r "MINUTE_SECOND_STEPS" tests/ src/
grep -r "state\.minute" tests/ src/
grep -r "state\.second" tests/ src/
```

…and fix each remaining occurrence inline. Re-run `npm test` until clean.

- [ ] **Step 2: Smoke-read the picker file**

Open [src/handlers/defCallPicker.js](src/handlers/defCallPicker.js) and verify:

- `MINUTE_SECOND_STEPS` is gone.
- The `pickerState` value shape comment (or surrounding doc) reflects `mt`/`mo`/`st`/`so`.
- `_parseMsgId`, `_expiredOrMissing`, `setPickerState`, `_resetPickerStateForTests`, `_getPickerStateForTests`, `_setPickerStateForTests`, `utcDateString`, `dateLabel` are unchanged from before.
- `buildPickerPage1` exports the new shape (date/hour/mt/mo + type_instead/next).
- `buildPickerPage2` is exported.
- `handlePickerSelect`, `handlePickerNextButton`, `handlePickerBackButton`, `handlePickerCreateButton`, `handlePickerTypeInsteadButton`, `handlePickerTypeInsteadSubmit` all exist and are exported.

- [ ] **Step 3: Smoke-read the modal file**

Open [src/handlers/defCalls.js](src/handlers/defCalls.js) and verify:

- `handleDefCallButton` adds the `arrival` row only when `!config.noDeadline`.
- `showEscalateModal` adds the `arrival` row pre-filled with `formatDeadline(report.first_eta)` when `!config.noDeadline`.
- `handleDefCallCreateModal` reads `arrival`, attempts `parseDeadline`, creates directly on future parse, falls through silently otherwise.

- [ ] **Step 4: Final commit (if any grep-fix changes were made)**

```bash
git status
# if any modifications:
git add -p
git commit -m "chore(defCallPicker): remove stale references to old state shape"
```

If no changes were needed in Step 1, skip this step.

---

## Spec Coverage Check (self-review)

- ✅ Modal `arrival` field added optionally on `def_active` (Task 9), with help-text placeholder.
- ✅ Modal `arrival` pre-filled from `report.first_eta` on escalation (Task 10).
- ✅ Fast path: parseable + future → direct create (Task 11).
- ✅ Silent fall-through on unparseable/past (Task 11 implementation, Task 12 tests).
- ✅ Picker page 1: date/hour/mt/mo + [Type instead, Next] (Task 3).
- ✅ Picker page 2: st/so + [Back, Create] (Task 4).
- ✅ `buildHeaderText` derives min/sec from tens/ones (Task 1).
- ✅ `resolveStateToUnix` combines tens/ones; seconds default to :00 (Task 2).
- ✅ `handlePickerSelect` dispatches to correct page (Task 5).
- ✅ `handlePickerNextButton` validates page-1 completeness, transitions to page 2 (Task 6).
- ✅ `handlePickerBackButton` returns to page 1 preserving state (Task 7).
- ✅ `handlePickerCreateButton` works against new state shape via the updated resolver (Task 8).
- ✅ `def_perma` modal unchanged (Task 9 explicit test).
- ✅ No router changes needed; tests confirm routing works.
