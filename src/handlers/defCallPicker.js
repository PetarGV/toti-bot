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
