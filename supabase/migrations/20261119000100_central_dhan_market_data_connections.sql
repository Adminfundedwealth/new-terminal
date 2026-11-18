create table if not exists public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  broker_id text not null,
  environment text not null default 'production',
  encrypted_credentials text not null,
  is_active boolean not null default true,
  is_connected boolean not null default false,
  last_tested_at timestamptz,
  last_test_result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broker_connections_broker_environment_unique
    unique (broker_id, environment)
);

alter table public.broker_connections
  add column if not exists broker_id text,
  add column if not exists environment text default 'production',
  add column if not exists encrypted_credentials text,
  add column if not exists is_active boolean default true,
  add column if not exists is_connected boolean default false,
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_test_result text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.broker_connections enable row level security;

create index if not exists broker_connections_lookup_idx
  on public.broker_connections (broker_id, environment, is_active);
