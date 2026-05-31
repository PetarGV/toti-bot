export const SCOUT_CATEGORY_NAME = 'Scouting';
export const SCOUT_REPORTS_CHANNEL_NAME = 'scout-reports';
export const REPORT_UPLOAD_WINDOW_SEC = 10 * 60;
export const TEMP_CHANNEL_DELETE_DELAY_SEC = 24 * 60 * 60;

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SCOUT_COMMITMENT_KIND = 'scout_commitment';
const SCOUT_REPORT_KIND = 'scout_report';

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

export function encodeScoutCommitmentAmount(amount) {
  return JSON.stringify({ kind: SCOUT_COMMITMENT_KIND, amount });
}

export function encodeScoutReportText(text) {
  return JSON.stringify({ kind: SCOUT_REPORT_KIND, text });
}

export function decodeScoutPledge(amount) {
  const raw = String(amount || '');
  if (raw === 'On it') return { kind: SCOUT_COMMITMENT_KIND, amount: null };

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind === SCOUT_COMMITMENT_KIND && typeof parsed.amount === 'string') {
      return { kind: SCOUT_COMMITMENT_KIND, amount: parsed.amount.trim() || null };
    }
    if (parsed?.kind === SCOUT_REPORT_KIND && typeof parsed.text === 'string') {
      return { kind: SCOUT_REPORT_KIND, text: parsed.text };
    }
  } catch {
    // Legacy/raw non-JSON rows are scout reports, except exact "On it" above.
  }

  return { kind: SCOUT_REPORT_KIND, text: raw };
}

export function decodeScoutCommitmentAmount(amount) {
  const pledge = decodeScoutPledge(amount);
  return pledge.kind === SCOUT_COMMITMENT_KIND ? pledge.amount : null;
}

export function decodeScoutReportText(amount) {
  const pledge = decodeScoutPledge(amount);
  return pledge.kind === SCOUT_REPORT_KIND ? pledge.text : null;
}

export function isScoutCommitment(amount) {
  return decodeScoutPledge(amount).kind === SCOUT_COMMITMENT_KIND;
}

export function isScoutReport(amount) {
  return decodeScoutPledge(amount).kind === SCOUT_REPORT_KIND;
}

export function isValidScoutImageAttachment(attachment) {
  const contentType = String(attachment?.contentType || '').toLowerCase();
  if (IMAGE_MIME_TYPES.has(contentType)) return true;
  if (contentType.startsWith('image/')) return false;
  const name = String(attachment?.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return IMAGE_EXTENSIONS.has(ext);
}
