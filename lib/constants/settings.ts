export const DEFAULT_CATEGORIES = [
  "Drone photographers / drone operators doing paid work",
  "Real estate photographers",
  "Real estate media companies",
  "Videographers doing commercial or real estate work",
  "Solo operators",
  "Small teams",
] as const;

export const DATE_FORMATS = [
  "MMM d, yyyy",
  "MM/dd/yyyy",
  "dd/MM/yyyy",
  "yyyy-MM-dd",
] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "Pacific/Honolulu",
  "UTC",
] as const;

export type AppTimezone = (typeof TIMEZONES)[number];

export const BROWSERS = [
  { value: "chromium", label: "Chromium" },
  { value: "chrome", label: "Google Chrome" },
  { value: "msedge", label: "Microsoft Edge" },
] as const;

export type PreferredBrowser = (typeof BROWSERS)[number]["value"];

export const DEFAULT_APP_NAME = "ShootPortal Outreach";
export const DEFAULT_TIMEZONE: AppTimezone = "America/Chicago";
export const DEFAULT_DATE_FORMAT: DateFormat = "MMM d, yyyy";
export const DEFAULT_HEARTBEAT_SECONDS = 30;
export const MAX_ACTIVE_WORKERS = 1;

export function isDateFormat(value: string): value is DateFormat {
  return DATE_FORMATS.some((format) => format === value);
}

export function isPreferredBrowser(value: string): value is PreferredBrowser {
  return BROWSERS.some((browser) => browser.value === value);
}

export function isAppTimezone(value: string): value is AppTimezone {
  return TIMEZONES.some((timezone) => timezone === value);
}
