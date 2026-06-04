import { config, getAppOrigin } from "./config.js";
import {
  FIELD_VISIBILITY,
  PLATFORM_OPTIONS,
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
import { encryptSecret } from "./crypto.js";

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
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const parentIds = [...form.querySelectorAll('[name="parentIds"]:checked')].map((input) => input.value);
  const childIds = [...form.querySelectorAll('[name="childIds"]:checked')].map((input) => input.value);
  const customFields = [...form.querySelectorAll("[data-custom-field-row]")].map((row) => ({
    fieldId: row.dataset.fieldId || "",
    name: row.querySelector('[name="customFieldName"]')?.value ?? "",
    valueText: row.querySelector('[name="customFieldValue"]')?.value ?? "",
    valueType: row.querySelector('[name="customFieldType"]')?.value ?? "text",
    visibility: row.querySelector('[name="customFieldVisibility"]')?.value ?? "private",
    searchable: row.querySelector('[name="customFieldSearchable"]')?.checked ?? true
  }));

  return {
    platform: formData.get("platform")?.toString() ?? "Custom",
    accountType: formData.get("accountType")?.toString() ?? "Custom",
    label: formData.get("label")?.toString() ?? "",
    mainEmail: formData.get("mainEmail")?.toString() ?? "",
    username: formData.get("username")?.toString() ?? "",
    secretValue: formData.get("secretValue")?.toString() ?? "",
    status: formData.get("status")?.toString() ?? "active",
    notes: formData.get("notes")?.toString() ?? "",
    favorite: formData.get("favorite") === "on",
    archived: formData.get("archived") === "on",
    tags,
    relationshipType: formData.get("relationshipType")?.toString() ?? "anchor",
    relationshipNote: formData.get("relationshipNote")?.toString() ?? "",
    parentIds,
    childIds,
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
    secretRecord,
    customFields
  };

  if (mode === "create") {
    const account = store.createAccount(state.ownerId, state.ownerId, payload);
    state.selectedAccountId = account.id;
    setToast("Account created", `${account.label} is now part of your vault.`, "success");
  } else {
    const account = store.updateAccount(state.ownerId, state.ownerId, accountId, payload);
    state.selectedAccountId = account.id;
    setToast("Account updated", `${account.label} was saved successfully.`, "success");
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
            <div class="brand-mark">Sx</div>
            <div class="brand-title">
              <strong>${escapeHtml(config.appName)}</strong>
              <span>Simple account organizer</span>
            </div>
          </div>
          <h1>Keep all my trash accounts in one place.</h1>
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
  const tags = [...new Set(owner.accounts.flatMap((account) => account.tags ?? []))].sort();
  const linkedOptions = owner.accounts;
  return `
    <section class="filter-bar">
      <div class="filter-group">
        <select data-action="filter-platform">
          <option value="all">All platforms</option>
          ${platformSet.map((platform) => `<option value="${escapeHtml(platform)}" ${state.filters.platform === platform ? "selected" : ""}>${escapeHtml(platform)}</option>`).join("")}
        </select>
        <select data-action="filter-status">
          <option value="all">All statuses</option>
          ${STATUS_OPTIONS.map((status) => `<option value="${escapeHtml(status)}" ${state.filters.status === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
        </select>
        <select data-action="filter-archived">
          <option value="active" ${state.filters.archived === "active" ? "selected" : ""}>Active</option>
          <option value="archived" ${state.filters.archived === "archived" ? "selected" : ""}>Archived</option>
          <option value="all" ${state.filters.archived === "all" ? "selected" : ""}>All</option>
        </select>
        <select data-action="filter-favorite">
          <option value="all" ${state.filters.favorite === "all" ? "selected" : ""}>All favorites</option>
          <option value="favorite" ${state.filters.favorite === "favorite" ? "selected" : ""}>Favorites</option>
          <option value="normal" ${state.filters.favorite === "normal" ? "selected" : ""}>Not favorites</option>
        </select>
        <select data-action="filter-linked">
          <option value="all">All linked identities</option>
          ${linkedOptions.map((account) => `<option value="${escapeHtml(account.id)}" ${state.filters.linkedTo === account.id ? "selected" : ""}>${escapeHtml(account.label)}</option>`).join("")}
        </select>
        <select data-action="filter-sort">
          <option value="updated_desc" ${state.filters.sort === "updated_desc" ? "selected" : ""}>Recently updated</option>
          <option value="newest" ${state.filters.sort === "newest" ? "selected" : ""}>Newest</option>
          <option value="alpha" ${state.filters.sort === "alpha" ? "selected" : ""}>Alphabetical</option>
          <option value="status" ${state.filters.sort === "status" ? "selected" : ""}>Status</option>
          <option value="platform" ${state.filters.sort === "platform" ? "selected" : ""}>Platform</option>
        </select>
        <input data-action="filter-tag" value="${escapeHtml(state.filters.tag)}" placeholder="Tag" />
      </div>
      <div class="filter-group chips">
        ${renderChip("All", state.search === "" && state.filters.platform === "all", "preset-filter", "all")}
        ${renderChip("Favorites", state.filters.favorite === "favorite", "preset-filter", "favorite")}
        ${renderChip("Archived", state.filters.archived === "archived", "preset-filter", "archived")}
        ${tags.map((tag) => renderChip(`#${tag}`, normalizeText(state.filters.tag) === normalizeText(tag), "tag-filter", tag)).join("")}
      </div>
    </section>
  `;
}

function renderAccountCard(account, query) {
  const owner = currentOwnerState();
  const relationships = owner?.accountRelationships ?? [];
  const parents = relationships.filter((relation) => relation.childAccountId === account.id);
  const children = relationships.filter((relation) => relation.parentAccountId === account.id);
  const customFields = owner?.customFieldValues
    ?.filter((value) => value.accountId === account.id)
    .map((value) => ({
      field: owner.customFields.find((field) => field.id === value.fieldId),
      value
    }))
    .filter((entry) => entry.field) ?? [];
  const notesPreview = account.notes ? account.notes.slice(0, 110) : "No notes yet.";
  const badgeClass =
    account.status === "active"
      ? "good"
      : account.status === "archived"
        ? "warn"
        : account.status === "locked"
          ? "danger"
          : "";

  return `
    <article class="account-card ${state.selectedAccountId === account.id ? "is-selected" : ""}" data-action="select-account" data-id="${escapeHtml(account.id)}">
      <div class="account-card-header">
        <div class="account-title">
          <strong>${highlightMatch(account.label, query)}</strong>
          <span>${highlightMatch(account.mainEmail || "No email on file", query)}</span>
        </div>
        <div class="badge-row">
          <span class="badge platform">${escapeHtml(account.platform)}</span>
          <span class="badge ${badgeClass}">${escapeHtml(account.status)}</span>
          ${account.favorite ? '<span class="badge good">Favorite</span>' : ""}
          ${account.archived ? '<span class="badge warn">Archived</span>' : ""}
        </div>
      </div>
      <div class="account-preview">
        <div class="meta-line">${highlightMatch(account.username || "No username", query)}</div>
        <div class="meta-line">${highlightMatch(notesPreview, query)}</div>
        <div class="badge-row">
          ${parents
            .slice(0, 2)
            .map((relation) => {
              const linked = owner?.accounts.find((candidate) => candidate.id === relation.parentAccountId);
              return linked ? `<span class="badge">Parent: ${escapeHtml(linked.label)}</span>` : "";
            })
            .join("")}
          ${children
            .slice(0, 2)
            .map((relation) => {
              const linked = owner?.accounts.find((candidate) => candidate.id === relation.childAccountId);
              return linked ? `<span class="badge">Child: ${escapeHtml(linked.label)}</span>` : "";
            })
            .join("")}
        </div>
        <div class="badge-row">
          ${customFields
            .slice(0, 3)
            .map((entry) => {
              const valueText = entry.value.valueText || (entry.value.encryptedValue ? "Encrypted" : "—");
              return `<span class="badge">${escapeHtml(entry.field.name)}: ${escapeHtml(valueText)}</span>`;
            })
            .join("")}
        </div>
        <div class="meta-line">Updated ${escapeHtml(formatRelative(account.updatedAt))}</div>
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
          Try clearing a filter or add a new account. SocialX supports dynamic custom fields, linked parents,
          child accounts, and archive-first organization.
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
  const secretPreview = enriched.secretRecord ? "Encrypted" : "None";

  return `
    <div class="drawer drawer-compact">
      <div class="drawer-head">
        <div class="topbar-left compact">
          <div class="avatar">${escapeHtml(getInitials(enriched.label))}</div>
          <div>
            <h2>${escapeHtml(enriched.label)}</h2>
            <div class="meta-line">${escapeHtml(enriched.platform)} · ${escapeHtml(enriched.status)}</div>
          </div>
        </div>
        <div class="badge-row">
          <span class="badge ${enriched.favorite ? "good" : ""}">${enriched.favorite ? "Favorite" : "Normal"}</span>
          <span class="badge ${enriched.archived ? "warn" : "good"}">${enriched.archived ? "Archived" : "Active"}</span>
        </div>
      </div>
      <div class="drawer-grid compact">
        <div class="kv"><div class="key">Main email</div><div class="val">${escapeHtml(enriched.mainEmail || "—")}</div></div>
        <div class="kv"><div class="key">Username</div><div class="val">${escapeHtml(enriched.username || "—")}</div></div>
        <div class="kv"><div class="key">Secret</div><div class="val">${escapeHtml(secretPreview)}</div></div>
        <div class="kv"><div class="key">Updated</div><div class="val">${escapeHtml(formatRelative(enriched.updatedAt))}</div></div>
      </div>
      <div class="inline-actions compact">
        <button class="secondary-button" data-action="copy-text" data-value="${escapeHtml(enriched.mainEmail || "")}" data-label="email">Copy email</button>
        <button class="secondary-button" data-action="copy-text" data-value="${escapeHtml(enriched.username || "")}" data-label="username">Copy username</button>
        <button class="secondary-button" data-action="open-edit" data-id="${escapeHtml(enriched.id)}">Edit</button>
        <button class="ghost-button" data-action="toggle-archive" data-id="${escapeHtml(enriched.id)}">${enriched.archived ? "Restore" : "Archive"}</button>
        <button class="danger-button" data-action="delete-account" data-id="${escapeHtml(enriched.id)}">Delete</button>
      </div>
    </div>
  `;
}

function renderTopbar(owner) {
  return `
    <header class="topbar">
      <div class="topbar-left">
        <div class="brand-mark">Sx</div>
        <div>
          <div class="title">${escapeHtml(config.appName)}</div>
          <div class="meta-line">${escapeHtml(state.session?.user?.email ?? "Signed in")}</div>
        </div>
      </div>
      <div class="search-wrap">
        <input
          class="search-input"
          type="search"
          placeholder="Search email, username, platform, notes, IDs, fields, and relationships..."
          value="${escapeHtml(state.search)}"
          data-action="search"
        />
      </div>
      <div class="topbar-actions">
        <button class="secondary-button" data-action="open-import">Import</button>
        <button class="secondary-button" data-action="open-export">Export</button>
        <button class="primary-button" data-action="open-create">Add account</button>
        <div class="avatar" title="${escapeHtml(state.session?.user?.email ?? "")}">${escapeHtml(getInitials(state.session?.user?.name ?? state.session?.user?.email ?? "U"))}</div>
        <button class="ghost-button" data-action="sign-out">Sign out</button>
      </div>
    </header>
  `;
}

function renderAccountForm(mode, account, owner) {
  const allAccounts = owner.accounts.filter((entry) => !account || entry.id !== account.id);
  const customRows =
    mode === "edit" && account?.customFields.length
      ? account.customFields
      : [
          {
            field: { id: uid("field"), name: "", valueType: "text", visibility: "private", searchable: true },
            valueText: ""
          }
        ];
  const parentIds = new Set(account?.parents?.map((entry) => entry.account?.id).filter(Boolean) ?? []);
  const childIds = new Set(account?.children?.map((entry) => entry.account?.id).filter(Boolean) ?? []);

  return `
    ${
      state.duplicateWarnings.length
        ? `<div class="note-box" style="margin-bottom: 14px;">
            <strong>Possible duplicates</strong><br />
            ${state.duplicateWarnings.map((warning) => `â€¢ ${escapeHtml(warning)}`).join("<br />")}
          </div>`
        : ""
    }

    <form id="accountForm">
      <div class="form-grid">
        <div class="form-field">
          <label>Main email or Google email</label>
          <input name="mainEmail" placeholder="name@example.com" value="${escapeHtml(account?.mainEmail ?? "")}" />
        </div>
        <div class="form-field">
          <label>Platform / type</label>
          <select name="platform">
            ${PLATFORM_OPTIONS.map((platform) => `<option value="${escapeHtml(platform)}" ${(account?.platform ?? "Google") === platform ? "selected" : ""}>${escapeHtml(platform)}</option>`).join("")}
          </select>
        </div>
        <div class="form-field">
          <label>Label / title</label>
          <input name="label" placeholder="Primary Google, Steam main, PAG-IBIG account..." value="${escapeHtml(account?.label ?? "")}" />
        </div>
        <div class="form-field">
          <label>Account type</label>
          <input name="accountType" placeholder="personal, work, government, gaming..." value="${escapeHtml(account?.accountType ?? "")}" />
        </div>
        <div class="form-field">
          <label>Username</label>
          <input name="username" placeholder="@handle / account username" value="${escapeHtml(account?.username ?? "")}" />
        </div>
        <div class="form-field">
          <label>Password or secret label</label>
          <input name="secretValue" type="password" placeholder="Stored encrypted if provided" />
        </div>
        <div class="form-field">
          <label>Status</label>
          <select name="status">
            ${STATUS_OPTIONS.map((status) => `<option value="${escapeHtml(status)}" ${(account?.status ?? "active") === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
          </select>
        </div>
        <div class="form-field">
          <label>Tags</label>
          <input name="tags" placeholder="personal, finance, government" value="${escapeHtml((account?.tags ?? []).join(", "))}" />
        </div>
        <div class="form-field full">
          <label>Notes</label>
          <textarea name="notes" rows="4" placeholder="Context, recovery notes, linked email pattern...">${escapeHtml(account?.notes ?? "")}</textarea>
        </div>
        <div class="form-field full">
          <label>Relationship type for links</label>
          <select name="relationshipType">
            ${RELATIONSHIP_TYPES.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}
          </select>
        </div>
        <div class="form-field full">
          <label>Relationship notes</label>
          <textarea name="relationshipNote" rows="2" placeholder="Optional note applied to the relationships created by this record."></textarea>
        </div>
      </div>

      <div class="stack" style="margin-top: 16px;">
        <div class="relationship-box">
          <h3 class="section-title">Parent links</h3>
          <div class="scroll-list">
            ${allAccounts
              .map(
                (entry) => `
                  <label class="linked-item">
                    <input type="checkbox" name="parentIds" value="${escapeHtml(entry.id)}" ${parentIds.has(entry.id) ? "checked" : ""} />
                    <span>${escapeHtml(entry.label)} <span class="muted">(${escapeHtml(entry.platform)})</span></span>
                    <span class="badge">${escapeHtml(entry.status)}</span>
                  </label>
                `
              )
              .join("")}
          </div>
        </div>

        <div class="relationship-box">
          <h3 class="section-title">Child links</h3>
          <div class="scroll-list">
            ${allAccounts
              .map(
                (entry) => `
                  <label class="linked-item">
                    <input type="checkbox" name="childIds" value="${escapeHtml(entry.id)}" ${childIds.has(entry.id) ? "checked" : ""} />
                    <span>${escapeHtml(entry.label)} <span class="muted">(${escapeHtml(entry.platform)})</span></span>
                    <span class="badge">${escapeHtml(entry.status)}</span>
                  </label>
                `
              )
              .join("")}
          </div>
        </div>

        <div class="custom-field-box">
          <div class="list-toolbar">
            <h3 class="section-title">Custom fields</h3>
            <button class="ghost-button" type="button" data-action="add-custom-field-row">Add custom field</button>
          </div>
          <div class="custom-field-list" id="customFieldList">
            ${
              customRows
                .map(
                  (row) => `
                    <div class="custom-field-item" data-custom-field-row data-field-id="${escapeHtml(row.field?.id ?? row.fieldId ?? "")}">
                      <input name="customFieldName" placeholder="Field name" value="${escapeHtml(row.field?.name ?? row.name ?? "")}" />
                      <input name="customFieldValue" placeholder="Field value" value="${escapeHtml(row.valueText ?? "")}" />
                      <select name="customFieldType">
                        <option value="text" ${escapeHtml(row.field?.valueType ?? "text") === "text" ? "selected" : ""}>text</option>
                        <option value="number" ${escapeHtml(row.field?.valueType ?? "text") === "number" ? "selected" : ""}>number</option>
                        <option value="boolean" ${escapeHtml(row.field?.valueType ?? "text") === "boolean" ? "selected" : ""}>boolean</option>
                        <option value="json" ${escapeHtml(row.field?.valueType ?? "text") === "json" ? "selected" : ""}>json</option>
                        <option value="secret" ${escapeHtml(row.field?.valueType ?? "text") === "secret" ? "selected" : ""}>secret</option>
                      </select>
                      <select name="customFieldVisibility">
                        ${FIELD_VISIBILITY.map((visibility) => `<option value="${escapeHtml(visibility)}" ${(row.field?.visibility ?? "private") === visibility ? "selected" : ""}>${escapeHtml(visibility)}</option>`).join("")}
                      </select>
                      <label class="checkbox-row">
                        <input name="customFieldSearchable" type="checkbox" ${row.field?.searchable === false ? "" : "checked"} />
                        <span>Searchable</span>
                      </label>
                      <button class="danger-button" type="button" data-action="remove-custom-field-row">Remove</button>
                    </div>
                  `
                )
                .join("")
            }
          </div>
        </div>

        <div class="checkbox-row">
          <label class="checkbox-row"><input type="checkbox" name="favorite" ${account?.favorite ? "checked" : ""} /><span>Favorite</span></label>
          <label class="checkbox-row"><input type="checkbox" name="archived" ${account?.archived ? "checked" : ""} /><span>Archived</span></label>
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
  const allAccounts = owner.accounts.filter((entry) => !account || entry.id !== account.id);
  const customRows = mode === "edit" && account?.customFields.length
    ? account.customFields
    : [
        {
          field: { id: uid("field"), name: "", valueType: "text", visibility: "private", searchable: true },
          valueText: ""
        }
      ];
  const parentIds = new Set(account?.parents?.map((entry) => entry.account?.id).filter(Boolean) ?? []);
  const childIds = new Set(account?.children?.map((entry) => entry.account?.id).filter(Boolean) ?? []);

  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="accountModalTitle">
        <div class="modal-head">
          <div>
            <h2 id="accountModalTitle">${escapeHtml(title)}</h2>
            <div class="meta-line">Use the form to add the account, linked identities, and any custom fields.</div>
          </div>
          <button class="icon-button" data-action="close-modal" aria-label="Close">×</button>
        </div>

        ${
          state.duplicateWarnings.length
            ? `<div class="note-box" style="margin-bottom: 14px;">
                <strong>Possible duplicates</strong><br />
                ${state.duplicateWarnings.map((warning) => `• ${escapeHtml(warning)}`).join("<br />")}
              </div>`
            : ""
        }

        <form id="accountForm">
          <div class="form-grid">
            <div class="form-field">
              <label>Main email or Google email</label>
              <input name="mainEmail" placeholder="name@example.com" value="${escapeHtml(account?.mainEmail ?? "")}" />
            </div>
            <div class="form-field">
              <label>Platform / type</label>
              <select name="platform">
                ${PLATFORM_OPTIONS.map((platform) => `<option value="${escapeHtml(platform)}" ${(account?.platform ?? "Google") === platform ? "selected" : ""}>${escapeHtml(platform)}</option>`).join("")}
              </select>
            </div>
            <div class="form-field">
              <label>Label / title</label>
              <input name="label" placeholder="Primary Google, Steam main, PAG-IBIG account..." value="${escapeHtml(account?.label ?? "")}" />
            </div>
            <div class="form-field">
              <label>Account type</label>
              <input name="accountType" placeholder="personal, work, government, gaming..." value="${escapeHtml(account?.accountType ?? "")}" />
            </div>
            <div class="form-field">
              <label>Username</label>
              <input name="username" placeholder="@handle / account username" value="${escapeHtml(account?.username ?? "")}" />
            </div>
            <div class="form-field">
              <label>Password or secret label</label>
              <input name="secretValue" type="password" placeholder="Stored encrypted if provided" />
            </div>
            <div class="form-field">
              <label>Status</label>
              <select name="status">
                ${STATUS_OPTIONS.map((status) => `<option value="${escapeHtml(status)}" ${(account?.status ?? "active") === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
              </select>
            </div>
            <div class="form-field">
              <label>Tags</label>
              <input name="tags" placeholder="personal, finance, government" value="${escapeHtml((account?.tags ?? []).join(", "))}" />
            </div>
            <div class="form-field full">
              <label>Notes</label>
              <textarea name="notes" rows="4" placeholder="Context, recovery notes, linked email pattern...">${escapeHtml(account?.notes ?? "")}</textarea>
            </div>
            <div class="form-field full">
              <label>Relationship type for links</label>
              <select name="relationshipType">
                ${RELATIONSHIP_TYPES.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}
              </select>
            </div>
            <div class="form-field full">
              <label>Relationship notes</label>
              <textarea name="relationshipNote" rows="2" placeholder="Optional note applied to the relationships created by this record."></textarea>
            </div>
          </div>

          <div class="stack" style="margin-top: 16px;">
            <div class="relationship-box">
              <h3 class="section-title">Parent links</h3>
              <div class="scroll-list">
                ${allAccounts
                  .map(
                    (entry) => `
                      <label class="linked-item">
                        <input type="checkbox" name="parentIds" value="${escapeHtml(entry.id)}" ${parentIds.has(entry.id) ? "checked" : ""} />
                        <span>${escapeHtml(entry.label)} <span class="muted">(${escapeHtml(entry.platform)})</span></span>
                        <span class="badge">${escapeHtml(entry.status)}</span>
                      </label>
                    `
                  )
                  .join("")}
              </div>
            </div>

            <div class="relationship-box">
              <h3 class="section-title">Child links</h3>
              <div class="scroll-list">
                ${allAccounts
                  .map(
                    (entry) => `
                      <label class="linked-item">
                        <input type="checkbox" name="childIds" value="${escapeHtml(entry.id)}" ${childIds.has(entry.id) ? "checked" : ""} />
                        <span>${escapeHtml(entry.label)} <span class="muted">(${escapeHtml(entry.platform)})</span></span>
                        <span class="badge">${escapeHtml(entry.status)}</span>
                      </label>
                    `
                  )
                  .join("")}
              </div>
            </div>

            <div class="custom-field-box">
              <div class="list-toolbar">
                <h3 class="section-title">Custom fields</h3>
                <button class="ghost-button" type="button" data-action="add-custom-field-row">Add custom field</button>
              </div>
              <div class="custom-field-list" id="customFieldList">
                ${
                  customRows
                    .map(
                      (row) => `
                        <div class="custom-field-item" data-custom-field-row data-field-id="${escapeHtml(row.field?.id ?? row.fieldId ?? "")}">
                          <input name="customFieldName" placeholder="Field name" value="${escapeHtml(row.field?.name ?? row.name ?? "")}" />
                          <input name="customFieldValue" placeholder="Field value" value="${escapeHtml(row.valueText ?? "")}" />
                          <select name="customFieldType">
                            <option value="text" ${escapeHtml(row.field?.valueType ?? "text") === "text" ? "selected" : ""}>text</option>
                            <option value="number" ${escapeHtml(row.field?.valueType ?? "text") === "number" ? "selected" : ""}>number</option>
                            <option value="boolean" ${escapeHtml(row.field?.valueType ?? "text") === "boolean" ? "selected" : ""}>boolean</option>
                            <option value="json" ${escapeHtml(row.field?.valueType ?? "text") === "json" ? "selected" : ""}>json</option>
                            <option value="secret" ${escapeHtml(row.field?.valueType ?? "text") === "secret" ? "selected" : ""}>secret</option>
                          </select>
                          <select name="customFieldVisibility">
                            ${FIELD_VISIBILITY.map((visibility) => `<option value="${escapeHtml(visibility)}" ${(row.field?.visibility ?? "private") === visibility ? "selected" : ""}>${escapeHtml(visibility)}</option>`).join("")}
                          </select>
                          <label class="checkbox-row">
                            <input name="customFieldSearchable" type="checkbox" ${row.field?.searchable === false ? "" : "checked"} />
                            <span>Searchable</span>
                          </label>
                          <button class="danger-button" type="button" data-action="remove-custom-field-row">Remove</button>
                        </div>
                      `
                    )
                    .join("")
                }
              </div>
            </div>

            <div class="checkbox-row">
              <label class="checkbox-row"><input type="checkbox" name="favorite" ${account?.favorite ? "checked" : ""} /><span>Favorite</span></label>
              <label class="checkbox-row"><input type="checkbox" name="archived" ${account?.archived ? "checked" : ""} /><span>Archived</span></label>
            </div>
          </div>

          <div class="form-actions">
            <button class="secondary-button" type="button" data-action="close-modal">Cancel</button>
            <button class="primary-button" type="submit">${mode === "edit" ? "Save changes" : "Create account"}</button>
          </div>
        </form>
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
          <button class="icon-button" data-action="close-modal" aria-label="Close">×</button>
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
          <button class="icon-button" data-action="close-modal" aria-label="Close">×</button>
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
    app.innerHTML = `
      <main class="app-shell hero">
        <section class="hero-card">
          <div class="hero-copy">
            <div class="brand">
              <div class="brand-mark">Sx</div>
              <div class="brand-title">
                <strong>${escapeHtml(config.appName)}</strong>
                <span>Loading secure auth and vault state</span>
              </div>
            </div>
            <h1>Preparing your identity graph.</h1>
            <p>Please wait while SocialX checks your Neon Auth session and loads the vault workspace.</p>
          </div>
          <aside class="sign-in-card">
            <div class="note-box">If auth fails, confirm the hosted Neon Auth URL and trusted domains are set correctly.</div>
          </aside>
        </section>
      </main>
    `;
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
              <button class="icon-button" data-action="close-modal" aria-label="Close">×</button>
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
      case "preset-filter":
        if (value === "all") {
          state.filters.platform = "all";
          state.filters.favorite = "all";
          state.filters.archived = "active";
        }
        if (value === "favorite") {
          state.filters.favorite = "favorite";
        }
        if (value === "archived") {
          state.filters.archived = "archived";
        }
        render();
        break;
      case "tag-filter":
        state.filters.tag = value;
        render();
        break;
      case "add-custom-field-row": {
        const list = document.querySelector("#customFieldList");
        if (list) {
          list.insertAdjacentHTML(
            "beforeend",
            `
              <div class="custom-field-item" data-custom-field-row data-field-id="">
                <input name="customFieldName" placeholder="Field name" />
                <input name="customFieldValue" placeholder="Field value" />
                <select name="customFieldType">
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json">json</option>
                  <option value="secret">secret</option>
                </select>
                <select name="customFieldVisibility">
                  ${FIELD_VISIBILITY.map((visibility) => `<option value="${escapeHtml(visibility)}">${escapeHtml(visibility)}</option>`).join("")}
                </select>
                <label class="checkbox-row">
                  <input name="customFieldSearchable" type="checkbox" checked />
                  <span>Searchable</span>
                </label>
                <button class="danger-button" type="button" data-action="remove-custom-field-row">Remove</button>
              </div>
            `
          );
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
    if (action === "filter-archived") {
      state.filters.archived = target.value;
      render();
    }
    if (action === "filter-sort") {
      state.filters.sort = target.value;
      render();
    }
    if (action === "filter-favorite") {
      state.filters.favorite = target.value;
      render();
    }
    if (action === "filter-linked") {
      state.filters.linkedTo = target.value;
      render();
    }
    if (action === "filter-tag") {
      state.filters.tag = target.value;
      updateSearchView();
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
    if (target.matches('select[name="showArchived"]')) {
      store.setSettings(state.ownerId, { showArchived: target.value === "true" });
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
