-- ============================================================================
-- Nebula Supabase Core Schema
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- users
-- Mirrors auth.users with game profile fields
-- ============================================================================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text,
  region text,
  total_games int not null default 0 check (total_games >= 0),
  total_wins int not null default 0 check (total_wins >= 0),
  total_score bigint not null default 0 check (total_score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- categories
-- ============================================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,64}$'),
  name text not null unique check (char_length(name) between 2 and 80),
  description text,
  is_premium boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- questions
-- ============================================================================
create table if not exists public.questions (
  id bigserial primary key,
  category_id uuid not null references public.categories(id) on delete cascade,
  question_text text not null check (char_length(question_text) between 10 and 500),
  correct_answer text not null check (char_length(correct_answer) between 1 and 200),
  explanation text,
  difficulty smallint not null default 3 check (difficulty between 1 and 5),
  language_code text not null default 'en' check (char_length(language_code) between 2 and 8),
  is_active boolean not null default true,
  times_served int not null default 0 check (times_served >= 0),
  last_served_at timestamptz,
  rand_key double precision not null default random(),
  generation_batch_id uuid,
  source_model text,
  metadata jsonb not null default '{}'::jsonb,
  created_by text not null default 'ai_agent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  question_hash bytea generated always as (
    digest(lower(btrim(question_text)) || '|' || lower(btrim(correct_answer)), 'sha256')
  ) stored
);

create unique index if not exists uq_questions_category_hash
  on public.questions(category_id, question_hash);

create index if not exists idx_questions_fetch
  on public.questions(category_id, is_active, rand_key, id);

create index if not exists idx_questions_inventory
  on public.questions(category_id, is_active, times_served);

-- ============================================================================
-- game rooms and state
-- ============================================================================
create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique check (join_code ~ '^[A-Z0-9]{6}$'),
  host_user_id uuid not null references public.users(id) on delete restrict,
  category_id uuid references public.categories(id) on delete set null,
  status text not null default 'waiting'
    check (status in ('waiting', 'in_progress', 'finished', 'cancelled')),
  max_players smallint not null default 10 check (max_players between 2 and 50),
  current_round int not null default 0 check (current_round >= 0),
  total_rounds int not null default 10 check (total_rounds between 1 and 100),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_room_players (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  score int not null default 0 check (score >= 0),
  is_connected boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, user_id)
);

create table if not exists public.game_room_state (
  room_id uuid primary key references public.game_rooms(id) on delete cascade,
  phase text not null default 'lobby'
    check (phase in ('lobby', 'question', 'answering', 'voting', 'results', 'finished')),
  countdown_ends_at timestamptz,
  current_question_id bigint references public.questions(id) on delete set null,
  server_now timestamptz not null default now(),
  version bigint not null default 1,
  payload jsonb not null default '{}'::jsonb,
  scoreboard jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_room_players_user on public.game_room_players(user_id);

-- ============================================================================
-- Utility triggers
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.bump_room_state_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  new.server_now = now();
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

drop trigger if exists trg_questions_updated_at on public.questions;
create trigger trg_questions_updated_at
before update on public.questions
for each row execute function public.set_updated_at();

drop trigger if exists trg_rooms_updated_at on public.game_rooms;
create trigger trg_rooms_updated_at
before update on public.game_rooms
for each row execute function public.set_updated_at();

drop trigger if exists trg_room_state_version on public.game_room_state;
create trigger trg_room_state_version
before update on public.game_room_state
for each row execute function public.bump_room_state_version();

-- auto profile row from auth.users
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, username, display_name)
  values (
    new.id,
    'user_' || substr(new.id::text, 1, 8),
    coalesce(new.raw_user_meta_data ->> 'full_name', 'Player')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.questions enable row level security;
alter table public.game_rooms enable row level security;
alter table public.game_room_players enable row level security;
alter table public.game_room_state enable row level security;

-- users
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
for select using (id = auth.uid());

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
for update using (id = auth.uid()) with check (id = auth.uid());

-- categories and questions
drop policy if exists categories_read_active on public.categories;
create policy categories_read_active on public.categories
for select using (is_active = true);

drop policy if exists questions_read_active on public.questions;
create policy questions_read_active on public.questions
for select using (is_active = true);

-- room read if member
drop policy if exists room_read_if_member on public.game_rooms;
create policy room_read_if_member on public.game_rooms
for select using (
  exists (
    select 1 from public.game_room_players p
    where p.room_id = game_rooms.id
      and p.user_id = auth.uid()
  )
);

drop policy if exists room_insert_host_self on public.game_rooms;
create policy room_insert_host_self on public.game_rooms
for insert with check (host_user_id = auth.uid());

drop policy if exists room_update_host_only on public.game_rooms;
create policy room_update_host_only on public.game_rooms
for update using (host_user_id = auth.uid()) with check (host_user_id = auth.uid());

drop policy if exists room_players_read_if_member on public.game_room_players;
create policy room_players_read_if_member on public.game_room_players
for select using (
  exists (
    select 1 from public.game_room_players me
    where me.room_id = game_room_players.room_id
      and me.user_id = auth.uid()
  )
);

drop policy if exists room_players_insert_self on public.game_room_players;
create policy room_players_insert_self on public.game_room_players
for insert with check (user_id = auth.uid());

drop policy if exists room_players_update_self on public.game_room_players;
create policy room_players_update_self on public.game_room_players
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists room_state_read_if_member on public.game_room_state;
create policy room_state_read_if_member on public.game_room_state
for select using (
  exists (
    select 1 from public.game_room_players p
    where p.room_id = game_room_state.room_id
      and p.user_id = auth.uid()
  )
);

-- ============================================================================
-- Realtime setup
-- ============================================================================
alter table public.game_rooms replica identity full;
alter table public.game_room_state replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.game_rooms;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.game_room_state;
exception
  when duplicate_object then null;
end $$;

-- ============================================================================
-- RPC: anti-repeat random fetch
-- Uses indexed random pivot scan (avoids ORDER BY random() full sort)
-- ============================================================================
create or replace function public.fetch_live_questions(
  p_category_id uuid,
  p_seen_question_ids bigint[] default '{}',
  p_limit integer default 10
)
returns table (
  id bigint,
  category_id uuid,
  question_text text,
  correct_answer text,
  explanation text,
  difficulty smallint,
  language_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 50));
  v_seen bigint[] := coalesce(p_seen_question_ids, '{}');
  v_pivot double precision := random();
