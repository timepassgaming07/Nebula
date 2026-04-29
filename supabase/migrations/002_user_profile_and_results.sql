-- ============================================================================
-- Add user profile fields + game results storage
-- ============================================================================

alter table public.users add column if not exists avatar_id int not null default 1;
alter table public.users add column if not exists xp int not null default 0;
alter table public.users add column if not exists level int not null default 1;
alter table public.users add column if not exists total_correct_guesses int not null default 0;
alter table public.users add column if not exists total_bluffs_successful int not null default 0;
alter table public.users add column if not exists provider text;
alter table public.users add column if not exists email text;

-- Update trigger to hydrate new auth users with extra fields
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, username, display_name, email, provider, avatar_id)
  values (
    new.id,
    'user_' || substr(new.id::text, 1, 8),
    coalesce(new.raw_user_meta_data ->> 'full_name', 'Player'),
    new.email,
    coalesce(new.raw_app_meta_data ->> 'provider', new.raw_user_meta_data ->> 'provider', 'supabase'),
    1
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Game results archive
create table if not exists public.game_results (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  game_mode text not null,
  players jsonb not null default '[]'::jsonb,
  rounds jsonb not null default '[]'::jsonb,
  winner_id uuid,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.game_results enable row level security;
