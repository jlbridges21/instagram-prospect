export function formatCountdown(targetAt: string | number | null | undefined, now: number) {
  if (targetAt == null || targetAt === "") return "Eligible now";
  const target = typeof targetAt === "number" ? targetAt : new Date(targetAt).getTime();
  if (!Number.isFinite(target)) return "Eligible now";
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  if (seconds <= 0) return "Eligible now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remain).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
