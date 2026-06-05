import { config, getAppOrigin } from "./config.js";
import {
  FIELD_VISIBILITY,
  getPlatformOptionsForCategory,
  normalizePlatformCategory,
  PLATFORM_CATEGORY_LABELS,
  PLATFORM_CATEGORY_ORDER,
  RELATIONSHIP_TYPES,
  STATUS_OPTIONS,
  escapeHtml,
  formatDateTime,
  formatRelative,
  highlightMatch,
  normalizeText,
  nowIso,
  uid
} from "./domain.js";
import { createStore } from "./store.js";
import { createAuthBridge } from "./auth.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

const app = document.querySelector("#app");
const store = createStore();

const state = {
  loading: true,
  authReady: false,
  auth: null,
  session: null,
  ownerId: null,
  search: "",
  filters: {
    platform: "all",
    status: "all",
    archived: "active",
    favorite: "all",
    linkedTo: "all",
    tag: "",
    sort: "updated_desc"
  },
  selectedAccountId: null,
  modal: null,
  toast: null,
  duplicateWarnings: [],
  secretCache: {},
  revealedSecrets: {},
  platformSelections: {
    social: "Google",
    bank: "PayPal",
    government: "BIR"
  },
  passphrase: sessionStorage.getItem("socialx:vault-passphrase") ?? ""
};

