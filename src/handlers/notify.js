import { prepare, getConfig, setConfig } from '../db/client.js';
import { getProfile } from './profile.js';
import { formatCoords } from '../utils/coords.js';
import { formatAmount } from '../utils/resources.js';
import { logger } from '../utils/logger.js';
import { getDualsForUser } from '../utils/ign.js';

// Recipients for an author-targeted DM: the author plus their duals.
// Skips the pledger (so duals don't get pinged about their own pledge)
// and anyone who has notify_pledges disabled.
function dmRecipients(authorId, excludeId = null) {
  const ids = [authorId, ...getDualsForUser(authorId).map(d => d.discord_id)];
  return ids
    .filter(id => id !== excludeId)
    .filter(id => getProfile(id)?.notify_pledges === 1);
}

export async function notifyAuthorOfPledge(client, callId, pledgerId, amountText) {
  try {
    const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call) return;

    const recipients = dmRecipients(call.author_id, pledgerId);
    if (!recipients.length) return;

    const message = `📦 <@${pledgerId}> pledged ${amountText} to your call (id ${callId}, ${formatCoords(call.x, call.y)})`;
    for (const id of recipients) {
      try {
        const user = await client.users.fetch(id);
        await user.send(message);
      } catch (err) {
        logger.warn(`DM pledge notify to ${id}:`, err.message);
      }
    }
  } catch (err) {
    logger.warn(`notifyAuthorOfPledge call ${callId}:`, err.message);
  }
}

async function sendToRecipients(client, recipients, message) {
  for (const id of recipients) {
    try {
      const user = await client.users.fetch(id);
      await user.send(message);
    } catch (err) {
      logger.warn(`DM milestone notify to ${id}:`, err.message);
    }
  }
}

export async function notifyAuthorIfMilestone(client, callId) {
  try {
    const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call || call.status !== 'open') return;

    const recipients = dmRecipients(call.author_id);
    if (!recipients.length) return;

    const prefix = call.type.split(':')[0];

    if (prefix === 'push') {
      const milestoneKey = `milestone_sent:${callId}:90`;
      if (getConfig(milestoneKey)) return;

      const payload = JSON.parse(call.payload || '{}');
      const target  = call.type === 'push:all' ? payload.amount * 4 : payload.amount;
      if (!target) return;

      const totalRow = prepare('SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) as total FROM pledges WHERE call_id = ?').get(callId);
      const ratio    = totalRow.total / target;

      if (ratio >= 0.9 && ratio < 1) {
        await sendToRecipients(client, recipients, `📊 Your push (id ${callId}, ${formatCoords(call.x, call.y)}) is 90% filled!`);
        setConfig(milestoneKey, '1');
      }
    } else if (['defense', 'offense', 'reinforce', 'urgent'].includes(prefix)) {
      const milestoneKey = `milestone_sent:${callId}:5`;
      if (getConfig(milestoneKey)) return;

      const count = prepare('SELECT COUNT(*) as c FROM pledges WHERE call_id = ?').get(callId);
      if (count.c >= 5) {
        await sendToRecipients(client, recipients, `📣 Your ${call.type} call (id ${callId}, ${formatCoords(call.x, call.y)}) now has ${count.c} responders.`);
        setConfig(milestoneKey, '1');
      }
    }
  } catch (err) {
    logger.warn(`notifyAuthorIfMilestone call ${callId}:`, err.message);
  }
}