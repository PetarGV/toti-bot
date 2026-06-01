// Two-page ephemeral picker for creating def_active calls.
// Replaces the free-text "arrival" field in the create modals.
// Custom-ID namespace: combat:newpick:*

import {
  StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { parseDeadline, formatDeadline, unixNow } from '../utils/time.js';
import { isLeadershipOrCoord } from '../utils/tier.js';
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

// Format the partial-state header text. Unpicked slots render as underscores.
export function buildHeaderText(state) {
  const datePart = (state.dateOffset == null)
    ? '____-__-__'
    : (() => {
        const now = new Date();
        const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + state.dateOffset));
        const pad = n => String(n).padStart(2, '0');
        return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;
      })();
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
  return Math.floor(utcMs / 1000);
}

function dateLabel(offset) {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}`;
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
