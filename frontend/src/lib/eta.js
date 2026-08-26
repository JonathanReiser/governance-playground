/**
 * A real, data-driven ETA for a sequence of real transactions/confirmations
 * — not a static guess. Averages actual elapsed time over steps ALREADY
 * completed and projects that average across whatever's left. Sepolia
 * confirmation time (and Claude decision time, for the cycle phase) is
 * genuinely variable — this app never fakes or shortens it, see
 * demoDeploy.js's own comments — so an estimate built from THIS run's own
 * timing is more honest than a fixed number that's usually wrong in one
 * direction or the other. It necessarily starts rough (one data point)
 * and gets more accurate as the run progresses.
 */
export function estimateRemainingMs(completedCount, totalCount, elapsedMs) {
  if (!completedCount || !totalCount || completedCount >= totalCount) return null;
  const avgMsPerItem = elapsedMs / completedCount;
  return avgMsPerItem * (totalCount - completedCount);
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
