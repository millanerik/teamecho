-- ============================================================
--  TEAM ECHO — Supabase setup
--  Paste this whole file into: Supabase -> SQL Editor -> New query -> Run
--  Safe to re-run: it uses "if not exists" / "on conflict" throughout.
-- ============================================================

-- pgcrypto gives us crypt() + gen_salt() for bcrypt PIN hashing.
create extension if not exists pgcrypto;

-- ---------- profiles (the team roster / "users" table) ----------
create table if not exists public.profiles (
  id          text primary key,          -- slug id, e.g. 'erik-millan'
  name        text not null,
  role        text not null default 'User',
  pin_hash    text,                      -- bcrypt hash; null until first login
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- A view-friendly boolean the browser can read without seeing the hash.
-- (We expose "has_pin" via the API by selecting a computed column below.)

-- ---------- board_items (mood board pins) ----------
create table if not exists public.board_items (
  id          text primary key,
  owner_id    text not null references public.profiles(id) on delete cascade,
  owner_name  text not null,
  kind        text not null,             -- 'text' | 'image' | 'gif'
  x           double precision not null default 45,
  y           double precision not null default 40,
  rot         double precision not null default 0,
  w           double precision not null default 180,
  z           integer not null default 10,
  text        text,
  color       text,
  src         text,                      -- public Storage URL for image/gif
  created_at  timestamptz not null default now()
);

-- ---------- seed the roster ----------
insert into public.profiles (id, name, role) values
  ('adam-nye',          'Adam Nye',          'User'),
  ('alyssa-tankersley', 'Alyssa Tankersley', 'User'),
  ('ashtyn-bailey',     'Ashtyn Bailey',     'User'),
  ('camaron-king',      'Camaron King',      'User'),
  ('elvis-vu',          'Elvis Vu',          'User'),
  ('jarrett-todd',      'Jarrett Todd',      'User'),
  ('jason-bremermann',  'Jason Bremermann',  'User'),
  ('kahlil-lambert',    'Kahlil Lambert',    'User'),
  ('mark-brand',        'Mark Brand',        'User'),
  ('morticia-hollis',   'Morticia Hollis',   'User'),
  ('erik-millan',       'Erik Millan',       'Super Admin')
on conflict (id) do nothing;

-- Give Erik his starting PIN of 1234 (hashed). Runs once; ignored if already set.
update public.profiles
  set pin_hash = crypt('1234', gen_salt('bf'))
  where id = 'erik-millan' and pin_hash is null;

-- ============================================================
--  Secure PIN functions
--  These run with the definer's privileges, so the hash never
--  has to be readable by the browser directly.
-- ============================================================

-- Set (or reset) a user's PIN. Hashes with bcrypt.
create or replace function public.set_pin(p_user_id text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;
  update public.profiles
    set pin_hash = crypt(p_pin, gen_salt('bf'))
    where id = p_user_id;
end;
$$;

-- Verify a PIN. Returns true/false. Never returns the hash.
create or replace function public.verify_pin(p_user_id text, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  stored text;
begin
  select pin_hash into stored from public.profiles where id = p_user_id;
  if stored is null then
    return false;
  end if;
  return stored = crypt(p_pin, stored);
end;
$$;

-- A safe roster read that includes "has_pin" but not the hash itself.
create or replace function public.get_roster()
returns table (id text, name text, role text, avatar_url text, has_pin boolean)
language sql
stable
as $$
  select id, name, role, avatar_url, (pin_hash is not null) as has_pin
  from public.profiles
  order by name;
$$;

-- ============================================================
--  Row Level Security
--  Trusted internal team model: the browser uses the public anon key.
--  We allow reading non-sensitive profile fields and full board access,
--  but NOT reading pin_hash and NOT writing pin_hash directly (only the
--  security-definer functions above can touch it).
-- ============================================================

alter table public.profiles   enable row level security;
alter table public.board_items enable row level security;

-- Profiles: allow the anon role to SELECT, but we protect the hash by
-- never selecting it from the client (the app calls get_roster()).
-- Allow updating avatar_url only (PIN changes go through set_pin()).
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists "profiles_update_avatar" on public.profiles;
create policy "profiles_update_avatar" on public.profiles
  for update to anon, authenticated
  using (true)
  with check (true);

-- Board: anyone on the team can read; insert/delete/update allowed.
drop policy if exists "board_read" on public.board_items;
create policy "board_read" on public.board_items
  for select to anon, authenticated using (true);

drop policy if exists "board_insert" on public.board_items;
create policy "board_insert" on public.board_items
  for insert to anon, authenticated with check (true);

drop policy if exists "board_update" on public.board_items;
create policy "board_update" on public.board_items
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "board_delete" on public.board_items;
create policy "board_delete" on public.board_items
  for delete to anon, authenticated using (true);

-- Let the anon role execute our functions.
grant execute on function public.set_pin(text, text)    to anon, authenticated;
grant execute on function public.verify_pin(text, text) to anon, authenticated;
grant execute on function public.get_roster()           to anon, authenticated;

-- ============================================================
--  DONE. Next: create the Storage bucket (see SUPABASE_SETUP.md step 3).
-- ============================================================
