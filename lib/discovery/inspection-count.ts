export function shouldFlushDiscoveryUsage(input: { profileOpens: number; aiQualifications: number }) {
  return input.profileOpens > 0 || input.aiQualifications > 0;
}

export function inspectedTodayAfterTurn(current: number, profileOpens: number) {
  const opens = Number.isFinite(profileOpens) && profileOpens > 0 ? Math.floor(profileOpens) : 0;
  if (!shouldFlushDiscoveryUsage({ profileOpens: opens, aiQualifications: 0 })) return current;
  return current + opens;
}
