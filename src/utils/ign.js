export function normalizeIgn(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

export { getDualsForUser, getUsersByIgn } from '../handlers/userIgnLinks.js';