function getInitials(text = "") {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function getProfileImageUrl(user) {
  return user?.image ?? user?.avatarUrl ?? currentOwnerState()?.profile?.avatarUrl ?? "";
}

function getDefaultPlatformSelection(category = "social") {
  const normalized = normalizePlatformCategory(category);
  if (normalized === "bank") return "PayPal";
  if (normalized === "government") return "BIR";
  return "Google";
}

function getPlatformFallback(owner, category, linkedGoogleMode = false) {
  const options = buildPlatformOptions(owner, category, { linkedGoogleMode });
  return (
    options.find((option) => normalizeText(option) !== normalizeText("Google") && normalizeText(option) !== normalizeText("Custom")) ??
    options[0] ??
    getDefaultPlatformSelection(category)
  );
}

function renderPlatformTile(platform, selected, hidden = false) {
  const active = selected ? "is-active" : "";
  const hiddenClass = hidden ? "is-hidden" : "";
  const tone = escapeHtml(platformTone(platform));
  return `
    <button
      type="button"
      class="platform-option ${active} ${hiddenClass} platform-${tone}"
      data-action="platform-option"
      data-platform-value="${escapeHtml(platform)}"
      data-platform-option="${escapeHtml(platform)}"
      ${hidden ? 'aria-hidden="true" tabindex="-1"' : ""}
    >
      ${renderPlatformIcon(platform)}
      <span>${escapeHtml(platform)}</span>
    </button>
  `;
}

function renderLinkModeToggle(mode = "separate") {
  const linkedActive = mode === "linkedGoogle";
  const separateActive = !linkedActive;
  return `
    <input type="hidden" name="linkMode" value="${escapeHtml(linkedActive ? "linkedGoogle" : "separate")}" data-link-mode-value />
    <div class="category-toggle link-mode-toggle" data-link-mode-toggle>
      <button type="button" class="category-pill ${linkedActive ? "is-active" : ""}" data-action="set-link-mode" data-link-mode-button data-value="linkedGoogle">
        &#x1F7E2; Linked to existing Google
      </button>
      <button type="button" class="category-pill ${separateActive ? "is-active" : ""}" data-action="set-link-mode" data-link-mode-button data-value="separate">
        &#x1F7E1; Separate account
      </button>
    </div>
  `;
}

function renderStatusBadge(status = "active") {
  const normalized = normalizeText(status);
  const tone = normalized === "active"
    ? "good"
    : normalized === "paused"
      ? "warn"
      : normalized === "locked"
        ? "danger"
        : normalized === "archived"
          ? "dark"
          : normalized === "pending" || normalized === "closed"
            ? "pending"
            : "";
  const icon =
    normalized === "active"
      ? "ðŸŸ¢"
      : normalized === "paused"
        ? "ðŸŸ¡"
        : normalized === "locked"
          ? "ðŸ”´"
          : normalized === "archived"
            ? "âš«"
            : "ðŸŸ ";
  const label =
    normalized === "active"
      ? "Active"
      : normalized === "paused"
        ? "Pause"
        : normalized === "locked"
          ? "Locked"
          : normalized === "archived"
            ? "Archive"
            : "Pending Close";
  return `<span class="badge ${tone} badge-status">${icon} ${escapeHtml(label)}</span>`;
}

function renderStatusDot(status = "active") {
  const normalized = normalizeText(status);
  const tone =
    normalized === "active"
      ? "good"
      : normalized === "paused"
        ? "warn"
        : normalized === "locked"
          ? "danger"
          : normalized === "archived"
            ? "dark"
            : "pending";
  const label =
    normalized === "active"
      ? "Active"
      : normalized === "paused"
        ? "Pause"
        : normalized === "locked"
          ? "Locked"
          : normalized === "archived"
            ? "Archive"
            : "Pending Close";
  return `<span class="status-dot status-${tone}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`;
}

function renderFilterStatusDot(status = "") {
  const normalized = normalizeText(status);
  if (!normalized || normalized === "all") {
    return `<span class="filter-dot filter-dot-neutral" aria-hidden="true"></span>`;
  }
  const tone =
    normalized === "active"
      ? "good"
      : normalized === "paused"
        ? "warn"
        : normalized === "locked"
          ? "danger"
          : normalized === "archived"
            ? "dark"
            : "pending";
  return `<span class="filter-dot filter-${tone}" aria-hidden="true"></span>`;
}

function renderFilterMenuItemIcon(platform = "") {
  return `<span class="filter-option-icon">${renderPlatformIcon(platform)}</span>`;
}

function cleanAnchorLabel(entry = {}) {
  const raw = (entry.mainEmail || entry.label || entry.platform || "Google").toString().trim();
  if (!raw) return "Google";
  const dashIndex = raw.indexOf(" - ");
  if (dashIndex > 0) {
    return raw.slice(0, dashIndex).trim();
  }
  return raw;
}

function renderPlatformGrid(owner, category, selectedPlatform, linkMode) {
  const options = buildPlatformOptions(owner, category, { linkedGoogleMode: linkMode === "linkedGoogle" });
  const fallbackPlatform = getPlatformFallback(owner, category, linkMode === "linkedGoogle");
  const normalizedSelected = normalizeText(selectedPlatform);
  const displayValue =
    linkMode === "linkedGoogle" && normalizedSelected === normalizeText("Google") ? fallbackPlatform : selectedPlatform;
  const nextValue = options.some((option) => normalizeText(option) === normalizeText(displayValue))
    ? displayValue
    : fallbackPlatform;

  const customVisible = normalizeText(nextValue) === normalizeText("Custom");
  return `
    <input type="hidden" name="platform" value="${escapeHtml(nextValue)}" data-platform-value />
    <div class="platform-grid" data-platform-grid>
      ${options
        .map((platform) => {
          const hidden = linkMode === "linkedGoogle" && normalizeText(platform) === normalizeText("Google");
          const selected = normalizeText(nextValue) === normalizeText(platform);
          return renderPlatformTile(platform, selected, hidden);
        })
        .join("")}
    </div>
    <input type="hidden" name="customPlatformVisible" value="${customVisible ? "true" : "false"}" data-custom-platform-visible />
  `;
}

function renderEyeIcon(open = false) {
  return open
    ? `<svg viewBox="0 0 24 24" width="16" height="16" focusable="false" aria-hidden="true"><path fill="currentColor" d="M12 5c5.45 0 9.73 3.21 11.25 7-.94 2.35-2.58 4.23-4.67 5.54l-1.42-1.42c1.54-.92 2.79-2.2 3.63-3.92C19.42 10.06 16.05 7 12 7c-1.15 0-2.25.21-3.26.59L7.22 6.07A10.6 10.6 0 0 1 12 5Zm0 14c-5.45 0-9.73-3.21-11.25-7 .9-2.24 2.45-4.05 4.43-5.34l1.43 1.43C4.7 9.92 3.57 11.18 2.75 13 4.58 16.73 8 19 12 19c1.18 0 2.3-.23 3.35-.66l1.4 1.4A10.6 10.6 0 0 1 12 19Zm0-12a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="16" height="16" focusable="false" aria-hidden="true"><path fill="currentColor" d="m2.1 3.51 1.41-1.41L20.9 19.48l-1.41 1.41-3.06-3.06A10.9 10.9 0 0 1 12 19C6.55 19 2.27 15.79 0.75 12c.73-1.82 1.92-3.37 3.44-4.6L2.1 3.51Zm7.07 7.07A3 3 0 0 0 12 15.48a3 3 0 0 0 2.42-4.78l-1.6-1.6a3 3 0 0 0-3.65 0ZM12 5c5.45 0 9.73 3.21 11.25 7a12.3 12.3 0 0 1-3.16 4.3l-1.46-1.46c1.14-.9 2.04-2.04 2.67-3.42C19.42 10.06 16.05 7 12 7c-.6 0-1.19.06-1.75.18l-1.7-1.7A10.6 10.6 0 0 1 12 5Zm0 14c-1.18 0-2.3-.23-3.35-.66l1.53-1.53c.58.13 1.19.19 1.82.19 4.05 0 7.42-3.06 8.59-5.42A12.2 12.2 0 0 0 17.25 9.2l1.49-1.49C20.23 8.9 21.47 10.39 22.5 12c-1.52 3.79-5.8 7-11.25 7Z"/></svg>`;
}

function renderCopyIcon() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" focusable="false" aria-hidden="true"><path fill="currentColor" d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H10V7h9v14Z"/></svg>`;
}

async function getAccountSecretValue(accountId) {
  if (!state.ownerId || !accountId) return "";
  if (state.secretCache[accountId]) return state.secretCache[accountId];
  const account = store.getAccount(state.ownerId, accountId);
  if (!account?.secretRecord) return "";
  const decrypted = await decryptSecret(account.secretRecord, state.passphrase || "");
  if (!decrypted || decrypted === "Encrypted") {
    return "";
  }
  state.secretCache[accountId] = decrypted;
  return decrypted;
}

function renderProfileCircle(user, fallbackText = "U", className = "avatar") {
  const imageUrl = getProfileImageUrl(user);
  const title = user?.name ?? user?.email ?? "Profile";
  if (imageUrl) {
    return `<img class="${className} avatar-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" title="${escapeHtml(title)}" />`;
  }
  return `<div class="${className}" title="${escapeHtml(title)}">${escapeHtml(getInitials(user?.name ?? user?.email ?? fallbackText))}</div>`;
}

function renderCustomFieldRow(row = {}, options = {}) {
  const field = row.field ?? {};
  const rowId = row.fieldId ?? field.id ?? "";
  const visibility = row.visibility ?? field.visibility ?? "masked";
  const name = row.field?.name ?? row.name ?? "";
  const value = row.valueText ?? "";
  const removeLabel = options.removeLabel ?? "Cancel custom field";

  return `
    <div class="custom-field-item" data-custom-field-row data-field-id="${escapeHtml(rowId)}">
      <label class="custom-field-label">
        <span>Name</span>
        <input name="customFieldName" value="${escapeHtml(name)}" placeholder="Field name" />
      </label>
      <label class="custom-field-label">
        <span>Value</span>
        <input name="customFieldValue" value="${escapeHtml(value)}" placeholder="Field value" />
      </label>
      <select name="customFieldVisibility" aria-label="Custom field visibility">
        <option value="private" ${visibility === "private" ? "selected" : ""}>private</option>
        <option value="public" ${visibility === "public" ? "selected" : ""}>public</option>
        <option value="masked" ${visibility === "masked" ? "selected" : ""}>masked</option>
      </select>
      <button class="secondary-button" type="button" data-action="remove-custom-field-row">${escapeHtml(removeLabel)}</button>
    </div>
  `;
}

function platformInitial(platform = "") {
  const normalized = normalizeText(platform);
  if (normalized.includes("google")) return "G";
  if (normalized.includes("facebook")) return "f";
  if (normalized.includes("instagram")) return "IG";
  if (normalized.includes("tiktok")) return "TT";
  if (normalized.includes("discord")) return "D";
  if (normalized.includes("steam")) return "S";
  if (normalized.includes("riot")) return "R";
  if (normalized.includes("epic")) return "E";
  if (normalized.includes("paypal")) return "P";
  if (normalized.includes("bank")) return "B";
  if (normalized.includes("government")) return "ID";
  if (normalized.includes("x")) return "X";
  return String(platform || "?").slice(0, 2).toUpperCase();
}

function platformTone(platform = "") {
  const normalized = normalizeText(platform);
  if (normalized.includes("google")) return "google";
  if (normalized.includes("facebook")) return "facebook";
  if (normalized.includes("instagram")) return "instagram";
  if (normalized.includes("tiktok")) return "tiktok";
  if (normalized.includes("discord")) return "discord";
  if (normalized.includes("steam")) return "steam";
  if (normalized.includes("riot")) return "riot";
  if (normalized.includes("epic")) return "epic";
  if (normalized.includes("paypal")) return "paypal";
  if (normalized.includes("bank")) return "bank";
  if (normalized.includes("government")) return "government";
  return "custom";
}

const PLATFORM_ICON_ASSETS = {
  google: "../assets/platform-icons/social/google.png",
  facebook: "../assets/platform-icons/social/facebook.png",
  instagram: "../assets/platform-icons/social/instagram.png",
  tiktok: "../assets/platform-icons/social/tiktok.png",
  cf: "../assets/platform-icons/social/cf.png",
  github: "../assets/platform-icons/social/github.png",
  "globe one": "../assets/platform-icons/social/globe-one.png",
  globeone: "../assets/platform-icons/social/globe-one.png",
  "x / twitter": "../assets/platform-icons/social/twitter.png",
  twitter: "../assets/platform-icons/social/twitter.png",
  x: "../assets/platform-icons/social/twitter.png",
  discord: "../assets/platform-icons/social/discord.png",
  steam: "../assets/platform-icons/social/steam.png",
  lazada: "../assets/platform-icons/social/lazada.png",
  linkedin: "../assets/platform-icons/social/linkedin.png",
  shopee: "../assets/platform-icons/social/shopee.png",
  telegram: "../assets/platform-icons/social/telegram.png",
  "riot / valorant": "../assets/platform-icons/social/valorant.png",
  riot: "../assets/platform-icons/social/valorant.png",
  valorant: "../assets/platform-icons/social/valorant.png",
  viber: "../assets/platform-icons/social/viber.png",
  whatsapp: "../assets/platform-icons/social/whatsapp.png",
  youtube: "../assets/platform-icons/social/youtube.png",
  zoom: "../assets/platform-icons/social/zoom.png",
  paypal: "../assets/platform-icons/bank/paypal.png",
  "coins.ph": "../assets/platform-icons/bank/coins-ph.png",
  "coins ph": "../assets/platform-icons/bank/coins-ph.png",
  gcash: "../assets/platform-icons/bank/gcash.png",
  maya: "../assets/platform-icons/bank/maya-bank.png",
  "maya bank": "../assets/platform-icons/bank/maya-bank.png",
  bdo: "../assets/platform-icons/bank/bdo.png",
  bpi: "../assets/platform-icons/bank/bpi.png",
  gotyme: "../assets/platform-icons/bank/gotyme.png",
  atome: "../assets/platform-icons/bank/atome.png",
  binance: "../assets/platform-icons/bank/binance.png",
  "home credit": "../assets/platform-icons/bank/home-credit.png",
  homecredit: "../assets/platform-icons/bank/home-credit.png",
  "metrobank": "../assets/platform-icons/bank/metrobank.png",
  "metro bank": "../assets/platform-icons/bank/metrobank.png",
  pnb: "../assets/platform-icons/bank/pnb.png",
  rcbc: "../assets/platform-icons/bank/rcbc.png",
  seabank: "../assets/platform-icons/bank/seabank.png",
  "security bank": "../assets/platform-icons/bank/security-bank.png",
  securitybank: "../assets/platform-icons/bank/security-bank.png",
  "unionbank": "../assets/platform-icons/bank/unionbank.png",
  "union bank": "../assets/platform-icons/bank/unionbank.png",
  "tin id": "../assets/platform-icons/government/bir.png",
  tin: "../assets/platform-icons/government/bir.png",
  bir: "../assets/platform-icons/government/bir.png",
  pagibig: "../assets/platform-icons/government/pag-ibig.png",
  "pag-ibig": "../assets/platform-icons/government/pag-ibig.png",
  "pag ibig": "../assets/platform-icons/government/pag-ibig.png",
  nbi: "../assets/platform-icons/government/nbi.png",
  philsys: "../assets/platform-icons/government/philsys.png",
  egovph: "../assets/platform-icons/government/egovph.png",
  "e gov ph": "../assets/platform-icons/government/egovph.png",
  pnp: "../assets/platform-icons/government/pnp.png"
};

function getPlatformIconAsset(platform = "") {
  const normalized = normalizeText(platform);
  return PLATFORM_ICON_ASSETS[normalized] ?? null;
}

function renderPlatformIcon(platform = "") {
  const iconAsset = getPlatformIconAsset(platform);
  const tone = escapeHtml(platformTone(platform));
  if (iconAsset) {
    const src = new URL(iconAsset, import.meta.url).href;
    return `
      <span class="platform-icon platform-image" aria-hidden="true">
        <img class="platform-icon-image" src="${escapeHtml(src)}" alt="" />
      </span>
    `;
  }

  return `
    <span class="platform-icon platform-fallback platform-${tone}" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="12" height="12" focusable="false">
        <circle cx="12" cy="12" r="7.5" fill="currentColor" opacity="0.75"></circle>
      </svg>
    </span>
  `;
}

function renderPlatformBadge(platform = "") {
  return `
    <span class="badge platform">
      ${renderPlatformIcon(platform)}
      <span>${escapeHtml(platform)}</span>
    </span>
  `;
}

function accountDisplayName(account) {
  return account?.label || account?.mainEmail || account?.platform || "Account";
}

function getPlatformCategoryForPlatform(platform = "", owner = null) {
  const normalized = normalizeText(platform);
  for (const category of PLATFORM_CATEGORY_ORDER) {
    const builtIn = getPlatformOptionsForCategory(category);
    if (builtIn.some((entry) => normalizeText(entry) === normalized)) {
      return category;
    }
  }
  const customPlatforms = owner?.settings?.customPlatforms ?? {};
  for (const category of PLATFORM_CATEGORY_ORDER) {
    const entries = Array.isArray(customPlatforms[category]) ? customPlatforms[category] : [];
    if (entries.some((entry) => normalizeText(entry) === normalized)) {
      return category;
    }
  }
  return "social";
}

function buildPlatformOptions(owner, category, { linkedGoogleMode = false } = {}) {
  const custom = owner?.settings?.customPlatforms?.[category] ?? [];
  const options = getPlatformOptionsForCategory(category, custom);
  const filtered = linkedGoogleMode ? options.filter((platform) => normalizeText(platform) !== normalizeText("Google")) : options;
  return [...filtered, "Custom"];
}

function getGoogleAnchorAccount(owner, account) {
  if (!owner || !account) return null;
  const relation = owner.accountRelationships.find(
    (entry) => entry.childAccountId === account.id && entry.relationshipType === "anchor"
  );
  if (!relation) return null;
  return owner.accounts.find((entry) => entry.id === relation.parentAccountId && entry.platform === "Google") ?? null;
}

function getLinkedAccountsForDisplay(owner, account) {
  if (!owner || !account) return [];

  if (account.platform === "Google") {
    const seen = new Set();
    return owner.accountRelationships
      .filter((relation) => relation.parentAccountId === account.id)
      .map((relation) => owner.accounts.find((entry) => entry.id === relation.childAccountId))
      .filter((entry) => entry && entry.platform !== "Google")
      .filter((entry) => {
        const key = normalizeText(entry.platform);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  const anchor = getGoogleAnchorAccount(owner, account);
  return anchor ? [anchor] : [];
}

function renderLinkedAccountChip(owner, linkedAccount, options = {}) {
  if (!linkedAccount) return "";
  const secondary = options.secondary ?? "";
  const primary = options.primary ?? accountDisplayName(linkedAccount);
  const chipTitle = options.title ?? `${linkedAccount.platform}: ${primary}`;
  const showCopy = secondary || normalizeText(primary) !== normalizeText(linkedAccount.platform);
  return `
    <button
      type="button"
      class="linked-chip"
      data-action="select-account"
      data-id="${escapeHtml(linkedAccount.id)}"
      title="${escapeHtml(chipTitle)}"
      aria-label="${escapeHtml(chipTitle)}"
    >
      ${renderPlatformIcon(linkedAccount.platform)}
      <span class="linked-chip-copy">
        <strong>${escapeHtml(linkedAccount.platform)}</strong>
        ${showCopy ? `<span>${escapeHtml(primary)}${secondary ? ` <span class="linked-chip-secondary">- ${escapeHtml(secondary)}</span>` : ""}</span>` : ""}
      </span>
    </button>
  `;
}

function renderLinkedAccountSection(owner, account, options = {}) {
  const linkedAccounts = getLinkedAccountsForDisplay(owner, account);
  if (!linkedAccounts.length) return "";
  const title = options.title ?? (account.platform === "Google" ? "Linked accounts" : "Linked to");
  const limit = options.limit ?? linkedAccounts.length;
  const chips = linkedAccounts
    .slice(0, limit)
    .map((linkedAccount) => {
      return renderLinkedAccountChip(owner, linkedAccount, {
        primary: linkedAccount.platform,
        secondary: ""
      });
    })
    .join("");
  const extraCount = linkedAccounts.length > limit ? linkedAccounts.length - limit : 0;

  return `
    <div class="linked-section">
      <div class="section-title">${escapeHtml(title)}</div>
      <div class="linked-chip-row">
        ${chips}
        ${extraCount ? `<span class="linked-chip-more">+${extraCount} more</span>` : ""}
      </div>
    </div>
  `;
}

function renderCardLinkedIndicator(owner, account) {
  if (!owner || !account) return "";
  if (account.platform === "Google") {
    const linkedAccounts = getLinkedAccountsForDisplay(owner, account);
    if (!linkedAccounts.length) return "";
    const visible = linkedAccounts.slice(0, 3);
    const extraCount = linkedAccounts.length - visible.length;
    return `
      <div class="card-linked-slot card-linked-stack" aria-label="Linked accounts">
        <div class="avatar-stack" aria-hidden="true">
          ${visible
            .map((entry) => `
              <span class="stack-avatar" title="${escapeHtml(entry.platform)}" aria-label="${escapeHtml(entry.platform)}">
                ${renderPlatformIcon(entry.platform)}
              </span>
            `)
            .join("")}
          ${extraCount > 0 ? `<span class="stack-more">+${extraCount}</span>` : ""}
        </div>
      </div>
    `;
  }

  const anchor = getGoogleAnchorAccount(owner, account);
  if (!anchor) return "";
  return `
    <div class="card-linked-slot card-linked-single" title="Linked to Google" aria-label="Linked to Google">
      ${renderPlatformIcon("Google")}
      <span>Linked to Google</span>
    </div>
  `;
}

function syncAccountFormLinkState(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const linkMode = form.querySelector('[name="linkMode"]');
  const platform = form.querySelector('[name="platform"]');
  const mainEmailField = form.querySelector('[data-main-email-field]');
  const mainEmail = mainEmailField?.querySelector('[name="mainEmail"]');
  const anchorGroup = form.querySelector('[data-linked-google-field]');
  const anchorSelect = form.querySelector('[name="anchorAccountId"]');
  const owner = currentOwnerState();

  if (!linkMode || !platform || !mainEmailField || !mainEmail || !anchorGroup || !anchorSelect || !owner) return;

  const mode = linkMode.value === "linkedGoogle" ? "linkedGoogle" : "separate";
  anchorGroup.classList.toggle("is-hidden", mode !== "linkedGoogle");
  mainEmailField.classList.toggle("is-hidden", mode === "linkedGoogle");
  if (mode === "linkedGoogle") {
    if (!mainEmail.dataset.linkModeBackup) {
      mainEmail.dataset.linkModeBackup = mainEmail.value || "";
    }
    mainEmail.disabled = true;
  } else {
    mainEmail.disabled = false;
    if (mainEmail.dataset.linkModeBackup) {
      if (!mainEmail.value || mainEmail.value === owner.accounts.find((account) => account.id === anchorSelect.value)?.mainEmail) {
        mainEmail.value = mainEmail.dataset.linkModeBackup;
      }
      delete mainEmail.dataset.linkModeBackup;
    }
  }

  if (mode === "linkedGoogle") {
    const linkedAccount = owner.accounts.find((account) => account.id === anchorSelect.value);
    mainEmail.value = linkedAccount?.mainEmail || "";
  }
}

function syncAccountFormPlatformState(form, preferredValue = "") {
  if (!(form instanceof HTMLFormElement)) return;
  const categoryInput = form.querySelector('[name="platformCategory"]');
  const platformInput = form.querySelector('[name="platform"]');
  const platformGrid = form.querySelector('[data-platform-grid]');
  const categoryButtons = [...form.querySelectorAll("[data-platform-category-button]")];
  const customGroup = form.querySelector("[data-custom-platform-field]");
  const label = form.querySelector("[data-platform-label]");
  const customVisibleFlag = form.querySelector('[data-custom-platform-visible]');
  const owner = currentOwnerState();
  if (!categoryInput || !platformInput || !platformGrid || !categoryButtons.length || !customGroup || !label || !owner) return;

  const activeCategory = normalizePlatformCategory(categoryInput.value || "social");
  const linkMode = form.querySelector('[name="linkMode"]')?.value === "linkedGoogle";
  const currentPlatformValue = platformInput.value || "";
  const rememberedValue = state.platformSelections[activeCategory] ?? getDefaultPlatformSelection(activeCategory);

  categoryInput.value = activeCategory;
  label.textContent = `${PLATFORM_CATEGORY_LABELS[activeCategory]} platform`;

  for (const button of categoryButtons) {
    const active = normalizePlatformCategory(button.dataset.value || "social") === activeCategory;
    button.classList.toggle("is-active", active);
  }

  const options = buildPlatformOptions(owner, activeCategory, { linkedGoogleMode: linkMode });
  const fallbackPlatform = getPlatformFallback(owner, activeCategory, linkMode);
  const candidateValue = preferredValue || currentPlatformValue || rememberedValue;
  const displayValue = linkMode && normalizeText(candidateValue) === normalizeText("Google") ? fallbackPlatform : candidateValue;
  const nextValue = options.some((option) => normalizeText(option) === normalizeText(displayValue))
    ? displayValue
    : fallbackPlatform;

  platformInput.value = nextValue;
  state.platformSelections[activeCategory] = nextValue;

  const customVisible = normalizeText(nextValue) === normalizeText("Custom");
  const buttons = options
    .map((platform) => {
      const hidden = linkMode && normalizeText(platform) === normalizeText("Google");
      const selected = normalizeText(nextValue) === normalizeText(platform);
      return renderPlatformTile(platform, selected, hidden);
    })
    .join("");
  platformGrid.innerHTML = buttons;

  const customName = form.querySelector('[name="customPlatformName"]');
  customGroup.classList.toggle("is-hidden", !customVisible);
  if (customVisibleFlag) {
    customVisibleFlag.value = customVisible ? "true" : "false";
  }
  if (customName) {
    customName.disabled = !customVisible;
    if (!customVisible && !customName.value.trim()) {
      customName.value = "";
    }
  }
}

function setToast(title, message, tone = "info") {
  state.toast = { title, message, tone, createdAt: Date.now() };
  render();
  window.clearTimeout(setToast._timer);
  setToast._timer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, 3600);
}

function navigate(hash) {
  if (location.hash !== hash) {
    location.hash = hash;
  }
}

function getRoute(hash = location.hash) {
  const current = hash || "#signin";
  if (current === "#" || current === "") {
    return { name: "dashboard" };
  }
  if (current === "#signin") {
    return { name: "signin" };
  }
  if (current === "#dashboard") {
    return { name: "dashboard" };
  }
  if (current === "#import") {
    return { name: "import" };
  }
  if (current === "#export") {
    return { name: "export" };
  }
  if (current === "#accounts/new") {
    return { name: "account-create" };
  }
  const editMatch = current.match(/^#accounts\/([^/]+)\/edit$/);
  if (editMatch) {
    return { name: "account-edit", accountId: decodeURIComponent(editMatch[1]) };
  }
  return { name: "dashboard" };
}

function isAccountEditorRoute(route = getRoute()) {
  return route.name === "account-create" || route.name === "account-edit";
}

function openAccountEditor(accountId = null) {
  state.modal = null;
  if (accountId) {
    state.selectedAccountId = accountId;
    navigate(`#accounts/${encodeURIComponent(accountId)}/edit`);
    return;
  }
  state.selectedAccountId = null;
  navigate("#accounts/new");
}

