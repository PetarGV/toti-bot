// Two-page ephemeral picker for creating def_active calls.
// Replaces the free-text "arrival" field in the create modals.
// Custom-ID namespace: combat:newpick:*

import {
  StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { parseDeadline, formatDeadline, unixNow } from '../utils/time.js';
import { createDefCall } from './defCalls.js';

// In-memory state, keyed by the ephemeral message ID. See spec for rationale
// (customID 100-char limit can't carry notes; DB persistence is overkill for
// a 15-minute interaction window).
const pickerState = new Map();
const TTL_MS = 16 * 60 * 1000;   // slightly above Discord's 15-min token

const _janitor = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pickerState) {
    if (now - v.createdAt > TTL_MS) pickerState.delete(k);
  }
}, 60_000);
if (typeof _janitor.unref === 'function') _janitor.unref();

export function setPickerState(msgId, state) {
  pickerState.set(msgId, state);
}

// Exposed for tests; do not call from production code.
export function _resetPickerStateForTests() {
  pickerState.clear();
}

export function _getPickerStateForTests(msgId) {
  return pickerState.get(msgId);
}

export function _setPickerStateForTests(msgId, value) {
  pickerState.set(msgId, value);
}

function utcDateString(offset) {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  const pad = n => String(n).padStart(2, '0');
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;
}

// Format the partial-state header text. Unpicked slots render as underscores.
export function buildHeaderText(state) {
  const datePart = (state.dateOffset == null)
    ? '____-__-__'
    : utcDateString(state.dateOffset);
  const hourPart = state.hour == null ? '__' : String(state.hour).padStart(2, '0');
  const minPart = (state.mt == null || state.mo == null) ? '__' : `${state.mt}${state.mo}`;
  const secPart = (state.st == null || state.so == null) ? '__' : `${state.st}${state.so}`;
  return `${datePart} ${hourPart}:${minPart}:${secPart}`;
}

// Resolve picker state to a unix timestamp, defaulting missing seconds to 00.
// Returns null if date/hour/minute components are not all set.
export function resolveStateToUnix(state) {
  if (state.dateOffset == null || state.hour == null || state.mt == null || state.mo == null) return null;
  const now = new Date();
  const utcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + state.dateOffset,
    state.hour,
    state.mt * 10 + state.mo,
    (state.st ?? 0) * 10 + (state.so ?? 0),
  );
  // Callers must validate that the result is in the future (not done here).
  return Math.floor(utcMs / 1000);
}

function dateLabel(offset) {
  const datePart = utcDateString(offset);
  if (offset === 0) return `Today (${datePart} UTC)`;
  if (offset === 1) return `Tomorrow (${datePart} UTC)`;
  return `Day after (${datePart} UTC)`;
}

export function buildPickerPage1(msgId, state) {
  const reportLine = state.reportFirstEta
    ? `Report ETA: ${formatDeadline(state.reportFirstEta)} UTC\n`
    : '';
  const content = `${reportLine}Pick impact time (UTC) — currently: \`${buildHeaderText(state)}\``;

  const dateSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:date:${msgId}`)
    .setPlaceholder(state.dateOffset == null ? 'Date' : dateLabel(state.dateOffset))
    .addOptions([0, 1, 2].map(o => ({ label: dateLabel(o), value: String(o), default: state.dateOffset === o })));

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
    .setPlaceholder(state.mt == null ? 'Minute tens (0–5)' : `Min tens: ${state.mt}`)
    .addOptions([0, 1, 2, 3, 4, 5].map(v => ({ label: String(v), value: String(v), default: state.mt === v })));

  const moSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:mo:${msgId}`)
    .setPlaceholder(state.mo == null ? 'Minute ones (0–9)' : `Min ones: ${state.mo}`)
    .addOptions(Array.from({ length: 10 }, (_, v) => ({ label: String(v), value: String(v), default: state.mo === v })));

  const typeBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:type_instead:${msgId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Type instead')
    .setEmoji('⌨️');

  const nextBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:next:${msgId}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel('Next →');

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

function _parseMsgId(customId) {
  // Format: combat:newpick:<part>:<msgId>
  return customId.split(':').slice(3).join(':');
}

function _expiredOrMissing(interaction, state) {
  if (!state) {
    return interaction.update({
      content: '⏱️ Picker session expired — please re-open the call.',
      components: [],
    }).then(() => true).catch(() => true);
  }
  return false;
}

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

  // Re-render current page.
  const onPage2 = state._page === 2;
  const payload = onPage2
    ? buildPickerPage2(msgId, state)
    : buildPickerPage1(msgId, state);
  await interaction.update({ content: payload.content, components: payload.components });
}

