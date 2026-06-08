import { getNeonDataClient } from "./neon.js";
import {
  compact,
  nowIso,
  normalizeText,
  normalizePlatformCategory,
  safeJsonParse,
  uid
} from "./domain.js";

const STORAGE_KEY = "socialx:owners:v2";

const clone = globalThis.structuredClone
  ? (value) => globalThis.structuredClone(value)
  : (value) => JSON.parse(JSON.stringify(value));

function normalizeIdentityKey(value = "") {
  return normalizeText(value).toLowerCase();
}

function normalizeCustomPlatforms(value = {}) {
  const groups = {
    social: [],
    bank: [],
    government: []
  };
  for (const group of Object.keys(groups)) {
    const entries = Array.isArray(value?.[group]) ? value[group] : [];
    groups[group] = [...new Set(entries.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
  }
  return groups;
}

function mergeCustomPlatforms(base = {}, incoming = {}) {
  const groups = {
    social: [],
    bank: [],
    government: []
  };
  for (const group of Object.keys(groups)) {
    const entries = [
      ...(Array.isArray(base?.[group]) ? base[group] : []),
      ...(Array.isArray(incoming?.[group]) ? incoming[group] : [])
    ];
    groups[group] = [...new Set(entries.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
  }
  return groups;
}

function normalizeSettings(value = {}) {
  return {
    vaultPassphrase: value.vaultPassphrase ?? "",
    showArchived: Boolean(value.showArchived ?? false),
    lastSeenAt: value.lastSeenAt ?? null,
    customPlatforms: normalizeCustomPlatforms(value.customPlatforms ?? {})
  };
}

function createEmptyOwnerState(ownerId) {
  return {
    profile: {
      ownerId,
      canonicalKey: ownerId,
      googleSubject: "",
      googleEmail: "",
      displayName: "",
      email: "",
      avatarUrl: ""
    },
    accounts: [],
    accountRelationships: [],
    customFields: [],
    customFieldValues: [],
    activityLog: [],
    settings: {
      vaultPassphrase: "",
      showArchived: false,
      lastSeenAt: null,
      customPlatforms: normalizeCustomPlatforms()
    },
    sync: {
      remoteEnabled: false,
      lastSyncAt: null,
      lastSyncError: null,
      source: "localStorage"
    }
  };
}

function readAll() {
  if (typeof localStorage === "undefined") {
    return { owners: {} };
  }

  const parsed = safeJsonParse(localStorage.getItem(STORAGE_KEY), null);
  if (!parsed) {
    return { owners: {} };
  }

  if (parsed.owners) {
    return parsed;
  }

  if (parsed.profile || parsed.accounts || parsed.accountRelationships) {
    const ownerId = parsed.profile?.ownerId ?? parsed.ownerId ?? "local";
    return {
      owners: {
        [ownerId]: parsed
      }
    };
  }

  return { owners: {} };
}

function writeAll(data) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function rowToAccount(row) {
  return {
    id: row.id,
    ownerId: row.owner_auth_user_id,
    platform: row.platform ?? "Custom",
    accountType: row.account_type ?? row.platform ?? "custom",
    label: row.label ?? "Untitled account",
    mainEmail: row.main_email ?? "",
    username: row.username ?? "",
    secretRecord: row.secret_ciphertext
      ? {
          ciphertext: row.secret_ciphertext ?? "",
          iv: row.secret_iv ?? "",
          salt: row.secret_salt ?? "",
          mode: row.secret_mode ?? "aes-gcm"
        }
      : null,
    status: row.status ?? "active",
    notes: row.notes ?? "",
    favorite: Boolean(row.favorite),
    archived: Boolean(row.archived),
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.created_at ?? nowIso(),
    updatedAt: row.updated_at ?? nowIso(),
    lastAccessedAt: row.last_accessed_at ?? null,
    searchBlob: ""
  };
}

function rowToUser(row) {
  const settings = typeof row.settings_json === "string" ? safeJsonParse(row.settings_json, {}) : row.settings_json ?? {};
  return {
    canonicalKey: row.canonical_key ?? row.auth_user_id ?? "",
    googleSubject: row.google_subject ?? "",
    googleEmail: row.google_email ?? "",
    displayName: row.display_name ?? "",
    email: row.email ?? "",
    avatarUrl: row.avatar_url ?? "",
    settings: normalizeSettings(settings)
  };
}

function userToRow(ownerId, snapshot) {
  return {
    auth_user_id: ownerId,
    canonical_key: snapshot.profile?.canonicalKey ?? ownerId,
    google_subject: snapshot.profile?.googleSubject ?? null,
    google_email: snapshot.profile?.googleEmail ?? null,
    display_name: snapshot.profile.displayName ?? "",
    email: snapshot.profile.email ?? "",
    avatar_url: snapshot.profile.avatarUrl ?? "",
    settings_json: snapshot.settings ?? {}
  };
}

function accountToRow(ownerId, account) {
  return {
    id: account.id,
    owner_auth_user_id: ownerId,
    platform: account.platform ?? "Custom",
    account_type: account.accountType ?? account.platform ?? "custom",
    label: account.label ?? "Untitled account",
    main_email: account.mainEmail ?? "",
    username: account.username ?? "",
    secret_ciphertext: account.secretRecord?.ciphertext ?? null,
    secret_iv: account.secretRecord?.iv ?? null,
    secret_salt: account.secretRecord?.salt ?? null,
    secret_mode: account.secretRecord?.mode ?? "aes-gcm",
    status: account.status ?? "active",
    notes: account.notes ?? "",
    favorite: Boolean(account.favorite),
    archived: Boolean(account.archived),
    tags: Array.isArray(account.tags) ? account.tags : [],
    created_at: account.createdAt ?? nowIso(),
    updated_at: account.updatedAt ?? nowIso(),
    last_accessed_at: account.lastAccessedAt ?? null
  };
}

function rowToCustomField(row) {
  return {
    id: row.id,
    ownerId: row.owner_auth_user_id,
    name: row.name ?? "Custom field",
    valueType: row.value_type ?? "text",
    visibility: row.visibility ?? "private",
    searchable: Boolean(row.searchable ?? true),
    createdAt: row.created_at ?? nowIso(),
    updatedAt: row.updated_at ?? nowIso()
  };
}

function customFieldToRow(ownerId, field) {
  return {
    id: field.id,
    owner_auth_user_id: ownerId,
    name: field.name ?? "Custom field",
    value_type: field.valueType ?? "text",
    visibility: field.visibility ?? "private",
    searchable: Boolean(field.searchable ?? true),
    created_at: field.createdAt ?? nowIso(),
    updated_at: field.updatedAt ?? nowIso()
  };
}

function rowToCustomFieldValue(row) {
  return {
    id: row.id,
    ownerId: row.owner_auth_user_id,
    accountId: row.account_id,
    fieldId: row.field_id,
    valueText: row.value_text ?? "",
    valueJson: row.value_json ?? null,
    encryptedValue: row.encrypted_value ? safeJsonParse(row.encrypted_value, row.encrypted_value) : null,
    createdAt: row.created_at ?? nowIso(),
    updatedAt: row.updated_at ?? nowIso()
  };
}

function customFieldValueToRow(ownerId, value) {
  return {
    id: value.id,
    owner_auth_user_id: ownerId,
    account_id: value.accountId,
    field_id: value.fieldId,
    value_text: value.valueText ?? "",
    value_json: value.valueJson ?? null,
    encrypted_value:
      value.encryptedValue && typeof value.encryptedValue === "object"
        ? JSON.stringify(value.encryptedValue)
        : value.encryptedValue ?? null,
    created_at: value.createdAt ?? nowIso(),
    updated_at: value.updatedAt ?? nowIso()
  };
}

function rowToRelationship(row) {
  return {
    id: row.id,
    ownerId: row.owner_auth_user_id,
    parentAccountId: row.parent_account_id,
    childAccountId: row.child_account_id,
    relationshipType: row.relationship_type ?? "custom",
    notes: row.notes ?? "",
    createdAt: row.created_at ?? nowIso(),
    updatedAt: row.updated_at ?? nowIso()
  };
}

function relationshipToRow(ownerId, relationship) {
  return {
    id: relationship.id,
    owner_auth_user_id: ownerId,
    parent_account_id: relationship.parentAccountId,
    child_account_id: relationship.childAccountId,
    relationship_type: relationship.relationshipType ?? "custom",
    notes: relationship.notes ?? "",
    created_at: relationship.createdAt ?? nowIso(),
    updated_at: relationship.updatedAt ?? nowIso()
  };
}

function rowToActivity(row) {
  return {
    id: row.id,
    ownerId: row.owner_auth_user_id,
    actorId: row.actor_auth_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    diff: row.diff ?? {},
    createdAt: row.created_at ?? nowIso()
  };
}

function activityToRow(ownerId, entry) {
  return {
    id: entry.id,
    owner_auth_user_id: ownerId,
    actor_auth_user_id: entry.actorId,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    action: entry.action,
    summary: entry.summary,
    diff: entry.diff ?? {},
    created_at: entry.createdAt ?? nowIso()
  };
}

function buildSearchBlob(owner, account) {
  const relationships = owner.accountRelationships
    .filter((relation) => relation.parentAccountId === account.id || relation.childAccountId === account.id)
    .map((relation) => `${relation.relationshipType} ${relation.notes}`)
    .join(" ");
  const customValues = owner.customFieldValues
    .filter((fieldValue) => fieldValue.accountId === account.id)
    .map((fieldValue) => {
      const field = owner.customFields.find((candidate) => candidate.id === fieldValue.fieldId);
      return [field?.name, fieldValue.valueText, fieldValue.valueJson ? JSON.stringify(fieldValue.valueJson) : ""]
        .filter(Boolean)
        .join(" ");
    })
    .join(" ");

  return compact(
    [
      account.platform,
      account.accountType,
      account.label,
      account.mainEmail,
      account.username,
      account.status,
      account.notes,
      (account.tags ?? []).join(" "),
      relationships,
      customValues
    ].join(" ")
  );
}

function rewriteSearchIndex(owner) {
  for (const account of owner.accounts) {
    account.searchBlob = buildSearchBlob(owner, account);
  }
  return owner;
}

function createActivity(owner, entry) {
  owner.activityLog.unshift({
    id: entry.id ?? uid("log"),
    ownerId: entry.ownerId,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    diff: entry.diff ?? {},
    createdAt: entry.createdAt ?? nowIso()
  });
}

function customFieldById(owner, id) {
  return owner.customFields.find((field) => field.id === id) ?? null;
}

function accountById(owner, id) {
  return owner.accounts.find((account) => account.id === id) ?? null;
}

function deriveAccountLabel(draft, fallback = "Account") {
  if (draft.linkMode === "linkedGoogle") {
    return (
      draft.username?.trim() ||
      draft.platform?.trim() ||
      draft.mainEmail?.trim() ||
      fallback
    );
  }

  return (
    draft.username?.trim() ||
    draft.mainEmail?.trim() ||
    draft.platform?.trim() ||
    fallback
  );
}

function resolveAnchorRelation(owner, accountId) {
  return owner.accountRelationships.find(
    (relation) => relation.childAccountId === accountId && relation.relationshipType === "anchor"
  ) ?? null;
}

function syncAnchorLink(owner, accountId, linkMode, anchorAccountId) {
  const existingAnchor = resolveAnchorRelation(owner, accountId);
  if (linkMode === "linkedGoogle" && existingAnchor?.parentAccountId === anchorAccountId) {
    return;
  }

  owner.accountRelationships = owner.accountRelationships.filter(
    (relation) => !(relation.childAccountId === accountId && relation.relationshipType === "anchor")
  );

  if (linkMode !== "linkedGoogle" || !anchorAccountId || anchorAccountId === accountId) {
    return;
  }

  const anchorAccount = accountById(owner, anchorAccountId);
  if (!anchorAccount || anchorAccount.platform !== "Google") {
    return;
  }

  owner.accountRelationships.unshift({
    id: uid("rel"),
    ownerId: owner.profile.ownerId,
    parentAccountId: anchorAccountId,
    childAccountId: accountId,
    relationshipType: "anchor",
    notes: "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

function normalizeOwnerSnapshot(ownerId, snapshot = {}) {
  const owner = createEmptyOwnerState(ownerId);
  owner.profile = {
    ...owner.profile,
    canonicalKey: snapshot.profile?.canonicalKey ?? snapshot.profile?.canonical_key ?? ownerId,
    googleSubject: snapshot.profile?.googleSubject ?? snapshot.profile?.google_subject ?? "",
    googleEmail: snapshot.profile?.googleEmail ?? snapshot.profile?.google_email ?? "",
    ...(snapshot.profile ?? {}),
    ownerId
  };
  owner.accounts = normalizeList(snapshot.accounts).map((account) => ({
    ...account,
    ownerId,
    searchBlob: account.searchBlob ?? ""
  }));
  owner.accountRelationships = normalizeList(snapshot.accountRelationships).map((relationship) => ({
    ...relationship,
    ownerId
  }));
  owner.customFields = normalizeList(snapshot.customFields).map((field) => ({
    ...field,
    ownerId
  }));
  owner.customFieldValues = normalizeList(snapshot.customFieldValues).map((value) => ({
    ...value,
    ownerId
  }));
  owner.activityLog = normalizeList(snapshot.activityLog).map((entry) => ({
    ...entry,
    ownerId
  }));
  owner.settings = {
    ...owner.settings,
    ...normalizeSettings(snapshot.settings ?? {})
  };
  owner.sync = {
    ...owner.sync,
    ...(snapshot.sync ?? {})
  };
  rewriteSearchIndex(owner);
  return owner;
}

function mergeOwnerSnapshots(baseOwner, incomingSnapshot) {
  const owner = clone(baseOwner);
  const incoming = normalizeOwnerSnapshot(owner.profile.ownerId, incomingSnapshot ?? {});

  owner.profile = {
    ...owner.profile,
    ...incoming.profile,
    ownerId: owner.profile.ownerId
  };
  owner.settings = {
    ...owner.settings,
    ...incoming.settings,
    customPlatforms: mergeCustomPlatforms(owner.settings.customPlatforms, incoming.settings.customPlatforms)
  };

  const mergeById = (existing = [], incomingList = []) => {
    const map = new Map();
    for (const item of existing) {
      if (item?.id) map.set(item.id, clone(item));
    }
    for (const item of incomingList) {
      if (item?.id) map.set(item.id, clone(item));
    }
    return [...map.values()];
  };

  owner.accounts = mergeById(owner.accounts, incoming.accounts);
  owner.accountRelationships = mergeById(owner.accountRelationships, incoming.accountRelationships);
  owner.customFields = mergeById(owner.customFields, incoming.customFields);
  owner.customFieldValues = mergeById(owner.customFieldValues, incoming.customFieldValues);
  owner.activityLog = mergeById(owner.activityLog, incoming.activityLog).sort(
    (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0)
  );
  owner.sync = {
    ...owner.sync,
    ...incoming.sync
  };
  rewriteSearchIndex(owner);
  return owner;
}

function duplicateWarnings(owner, draft, ignoreId = null) {
  const email = normalizeText(draft.mainEmail);
  const username = normalizeText(draft.username);
  const potential = [];

  for (const account of owner.accounts) {
    if (ignoreId && account.id === ignoreId) continue;
    if (email && normalizeText(account.mainEmail) === email) {
      potential.push(`Email already exists on ${account.label}`);
    }
    if (username && normalizeText(account.username) === username) {
      potential.push(`Username already exists on ${account.label}`);
    }
  }

  for (const customField of draft.customFields ?? []) {
    const fieldLabel = normalizeText(customField.name);
    const fieldValue = normalizeText(customField.valueText);
    if (!fieldLabel || !fieldValue) continue;
    for (const value of owner.customFieldValues) {
      const field = customFieldById(owner, value.fieldId);
      if (!field) continue;
      if (ignoreId && value.accountId === ignoreId) continue;
      if (normalizeText(field.name) === fieldLabel && normalizeText(value.valueText) === fieldValue) {
        potential.push(`Custom field "${customField.name}" matches another account`);
      }
    }
  }

  return [...new Set(potential)];
}

async function exec(query) {
  const response = await query;
  if (response?.error) {
    throw response.error;
  }
  return response?.data ?? response;
}

export function createStore() {
  const owners = new Map();
  const dirtyOwners = new Set();
  const flushTimers = new Map();
  const flushPromises = new Map();
  let localData = readAll();

  function getOwnerState(ownerId) {
    if (!owners.has(ownerId)) {
      const snapshot = localData.owners?.[ownerId] ?? createEmptyOwnerState(ownerId);
      owners.set(ownerId, normalizeOwnerSnapshot(ownerId, snapshot));
    }
    return owners.get(ownerId);
  }

  function saveLocalSnapshot() {
    const ownersObject = {};
    for (const [ownerId, owner] of owners.entries()) {
      ownersObject[ownerId] = clone(owner);
    }
    localData = { owners: ownersObject };
    writeAll(localData);
  }

  async function loadRemoteOwner(ownerId) {
    const client = await getNeonDataClient();
    if (!client) return null;

    try {
      const [userRows, accountRows, relationshipRows, fieldRows, valueRows, activityRows] = await Promise.all([
        exec(client.from("users").select("*").eq("auth_user_id", ownerId).limit(1)),
        exec(client.from("accounts").select("*").eq("owner_auth_user_id", ownerId).order("created_at", { ascending: false })),
        exec(client.from("account_relationships").select("*").eq("owner_auth_user_id", ownerId).order("created_at", { ascending: false })),
        exec(client.from("custom_fields").select("*").eq("owner_auth_user_id", ownerId).order("created_at", { ascending: false })),
        exec(client.from("custom_field_values").select("*").eq("owner_auth_user_id", ownerId).order("created_at", { ascending: false })),
        exec(client.from("activity_log").select("*").eq("owner_auth_user_id", ownerId).order("created_at", { ascending: false }))
      ]);

      const owner = createEmptyOwnerState(ownerId);
      const userRow = Array.isArray(userRows) ? userRows[0] : userRows;
      if (userRow) {
        const userProfile = rowToUser(userRow);
        owner.profile = {
          ownerId,
          canonicalKey: userProfile.canonicalKey ?? ownerId,
          googleSubject: userProfile.googleSubject ?? "",
          googleEmail: userProfile.googleEmail ?? "",
          displayName: userProfile.displayName,
          email: userProfile.email,
          avatarUrl: userProfile.avatarUrl
        };
        owner.settings = {
          ...owner.settings,
          ...userProfile.settings
        };
      }
      owner.accounts = normalizeList(accountRows).map(rowToAccount);
      owner.accountRelationships = normalizeList(relationshipRows).map(rowToRelationship);
      owner.customFields = normalizeList(fieldRows).map(rowToCustomField);
      owner.customFieldValues = normalizeList(valueRows).map(rowToCustomFieldValue);
      owner.activityLog = normalizeList(activityRows).map(rowToActivity);
      rewriteSearchIndex(owner);
      owner.sync = {
        remoteEnabled: Boolean(config.neonDataApiUrl),
        lastSyncAt: nowIso(),
        lastSyncError: null,
        source: "neon"
      };
      return owner;
    } catch (error) {
      const owner = getOwnerState(ownerId);
      owner.sync = {
        ...owner.sync,
        remoteEnabled: Boolean(config.neonDataApiUrl),
        lastSyncError: error?.message ?? String(error),
        source: owner.sync.source ?? "localStorage"
      };
      return null;
    }
  }

  async function flushOwner(ownerId) {
    if (flushPromises.has(ownerId)) {
      return flushPromises.get(ownerId);
    }

    const promise = (async () => {
      const client = await getNeonDataClient();
      const owner = owners.get(ownerId);
      if (!client || !owner) {
        saveLocalSnapshot();
        return false;
      }

      const snapshot = clone(owner);
      try {
        await exec(
          client.from("activity_log").delete().eq("owner_auth_user_id", ownerId)
        );
        await exec(client.from("custom_field_values").delete().eq("owner_auth_user_id", ownerId));
        await exec(client.from("custom_fields").delete().eq("owner_auth_user_id", ownerId));
        await exec(client.from("account_relationships").delete().eq("owner_auth_user_id", ownerId));
        await exec(client.from("accounts").delete().eq("owner_auth_user_id", ownerId));
        await exec(client.from("users").upsert(userToRow(ownerId, snapshot), { onConflict: "auth_user_id" }));

        if (snapshot.accounts.length) {
          await exec(client.from("accounts").insert(snapshot.accounts.map((account) => accountToRow(ownerId, account))));
        }

        if (snapshot.customFields.length) {
          await exec(
            client.from("custom_fields").insert(snapshot.customFields.map((field) => customFieldToRow(ownerId, field)))
          );
        }

        if (snapshot.accountRelationships.length) {
          await exec(
            client.from("account_relationships").insert(
              snapshot.accountRelationships.map((relationship) => relationshipToRow(ownerId, relationship))
            )
          );
        }

        if (snapshot.customFieldValues.length) {
          await exec(
            client.from("custom_field_values").insert(
              snapshot.customFieldValues.map((value) => customFieldValueToRow(ownerId, value))
            )
          );
        }

        if (snapshot.activityLog.length) {
          await exec(client.from("activity_log").insert(snapshot.activityLog.map((entry) => activityToRow(ownerId, entry))));
        }

        owner.sync = {
          remoteEnabled: Boolean(config.neonDataApiUrl),
          lastSyncAt: nowIso(),
          lastSyncError: null,
          source: "neon"
        };
        dirtyOwners.delete(ownerId);
        saveLocalSnapshot();
        return true;
      } catch (error) {
        owner.sync = {
          ...owner.sync,
          remoteEnabled: Boolean(config.neonDataApiUrl),
          lastSyncError: error?.message ?? String(error),
          source: owner.sync.source ?? "localStorage"
        };
        saveLocalSnapshot();
        return false;
      }
    })().finally(() => {
      flushPromises.delete(ownerId);
    });

    flushPromises.set(ownerId, promise);
    return promise;
  }

  function schedulePersist(ownerId) {
    dirtyOwners.add(ownerId);
    const current = flushTimers.get(ownerId);
    if (current) {
      clearTimeout(current);
    }
    flushTimers.set(
      ownerId,
      setTimeout(() => {
        flushTimers.delete(ownerId);
        void flushOwner(ownerId);
      }, 120)
    );
  }

  function touchOwner(ownerId) {
    const owner = getOwnerState(ownerId);
    owner.settings.lastSeenAt = nowIso();
    return owner;
  }

  return {
    resetMemory() {
      for (const timer of flushTimers.values()) {
        clearTimeout(timer);
      }
      flushTimers.clear();
      flushPromises.clear();
      dirtyOwners.clear();
      owners.clear();
      localData = readAll();
    },

    async resolveOwnerIdentity(identity = {}) {
      const authUserId = String(identity.authUserId ?? "").trim();
      const canonicalKey = String(
        identity.canonicalKey ?? identity.googleSubject ?? identity.googleEmail ?? identity.email ?? authUserId
      ).trim();
      const payload = {
        p_auth_user_id: authUserId,
        p_canonical_key: canonicalKey,
        p_display_name: identity.displayName ?? "",
        p_email: identity.email ?? "",
        p_avatar_url: identity.avatarUrl ?? "",
        p_google_subject: identity.googleSubject ?? "",
        p_google_email: identity.googleEmail ?? identity.email ?? ""
      };

      const fallbackResult = {
        ownerId: canonicalKey || authUserId,
        canonicalKey: canonicalKey || authUserId,
        linkedAuthUserId: authUserId,
        googleSubject: identity.googleSubject ?? "",
        googleEmail: identity.googleEmail ?? identity.email ?? "",
        resolutionSource: "local-fallback",
        mergedFrom: []
      };

      const client = await getNeonDataClient();
      if (!client || typeof client.rpc !== "function") {
        return fallbackResult;
      }

      try {
        const response = await exec(client.rpc("resolve_owner_identity", payload));
        const row = Array.isArray(response) ? response[0] : response;
        if (!row) {
          return fallbackResult;
        }
        return {
          ownerId: row.owner_auth_user_id ?? row.canonical_key ?? fallbackResult.ownerId,
          canonicalKey: row.canonical_key ?? fallbackResult.canonicalKey,
          linkedAuthUserId: row.linked_auth_user_id ?? authUserId,
          googleSubject: row.google_subject ?? payload.p_google_subject ?? "",
          googleEmail: row.google_email ?? payload.p_google_email ?? "",
          resolutionSource: row.resolution_source ?? "neon",
          mergedFrom: Array.isArray(row.merged_from) ? row.merged_from.filter(Boolean) : []
        };
      } catch (error) {
        return {
          ...fallbackResult,
          resolutionSource: "rpc-error",
          resolutionError: error?.message ?? String(error)
        };
      }
    },

    async initialize(ownerId, profile = {}, options = {}) {
      const aliases = Array.isArray(options.aliases) ? options.aliases.filter(Boolean).filter((alias) => alias !== ownerId) : [];
      const remoteOwner = await loadRemoteOwner(ownerId);
      let owner = remoteOwner ?? getOwnerState(ownerId);
      const localSnapshots = [];
      if (localData.owners?.[ownerId]) {
        localSnapshots.push(localData.owners[ownerId]);
      }
      for (const alias of aliases) {
        if (localData.owners?.[alias]) {
          localSnapshots.push(localData.owners[alias]);
        }
      }
      for (const snapshot of localSnapshots) {
        owner = mergeOwnerSnapshots(owner, snapshot);
      }
      owner.profile = {
        ...owner.profile,
        ...profile,
        ownerId
      };
      owner.sync = {
        ...owner.sync,
        remoteEnabled: Boolean(config.neonDataApiUrl),
        source: remoteOwner ? (localSnapshots.length ? "merged" : "neon") : (localSnapshots.length ? "localStorage" : "empty"),
        lastSyncError: remoteOwner ? null : owner.sync.lastSyncError ?? null
      };
      owners.set(ownerId, owner);
      if (localSnapshots.length) {
        for (const alias of aliases) {
          if (alias !== ownerId && localData.owners?.[alias]) {
            delete localData.owners[alias];
          }
          if (alias !== ownerId && owners.has(alias)) {
            owners.delete(alias);
          }
        }
      }
      saveLocalSnapshot();
      if (owner.sync.remoteEnabled && (remoteOwner || localSnapshots.length)) {
        schedulePersist(ownerId);
      }
      return clone(owner);
    },

    getOwner(ownerId) {
      return clone(touchOwner(ownerId));
    },

    listAccounts(ownerId, options = {}) {
      const owner = touchOwner(ownerId);
      const query = compact(options.query ?? "");
      const platform = options.platform ?? "all";
      const status = options.status ?? "all";
      const archived = options.archived ?? "active";
      const favorite = options.favorite ?? "all";
      const linkedTo = options.linkedTo ?? "all";
      const tag = normalizeText(options.tag ?? "");
      const sort = options.sort ?? "updated_desc";

      let accounts = owner.accounts.slice();

      if (archived !== "all") {
        const archivedValue = archived === "archived";
        accounts = accounts.filter((account) => account.archived === archivedValue);
      }

      if (platform !== "all") {
        accounts = accounts.filter((account) => normalizeText(account.platform) === normalizeText(platform));
      }

      if (status !== "all") {
        accounts = accounts.filter((account) => normalizeText(account.status) === normalizeText(status));
      }

      if (favorite === "favorite") {
        accounts = accounts.filter((account) => account.favorite);
      } else if (favorite === "normal") {
        accounts = accounts.filter((account) => !account.favorite);
      }

      if (tag) {
        accounts = accounts.filter((account) => (account.tags ?? []).some((entry) => normalizeText(entry) === tag));
      }

      if (linkedTo !== "all") {
        accounts = accounts.filter((account) => {
          const relationships = owner.accountRelationships.filter(
            (relation) => relation.parentAccountId === linkedTo || relation.childAccountId === linkedTo
          );
          return relationships.some(
            (relation) => relation.parentAccountId === account.id || relation.childAccountId === account.id
          );
        });
      }

      if (query) {
        accounts = accounts.filter((account) => account.searchBlob.includes(query));
      }

      accounts.sort((left, right) => {
        switch (sort) {
          case "alpha":
            return (left.label ?? "").localeCompare(right.label ?? "");
          case "status":
            return (left.status ?? "").localeCompare(right.status ?? "") || (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
          case "platform":
            return (left.platform ?? "").localeCompare(right.platform ?? "") || (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
          case "newest":
            return (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
          case "updated_desc":
          default:
            return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
        }
      });

      return clone(accounts);
    },

    createAccount(ownerId, actorId, draft) {
      const owner = touchOwner(ownerId);
      const anchorAccount = draft.linkMode === "linkedGoogle" ? accountById(owner, draft.anchorAccountId) : null;
      const account = {
        id: uid("acct"),
        ownerId,
        platform: draft.platform?.trim() || "Custom",
        accountType: draft.accountType?.trim() || draft.platform?.trim() || "Custom",
        label: deriveAccountLabel(draft, draft.platform?.trim() || "Account"),
        mainEmail: draft.mainEmail?.trim() || anchorAccount?.mainEmail || "",
        username: draft.username?.trim() || "",
        secretRecord: draft.secretRecord ?? null,
        status: draft.status || "active",
        notes: draft.notes?.trim() || "",
        favorite: Boolean(draft.favorite ?? false),
        archived: Boolean(draft.archived ?? false),
        tags: normalizeList(draft.tags).map((tag) => tag.trim()).filter(Boolean),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastAccessedAt: null,
        searchBlob: ""
      };

      owner.accounts.unshift(account);

      for (const customField of draft.customFields ?? []) {
        const field = customFieldById(owner, customField.fieldId) ?? {
          id: customField.fieldId || uid("field"),
          ownerId,
          name: customField.name?.trim() || "Custom field",
          valueType: customField.valueType || "text",
          visibility: customField.visibility || "private",
          searchable: Boolean(customField.searchable ?? true),
          createdAt: nowIso(),
          updatedAt: nowIso()
        };

        if (!customFieldById(owner, field.id)) {
          owner.customFields.unshift(field);
        }

        owner.customFieldValues.unshift({
          id: uid("fieldval"),
          ownerId,
          accountId: account.id,
          fieldId: field.id,
          valueText: customField.valueText?.trim() || "",
          valueJson: customField.valueJson ?? null,
          encryptedValue: customField.encryptedValue ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        });
      }

      syncAnchorLink(owner, account.id, draft.linkMode, draft.anchorAccountId);

      createActivity(owner, {
        ownerId,
        actorId,
        action: "account.create",
        entityType: "account",
        entityId: account.id,
        summary: `Created ${account.label}`,
        diff: {
          after: account
        }
      });

      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return clone(account);
    },

    updateAccount(ownerId, actorId, accountId, draft) {
      const owner = touchOwner(ownerId);
      const account = accountById(owner, accountId);
      if (!account) {
        throw new Error("Account not found");
      }
      const anchorAccount = draft.linkMode === "linkedGoogle" ? accountById(owner, draft.anchorAccountId) : null;
      const before = clone(account);
      account.platform = draft.platform?.trim() || account.platform;
      account.accountType = draft.accountType?.trim() || account.accountType;
      account.label = deriveAccountLabel(draft, account.label);
      account.mainEmail = draft.mainEmail?.trim() || anchorAccount?.mainEmail || account.mainEmail || "";
      account.username = draft.username?.trim() || "";
      if (draft.secretRecord) {
        account.secretRecord = draft.secretRecord;
      }
      account.status = draft.status || account.status;
      account.notes = draft.notes?.trim() || "";
      account.tags = normalizeList(draft.tags).map((tag) => tag.trim()).filter(Boolean);
      account.updatedAt = nowIso();

      owner.customFieldValues = owner.customFieldValues.filter((value) => value.accountId !== accountId);
      for (const customField of draft.customFields ?? []) {
        let field = customFieldById(owner, customField.fieldId);
        if (!field) {
          field = {
            id: customField.fieldId || uid("field"),
            ownerId,
            name: customField.name?.trim() || "Custom field",
            valueType: customField.valueType || "text",
            visibility: customField.visibility || "private",
            searchable: Boolean(customField.searchable ?? true),
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          owner.customFields.unshift(field);
        } else {
          field.name = customField.name?.trim() || field.name;
          field.valueType = customField.valueType || field.valueType;
          field.visibility = customField.visibility || field.visibility;
          field.searchable = Boolean(customField.searchable ?? field.searchable);
          field.updatedAt = nowIso();
        }

        owner.customFieldValues.unshift({
          id: uid("fieldval"),
          ownerId,
          accountId,
          fieldId: field.id,
          valueText: customField.valueText?.trim() || "",
          valueJson: customField.valueJson ?? null,
          encryptedValue: customField.encryptedValue ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        });
      }

      syncAnchorLink(owner, accountId, draft.linkMode, draft.anchorAccountId);

      createActivity(owner, {
        ownerId,
        actorId,
        action: "account.update",
        entityType: "account",
        entityId: account.id,
        summary: `Updated ${account.label}`,
        diff: {
          before,
          after: clone(account)
        }
      });

      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return clone(account);
    },

    archiveAccount(ownerId, actorId, accountId, archived) {
      const owner = touchOwner(ownerId);
      const account = accountById(owner, accountId);
      if (!account) throw new Error("Account not found");
      const before = clone(account);
      account.archived = Boolean(archived);
      account.status = archived ? "archived" : account.status === "archived" ? "active" : account.status;
      account.updatedAt = nowIso();
      createActivity(owner, {
        ownerId,
        actorId,
        action: archived ? "account.archive" : "account.restore",
        entityType: "account",
        entityId: account.id,
        summary: `${archived ? "Archived" : "Restored"} ${account.label}`,
        diff: { before, after: clone(account) }
      });
      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return clone(account);
    },

    deleteAccount(ownerId, actorId, accountId) {
      const owner = touchOwner(ownerId);
      const account = accountById(owner, accountId);
      if (!account) throw new Error("Account not found");
      owner.accounts = owner.accounts.filter((entry) => entry.id !== accountId);
      owner.accountRelationships = owner.accountRelationships.filter(
        (relation) => relation.parentAccountId !== accountId && relation.childAccountId !== accountId
      );
      owner.customFieldValues = owner.customFieldValues.filter((value) => value.accountId !== accountId);
      createActivity(owner, {
        ownerId,
        actorId,
        action: "account.delete",
        entityType: "account",
        entityId: account.id,
        summary: `Deleted ${account.label}`,
        diff: { before: clone(account) }
      });
      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return true;
    },

    upsertCustomField(ownerId, actorId, fieldDraft) {
      const owner = touchOwner(ownerId);
      let field = fieldDraft.fieldId ? customFieldById(owner, fieldDraft.fieldId) : null;
      if (!field) {
        field = {
          id: fieldDraft.fieldId || uid("field"),
          ownerId,
          name: fieldDraft.name?.trim() || "Custom field",
          valueType: fieldDraft.valueType || "text",
          visibility: fieldDraft.visibility || "private",
          searchable: Boolean(fieldDraft.searchable ?? true),
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        owner.customFields.unshift(field);
      } else {
        field.name = fieldDraft.name?.trim() || field.name;
        field.valueType = fieldDraft.valueType || field.valueType;
        field.visibility = fieldDraft.visibility || field.visibility;
        field.searchable = Boolean(fieldDraft.searchable ?? field.searchable);
        field.updatedAt = nowIso();
      }

      createActivity(owner, {
        ownerId,
        actorId,
        action: "field.upsert",
        entityType: "custom_field",
        entityId: field.id,
        summary: `Updated custom field ${field.name}`,
        diff: { after: clone(field) }
      });

      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return clone(field);
    },

    setCustomFieldValue(ownerId, actorId, accountId, fieldDraft) {
      const owner = touchOwner(ownerId);
      let field = fieldDraft.fieldId ? customFieldById(owner, fieldDraft.fieldId) : null;
      if (!field) {
        field = this.upsertCustomField(ownerId, actorId, fieldDraft);
      }
      const existing = owner.customFieldValues.find((value) => value.accountId === accountId && value.fieldId === field.id);
      if (existing) {
        existing.valueText = fieldDraft.valueText?.trim() || "";
        existing.valueJson = fieldDraft.valueJson ?? null;
        existing.encryptedValue = fieldDraft.encryptedValue ?? null;
        existing.updatedAt = nowIso();
      } else {
        owner.customFieldValues.unshift({
          id: uid("fieldval"),
          ownerId,
          accountId,
          fieldId: field.id,
          valueText: fieldDraft.valueText?.trim() || "",
          valueJson: fieldDraft.valueJson ?? null,
          encryptedValue: fieldDraft.encryptedValue ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        });
      }

      createActivity(owner, {
        ownerId,
        actorId,
        action: "field.value",
        entityType: "custom_field_value",
        entityId: field.id,
        summary: `Updated ${field.name} for account`,
        diff: { after: fieldDraft.valueText }
      });

      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return true;
    },

    deleteCustomFieldValue(ownerId, actorId, accountId, fieldId) {
      const owner = touchOwner(ownerId);
      owner.customFieldValues = owner.customFieldValues.filter(
        (value) => !(value.accountId === accountId && value.fieldId === fieldId)
      );
      createActivity(owner, {
        ownerId,
        actorId,
        action: "field.value.delete",
        entityType: "custom_field_value",
        entityId: fieldId,
        summary: `Removed custom field value`,
        diff: {}
      });
      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return true;
    },

    addRelationship(ownerId, actorId, relationshipDraft) {
      const owner = touchOwner(ownerId);
      const relationship = {
        id: uid("rel"),
        ownerId,
        parentAccountId: relationshipDraft.parentAccountId,
        childAccountId: relationshipDraft.childAccountId,
        relationshipType: relationshipDraft.relationshipType || "custom",
        notes: relationshipDraft.notes?.trim() || "",
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      owner.accountRelationships.unshift(relationship);
      createActivity(owner, {
        ownerId,
        actorId,
        action: "relationship.create",
        entityType: "relationship",
        entityId: relationship.id,
        summary: `Linked accounts`,
        diff: { after: clone(relationship) }
      });
      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return clone(relationship);
    },

    deleteRelationship(ownerId, actorId, relationshipId) {
      const owner = touchOwner(ownerId);
      owner.accountRelationships = owner.accountRelationships.filter((relation) => relation.id !== relationshipId);
      createActivity(owner, {
        ownerId,
        actorId,
        action: "relationship.delete",
        entityType: "relationship",
        entityId: relationshipId,
        summary: `Removed relationship`,
        diff: {}
      });
      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return true;
    },

    listRelationships(ownerId, accountId) {
      const owner = touchOwner(ownerId);
      return clone(
        owner.accountRelationships.filter(
          (relation) => relation.parentAccountId === accountId || relation.childAccountId === accountId
        )
      );
    },

    getAccount(ownerId, accountId) {
      const owner = touchOwner(ownerId);
      const account = accountById(owner, accountId);
      if (!account) return null;
      const parentRelationships = owner.accountRelationships.filter((relation) => relation.childAccountId === accountId);
      const childRelationships = owner.accountRelationships.filter((relation) => relation.parentAccountId === accountId);
      const customFields = owner.customFieldValues
        .filter((value) => value.accountId === accountId)
        .map((value) => {
          const field = customFieldById(owner, value.fieldId);
          return {
            ...value,
            field
          };
        });
      const parents = parentRelationships.map((relation) => ({
        relationship: relation,
        account: accountById(owner, relation.parentAccountId)
      }));
      const children = childRelationships.map((relation) => ({
        relationship: relation,
        account: accountById(owner, relation.childAccountId)
      }));
      return {
        ...clone(account),
        parents,
        children,
        customFields,
        relationships: [...parentRelationships, ...childRelationships]
      };
    },

    getDuplicateWarnings(ownerId, draft, ignoreId = null) {
      const owner = touchOwner(ownerId);
      return duplicateWarnings(owner, draft, ignoreId);
    },

    getSummary(ownerId) {
      const owner = touchOwner(ownerId);
      return {
        total: owner.accounts.length,
        active: owner.accounts.filter((account) => !account.archived).length,
        archived: owner.accounts.filter((account) => account.archived).length,
        favorites: owner.accounts.filter((account) => account.favorite).length,
        relationships: owner.accountRelationships.length,
        fields: owner.customFields.length
      };
    },

    exportOwner(ownerId) {
      const owner = touchOwner(ownerId);
      return clone(owner);
    },

    importOwner(ownerId, snapshot, actorId) {
      const owner = normalizeOwnerSnapshot(ownerId, snapshot);
      owners.set(ownerId, owner);
      createActivity(owner, {
        ownerId,
        actorId,
        action: "import.complete",
        entityType: "snapshot",
        entityId: ownerId,
        summary: "Imported account vault snapshot",
        diff: {}
      });
      rewriteSearchIndex(owner);
      schedulePersist(ownerId);
      return true;
    },

    updateProfile(ownerId, patch) {
      const owner = touchOwner(ownerId);
      owner.profile = {
        ...owner.profile,
        ...patch,
        ownerId
      };
      schedulePersist(ownerId);
      return clone(owner.profile);
    },

    setSettings(ownerId, patch) {
      const owner = touchOwner(ownerId);
      owner.settings = {
        ...owner.settings,
        ...normalizeSettings({
          ...owner.settings,
          ...patch
        })
      };
      schedulePersist(ownerId);
      return clone(owner.settings);
    },

    addCustomPlatform(ownerId, category, platformName) {
      const owner = touchOwner(ownerId);
      const key = normalizePlatformCategory(category);
      const name = String(platformName ?? "").trim();
      if (!name) return clone(owner.settings);
      const customPlatforms = normalizeCustomPlatforms(owner.settings.customPlatforms ?? {});
      if (!customPlatforms[key].some((entry) => normalizeText(entry) === normalizeText(name))) {
        customPlatforms[key].push(name);
      }
      owner.settings = normalizeSettings({
        ...owner.settings,
        customPlatforms
      });
      schedulePersist(ownerId);
      return clone(owner.settings);
    },

    async syncOwner(ownerId) {
      return flushOwner(ownerId);
    }
  };
}
