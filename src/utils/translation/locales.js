export const SUPPORTED_LANGS = [
  'EN-GB',
  'EN-US',
  'DE',
  'FR',
  'ES',
  'RU',
  'BG',
  'PL',
  'IT',
  'NL',
  'PT-PT',
  'PT-BR',
];

export const FALLBACK_LANG = 'EN-GB';

const DISCORD_TO_DEEPL = {
  'en-US': 'EN-US',
  'en-GB': 'EN-GB',
  de: 'DE',
  fr: 'FR',
  'es-ES': 'ES',
  ru: 'RU',
  bg: 'BG',
  pl: 'PL',
  it: 'IT',
  nl: 'NL',
  'pt-PT': 'PT-PT',
  'pt-BR': 'PT-BR',
};

const FLAG_TO_DEEPL = {
  '🇬🇧': 'EN-GB',
  '🇺🇸': 'EN-US',
  '🇩🇪': 'DE',
  '🇫🇷': 'FR',
  '🇪🇸': 'ES',
  '🇷🇺': 'RU',
  '🇧🇬': 'BG',
  '🇵🇱': 'PL',
  '🇮🇹': 'IT',
  '🇳🇱': 'NL',
  '🇵🇹': 'PT-PT',
  '🇧🇷': 'PT-BR',
};

const DEEPL_TO_FLAG = Object.fromEntries(
  Object.entries(FLAG_TO_DEEPL).map(([flag, code]) => [code, flag]),
);

const LABELS = {
  'EN-GB': 'English (UK)',
  'EN-US': 'English (US)',
  DE: 'German',
  FR: 'French',
  ES: 'Spanish',
  RU: 'Russian',
  BG: 'Bulgarian',
  PL: 'Polish',
  IT: 'Italian',
  NL: 'Dutch',
  'PT-PT': 'Portuguese (PT)',
  'PT-BR': 'Portuguese (BR)',
};

export function discordLocaleToDeepl(locale) {
  if (!locale) return null;
  return DISCORD_TO_DEEPL[locale] ?? null;
}

export function flagToDeepl(emoji) {
  if (!emoji) return null;
  return FLAG_TO_DEEPL[emoji] ?? null;
}

export function flagForLang(code) {
  if (!code) return '';
  return DEEPL_TO_FLAG[code] ?? '';
}

export function langChoices() {
  return SUPPORTED_LANGS.map((code) => ({
    name: `${LABELS[code]} (${code})`,
    value: code,
  }));
}
