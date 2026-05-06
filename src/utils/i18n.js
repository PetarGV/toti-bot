// Centralised user-facing strings for the bot.
// Locale defaults to 'en'. To add another language, copy the LOCALES.en block
// and set LOCALE in .env to the new key (e.g. 'de').

const LOCALES = {
  en: {
    resources: {
      lumber: 'Lumber',
      clay:   'Clay',
      iron:   'Iron',
      crop:   'Crop',
      all:    'All Resources',
    },
    tribes: {
      1: 'Romans', 2: 'Teutons', 3: 'Gauls', 4: 'Nature',
      5: 'Natars', 6: 'Egyptians', 7: 'Huns', 8: 'Spartans',
    },
    callTypes: {
      defense:   'Defense Call',
      offense:   'Offense Call',
      reinforce: 'Reinforce',
      urgent:    'URGENT',
      scout:     'Scout Request',
    },
    statusBadges: {
      open:    '',
      filled:  '✅ Filled',
      expired: '⏰ Expired',
      closed:  '🔒 Closed',
    },
    errors: {
      invalidCoords:   '❌ Invalid coordinates. Use format like (x|y), x|y, or x/y.',
      invalidAmount:   '❌ Invalid amount. Try `50k` or `50000`.',
      invalidDeadline: '❌ Invalid deadline. Try `14:30` or `in 2h`.',
      callClosed:      'This call is no longer open.',
      callNotFound:    'Call not found.',
      authorOnly:      'Only the requester can do this.',
      generic:         '❌ Something went wrong. Please try again.',
    },
  },
};

const LOCALE = process.env.LOCALE || 'en';
const L = LOCALES[LOCALE] || LOCALES.en;

export function t(path, fallback = '') {
  const parts = path.split('.');
  let cur = L;
  for (const p of parts) {
    cur = cur?.[p];
    if (cur == null) return fallback;
  }
  return cur;
}

export function resourceLabel(id) { return L.resources[id] ?? id; }
export function tribeLabel(tid)   { return L.tribes[tid] ?? 'Unknown'; }
export function callTypeLabel(t)  { return L.callTypes[t] ?? t; }
export function statusBadge(s)    { return L.statusBadges[s] ?? ''; }
export function err(key)          { return L.errors[key] ?? L.errors.generic; }

export const COLORS = {
  resource: { lumber: 0x8b4513, clay: 0xd2691e, iron: 0x808080, crop: 0xffd700, all: 0x9b59b6 },
  call:     { defense: 0xe74c3c, offense: 0x992d22, reinforce: 0xe67e22, urgent: 0xff0000, scout: 0x3498db },
  status:   { open: null, filled: 0x2ecc71, expired: 0x95a5a6, closed: 0x95a5a6 },
  brand:    { primary: 0x9b59b6, info: 0x3498db, warning: 0xf39c12, danger: 0xe74c3c, success: 0x2ecc71 },
};

export const FOOTER = process.env.BOT_FOOTER || 'Travian Alliance Bot';