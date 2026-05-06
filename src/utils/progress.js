export function progressBar(current, target, width = 10) {
  if (!target || target <= 0) {
    return `${'⬜'.repeat(width)} 0%`;
  }
  const ratio = Math.max(0, current / target);
  const capped = Math.min(1, ratio);
  const filled = Math.round(capped * width);
  const empty = width - filled;
  const pct = Math.min(100, Math.round(ratio * 100));
  return `${'🟩'.repeat(filled)}${'⬜'.repeat(empty)} ${pct}%`;
}