function goToDashboard() {
  state.modal = null;
  navigate("#dashboard");
}

function syncRoute() {
  const route = getRoute();
  if (!state.session && route.name !== "signin") {
    navigate("#signin");
  }
  if (state.session && route.name === "signin") {
    navigate("#dashboard");
  }
  if (state.session && route.name === "account-edit" && route.accountId) {
    state.selectedAccountId = route.accountId;
  }
}

function savePassphrase(value) {
  state.passphrase = value;
  if (value) {
    sessionStorage.setItem("socialx:vault-passphrase", value);
  } else {
    sessionStorage.removeItem("socialx:vault-passphrase");
  }
}

async function bootstrapAuth() {
  state.loading = true;
  render();
  state.auth = await createAuthBridge();
  state.authReady = true;
  await refreshSession();
  state.loading = false;
  render();
}

async function refreshSession() {
  if (!state.auth) return;
  const result = await state.auth.getSession();
  state.session = result.user ? result : null;
  state.ownerId = result.user?.id ?? result.session?.userId ?? result.session?.user?.id ?? null;
  if (state.ownerId) {
    const profile = {
      ownerId: state.ownerId,
      displayName: result.user?.name ?? result.user?.displayName ?? result.user?.email ?? "Account owner",
      email: result.user?.email ?? "",
      avatarUrl: result.user?.image ?? result.user?.avatarUrl ?? ""
    };
    void store.initialize(state.ownerId, profile)
      .then(() => {
        const current = store.getOwner(state.ownerId);
        if (!current.profile.displayName) {
          store.updateProfile(state.ownerId, profile);
        }
        store.setSettings(state.ownerId, { lastSeenAt: nowIso() });
        render();
      })
      .catch((error) => {
        console.warn("Failed to hydrate Neon store.", error);
      });
  }
  syncRoute();
}

