create extension if not exists pgcrypto;

create table if not exists users (
  auth_user_id text primary key,
  canonical_key text unique,
  google_subject text unique,
  google_email text unique,
  display_name text,
  email text,
  avatar_url text,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists owner_auth_links (
  auth_user_id text primary key,
  owner_auth_user_id text not null references users(auth_user_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_auth_links_owner_idx on owner_auth_links (owner_auth_user_id);

create table if not exists accounts (
  id text primary key,
  owner_auth_user_id text not null references users(auth_user_id) on delete cascade,
  platform text not null,
  account_type text not null default 'custom',
  label text not null,
  main_email text,
  username text,
  secret_ciphertext text,
  secret_iv text,
  secret_salt text,
  secret_mode text not null default 'aes-gcm',
  status text not null default 'active',
  notes text not null default '',
  favorite boolean not null default false,
  archived boolean not null default false,
  tags text[] not null default '{}',
  search_blob text generated always as (
    lower(
      concat_ws(
        ' ',
        platform,
        account_type,
        label,
        coalesce(main_email, ''),
        coalesce(username, ''),
        status,
        coalesce(notes, ''),
        array_to_string(tags, ' ')
      )
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz
);

create index if not exists accounts_owner_idx on accounts (owner_auth_user_id);
create index if not exists accounts_platform_idx on accounts (owner_auth_user_id, platform);
create index if not exists accounts_status_idx on accounts (owner_auth_user_id, status);
create index if not exists accounts_archive_idx on accounts (owner_auth_user_id, archived);
create index if not exists accounts_favorite_idx on accounts (owner_auth_user_id, favorite);
create index if not exists accounts_search_idx on accounts using gin (to_tsvector('simple', search_blob));

create table if not exists account_relationships (
  id text primary key,
  owner_auth_user_id text not null references users(auth_user_id) on delete cascade,
  parent_account_id text not null references accounts(id) on delete cascade,
  child_account_id text not null references accounts(id) on delete cascade,
  relationship_type text not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_not_self check (parent_account_id <> child_account_id),
  constraint unique_relationship unique (owner_auth_user_id, parent_account_id, child_account_id, relationship_type)
);

create index if not exists relationships_owner_idx on account_relationships (owner_auth_user_id);
create index if not exists relationships_parent_idx on account_relationships (parent_account_id);
create index if not exists relationships_child_idx on account_relationships (child_account_id);

create table if not exists custom_fields (
  id text primary key,
  owner_auth_user_id text not null references users(auth_user_id) on delete cascade,
  name text not null,
  name_normalized text generated always as (lower(name)) stored,
  value_type text not null default 'text',
  visibility text not null default 'private',
  searchable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists custom_fields_owner_name_idx on custom_fields (owner_auth_user_id, name_normalized);
create index if not exists custom_fields_owner_idx on custom_fields (owner_auth_user_id);

create table if not exists custom_field_values (
  id text primary key,
  owner_auth_user_id text not null references users(auth_user_id) on delete cascade,
  account_id text not null references accounts(id) on delete cascade,
  field_id text not null references custom_fields(id) on delete cascade,
  value_text text not null default '',
  value_json jsonb,
  encrypted_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_value unique (account_id, field_id)
);

create index if not exists custom_field_values_owner_idx on custom_field_values (owner_auth_user_id);
create index if not exists custom_field_values_account_idx on custom_field_values (account_id);
create index if not exists custom_field_values_field_idx on custom_field_values (field_id);

create table if not exists activity_log (
  id text primary key,
  owner_auth_user_id text not null references users(auth_user_id) on delete cascade,
  actor_auth_user_id text not null,
  entity_type text not null,
  entity_id text,
  action text not null,
  summary text not null,
  diff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_owner_idx on activity_log (owner_auth_user_id, created_at desc);

create or replace function resolve_owner_identity(
  p_auth_user_id text,
  p_canonical_key text,
  p_display_name text default '',
  p_email text default '',
  p_avatar_url text default '',
  p_google_subject text default '',
  p_google_email text default ''
)
returns table (
  owner_auth_user_id text,
  canonical_key text,
  linked_auth_user_id text,
  google_subject text,
  google_email text,
  resolution_source text,
  merged_from text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id text := nullif(btrim(coalesce(p_auth_user_id, '')), '');
  v_canonical_key text := nullif(btrim(coalesce(p_canonical_key, '')), '');
  v_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_avatar_url text := nullif(btrim(coalesce(p_avatar_url, '')), '');
  v_google_subject text := nullif(btrim(coalesce(p_google_subject, '')), '');
  v_google_email text := nullif(lower(btrim(coalesce(p_google_email, p_email, ''))), '');
  v_linked_owner_id text := null;
  v_existing_owner_id text := null;
  v_target_owner_id text := null;
  v_resolution_source text := 'created';
  v_merged_from text[] := array[]::text[];
begin
  if v_auth_user_id is null then
    raise exception 'auth user id is required';
  end if;

  if auth.user_id() is not null and auth.user_id() <> v_auth_user_id then
    raise exception 'auth user mismatch';
  end if;

  v_canonical_key := coalesce(nullif(btrim(coalesce(v_canonical_key, '')), ''), v_google_subject, v_google_email, v_email, v_auth_user_id);
  v_target_owner_id := v_canonical_key;

  select owner_auth_links.owner_auth_user_id
  into v_linked_owner_id
  from owner_auth_links
  where owner_auth_links.auth_user_id = v_auth_user_id
  limit 1;

  if v_linked_owner_id is not null then
    v_existing_owner_id := v_linked_owner_id;
    v_target_owner_id := v_linked_owner_id;
    v_resolution_source := 'linked';
  end if;

  if v_existing_owner_id is null then
  select u.auth_user_id
  into v_existing_owner_id
  from users u
  where u.auth_user_id = v_target_owner_id
     or u.canonical_key = v_target_owner_id
     or (v_google_subject is not null and u.google_subject = v_google_subject)
     or (v_google_email is not null and u.google_email = v_google_email)
  order by case when u.auth_user_id = v_target_owner_id then 0 else 1 end, u.created_at asc
  limit 1;
  end if;

  if v_existing_owner_id is null then
    insert into users (
      auth_user_id,
      canonical_key,
      google_subject,
      google_email,
      display_name,
      email,
      avatar_url
    )
    values (
      v_target_owner_id,
      v_target_owner_id,
      v_google_subject,
      v_google_email,
      coalesce(v_display_name, 'Account owner'),
      v_email,
      v_avatar_url
    );
  elsif v_existing_owner_id <> v_target_owner_id then
    if exists (select 1 from users where auth_user_id = v_target_owner_id) then
      update users
      set
        canonical_key = v_target_owner_id,
        google_subject = coalesce(users.google_subject, v_google_subject),
        google_email = coalesce(users.google_email, v_google_email),
        display_name = coalesce(nullif(users.display_name, ''), v_display_name, users.display_name),
        email = coalesce(users.email, v_email),
        avatar_url = coalesce(users.avatar_url, v_avatar_url),
        updated_at = now()
      where auth_user_id = v_target_owner_id;
    else
      insert into users (
        auth_user_id,
        canonical_key,
        google_subject,
        google_email,
        display_name,
        email,
        avatar_url,
        settings_json,
        created_at,
        updated_at
      )
      select
        v_target_owner_id,
        v_target_owner_id,
        coalesce(v_google_subject, google_subject),
        coalesce(v_google_email, google_email),
        coalesce(nullif(v_display_name, ''), nullif(display_name, ''), 'Account owner'),
        coalesce(v_email, email),
        coalesce(v_avatar_url, avatar_url),
        settings_json,
        created_at,
        updated_at
      from users
      where auth_user_id = v_existing_owner_id;
    end if;

    update accounts set owner_auth_user_id = v_target_owner_id where owner_auth_user_id = v_existing_owner_id;
    update account_relationships set owner_auth_user_id = v_target_owner_id where owner_auth_user_id = v_existing_owner_id;
    update custom_fields set owner_auth_user_id = v_target_owner_id where owner_auth_user_id = v_existing_owner_id;
    update custom_field_values set owner_auth_user_id = v_target_owner_id where owner_auth_user_id = v_existing_owner_id;
    update activity_log set owner_auth_user_id = v_target_owner_id where owner_auth_user_id = v_existing_owner_id;
    update owner_auth_links set owner_auth_user_id = v_target_owner_id where owner_auth_user_id = v_existing_owner_id;
    delete from users where auth_user_id = v_existing_owner_id;

    v_merged_from := array_append(v_merged_from, v_existing_owner_id);
    v_resolution_source := 'merged';
  else
    update users
    set
      canonical_key = coalesce(users.canonical_key, v_target_owner_id),
      google_subject = coalesce(users.google_subject, v_google_subject),
      google_email = coalesce(users.google_email, v_google_email),
      display_name = coalesce(nullif(users.display_name, ''), v_display_name, users.display_name),
      email = coalesce(users.email, v_email),
      avatar_url = coalesce(users.avatar_url, v_avatar_url),
      updated_at = now()
      where auth_user_id = v_target_owner_id;

    if v_resolution_source <> 'linked' then
      v_resolution_source := 'existing';
    end if;
  end if;

  insert into owner_auth_links (auth_user_id, owner_auth_user_id)
  values (v_auth_user_id, v_target_owner_id)
  on conflict (auth_user_id) do update
    set owner_auth_user_id = excluded.owner_auth_user_id,
        updated_at = now();

  return query
  select
    v_target_owner_id,
    v_target_owner_id,
    v_auth_user_id,
    v_google_subject,
    v_google_email,
    v_resolution_source,
    v_merged_from;
end;
$$;

grant execute on function resolve_owner_identity(text, text, text, text, text, text, text) to authenticated;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists accounts_set_updated_at on accounts;
create trigger accounts_set_updated_at
before update on accounts
for each row execute function set_updated_at();

drop trigger if exists relationships_set_updated_at on account_relationships;
create trigger relationships_set_updated_at
before update on account_relationships
for each row execute function set_updated_at();

drop trigger if exists custom_fields_set_updated_at on custom_fields;
create trigger custom_fields_set_updated_at
before update on custom_fields
for each row execute function set_updated_at();

drop trigger if exists custom_field_values_set_updated_at on custom_field_values;
create trigger custom_field_values_set_updated_at
before update on custom_field_values
for each row execute function set_updated_at();

alter table users enable row level security;
alter table accounts enable row level security;
alter table account_relationships enable row level security;
alter table custom_fields enable row level security;
alter table custom_field_values enable row level security;
alter table activity_log enable row level security;

create policy "users own profile"
on users
for all
using (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = users.auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
)
with check (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = users.auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
);

create policy "owner auth links own mapping"
on owner_auth_links
for all
using (auth.user_id() = auth_user_id)
with check (auth.user_id() = auth_user_id);

create policy "accounts owner only"
on accounts
for all
using (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = accounts.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
)
with check (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = accounts.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
);

create policy "relationships owner only"
on account_relationships
for all
using (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = account_relationships.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
)
with check (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = account_relationships.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
);

create policy "custom fields owner only"
on custom_fields
for all
using (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = custom_fields.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
)
with check (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = custom_fields.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
);

create policy "custom field values owner only"
on custom_field_values
for all
using (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = custom_field_values.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
)
with check (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = custom_field_values.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
);

create policy "activity owner only"
on activity_log
for all
using (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = activity_log.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
)
with check (
  exists (
    select 1
    from owner_auth_links
    where owner_auth_links.owner_auth_user_id = activity_log.owner_auth_user_id
      and owner_auth_links.auth_user_id = auth.user_id()
  )
);

grant usage on schema public to authenticated, anonymous;
grant select, insert, update, delete on owner_auth_links to authenticated, anonymous;
grant select, insert, update, delete on users to authenticated, anonymous;
grant select, insert, update, delete on accounts to authenticated, anonymous;
grant select, insert, update, delete on account_relationships to authenticated, anonymous;
grant select, insert, update, delete on custom_fields to authenticated, anonymous;
grant select, insert, update, delete on custom_field_values to authenticated, anonymous;
grant select, insert, update, delete on activity_log to authenticated, anonymous;

comment on table accounts is 'Unified account graph records for SocialX.';
comment on table account_relationships is 'Directed parent-child account relationships.';
comment on table custom_fields is 'Per-user custom field definitions.';
comment on table custom_field_values is 'Per-account custom field data.';
comment on table activity_log is 'Audit trail for all user-visible changes.';
