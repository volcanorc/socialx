create extension if not exists pgcrypto;

create table if not exists users (
  auth_user_id text primary key,
  display_name text,
  email text,
  avatar_url text,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
using (auth.user_id() = auth_user_id)
with check (auth.user_id() = auth_user_id);

create policy "accounts owner only"
on accounts
for all
using (auth.user_id() = owner_auth_user_id)
with check (auth.user_id() = owner_auth_user_id);

create policy "relationships owner only"
on account_relationships
for all
using (auth.user_id() = owner_auth_user_id)
with check (auth.user_id() = owner_auth_user_id);

create policy "custom fields owner only"
on custom_fields
for all
using (auth.user_id() = owner_auth_user_id)
with check (auth.user_id() = owner_auth_user_id);

create policy "custom field values owner only"
on custom_field_values
for all
using (auth.user_id() = owner_auth_user_id)
with check (auth.user_id() = owner_auth_user_id);

create policy "activity owner only"
on activity_log
for all
using (auth.user_id() = owner_auth_user_id)
with check (auth.user_id() = owner_auth_user_id);

grant usage on schema public to authenticated, anonymous;
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