export function buildPickerPage2(msgId, state) {
  const content = `Seconds (UTC) — currently: \`${buildHeaderText({ ...state, st: state.st ?? 0, so: state.so ?? 0 })}\`\n_Tip: leave both seconds selects unpicked for :00._`;

  const stSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:st:${msgId}`)
    .setPlaceholder(state.st == null ? 'Second tens (0–5)' : `Sec tens: ${state.st}`)
    .addOptions([0, 1, 2, 3, 4, 5].map(v => ({ label: String(v), value: String(v), default: state.st === v })));

  const soSelect = new StringSelectMenuBuilder()
    .setCustomId(`combat:newpick:so:${msgId}`)
    .setPlaceholder(state.so == null ? 'Second ones (0–9)' : `Sec ones: ${state.so}`)
    .addOptions(Array.from({ length: 10 }, (_, v) => ({ label: String(v), value: String(v), default: state.so === v })));

  const backBtn = new ButtonBuilder()
    .setCustomId(`combat:newpick:back:${msgId}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('← Back');

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

export async function handlePickerTypeInsteadButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  const modal = new ModalBuilder()
    .setCustomId(`combat:newpick:type_instead_submit:${msgId}`)
    .setTitle('Impact time (UTC)');

  const arrival = new TextInputBuilder()
    .setCustomId('arrival')
    .setLabel('Impact time (UTC)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('14:30:45 · in 2h30m · 2030-06-01 10:00:01')
    .setMaxLength(60);

  if (state.reportFirstEta) {
    arrival.setValue(formatDeadline(state.reportFirstEta));
  }

  modal.addComponents(new ActionRowBuilder().addComponents(arrival));
  await interaction.showModal(modal);
}
export async function handlePickerNextButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  // Require page-1 components to all be picked before advancing.
  if (state.dateOffset == null || state.hour == null || state.mt == null || state.mo == null) {
    return interaction.reply({
      content: '❌ Pick date, hour, and minutes first.',
      ephemeral: true,
    });
  }

  state._page = 2;
  const payload = buildPickerPage2(msgId, state);
  await interaction.update({ content: payload.content, components: payload.components });
}

export async function handlePickerBackButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  state._page = 1;
  const payload = buildPickerPage1(msgId, state);
  await interaction.update({ content: payload.content, components: payload.components });
}
export async function handlePickerCreateButton(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (await _expiredOrMissing(interaction, state)) return;

  const deadline = resolveStateToUnix(state);
  if (deadline == null) {
    return interaction.reply({
      content: '❌ Pick date, hour, and minutes first.',
      ephemeral: true,
    });
  }
  if (deadline < unixNow()) {
    return interaction.reply({
      content: '❌ Impact time is in the past.',
      ephemeral: true,
    });
  }

  const { callId, error } = await createDefCall(interaction, {
    type: state.type,
    x: state.x,
    y: state.y,
    deadline,
    troopsNeeded: state.troopsNeeded,
    notes: state.notes,
    sourceReportId: state.sourceReportId,
  });

  if (error) {
    return interaction.reply({ content: error, ephemeral: true });
  }

  pickerState.delete(msgId);
  await interaction.update({
    content: `✅ Call #${callId} posted.`,
    components: [],
  });
}
export async function handlePickerTypeInsteadSubmit(interaction) {
  const msgId = _parseMsgId(interaction.customId);
  const state = pickerState.get(msgId);
  if (!state) {
    return interaction.reply({
      content: '⏱️ Picker session expired — please re-open the call.',
      ephemeral: true,
    });
  }

  const raw = interaction.fields.getTextInputValue('arrival');
  const deadline = parseDeadline(raw);
  if (deadline == null) {
    return interaction.reply({
      content: `❌ Could not parse \`${raw}\`. Try \`14:30:45\`, \`in 2h30m\`, or \`2030-06-01 10:00:01\`.`,
      ephemeral: true,
    });
  }
  if (deadline < unixNow()) {
    return interaction.reply({
      content: '❌ Impact time is in the past.',
      ephemeral: true,
    });
  }

  const { callId, error } = await createDefCall(interaction, {
    type: state.type,
    x: state.x,
    y: state.y,
    deadline,
    troopsNeeded: state.troopsNeeded,
    notes: state.notes,
    sourceReportId: state.sourceReportId,
  });
  if (error) return interaction.reply({ content: error, ephemeral: true });

  pickerState.delete(msgId);
  await interaction.reply({
    content: `✅ Call #${callId} posted.`,
    ephemeral: true,
  });
}