function currentOwnerState() {
  if (!state.ownerId) return null;
  return store.getOwner(state.ownerId);
}

function currentAccounts() {
  if (!state.ownerId) return [];
  return store.listAccounts(state.ownerId, state.filtersWithQuery ?? {
    ...state.filters,
    query: state.search
  });
}

function selectedAccount() {
  if (!state.ownerId || !state.selectedAccountId) return null;
  return store.getAccount(state.ownerId, state.selectedAccountId);
}

function setSelected(accountId) {
  state.selectedAccountId = accountId;
  render();
}

function openModal(modal) {
  state.modal = modal;
  state.duplicateWarnings = [];
  render();
}

function closeModal() {
  state.modal = null;
  state.duplicateWarnings = [];
  render();
}

function renderSyncStatus(owner) {
  const sync = owner?.sync ?? {};
  const configured = Boolean(config.neonDataApiUrl);
  if (!configured) {
    return `
      <div class="note-box">
        Neon Data API is not configured. SocialX is running from the local browser cache only.
      </div>
    `;
  }
  if (sync.lastSyncError) {
    return `
      <div class="note-box">
        <strong>Neon sync needs attention</strong><br />
        ${escapeHtml(sync.lastSyncError)}
      </div>
    `;
  }
  const lastSyncLabel = sync.lastSyncAt ? formatRelative(sync.lastSyncAt) : "just now";
  return `
    <div class="note-box" style="background: rgba(112, 225, 166, 0.08); border-color: rgba(112, 225, 166, 0.16); color: #d8ffe8;">
      <strong>Connected to Neon</strong><br />
      Last sync ${escapeHtml(lastSyncLabel)}.
    </div>
  `;
}

function getDraftFromForm(form) {
  const formData = new FormData(form);
  const customFields = [...form.querySelectorAll("[data-custom-field-row]")].map((row) => ({
    fieldId: row.dataset.fieldId || "",
    valueType: "text",
    name: row.querySelector('[name="customFieldName"]')?.value ?? "",
    valueText: row.querySelector('[name="customFieldValue"]')?.value ?? "",
    visibility: row.querySelector('[name="customFieldVisibility"]')?.value ?? "masked"
  }));

  return {
    linkMode: formData.get("linkMode")?.toString() ?? "separate",
    anchorAccountId: formData.get("anchorAccountId")?.toString() ?? "",
    platformCategory: formData.get("platformCategory")?.toString() ?? "social",
    platform: formData.get("platform")?.toString() ?? "Google",
    customPlatformName: formData.get("customPlatformName")?.toString() ?? "",
    mainEmail: formData.get("mainEmail")?.toString() ?? "",
    username: formData.get("username")?.toString() ?? "",
    secretValue: formData.get("secretValue")?.toString() ?? "",
    status: formData.get("status")?.toString() ?? "active",
    notes: formData.get("notes")?.toString() ?? "",
    customFields
  };
}

async function evaluateDuplicates(form, ignoreId = null) {
  if (!state.ownerId) return [];
  const draft = getDraftFromForm(form);
  const warnings = store.getDuplicateWarnings(state.ownerId, draft, ignoreId);
  state.duplicateWarnings = warnings;
  return warnings;
}

async function submitAccountForm(form, mode, accountId = null) {
  if (!state.ownerId || !state.session?.user?.id && !state.session?.userId && !state.ownerId) return;
  const draft = getDraftFromForm(form);
  if (draft.linkMode === "linkedGoogle" && !draft.anchorAccountId) {
    setToast("Choose a Google account", "Linked accounts need an existing Google anchor.", "danger");
    return;
  }
  const platform = normalizeText(draft.platform) === normalizeText("Custom")
    ? draft.customPlatformName.trim()
    : draft.platform.trim();
  if (!platform) {
    setToast("Choose a platform", "Every account needs a platform name.", "danger");
    return;
  }
  if (normalizeText(draft.platform) === normalizeText("Custom")) {
    store.addCustomPlatform(state.ownerId, draft.platformCategory, platform);
  }
  const secretRecord = draft.secretValue
    ? await encryptSecret(draft.secretValue, state.passphrase || "")
    : null;
  const customFields = await Promise.all(
    draft.customFields.map(async (field) => {
      if (field.valueType === "secret" && field.valueText) {
        const encryptedValue = await encryptSecret(field.valueText, state.passphrase || "");
        return {
          ...field,
          valueText: "",
          encryptedValue
        };
      }
      return field;
    })
  );
  const payload = {
    ...draft,
    platform,
    secretRecord,
    customFields
  };

  if (mode === "create") {
    const account = store.createAccount(state.ownerId, state.ownerId, payload);
    state.selectedAccountId = account.id;
    delete state.secretCache[account.id];
    delete state.revealedSecrets[account.id];
    setToast("Account created", `${account.label} is now part of your vault.`, "success");
  } else {
    const account = store.updateAccount(state.ownerId, state.ownerId, accountId, payload);
    state.selectedAccountId = account.id;
    delete state.secretCache[account.id];
    delete state.revealedSecrets[account.id];
    setToast("Account updated", `${account.label} was saved successfully.`, "success");
  }
  const synced = await store.syncOwner(state.ownerId);
  if (!synced) {
    setToast("Saved locally", "The account saved locally, but Neon sync needs attention.", "warn");
  }
  state.modal = null;
  goToDashboard();
  render();
}

function copyText(value, label) {
  if (!value) return;
  navigator.clipboard?.writeText(value);
  setToast("Copied", `${label} copied to clipboard.`, "success");
}

function renderChip(label, active = false, action = "", value = "") {
  return `
    <button class="chip ${active ? "is-active" : ""}" type="button" data-action="${escapeHtml(action)}" data-value="${escapeHtml(value)}">
      ${escapeHtml(label)}
    </button>
  `;
}

