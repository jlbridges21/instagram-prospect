import type { DateFormat } from "@/lib/constants/settings";

export function startOfTodayIso(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  const offset = asUtc - now.getTime();
  const midnightUtc = Date.UTC(value("year"), value("month") - 1, value("day"));
  return new Date(midnightUtc - offset).toISOString();
}

export function formatDate(
  iso: string | null | undefined,
  timeZone: string,
  dateFormat: DateFormat,
  emptyLabel = "Not set",
) {
  if (!iso) return emptyLabel;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return emptyLabel;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const month = get("month");
  const day = get("day");
  const year = get("year");

  if (dateFormat === "MM/dd/yyyy") return `${month}/${day}/${year}`;
  if (dateFormat === "dd/MM/yyyy") return `${day}/${month}/${year}`;
  if (dateFormat === "yyyy-MM-dd") return `${year}-${month}-${day}`;

  const monthName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
  }).format(date);
  return `${monthName} ${Number(day)}, ${year}`;
}

export function formatDateTime(
  iso: string | null | undefined,
  timeZone: string,
  dateFormat: DateFormat,
  emptyLabel = "Not set",
) {
  if (!iso) return emptyLabel;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return emptyLabel;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${formatDate(iso, timeZone, dateFormat, emptyLabel)} · ${time}`;
}

export function formatRelativeTime(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "Never";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Never";
  const diffSeconds = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return formatter.format(diffSeconds, "second");
  if (abs < 3600) return formatter.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return formatter.format(Math.round(diffSeconds / 3600), "hour");
  if (abs < 86400 * 45) return formatter.format(Math.round(diffSeconds / 86400), "day");
  return formatter.format(Math.round(diffSeconds / (86400 * 30)), "month");
}

export function formatFollowers(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unknown";
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatFollowerCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unknown";
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const scaled = value / 1000;
    const digits = scaled >= 100 ? 0 : 1;
    return `${scaled.toFixed(digits).replace(/\.0$/, "")}K`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "").toLowerCase();
}

export function profileUrlForUsername(username: string, profileUrl?: string | null) {
  const trimmed = profileUrl?.trim();
  if (trimmed) return trimmed;
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

export function formatPercent(value: number | null) {
  if (value === null) return "--";
  return `${Math.round(value * 100)}%`;
}

export function endOfTodayIso(timeZone: string, now = new Date()) {
  const start = new Date(startOfTodayIso(timeZone, now)).getTime();
  return new Date(start + 24 * 60 * 60 * 1000 - 1).toISOString();
}

export function daysAgoIso(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function rate(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function initials(name: string) {
  const parts = name
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "SP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function platformLabel(platform: string | null | undefined) {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  if (!platform) return "Not reported";
  return platform;
}

export function instagramProfileUrl(username: string) {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function sanitizeSearch(value: string) {
  return value.replace(/[%_,.()"'\\]/g, " ").replace(/\s+/g, " ").trim();
}

export function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}
