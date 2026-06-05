export const PLATFORM_OPTIONS = [
  "Google",
  "Facebook",
  "Instagram",
  "TikTok",
  "X / Twitter",
  "Discord",
  "Steam",
  "Riot / Valorant",
  "Epic Games",
  "CF",
  "GitHub",
  "Globe One",
  "Lazada",
  "LinkedIn",
  "Shopee",
  "Telegram",
  "Upwork",
  "Viber",
  "WhatsApp",
  "YouTube",
  "Zoom",
  "PayPal",
  "Coins.ph",
  "GCash",
  "Maya Bank",
  "BDO",
  "GoTyme",
  "Atome",
  "Binance",
  "BPI",
  "Home Credit",
  "MetroBank",
  "PNB",
  "RCBC",
  "SeaBank",
  "Security Bank",
  "UnionBank",
  "BIR",
  "eGOVph",
  "NBI",
  "PAG-IBIG",
  "PhilSys",
  "PNP",
  "Custom"
];

export const PLATFORM_CATEGORY_LABELS = {
  social: "Social",
  bank: "Bank",
  government: "Government"
};

export const PLATFORM_CATEGORY_OPTIONS = {
  social: ["CF", "Discord", "Facebook", "GitHub", "Globe One", "Google", "Instagram", "Lazada", "LinkedIn", "Shopee", "Steam", "Telegram", "TikTok", "X / Twitter", "Upwork", "Valorant", "Viber", "WhatsApp", "YouTube", "Zoom"],
  bank: ["Atome", "BDO", "Binance", "BPI", "Coins.ph", "GCash", "GoTyme", "Home Credit", "Maya Bank", "MetroBank", "PayPal", "PNB", "RCBC", "SeaBank", "Security Bank", "UnionBank"],
  government: ["BIR", "eGOVph", "NBI", "PAG-IBIG", "PhilSys", "PNP"]
};

export const PLATFORM_CATEGORY_ORDER = ["social", "bank", "government"];

export function normalizePlatformCategory(value = "social") {
  const normalized = normalizeText(value);
  if (normalized.includes("bank")) return "bank";
  if (normalized.includes("government")) return "government";
  return "social";
}

export function getPlatformOptionsForCategory(category = "social", customPlatforms = []) {
  const key = normalizePlatformCategory(category);
  const base = PLATFORM_CATEGORY_OPTIONS[key] ?? [];
  const custom = Array.isArray(customPlatforms) ? customPlatforms : [];
  const merged = [...base, ...custom.filter(Boolean)];
  return [...new Set(merged)];
}

export const STATUS_OPTIONS = ["active", "paused", "locked", "archived", "pending", "closed"];

export const RELATIONSHIP_TYPES = [
  "anchor",
  "login email",
  "recovery email",
  "linked social login",
  "linked government id",
  "financial owner",
  "child account",
  "parent account",
  "backup account",
  "custom"
];

export const FIELD_VISIBILITY = ["private", "masked", "public"];

export function uid(prefix = "id") {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeText(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

export function compact(value = "") {
  return normalizeText(value).replace(/[^a-z0-9@._/-]+/g, "");
}

export function formatDateTime(value) {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatRelative(value) {
  if (!value) return "Never";
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const units = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60]
  ];
  const match = units.find(([, size]) => abs >= size) ?? ["minute", 60_000];
  const amount = Math.max(1, Math.round(abs / match[1]));
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return formatter.format(-amount, match[0]);
}

export function highlightMatch(text, query) {
  const source = escapeHtml(text ?? "");
  const needle = normalizeText(query);
  if (!needle) return source;
  const haystack = normalizeText(text ?? "");
  const index = haystack.indexOf(needle);
  if (index === -1) return source;
  const before = source.slice(0, index);
  const match = source.slice(index, index + needle.length);
  const after = source.slice(index + needle.length);
  return `${before}<mark>${match}</mark>${after}`;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
