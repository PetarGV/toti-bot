import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { logger } from '../utils/logger.js';
import { DeeplError, translate } from '../utils/translation/deepl.js';
import { cacheKeyFor, translationCache } from '../utils/translation/cache.js';
import { checkRateLimit } from '../utils/translation/rateLimit.js';
import { flagToDeepl } from '../utils/translation/locales.js';

const MAX_CHARS = 5000;
const THREAD_NAME = '🌐 Translations';
const THREAD_ARCHIVE_MIN = 60;
const DEDUP_CAPACITY = 1000;
const THREAD_SCAN_LIMIT = 100;

const dedup = new Set();
const dedupOrder = [];

export function _resetDedup() {
  dedup.clear();
  dedupOrder.length = 0;
}

export async function handleTranslateReaction(reaction, user) {
  if (user?.bot) return;

  const emoji = reaction?.emoji?.name;
  const targetLang = flagToDeepl(emoji);
  if (!targetLang) return;

  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message?.partial) await reaction.message.fetch();
  } catch (err) {
    logger.warn('translate reaction partial fetch failed:', err);
    return;
  }

  const message = reaction.message;
  const text = (message?.content ?? '').trim();
  if (!text) return;
  if (text.length > MAX_CHARS) return;

  const dedupKey = `${message.id}:${targetLang}`;
  if (dedup.has(dedupKey)) return;

  const existingThread = findExistingThread(message);
  if (existingThread) {
    try {
      if (await threadHasTranslation(existingThread, targetLang)) {
        addDedup(dedupKey);
        return;
      }
    } catch (err) {
      logger.warn('translate reaction thread scan failed:', err);
    }
  }

  if (!hasRequiredPermissions(message)) return;

  const rate = checkRateLimit(user.id);
  if (!rate.allowed) {
    logger.debug('translate reaction rate limited:', user.id);
    return;
  }

  const key = cacheKeyFor(targetLang, text);
  let result = translationCache.get(key);
  const fromCache = Boolean(result);

  if (!result) {
    try {
      result = await translate({ text, targetLang, apiKey });
      translationCache.set(key, result);
    } catch (err) {
      if (err instanceof DeeplError) {
        logger.warn('translate reaction DeepL failure:', err.kind, err.message);
      } else {
        logger.error('translate reaction failed:', err);
      }
      return;
    }
  }

  let thread;
  try {
    thread = existingThread ?? await message.startThread({
      name: THREAD_NAME,
      autoArchiveDuration: THREAD_ARCHIVE_MIN,
    });
  } catch (err) {
    logger.warn('translate reaction thread creation failed:', err);
    return;
  }

  try {
    await thread.send({
      embeds: [buildReactionEmbed({
        emoji,
        targetLang,
        detectedSourceLang: result.detectedSourceLang,
        translatedText: result.translation,
        user,
        fromCache,
      })],
    });
    addDedup(dedupKey);
  } catch (err) {
    logger.warn('translate reaction send failed:', err);
  }
}

function findExistingThread(message) {
  if (message?.channel?.isThread?.()) return message.channel;
  return message?.thread ?? null;
}

function hasRequiredPermissions(message) {
  const channel = message?.channel;
  if (!channel || typeof channel.permissionsFor !== 'function') return true;

  const perms = channel.permissionsFor(channel.guild?.members?.me ?? null);
  if (!perms) return true;

  if (!channel.isThread?.() && !message.thread && !perms.has(PermissionFlagsBits.CreatePublicThreads)) {
    logger.warn('translate reaction missing CreatePublicThreads in channel:', channel.id);
    return false;
  }

  if (!perms.has(PermissionFlagsBits.SendMessagesInThreads)) {
    logger.warn('translate reaction missing SendMessagesInThreads in channel:', channel.id);
    return false;
  }

  return true;
}

async function threadHasTranslation(thread, targetLang) {
  if (!thread?.messages?.fetch) return false;
  const fetched = await thread.messages.fetch({ limit: THREAD_SCAN_LIMIT });
  for (const message of fetched.values()) {
    const title = message.embeds?.[0]?.data?.title ?? message.embeds?.[0]?.title;
    if (message.author?.bot && typeof title === 'string' && title.includes(targetLang)) {
      return true;
    }
  }
  return false;
}

function addDedup(key) {
  if (dedup.has(key)) return;
  dedup.add(key);
  dedupOrder.push(key);
  while (dedupOrder.length > DEDUP_CAPACITY) {
    const oldest = dedupOrder.shift();
    dedup.delete(oldest);
  }
}

function buildReactionEmbed({ emoji, targetLang, detectedSourceLang, translatedText, user, fromCache }) {
  const footer = [
    `Triggered by <@${user.id}>`,
    fromCache ? 'cached' : null,
    FOOTER,
  ].filter(Boolean).join(' | ');

  return new EmbedBuilder()
    .setTitle(`${emoji} ${targetLang} (from ${detectedSourceLang || '??'})`)
    .setColor(COLORS.brand.info)
    .setDescription(truncate(translatedText, 4000))
    .setFooter({ text: footer });
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
