import { EmbedBuilder } from 'discord.js';
import { COLORS, FOOTER } from '../utils/i18n.js';
import { logger } from '../utils/logger.js';
import { DeeplError, translate } from '../utils/translation/deepl.js';
import { cacheKeyFor, translationCache } from '../utils/translation/cache.js';
import { checkRateLimit } from '../utils/translation/rateLimit.js';
import {
  FALLBACK_LANG,
  discordLocaleToDeepl,
  flagForLang,
} from '../utils/translation/locales.js';

const MAX_CHARS = 5000;

export async function handleTranslate(interaction) {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    return interaction.reply({
      content: "Translation isn't configured on this server. Ask an admin to set it up.",
      ephemeral: true,
    });
  }

  const text = interaction.options.getString('text', true).trim();
  if (!text) {
    return interaction.reply({ content: 'Nothing to translate.', ephemeral: true });
  }
  if (text.length > MAX_CHARS) {
    return interaction.reply({
      content: 'Text too long (max 5000 chars). Try splitting it.',
      ephemeral: true,
    });
  }

  const rate = checkRateLimit(interaction.user.id);
  if (!rate.allowed) {
    return interaction.reply({
      content: `You've hit the translation limit (10/min). Try again in ${rate.retryAfterSec}s.`,
      ephemeral: true,
    });
  }

  const requested = interaction.options.getString('to', false);
  const localeTarget = requested ? null : discordLocaleToDeepl(interaction.locale);
  const targetLang = requested || localeTarget || FALLBACK_LANG;
  const fallbackNote = !requested && !localeTarget
    ? `Your locale \`${interaction.locale ?? 'unknown'}\` is not supported - showing English. Use \`/translate to:de\` to pick another.`
    : null;

  await interaction.deferReply({ ephemeral: true });

  const key = cacheKeyFor(targetLang, text);
  let result = translationCache.get(key);
  const fromCache = Boolean(result);

  if (!result) {
    try {
      result = await translate({ text, targetLang, apiKey });
      translationCache.set(key, result);
    } catch (err) {
      logger.warn('translate slash failed:', err);
      return interaction.editReply({ content: messageForError(err) });
    }
  }

  return interaction.editReply({
    ...(fallbackNote ? { content: fallbackNote } : {}),
    embeds: [buildSlashEmbed({
      sourceText: text,
      translatedText: result.translation,
      detectedSourceLang: result.detectedSourceLang,
      targetLang,
      fromCache,
    })],
  });
}

function buildSlashEmbed({ sourceText, translatedText, detectedSourceLang, targetLang, fromCache }) {
  const source = detectedSourceLang || '??';
  const sourceFlag = flagForLang(source);
  const targetFlag = flagForLang(targetLang);
  const footer = [
    `${sourceFlag ? `${sourceFlag} ` : ''}${source} -> ${targetFlag ? `${targetFlag} ` : ''}${targetLang}`,
    fromCache ? 'cached' : null,
    FOOTER,
  ].filter(Boolean).join(' | ');

  return new EmbedBuilder()
    .setTitle('🌐 Translation')
    .setColor(COLORS.brand.info)
    .setDescription(`${truncate(sourceText, 1800)}\n\n${truncate(translatedText, 1800)}`)
    .setFooter({ text: footer });
}

function messageForError(err) {
  if (err instanceof DeeplError) {
    if (err.kind === 'auth') {
      return 'Translation service rejected the request. Ask an admin to check the API key.';
    }
    if (err.kind === 'quota') {
      return 'Monthly translation quota reached. Resets on the 1st.';
    }
    if (err.kind === 'upstream' || err.kind === 'timeout' || err.kind === 'network') {
      return 'Translation service is down. Try again in a moment.';
    }
  }
  return 'Translation failed. Try again.';
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
