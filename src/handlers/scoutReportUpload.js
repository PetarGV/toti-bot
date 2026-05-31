import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { getConfig, prepare } from '../db/client.js';
import { mapUrl } from '../utils/travianUrl.js';
import { formatCoords } from '../utils/coords.js';
import { unixNow, discordTimestamp } from '../utils/time.js';
import {
  REPORT_UPLOAD_WINDOW_SEC,
  TEMP_CHANNEL_DELETE_DELAY_SEC,
  isValidScoutImageAttachment,
} from '../utils/scoutReports.js';

const pendingUploads = new Map();
const inFlightReportArchives = new Set();

function pendingKey(channelId, userId) {
  return `${channelId}:${userId}`;
}

function attachmentList(message) {
  return Array.from(message?.attachments?.values?.() ?? []);
}

function archiveAttachmentUrl(message, fallback) {
  const first = Array.from(message?.attachments?.values?.() ?? [])[0];
  return first?.url || fallback;
}

function safeFileName(name, callId) {
  const clean = String(name || '').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '_');
  return clean || `scout-report-${callId}.png`;
}

function parsePayload(call) {
  try {
    return JSON.parse(call?.payload || '{}');
  } catch {
    return {};
  }
}

function restorePendingUpload(key, pending) {
  if (!pendingUploads.has(key)) {
    pendingUploads.set(key, pending);
  }
}

function buildArchiveEmbed({ call, report, reporterId, note, fileName, submittedAt }) {
  const payload = parsePayload(call);
  const target = payload.targetPlayer
    ? `${payload.targetPlayer}${payload.targetAlliance ? ` [${payload.targetAlliance}]` : ''}`
    : null;

  const embed = new EmbedBuilder()
    .setTitle('Scout Report')
    .setColor(0x2ecc71)
    .addFields(
      { name: 'Code', value: `\`${report.scout_code}\``, inline: true },
      { name: 'Coords', value: `[${formatCoords(call.x, call.y)}](${mapUrl(call.x, call.y)})`, inline: true },
      { name: 'Requester', value: `<@${call.author_id}>`, inline: true },
      { name: 'Reporter', value: `<@${reporterId}>`, inline: true },
      { name: 'Submitted', value: discordTimestamp(submittedAt, 'F'), inline: true },
      { name: 'Call ID', value: String(call.id), inline: true },
      { name: 'Scout channel', value: `<#${call.channel_id}>`, inline: true },
    )
    .setImage(`attachment://${fileName}`)
    .setTimestamp(new Date(submittedAt * 1000));

  if (target) embed.addFields({ name: 'Target', value: target, inline: false });
  if (note) embed.addFields({ name: 'Note', value: note, inline: false });

  return embed;
}

export function clearPendingScoutReportUploads() {
  pendingUploads.clear();
  inFlightReportArchives.clear();
}

export function startPendingScoutReportUpload({ callId, userId, channelId, note, now = unixNow() }) {
  const pending = {
    callId,
    userId,
    channelId,
    note: String(note || '').trim() || null,
    expiresAt: now + REPORT_UPLOAD_WINDOW_SEC,
  };
  pendingUploads.set(pendingKey(channelId, userId), pending);
  return pending;
}

export async function handleScoutReportMessage(message, now = unixNow()) {
  if (message?.author?.bot) return false;

  const userId = message?.author?.id;
  const channelId = message?.channelId;
  const key = pendingKey(channelId, userId);
  const pending = pendingUploads.get(key);
  if (!pending) return false;
  if (now > pending.expiresAt) {
    pendingUploads.delete(key);
    return false;
  }

  const call = prepare('SELECT * FROM calls WHERE id = ?').get(pending.callId);
  const report = prepare('SELECT * FROM scout_reports WHERE call_id = ?').get(pending.callId);
  if (!call || !report) {
    pendingUploads.delete(key);
    await message.reply({ content: 'This scout request could not be found anymore.' });
    return true;
  }
  if (call.status !== 'open') {
    pendingUploads.delete(key);
    await message.reply({ content: 'This scout request is no longer open.' });
    return true;
  }
  if (report.reported_at || report.archive_message_id) {
    pendingUploads.delete(key);
    await message.reply({ content: 'This scout report has already been archived.' });
    return true;
  }

  const attachments = attachmentList(message);
  const validAttachments = attachments.filter(isValidScoutImageAttachment);
  if (attachments.length !== 1 || validAttachments.length !== 1) {
    await message.reply({ content: 'Please upload exactly one PNG, JPG, or WEBP scout screenshot.' });
    return true;
  }

  const archiveChannelId = getConfig('scout_reports_channel_id');
  if (!archiveChannelId) {
    await message.reply({ content: 'Scout report archive channel is not configured yet.' });
    return true;
  }

  const archiveKey = String(pending.callId);
  if (inFlightReportArchives.has(archiveKey)) {
    await message.reply({ content: 'This scout report is already being archived. Please wait a moment.' });
    return true;
  }
  inFlightReportArchives.add(archiveKey);
  pendingUploads.delete(key);

  try {
    let archiveChannel;
    try {
      archiveChannel = await message.client.channels.fetch(archiveChannelId);
    } catch (err) {
      restorePendingUpload(key, pending);
      throw err;
    }
    if (!archiveChannel) {
      restorePendingUpload(key, pending);
      await message.reply({ content: 'Scout report archive channel could not be found.' });
      return true;
    }

    const source = validAttachments[0];
    const fileName = safeFileName(source.name, pending.callId);
    const embed = buildArchiveEmbed({
      call,
      report,
      reporterId: userId,
      note: pending.note,
      fileName,
      submittedAt: now,
    });
    let archiveMessage;
    try {
      archiveMessage = await archiveChannel.send({
        embeds: [embed],
        files: [new AttachmentBuilder(source.url, { name: fileName })],
      });
    } catch (err) {
      restorePendingUpload(key, pending);
      throw err;
    }
    const screenshotUrl = archiveAttachmentUrl(archiveMessage, source.url);
    const deleteAfter = now + TEMP_CHANNEL_DELETE_DELAY_SEC;

    const update = prepare(`
      UPDATE scout_reports
      SET archive_channel_id = ?,
          archive_message_id = ?,
          reporter_id = ?,
          report_note = ?,
          screenshot_url = ?,
          reported_at = ?,
          delete_after = ?
      WHERE call_id = ?
        AND reported_at IS NULL
        AND archive_message_id IS NULL
        AND EXISTS (
          SELECT 1 FROM calls
          WHERE id = ?
            AND status = 'open'
        )
    `).run(
      archiveChannelId,
      archiveMessage.id,
      userId,
      pending.note,
      screenshotUrl,
      now,
      deleteAfter,
      pending.callId,
      pending.callId,
    );
    if (update.changes === 0) {
      try {
        await archiveMessage.delete?.();
      } catch {
        // Best-effort cleanup; the database state is the source of truth.
      }
      const latestCall = prepare('SELECT status FROM calls WHERE id = ?').get(pending.callId);
      const content = latestCall?.status === 'open'
        ? 'This scout report has already been archived.'
        : 'This scout request is no longer open.';
      await message.reply({ content });
      return true;
    }
    prepare("UPDATE calls SET status = 'closed' WHERE id = ?").run(pending.callId);

    const { refreshCall } = await import('./calls.js');
    await refreshCall(message.client, pending.callId);
    await message.reply({ content: 'Scout report archived. This channel will be deleted in 24h.' });
    return true;
  } finally {
    inFlightReportArchives.delete(archiveKey);
  }
}
