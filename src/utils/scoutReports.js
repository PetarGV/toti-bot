export const SCOUT_CATEGORY_NAME = 'Scouting';
export const SCOUT_REPORTS_CHANNEL_NAME = 'scout-reports';
export const REPORT_UPLOAD_WINDOW_SEC = 10 * 60;
export const TEMP_CHANNEL_DELETE_DELAY_SEC = 24 * 60 * 60;

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

export function generateScoutCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    const idx = Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length;
    code += CODE_ALPHABET[idx];
  }
  return code;
}

export function slugifyScoutPlayer(player) {
  const raw = String(player || 'unknown').trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42)
    .replace(/-+$/g, '');
  return slug || 'unknown';
}

export function buildScoutChannelName({ code, x, y, player }) {
  const base = `scout-${code}-x${x}-y${y}-${slugifyScoutPlayer(player)}`;
  return base.slice(0, 90).replace(/-+$/g, '');
}

export function parseScoutCommitmentAmount(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const match = raw.replace(/,/g, '').match(/^(\d+)/);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function isValidScoutImageAttachment(attachment) {
  const contentType = String(attachment?.contentType || '').toLowerCase();
  if (IMAGE_MIME_TYPES.has(contentType)) return true;
  const name = String(attachment?.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return IMAGE_EXTENSIONS.has(ext);
}
