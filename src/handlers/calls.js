import { prepare } from '../db/client.js';
import { logger } from '../utils/logger.js';

// ── Renderer registry ────────────────────────────────────────────────────────
// Map<typePrefix, { buildEmbed(call, pledges, client?), buildComponents(call) }>
const renderers = new Map();

/**
 * Register a renderer for a call type prefix (e.g. 'push', 'defense').
 * @param {string} prefix
 * @param {{ buildEmbed: Function, buildComponents: Function }} renderer
 */
export function registerRenderer(prefix, renderer) {
  renderers.set(prefix, renderer);
}

/**
 * Fetch the call and pledges, rebuild the embed + components, and edit the message.
 * @param {import('discord.js').Client} client
 * @param {number|string} callId
 */
export async function refreshCall(client, callId) {
  const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
  if (!call || !call.message_id || !call.channel_id) return;

  const prefix = call.type.split(':')[0];
  const renderer = renderers.get(prefix);
  if (!renderer) {
    logger.warn(`refreshCall: no renderer for prefix "${prefix}" (call ${callId})`);
    return;
  }

  const pledges = prepare(
    'SELECT * FROM pledges WHERE call_id = ? ORDER BY created_at ASC'
  ).all(callId);

  let embed, components;
  try {
    embed = renderer.buildEmbed(call, pledges, client);
    components = renderer.buildComponents(call);
  } catch (err) {
    logger.warn(`refreshCall: renderer error for call ${callId}:`, err.message);
    return;
  }

  try {
    const channel = await client.channels.fetch(call.channel_id);
    const msg = await channel.messages.fetch(call.message_id);
    await msg.edit({ embeds: [embed], components });
  } catch (err) {
    logger.warn(`refreshCall: could not edit message for call ${callId}:`, err.message);
  }
}

/**
 * Refresh all open calls (e.g. on bot restart).
 * @param {import('discord.js').Client} client
 */
export async function refreshOpenCalls(client) {
  const rows = prepare("SELECT id FROM calls WHERE status = 'open'").all();
  for (const row of rows) {
    try {
      await refreshCall(client, row.id);
    } catch (err) {
      logger.warn(`refreshOpenCalls: failed for call ${row.id}:`, err.message);
    }
  }
}