begin
  return query
  with first_slice as (
    select q.id, q.category_id, q.question_text, q.correct_answer, q.explanation, q.difficulty, q.language_code
    from public.questions q
    where q.is_active = true
      and q.category_id = p_category_id
      and q.id <> all(v_seen)
      and q.rand_key >= v_pivot
    order by q.rand_key asc
    limit v_limit
  ),
  second_slice as (
    select q.id, q.category_id, q.question_text, q.correct_answer, q.explanation, q.difficulty, q.language_code
    from public.questions q
    where q.is_active = true
      and q.category_id = p_category_id
      and q.id <> all(v_seen)
      and q.rand_key < v_pivot
    order by q.rand_key asc
    limit greatest(0, v_limit - (select count(*) from first_slice))
  )
  select * from first_slice
  union all
  select * from second_slice
  limit v_limit;
end;
$$;

grant execute on function public.fetch_live_questions(uuid, bigint[], integer)
to authenticated;

-- mark served for anti-repeat freshness
create or replace function public.mark_questions_served(p_question_ids bigint[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.questions
  set times_served = times_served + 1,
      last_served_at = now(),
      updated_at = now(),
      rand_key = random()
  where id = any(coalesce(p_question_ids, '{}'));
$$;

grant execute on function public.mark_questions_served(bigint[])
to authenticated;

-- inventory helper for AI worker
create or replace function public.question_inventory_by_category(p_threshold integer default 500)
returns table (
  category_id uuid,
  slug text,
  name text,
  unplayed_count integer
)
language sql
security definer
set search_path = public
as $$
  select
    c.id as category_id,
    c.slug,
    c.name,
    coalesce(sum((q.is_active = true and q.times_served = 0)::int), 0)::int as unplayed_count
  from public.categories c
  left join public.questions q on q.category_id = c.id
  where c.is_active = true
  group by c.id, c.slug, c.name
  having coalesce(sum((q.is_active = true and q.times_served = 0)::int), 0)::int < p_threshold
  order by unplayed_count asc;
$$;

grant execute on function public.question_inventory_by_category(integer)
to service_role;

-- lock down SECURITY DEFINER function execution surface
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.bump_room_state_version() from public, anon, authenticated;
revoke execute on function public.fetch_live_questions(uuid, bigint[], integer) from anon;
revoke execute on function public.mark_questions_served(bigint[]) from anon;
revoke execute on function public.question_inventory_by_category(integer) from anon, authenticated;
