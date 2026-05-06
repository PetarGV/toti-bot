import { getConfig } from '../db/client.js';

function base() {
  return getConfig('server_url') || process.env.TRAVIAN_SERVER_URL || 'https://ts2.x1.international.travian.com';
}

export function mapUrl(x, y) {
  return `${base()}/karte.php?x=${x}&y=${y}`;
}

export function rallyUrl(x, y) {
  // Opens rally point with coords pre-selected — gid=16 is the rally point
  return `${base()}/build.php?gid=16&tt=2&x=${x}&y=${y}`;
}

export function marketUrl(x, y) {
  return `${base()}/build.php?gid=17&x=${x}&y=${y}`;
}
