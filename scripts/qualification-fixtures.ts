import type { TargetingSettings } from "@/lib/db/models";

export function fallbackTargeting(): TargetingSettings {
  return {
    categories: [
      "Drone photographers / drone operators doing paid work",
      "Real estate photographers",
      "Real estate media companies",
      "Videographers doing commercial or real estate work",
      "Solo operators",
      "Small teams",
    ],
    minFollowers: 500,
    maxFollowers: 250000,
    englishOnly: true,
    preferUnitedStates: true,
    allowUnknownLocation: true,
    excludeAlreadyFollowing: true,
    excludeAlreadyContacted: true,
    excludeHobbyAccounts: true,
    excludeMemeAccounts: true,
    excludeLargeAgencies: true,
    excludeUnrelatedDrone: true,
    updatedAt: null,
  };
}