function renderSignIn() {
  return `
    <main class="app-shell hero">
      <section class="hero-card hero-card-simple">
        <div class="sign-in-card sign-in-card-simple">
          <div class="brand">
            <img class="brand-mark" src="./assets/socialx-logo.png" alt="SocialX logo" />
            <div class="brand-title">
              <strong>${escapeHtml(config.appName)}</strong>
              <span>Simple account organizer</span>
            </div>
          </div>
          <h1>where I keep all trash accounts in one place</h1>
          <p>
            I use SocialX to keep my dummy accounts and forgotten logins organized so I can find them fast.
          </p>
          <button class="google-button" type="button" data-action="sign-in-google" aria-label="Continue with Google">
            <span class="google-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="20" height="20" role="img" focusable="false">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.1 5 29.4 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.8-.4-4.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.8 15.1 19 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.1 5 29.4 3 24 3 16.1 3 9.3 7.5 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 45c5.3 0 10.1-2 13.7-5.3l-6.3-5.2C29.4 36.2 26.9 37 24 37c-5.2 0-9.6-3.3-11.3-8l-6.6 5C9.1 40.1 16 45 24 45z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.3-3.4 5.9-6 7.3l.1-.1 6.3 5.2C35.2 39.1 45 32.5 45 24c0-1.4-.1-2.8-.4-4.5z"/>
              </svg>
            </span>
            <span>Continue with Google</span>
          </button>
        </div>
      </section>
    </main>
  `;
}

function renderLoadingSkeleton() {
  return `
    <main class="app-shell hero">
      <section class="hero-card hero-card-skeleton">
        <div class="skeleton-column">
          <div class="brand skeleton-brand">
            <div class="brand-mark skeleton-box skeleton-logo"></div>
            <div class="brand-title">
              <div class="skeleton-line skeleton-line-lg"></div>
              <div class="skeleton-line skeleton-line-sm"></div>
            </div>
          </div>
          <div class="skeleton-line skeleton-line-xl"></div>
          <div class="skeleton-line skeleton-line-md"></div>
          <div class="skeleton-line skeleton-line-md short"></div>
          <div class="skeleton-button-row">
            <div class="skeleton-pill"></div>
            <div class="skeleton-pill"></div>
          </div>
        </div>
        <aside class="sign-in-card sign-in-card-skeleton">
          <div class="skeleton-card-head">
            <div class="skeleton-avatar skeleton-box"></div>
            <div class="skeleton-meta">
              <div class="skeleton-line skeleton-line-md"></div>
              <div class="skeleton-line skeleton-line-sm"></div>
            </div>
          </div>
          <div class="skeleton-grid">
            <div class="skeleton-block"></div>
            <div class="skeleton-block"></div>
            <div class="skeleton-block"></div>
            <div class="skeleton-block"></div>
          </div>
          <div class="skeleton-line skeleton-line-md"></div>
          <div class="skeleton-chip-row">
            <div class="skeleton-chip"></div>
            <div class="skeleton-chip"></div>
            <div class="skeleton-chip"></div>
          </div>
        </aside>
      </section>
    </main>
  `;
}

function renderSummary(owner) {
  const summary = store.getSummary(state.ownerId);
  return `
    <section class="summary-row">
      <div class="stat-card">
        <div class="label">Accounts</div>
        <div class="value">${summary.total}</div>
      </div>
      <div class="stat-card">
        <div class="label">Active</div>
        <div class="value">${summary.active}</div>
      </div>
      <div class="stat-card">
        <div class="label">Relationships</div>
        <div class="value">${summary.relationships}</div>
      </div>
      <div class="stat-card">
        <div class="label">Custom Fields</div>
        <div class="value">${summary.fields}</div>
      </div>
    </section>
  `;
}

function renderFilters(owner) {
  const platformSet = [...new Set(owner.accounts.map((account) => account.platform))].sort();
  const selectedPlatform = state.filters.platform === "all" ? "" : state.filters.platform;
  const selectedStatus = state.filters.status === "all" ? "" : state.filters.status;
  const platformLabel = selectedPlatform || "All platforms";
  const statusLabel = selectedStatus || "All statuses";
  return `
    <section class="filter-bar">
      <div class="filter-group">
        <details class="filter-menu" data-filter-menu>
          <summary class="filter-menu-trigger">
            ${selectedPlatform ? renderPlatformIcon(selectedPlatform) : `<span class="filter-trigger-neutral" aria-hidden="true"></span>`}
            <span>${escapeHtml(platformLabel)}</span>
          </summary>
          <div class="filter-menu-list" role="menu" aria-label="Platform filter options">
            <button type="button" class="filter-menu-item ${state.filters.platform === "all" ? "is-selected" : ""}" data-action="filter-platform" data-value="all">
              <span class="filter-option-icon filter-option-neutral" aria-hidden="true"></span>
              <span>All platforms</span>
            </button>
            ${platformSet
              .map((platform) => `
                <button type="button" class="filter-menu-item ${state.filters.platform === platform ? "is-selected" : ""}" data-action="filter-platform" data-value="${escapeHtml(platform)}">
                  ${renderFilterMenuItemIcon(platform)}
                  <span>${escapeHtml(platform)}</span>
                </button>
              `)
              .join("")}
          </div>
        </details>

        <details class="filter-menu" data-filter-menu>
          <summary class="filter-menu-trigger">
            ${selectedStatus ? renderFilterStatusDot(selectedStatus) : `<span class="filter-dot filter-dot-neutral" aria-hidden="true"></span>`}
            <span>${escapeHtml(statusLabel)}</span>
          </summary>
          <div class="filter-menu-list" role="menu" aria-label="Status filter options">
            <button type="button" class="filter-menu-item ${state.filters.status === "all" ? "is-selected" : ""}" data-action="filter-status" data-value="all">
              <span class="filter-dot filter-dot-neutral" aria-hidden="true"></span>
              <span>All statuses</span>
            </button>
            ${STATUS_OPTIONS.map((status) => `
              <button type="button" class="filter-menu-item ${state.filters.status === status ? "is-selected" : ""}" data-action="filter-status" data-value="${escapeHtml(status)}">
                ${renderFilterStatusDot(status)}
                <span>${escapeHtml(status)}</span>
              </button>
            `).join("")}
          </div>
        </details>
        <select data-action="filter-sort">
          <option value="updated_desc" ${state.filters.sort === "updated_desc" ? "selected" : ""}>Recently updated</option>
          <option value="newest" ${state.filters.sort === "newest" ? "selected" : ""}>Newest</option>
          <option value="alpha" ${state.filters.sort === "alpha" ? "selected" : ""}>Alphabetical</option>
          <option value="status" ${state.filters.sort === "status" ? "selected" : ""}>Status</option>
          <option value="platform" ${state.filters.sort === "platform" ? "selected" : ""}>Platform</option>
        </select>
      </div>
    </section>
  `;
}

function renderAccountCard(account, query) {
  const owner = currentOwnerState();
  const linkedGoogle = account.platform === "Google" ? null : getGoogleAnchorAccount(owner, account);
  const priorityLine = linkedGoogle?.mainEmail
    ? highlightMatch(linkedGoogle.mainEmail, query)
    : account.mainEmail
      ? highlightMatch(account.mainEmail, query)
      : account.username
        ? highlightMatch(account.username, query)
        : "";

  return `
    <article class="account-card ${state.selectedAccountId === account.id ? "is-selected" : ""}" data-action="select-account" data-id="${escapeHtml(account.id)}">
      <div class="account-card-header">
        <div class="account-title">
          ${renderPlatformBadge(account.platform)}
        </div>
        <div class="card-status-slot">
          ${renderStatusDot(account.status)}
        </div>
      </div>
      <div class="account-preview">
        <div class="card-preview-row">
          <div class="card-preview-copy">
            ${priorityLine ? `<div class="meta-line truncate">${priorityLine}</div>` : ""}
            <div class="meta-line">Updated ${escapeHtml(formatRelative(account.updatedAt))}</div>
          </div>
          ${renderCardLinkedIndicator(owner, account)}
        </div>
      </div>
    </article>
  `;
}

function renderAccountList(owner) {
  const accounts = currentAccounts();
  const query = state.search.trim();
  if (!accounts.length) {
    return `
      <div class="empty-state">
        <h3>No accounts match your current filters.</h3>
        <p>
          Try clearing a filter or add a new account. SocialX keeps linked accounts, custom fields, and archive-first
          organization simple to browse.
        </p>
        <button class="primary-button" type="button" data-action="open-create">Add account</button>
      </div>
    `;
  }
  return `
    <div class="list-grid">
      ${accounts.map((account) => renderAccountCard(account, query)).join("")}
    </div>
  `;
}

