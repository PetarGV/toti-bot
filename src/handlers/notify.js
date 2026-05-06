import { prepare, getConfig, setConfig } from '../db/client.js';
import { getProfile } from './profile.js';
import { formatCoords } from '../utils/coords.js';
import { formatAmount } from '../utils/resources.js';
import { logger } from '../utils/logger.js';

export async function notifyAuthorOfPledge(client, callId, pledgerId, amountText) {
  try {
    const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call) return;

    const authorId = call.author_id;
    if (authorId === pledgerId) return;

    const profile = getProfile(authorId);
    if (profile?.notify_pledges !== 1) return;

    const user = await client.users.fetch(authorId);
    await user.send(`📦 <@${pledgerId}> pledged ${amountText} to your call (id ${callId}, ${formatCoords(call.x, call.y)})`);
  } catch (err) {
    logger.warn(`notifyAuthorOfPledge call ${callId}:`, err.message);
  }
}

export async function notifyAuthorIfMilestone(client, callId) {
  try {
    const call = prepare('SELECT * FROM calls WHERE id = ?').get(callId);
    if (!call || call.status !== 'open') return;

    const profile = getProfile(call.author_id);
    if (profile?.notify_pledges !== 1) return;

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
        const user = await client.users.fetch(call.author_id);
        await user.send(`📊 Your push (id ${callId}, ${formatCoords(call.x, call.y)}) is 90% filled!`);
        setConfig(milestoneKey, '1');
      }
    } else if (['defense', 'offense', 'reinforce', 'urgent'].includes(prefix)) {
      const milestoneKey = `milestone_sent:${callId}:5`;
      if (getConfig(milestoneKey)) return;

      const count = prepare('SELECT COUNT(*) as c FROM pledges WHERE call_id = ?').get(callId);
      if (count.c >= 5) {
        const user = await client.users.fetch(call.author_id);
        await user.send(`📣 Your ${call.type} call (id ${callId}, ${formatCoords(call.x, call.y)}) now has ${count.c} responders.`);
        setConfig(milestoneKey, '1');
      }
    }
  } catch (err) {
    logger.warn(`notifyAuthorIfMilestone call ${callId}:`, err.message);
  }
}