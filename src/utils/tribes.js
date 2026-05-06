const TRIBES = {
  1: { name: 'Romans',    emoji: '🛡️' },
  2: { name: 'Teutons',   emoji: '⚔️' },
  3: { name: 'Gauls',     emoji: '🏹' },
  4: { name: 'Nature',    emoji: '🌳' },
  5: { name: 'Natars',    emoji: '🐍' },
  6: { name: 'Egyptians', emoji: '🐫' },
  7: { name: 'Huns',      emoji: '🐎' },
  8: { name: 'Spartans',  emoji: '🦅' },
};

export function getTribe(tid) {
  return TRIBES[tid] ?? { name: 'Unknown', emoji: '❓' };
}