function renderAccountDetails(owner) {
  const account = selectedAccount();
  if (!account) {
    return "";
  }

  const enriched = store.getAccount(state.ownerId, account.id);
  const revealed = state.revealedSecrets[enriched.id] ?? false;
  const secretPreview = revealed ? (state.secretCache[enriched.id] || "••••••••") : (enriched.secretRecord ? "••••••••" : "None");
  const detailRows = [
    enriched.mainEmail ? `<div class="kv"><div class="key">Main email</div><div class="val truncate">${escapeHtml(enriched.mainEmail)}</div></div>` : "",
    enriched.username ? `<div class="kv"><div class="key">Username</div><div class="val truncate">${escapeHtml(enriched.username)}</div></div>` : "",
    enriched.secretRecord
      ? `<div class="kv kv-secret">
          <div class="key">Password</div>
          <div class="val secret-row">
            <span class="secret-value ${revealed ? "is-revealed" : "is-masked"}">${escapeHtml(secretPreview)}</span>
            <div class="secret-actions">
              <button class="icon-button subtle" type="button" data-action="toggle-secret" data-id="${escapeHtml(enriched.id)}" aria-label="${revealed ? "Hide password" : "Show password"}">
                ${renderEyeIcon(revealed)}
              </button>
              <button class="icon-button subtle" type="button" data-action="copy-secret" data-id="${escapeHtml(enriched.id)}" aria-label="Copy password">
                ${renderCopyIcon()}
              </button>
            </div>
          </div>
        </div>`
      : "",
    `<div class="kv"><div class="key">Updated</div><div class="val">${escapeHtml(formatRelative(enriched.updatedAt))}</div></div>`
  ]
    .filter(Boolean)
    .join("");

  return `
    <div class="drawer drawer-compact">
      <div class="drawer-head">
        <div class="topbar-left compact drawer-title-row">
          <div class="drawer-platform-icon">${renderPlatformIcon(enriched.platform)}</div>
          <div>
            <h2 class="truncate">${escapeHtml(enriched.platform)}</h2>
          </div>
        </div>
        ${renderStatusDot(enriched.status)}
      </div>
      <div class="drawer-section drawer-summary-grid">${detailRows}</div>
      ${enriched.notes ? `<div class="drawer-section drawer-notes"><div class="key">Notes</div><div class="val">${escapeHtml(enriched.notes)}</div></div>` : ""}
      <div class="drawer-actions">
        ${enriched.mainEmail ? `<button class="secondary-button" data-action="copy-text" data-value="${escapeHtml(enriched.mainEmail)}" data-label="email">Copy email</button>` : ""}
        ${enriched.username ? `<button class="secondary-button" data-action="copy-text" data-value="${escapeHtml(enriched.username)}" data-label="username">Copy username</button>` : ""}
        <button class="secondary-button" data-action="open-edit" data-id="${escapeHtml(enriched.id)}">Edit</button>
        <button class="ghost-button" data-action="toggle-archive" data-id="${escapeHtml(enriched.id)}">${enriched.archived ? "Restore" : "Archive"}</button>
        <button class="danger-button" data-action="delete-account" data-id="${escapeHtml(enriched.id)}">Delete</button>
      </div>
      ${renderLinkedAccountSection(owner, enriched, { title: enriched.platform === "Google" ? "Linked accounts" : "Linked to" })}
    </div>
  `;
}

function renderTopbar(owner) {

  return `
    <header class="topbar">
      <div class="topbar-left">
        <img class="brand-mark" src="./assets/socialx-logo.png" alt="SocialX logo" />
        <div>
          <div class="title">${escapeHtml(config.appName)}</div>
          <div class="meta-line">Simple account organizer</div>
        </div>
      </div>
      <div class="search-wrap">
        <span class="search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" focusable="false">
            <path fill="currentColor" d="M10 4a6 6 0 1 0 3.87 10.57l4.78 4.78 1.41-1.41-4.78-4.78A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/>
          </svg>
        </span>
        <input
          class="search-input"
          type="search"
          placeholder="Search email, username, platform, notes, IDs, fields, and relationships..."
          value="${escapeHtml(state.search)}"
          data-action="search"
        />
      </div>
      <div class="topbar-actions">
        <button class="primary-button" data-action="open-create">Add account</button>
        <div class="profile-stack">
          ${renderProfileCircle(state.session?.user, "U", "avatar profile-avatar")}
          <span class="profile-email">${escapeHtml(state.session?.user?.email ?? "Signed in")}</span>
        </div>
        <button class="ghost-button" data-action="sign-out">Sign out</button>
      </div>
    </header>
  `;
}

function renderAccountForm(mode, account, owner) {
  const linkedGoogle = account?.parents?.find((entry) => entry.account?.platform === "Google") ?? null;
  const linkMode = linkedGoogle ? "linkedGoogle" : "separate";
  const anchorAccountId = linkedGoogle?.account?.id ?? "";
  const platformCategory = getPlatformCategoryForPlatform(account?.platform || "social", owner);
  const categoryOptions = PLATFORM_CATEGORY_ORDER.map((key) => ({
    key,
    label: PLATFORM_CATEGORY_LABELS[key]
  }));
  const accountPlatform = account?.platform ?? "";
  const activePlatformOptions = buildPlatformOptions(owner, platformCategory, { linkedGoogleMode: linkMode === "linkedGoogle" });
  const knownPlatform = activePlatformOptions.some((option) => normalizeText(option) === normalizeText(accountPlatform));
  const rememberedSelection = state.platformSelections[platformCategory] ?? getDefaultPlatformSelection(platformCategory);
  const selectedPlatform = accountPlatform
    ? (knownPlatform ? accountPlatform : "Custom")
    : rememberedSelection;
  const customPlatformName = knownPlatform || !accountPlatform ? "" : accountPlatform;
  const customRows = mode === "edit" && account?.customFields.length ? account.customFields : [];

  return `
    ${
      state.duplicateWarnings.length
        ? `<div class="note-box form-note">
            <strong>Possible duplicates</strong><br />
            ${state.duplicateWarnings.map((warning) => `- ${escapeHtml(warning)}`).join("<br />")}
          </div>`
        : ""
    }

    <form id="accountForm" class="account-form" autocomplete="off">
      <div class="form-grid">
        <div class="form-field full">
          <label>Link mode</label>
          ${renderLinkModeToggle(linkMode)}
        </div>

        <div class="form-field full ${linkMode === "linkedGoogle" ? "" : "is-hidden"}" data-linked-google-field>
          <label>Link to existing Google</label>
          <select name="anchorAccountId" data-action="anchor-google">
            <option value="">Choose Google account</option>
            ${owner.accounts
              .filter((entry) => entry.platform === "Google" && (!account || entry.id !== account.id))
              .map(
                (entry) => `
                  <option value="${escapeHtml(entry.id)}" ${entry.id === anchorAccountId ? "selected" : ""}>${escapeHtml(cleanAnchorLabel(entry))}</option>
                `
              )
              .join("")}
          </select>
        </div>

        <div class="form-field full ${linkMode === "linkedGoogle" ? "is-hidden" : ""}" data-main-email-field>
          <label>Main email or Google email</label>
          <input name="mainEmail" placeholder="name@example.com" value="${escapeHtml(account?.mainEmail ?? "")}" ${linkMode === "linkedGoogle" ? "disabled" : ""} />
        </div>

        <div class="form-field full">
          <label>Platform category</label>
          <div class="category-toggle" data-platform-category-toggle>
            ${categoryOptions
              .map(
                ({ key, label }) => `
                  <button type="button" class="category-pill ${platformCategory === key ? "is-active" : ""}" data-action="set-platform-category" data-platform-category-button data-value="${escapeHtml(key)}">
                    ${escapeHtml(label)}
                  </button>
                `
              )
              .join("")}
          </div>
          <input type="hidden" name="platformCategory" value="${escapeHtml(platformCategory)}" />
        </div>

        <div class="form-field full" data-platform-select-field>
          <label data-platform-label>${escapeHtml(PLATFORM_CATEGORY_LABELS[platformCategory])} platform</label>
          ${renderPlatformGrid(owner, platformCategory, selectedPlatform, linkMode)}
        </div>

        <div class="form-field full ${normalizeText(selectedPlatform) === normalizeText("Custom") ? "" : "is-hidden"}" data-custom-platform-field>
          <label>Custom platform</label>
          <input name="customPlatformName" placeholder="Add your own platform" value="${escapeHtml(customPlatformName)}" />
        </div>

        <div class="form-field">
          <label>Username</label>
          <input name="username" placeholder="@handle / account username" value="${escapeHtml(account?.username ?? "")}" />
        </div>
        <div class="form-field">
          <label>Password</label>
          <input
            name="secretValue"
            type="text"
            class="masked-input secret-input"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            placeholder="Password"
          />
        </div>
        <div class="form-field">
          <label>Status</label>
          <select name="status">
            ${STATUS_OPTIONS.map((status) => `<option value="${escapeHtml(status)}" ${(account?.status ?? "active") === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
          </select>
        </div>
        <div class="form-field full">
          <label>Notes</label>
          <textarea name="notes" rows="4" placeholder="Context, recovery notes, linked email pattern...">${escapeHtml(account?.notes ?? "")}</textarea>
        </div>

        <div class="custom-field-box full-width">
          <div class="list-toolbar">
            <h3 class="section-title">Custom fields</h3>
            <button class="ghost-button" type="button" data-action="add-custom-field-row">Add custom field</button>
          </div>
          <div class="custom-field-list ${customRows.length ? "" : "is-hidden"}" id="customFieldList">
            ${customRows.map((row) => renderCustomFieldRow(row)).join("")}
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button class="secondary-button" type="button" data-action="go-dashboard">Cancel</button>
        <button class="primary-button" type="submit">${mode === "edit" ? "Save changes" : "Create account"}</button>
      </div>
    </form>
  `;
}

function renderAccountEditorWorkspace(owner) {
  const route = getRoute();
  const mode = route.name === "account-edit" ? "edit" : "create";
  const account = mode === "edit" ? store.getAccount(state.ownerId, route.accountId) : null;
  const title = mode === "edit" ? `Edit ${account?.label ?? "account"}` : "Add account";
  if (mode === "edit" && !account) {
    return `
      <section class="workspace">
        <div class="panel list-panel editor-panel">
          <div class="list-toolbar">
            <div>
              <div class="section-title">Account not found</div>
              <div class="meta-line">The route points to a record that does not exist in your current vault.</div>
            </div>
          <div class="inline-actions">
              <button class="secondary-button" type="button" data-action="go-dashboard">Back to dashboard</button>
            </div>
          </div>
        </div>
        ${renderAccountDetails(owner)}
      </section>
    `;
  }
  return `
    <section class="workspace">
      <div class="panel list-panel editor-panel">
        <div class="list-toolbar">
          <div>
            <div class="section-title">${escapeHtml(title)}</div>
            <div class="meta-line">This route replaces the modal so account creation stays on its own page.</div>
          </div>
          <div class="inline-actions">
            <button class="secondary-button" type="button" data-action="go-dashboard">Back to dashboard</button>
          </div>
        </div>
        ${renderAccountForm(mode, account, owner)}
      </div>
      ${renderAccountDetails(owner)}
    </section>
  `;
}

function updateSearchView() {
  const owner = currentOwnerState();
  if (!owner) return;

  const visibleCount = app.querySelector('[data-region="visible-count"]');
  if (visibleCount) {
    visibleCount.textContent = `${currentAccounts().length} visible records from ${owner.accounts.length} total accounts`;
  }

  const listRegion = app.querySelector('[data-region="account-list"]');
  if (listRegion) {
    listRegion.innerHTML = renderAccountList(owner);
  }
}

function renderModal() {
  if (!state.modal || !state.ownerId) return "";
  const owner = currentOwnerState();
  const mode = state.modal.mode;
  const account = mode === "edit" ? store.getAccount(state.ownerId, state.modal.accountId) : null;
  const title = mode === "edit" ? `Edit ${account?.label ?? "account"}` : "Add account";

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal modal-form-shell" role="dialog" aria-modal="true" aria-labelledby="accountModalTitle">
        <div class="modal-head">
          <div>
            <h2 id="accountModalTitle">${escapeHtml(title)}</h2>
            <div class="meta-line">A simple account form with Google linking and custom fields.</div>
          </div>
          <button class="icon-button" data-action="close-modal" aria-label="Close">Ã—</button>
        </div>
        ${renderAccountForm(mode, account, owner)}
      </div>
    </div>
  `;
}

function renderImportPage() {
  return `
    <section class="workspace single">
      <div class="panel list-panel">
        <div class="panel-head">
          <div>
            <div class="section-title">Import vault</div>
            <div class="meta-line">Restore from a SocialX JSON export.</div>
          </div>
          <button class="secondary-button" type="button" data-action="go-dashboard">Back</button>
        </div>
        <form id="importForm">
          <div class="form-field full">
            <label>Snapshot JSON</label>
            <textarea name="snapshot" rows="14" placeholder="Paste exported JSON here or choose a file"></textarea>
            <input type="file" accept="application/json" data-import-file hidden />
          </div>
          <div class="form-actions">
            <button class="secondary-button" type="button" data-action="load-import-file">Load file</button>
            <button class="secondary-button" type="button" data-action="go-dashboard">Cancel</button>
            <button class="primary-button" type="submit">Import</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderExportPage(snapshot) {
  return `
    <section class="workspace single">
      <div class="panel list-panel">
        <div class="panel-head">
          <div>
            <div class="section-title">Export vault</div>
            <div class="meta-line">Copy or download your current SocialX snapshot.</div>
          </div>
          <button class="secondary-button" type="button" data-action="go-dashboard">Back</button>
        </div>
        <div class="code-panel">
          <pre id="exportSnapshot" style="margin: 0; white-space: pre-wrap;">${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>
        </div>
        <div class="form-actions" style="margin-top: 14px;">
          <button class="secondary-button" type="button" data-action="copy-export-json">Copy JSON</button>
          <button class="primary-button" type="button" data-action="download-export-json">Download JSON</button>
        </div>
      </div>
    </section>
  `;
}

function renderImportModal() {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal">
        <div class="modal-head">
          <div>
            <h2>Import vault snapshot</h2>
            <div class="meta-line">Upload a SocialX JSON export to restore accounts, fields, relationships, and logs.</div>
          </div>
          <button class="icon-button" data-action="close-modal" aria-label="Close">Ã—</button>
        </div>
        <form id="importForm">
          <div class="form-field full">
            <label>Snapshot JSON</label>
            <textarea name="snapshot" rows="14" placeholder='Paste exported JSON here or choose a file'></textarea>
            <input type="file" accept="application/json" data-import-file hidden />
          </div>
          <div class="form-actions">
            <button class="secondary-button" type="button" data-action="load-import-file">Load file</button>
            <button class="secondary-button" type="button" data-action="close-modal">Cancel</button>
            <button class="primary-button" type="submit">Import</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderExportModal(snapshot) {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal">
        <div class="modal-head">
          <div>
            <h2>Export vault snapshot</h2>
            <div class="meta-line">Copy or download the current owner vault as JSON.</div>
          </div>
          <button class="icon-button" data-action="close-modal" aria-label="Close">Ã—</button>
        </div>
        <div class="custom-field-box">
          <pre style="white-space: pre-wrap; margin: 0; max-height: 52vh; overflow: auto;">${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>
        </div>
        <div class="form-actions">
          <button class="secondary-button" data-action="copy-export-json">Copy JSON</button>
          <button class="primary-button" data-action="download-export-json">Download JSON</button>
          <button class="secondary-button" data-action="close-modal">Close</button>
        </div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const owner = currentOwnerState();
  if (!owner) {
    return renderSignIn();
  }
  const route = getRoute();
  if (route.name === "import") {
    return `
      <div class="app-shell">
        <div class="layout">
          <main class="content wide">
            ${renderTopbar(owner)}
            ${renderFilters(owner)}
            ${renderImportPage()}
          </main>
        </div>
      </div>
    `;
  }
  if (route.name === "export") {
    return `
      <div class="app-shell">
        <div class="layout">
          <main class="content wide">
            ${renderTopbar(owner)}
            ${renderFilters(owner)}
            ${renderExportPage(store.exportOwner(state.ownerId))}
          </main>
        </div>
      </div>
    `;
  }
  return `
    <div class="app-shell">
      <div class="layout layout-clean">
        <main class="content wide">
          ${renderTopbar(owner)}
          ${renderFilters(owner)}
          ${isAccountEditorRoute() ? renderAccountEditorWorkspace(owner) : `
            <section class="workspace ${selectedAccount() ? "has-drawer" : "single"}">
              <div class="panel list-panel">
                <div class="list-toolbar">
                  <div>
                    <div class="section-title">Accounts</div>
                    <div class="meta-line">
                      <span data-region="visible-count">${currentAccounts().length} visible records from ${owner.accounts.length} total accounts</span>
                    </div>
                  </div>
                  <div class="inline-actions">
                    <button class="secondary-button" type="button" data-action="open-import">Import</button>
                    <button class="secondary-button" type="button" data-action="open-export">Export</button>
                    <button class="secondary-button" type="button" data-action="open-settings">Settings</button>
                    <button class="primary-button" type="button" data-action="open-create">Add account</button>
                  </div>
                </div>
                <div data-region="account-list">${renderAccountList(owner)}</div>
              </div>
              ${renderAccountDetails(owner)}
            </section>
          `}
        </main>
      </div>
    </div>
  `;
}

function render() {
  if (state.loading) {
    app.innerHTML = renderLoadingSkeleton();
    return;
  }

  if (!state.session || !state.ownerId) {
    app.innerHTML = renderSignIn();
    if (state.modal) {
      state.modal = null;
    }
    return;
  }

  app.innerHTML = renderDashboard();
  const accountForm = app.querySelector("#accountForm");
  if (accountForm) {
    syncAccountFormLinkState(accountForm);
    syncAccountFormPlatformState(accountForm);
  }
  if (state.modal?.mode === "settings") {
    const owner = currentOwnerState();
    app.insertAdjacentHTML(
      "beforeend",
      `
        <div class="modal-backdrop" data-action="close-modal">
          <div class="modal">
            <div class="modal-head">
              <div>
                <h2>Settings</h2>
                <div class="meta-line">Vault passphrase, archive behavior, and export/import safety controls.</div>
              </div>
              <button class="icon-button" data-action="close-modal" aria-label="Close">Ã—</button>
            </div>
            <div class="form-grid">
              <div class="form-field full">
                <label>Vault passphrase</label>
                <input name="vaultPassphrase" value="${escapeHtml(state.passphrase)}" placeholder="Optional local encryption passphrase" />
              </div>
              <div class="form-field full">
                <label>Archive preference</label>
                <select name="showArchived">
                  <option value="false" ${owner.settings?.showArchived ? "" : "selected"}>Hide archived by default</option>
                  <option value="true" ${owner.settings?.showArchived ? "selected" : ""}>Show archived by default</option>
                </select>
              </div>
            </div>
            <div class="form-actions">
              <button class="secondary-button" data-action="close-modal">Cancel</button>
              <button class="primary-button" data-action="save-settings">Save settings</button>
            </div>
          </div>
        </div>
      `
    );
  }

  if (state.toast) {
    app.insertAdjacentHTML(
      "beforeend",
      `
        <div class="toast">
          <strong>${escapeHtml(state.toast.title)}</strong>
          <p>${escapeHtml(state.toast.message)}</p>
        </div>
      `
    );
  }

  state.duplicateWarnings = [];
}

function bindGlobalEvents() {
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const value = target.dataset.value ?? "";
    const id = target.dataset.id ?? "";
    const label = target.dataset.label ?? "";

    if (target.closest(".modal-backdrop") && target.dataset.action !== "close-modal") {
      event.stopPropagation();
    }

    switch (action) {
      case "sign-in-google":
        try {
          await state.auth.signInWithGoogle();
        } catch (error) {
          setToast("Sign-in failed", error.message || "Unable to start Google login.", "danger");
        }
        break;
      case "sign-out":
        await state.auth?.signOut?.();
        state.session = null;
        state.ownerId = null;
        state.selectedAccountId = null;
        state.secretCache = {};
        state.revealedSecrets = {};
        navigate("#signin");
        render();
        break;
      case "open-create":
        openAccountEditor();
        break;
      case "open-edit":
        openAccountEditor(id);
        break;
      case "open-import":
        navigate("#import");
        render();
        break;
      case "open-export":
        navigate("#export");
        render();
        break;
      case "open-settings":
        openModal({ mode: "settings" });
        break;
      case "close-modal":
        closeModal();
        break;
      case "go-dashboard":
        state.modal = null;
        goToDashboard();
        render();
        break;
      case "copy-text":
        copyText(value, label || "text");
        break;
      case "toggle-secret": {
        const account = store.getAccount(state.ownerId, id);
        if (!account?.secretRecord) break;
        const revealed = state.revealedSecrets[id] ?? false;
        if (revealed) {
          state.revealedSecrets[id] = false;
          render();
          break;
        }
        try {
          const secret = await getAccountSecretValue(id);
          if (!secret) {
            setToast("Secret locked", "Unlock your passphrase to reveal this secret.", "danger");
            break;
          }
          state.secretCache[id] = secret;
          state.revealedSecrets[id] = true;
          render();
        } catch (error) {
          setToast("Secret unavailable", error.message || "Unable to decrypt the secret value.", "danger");
        }
        break;
      }
      case "copy-secret": {
        const account = store.getAccount(state.ownerId, id);
        if (!account?.secretRecord) break;
        try {
          const secret = state.secretCache[id] || (await getAccountSecretValue(id));
          if (!secret) {
            setToast("Secret locked", "Unlock your passphrase to copy this secret.", "danger");
            break;
          }
          await copyText(secret, "secret");
          state.revealedSecrets[id] = true;
          render();
        } catch (error) {
          setToast("Copy failed", error.message || "Unable to copy the secret value.", "danger");
        }
        break;
      }
      case "toggle-archive":
        store.archiveAccount(state.ownerId, state.ownerId, id, !(store.getAccount(state.ownerId, id)?.archived ?? false));
        setToast("Archive updated", "The account archive state changed.", "success");
        render();
        break;
      case "delete-account":
        if (confirm("Delete this account and all connected relationships?")) {
          store.deleteAccount(state.ownerId, state.ownerId, id);
          if (state.selectedAccountId === id) {
            state.selectedAccountId = null;
          }
          setToast("Account deleted", "The account was removed from your vault.", "success");
          render();
        }
        break;
      case "select-account":
        setSelected(id);
        break;
      case "set-link-mode": {
        const form = target.closest("form");
        const linkModeInput = form?.querySelector('[name="linkMode"]');
        if (linkModeInput) {
          linkModeInput.value = value === "linkedGoogle" ? "linkedGoogle" : "separate";
          syncAccountFormLinkState(form);
          syncAccountFormPlatformState(form);
        }
        break;
      }
      case "set-platform-category": {
        const form = target.closest("form");
        const categoryInput = form?.querySelector('[name="platformCategory"]');
        if (categoryInput) {
          categoryInput.value = value || "social";
          syncAccountFormPlatformState(form);
        }
        break;
      }
      case "filter-platform":
        state.filters.platform = value || "all";
        target.closest("details[data-filter-menu]")?.removeAttribute("open");
        render();
        break;
      case "filter-status":
        state.filters.status = value || "all";
        target.closest("details[data-filter-menu]")?.removeAttribute("open");
        render();
        break;
      case "platform-option": {
        const form = target.closest("form");
        const category = normalizePlatformCategory(form?.querySelector('[name="platformCategory"]')?.value || "social");
        const platformValue = target.dataset.platformValue || "";
        if (form && platformValue) {
          state.platformSelections[category] = platformValue;
          const platformInput = form.querySelector('[name="platform"]');
          if (platformInput) {
            platformInput.value = platformValue;
          }
        }
        syncAccountFormPlatformState(form, platformValue);
        break;
      }
      case "add-custom-field-row": {
        const list = document.querySelector("#customFieldList");
        if (list) {
          list.classList.remove("is-hidden");
          list.insertAdjacentHTML("beforeend", renderCustomFieldRow({ field: { id: uid("field"), visibility: "masked" } }));
        }
        break;
      }
      case "remove-custom-field-row":
        target.closest("[data-custom-field-row]")?.remove();
        break;
      case "load-import-file":
        document.querySelector('input[type="file"][data-import-file]')?.click();
        break;
      case "save-settings": {
        const modal = target.closest(".modal");
        const passphrase = modal?.querySelector('input[name="vaultPassphrase"]')?.value ?? "";
        const showArchived = modal?.querySelector('select[name="showArchived"]')?.value === "true";
        savePassphrase(passphrase);
        store.setSettings(state.ownerId, { showArchived, lastSeenAt: nowIso() });
        setToast("Settings saved", "Vault preferences were updated.", "success");
        closeModal();
        break;
      }
      case "copy-export-json":
        navigator.clipboard?.writeText(document.querySelector("#exportSnapshot")?.textContent ?? "");
        setToast("Copied", "Export JSON copied to clipboard.", "success");
        break;
      case "download-export-json": {
        const snapshot = document.querySelector("#exportSnapshot")?.textContent ?? "";
        const blob = new Blob([snapshot], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "socialx-vault.json";
        anchor.click();
        URL.revokeObjectURL(url);
        break;
      }
      default:
        break;
    }
  });

  document.addEventListener("input", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (!action) return;

    if (action === "search") {
      state.search = target.value;
      updateSearchView();
    }
    if (action === "filter-platform") {
      state.filters.platform = target.value;
      render();
    }
    if (action === "filter-status") {
      state.filters.status = target.value;
      render();
    }
    if (action === "filter-sort") {
      state.filters.sort = target.value;
      render();
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === "accountForm") {
      event.preventDefault();
      const route = getRoute();
      const editorAccountId = route.name === "account-edit" ? route.accountId : null;
      const mode = route.name === "account-edit" ? "edit" : "create";
      const warnings = await evaluateDuplicates(form, editorAccountId ?? null);
      if (warnings.length && !confirm("Possible duplicates were found. Save anyway?")) {
        return;
      }
      await submitAccountForm(form, mode, editorAccountId ?? null);
    }
    if (form.id === "importForm") {
      event.preventDefault();
      const text = new FormData(form).get("snapshot")?.toString() ?? "";
      try {
        const parsed = JSON.parse(text);
        store.importOwner(state.ownerId, parsed, state.ownerId);
        await store.syncOwner(state.ownerId);
        setToast("Import complete", "Vault snapshot restored successfully.", "success");
        goToDashboard();
        render();
      } catch (error) {
        setToast("Import failed", "The JSON could not be parsed.", "danger");
      }
    }
  });

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('[name="anchorAccountId"], [name="platformCategory"]')) {
      const form = target.closest("form");
      syncAccountFormLinkState(form);
      syncAccountFormPlatformState(form);
      return;
    }
    if (target.matches('input[type="file"][data-import-file]')) {
      const file = target.files?.[0];
      if (file) {
        const text = await file.text();
        const textarea = document.querySelector('#importForm textarea[name="snapshot"]');
        if (textarea) {
          textarea.value = text;
          setToast("File loaded", "The imported JSON was loaded into the form.", "success");
        }
      }
      return;
    }
    if (target.matches('input[name="vaultPassphrase"]')) {
      savePassphrase(target.value);
      return;
    }
    if (target.matches('[name="anchorAccountId"], [name="platformCategory"]')) {
      const form = target.closest("form");
      syncAccountFormLinkState(form);
      syncAccountFormPlatformState(form);
      return;
    }
    if (target.matches('select[name="showArchived"]')) {
      store.setSettings(state.ownerId, { showArchived: target.value === "true" });
      await store.syncOwner(state.ownerId);
      render();
      return;
    }
    if (target.matches("[data-custom-field-row] input, [data-custom-field-row] select")) {
      const form = target.closest("form");
      if (form) {
        const route = getRoute();
        await evaluateDuplicates(form, route.name === "account-edit" ? route.accountId : null);
      }
      return;
    }
  });

  window.addEventListener("hashchange", () => {
    syncRoute();
    render();
  });
}

async function initialize() {
  bindGlobalEvents();
  await bootstrapAuth();
  syncRoute();
  render();
}

initialize();


