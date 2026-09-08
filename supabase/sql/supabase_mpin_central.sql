-- =============================================================================
-- Central MPIN (4-digit quick sign-in) — stored on the ACCOUNT, not the device.
-- =============================================================================
-- Run this once in Supabase SQL Editor.
--
-- Why: the MPIN used to be a device-local vault (credentials encrypted in
-- localStorage under the PIN). That meant every new device/browser asked the
-- owner to invent a PIN again, and it silently did nothing on any origin without
-- Web Crypto (e.g. a plain-http LAN address), which is why "sign in with MPIN"
-- appeared to be broken. Now the PIN is bcrypt-hashed here, once per account,
-- and any device can use it.
--
-- What is stored: only a bcrypt hash of the 4 digits. The password is never
-- stored anywhere by this feature. Verification cannot be reached from the
-- browser directly — `verify_user_mpin` is granted to `service_role` only and is
-- called by the `mpin-signin` Edge Function, which mints the session. That keeps
-- a 4-digit secret from being brute-forceable against PostgREST.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.user_mpins (
  auth_user_id    uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  mpin_hash       text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Sign-in looks the row up by email, so one row per address.
create unique index if not exists user_mpins_email_key
  on public.user_mpins (lower(email));

-- RLS on, and deliberately no policies: nothing reaches this table except the
-- SECURITY DEFINER functions below and the service role.
alter table public.user_mpins enable row level security;

-- ---------------------------------------------------------------------------
-- Set / replace the caller's MPIN (requires a live owner session)
-- ---------------------------------------------------------------------------

create or replace function public.set_user_mpin(p_mpin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'Sign in first, then set your MPIN');
  end if;

  if p_mpin is null or p_mpin !~ '^\d{4}$' then
    return jsonb_build_object('success', false, 'error', 'MPIN must be exactly 4 digits');
  end if;

  -- Owners only: auditors sign in through their own RPC and have no auth user.
  select lower(u.email)
  into v_email
  from public.app_users u
  where u.auth_user_id = v_uid
    and u.role = 'owner'
    and u.is_active = true
  limit 1;

  if v_email is null then
    select lower(email) into v_email from auth.users where id = v_uid;
  end if;

  if v_email is null then
    return jsonb_build_object('success', false, 'error', 'Account not found');
  end if;

  -- An address can only back one MPIN. If the same address somehow points at an
  -- older auth user, that stale row must go or the unique index would block us.
  delete from public.user_mpins
  where lower(email) = v_email
    and auth_user_id <> v_uid;

  insert into public.user_mpins (auth_user_id, email, mpin_hash)
  values (v_uid, v_email, crypt(p_mpin, gen_salt('bf', 10)))
  on conflict (auth_user_id) do update
    set email           = excluded.email,
        mpin_hash       = excluded.mpin_hash,
        failed_attempts = 0,
        locked_until    = null,
        updated_at      = now();

  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Does the caller already have an MPIN? (drives the post-login "set your MPIN")
-- ---------------------------------------------------------------------------

create or replace function public.mpin_status()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in');
  end if;

  return jsonb_build_object(
    'success', true,
    'mpin_set', exists (select 1 from public.user_mpins where auth_user_id = v_uid)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Remove the caller's MPIN (turns quick sign-in off everywhere)
-- ---------------------------------------------------------------------------

create or replace function public.clear_user_mpin()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in');
  end if;

  delete from public.user_mpins where auth_user_id = v_uid;
  return jsonb_build_object('success', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Verify an MPIN — service_role only, called by the mpin-signin Edge Function.
-- Five wrong PINs lock quick sign-in for 15 minutes; the password always works.
-- ---------------------------------------------------------------------------

create or replace function public.verify_user_mpin(p_email text, p_mpin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row      public.user_mpins;
  v_attempts integer;
  v_minutes  integer;
begin
  if p_email is null or btrim(p_email) = '' or p_mpin is null or p_mpin !~ '^\d{4}$' then
    return jsonb_build_object('success', false, 'error', 'Enter your email and 4-digit MPIN');
  end if;

  select * into v_row
  from public.user_mpins
  where lower(email) = lower(btrim(p_email))
  limit 1;

  if v_row.auth_user_id is null then
    return jsonb_build_object(
      'success', false,
      'not_set', true,
      'error', 'No MPIN is set for this email. Sign in with your password once, then choose an MPIN.'
    );
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    v_minutes := greatest(1, ceil(extract(epoch from (v_row.locked_until - now())) / 60.0)::int);
    return jsonb_build_object(
      'success', false,
      'locked', true,
      'error', 'Too many wrong MPIN attempts. Try again in ' || v_minutes ||
               ' minute(s), or sign in with your password.'
    );
  end if;

  -- A deactivated owner must not be handed a session by the back door.
  if not exists (
    select 1
    from public.app_users u
    where u.auth_user_id = v_row.auth_user_id
      and u.role = 'owner'
      and u.is_active = true
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'This account is not active. Contact support.'
    );
  end if;

  if v_row.mpin_hash = crypt(p_mpin, v_row.mpin_hash) then
    update public.user_mpins
       set failed_attempts = 0,
           locked_until    = null,
           last_used_at    = now(),
           updated_at      = now()
     where auth_user_id = v_row.auth_user_id;

    return jsonb_build_object('success', true, 'user_id', v_row.auth_user_id, 'email', v_row.email);
  end if;

  v_attempts := v_row.failed_attempts + 1;

  update public.user_mpins
     set failed_attempts = case when v_attempts >= 5 then 0 else v_attempts end,
         locked_until    = case when v_attempts >= 5 then now() + interval '15 minutes' else null end,
         updated_at      = now()
   where auth_user_id = v_row.auth_user_id;

  if v_attempts >= 5 then
    return jsonb_build_object(
      'success', false,
      'locked', true,
      'error', 'Too many wrong MPIN attempts. Quick sign-in is locked for 15 minutes — use your password.'
    );
  end if;

  return jsonb_build_object(
    'success', false,
    'error', 'Incorrect MPIN. ' || (5 - v_attempts) || ' attempt(s) left before quick sign-in locks.'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Emergency developer override — resolve an account for the master MPIN.
-- service_role only, called by the mpin-signin Edge Function AFTER it has
-- matched the caller's input against the MASTER_MPIN secret. It checks NO PIN:
-- the secret has already been proven. It only confirms the email belongs to an
-- active owner, so the override can never mint a session for a stranger's email,
-- a deactivated account, or (via generate_link's should_create_user) a brand-new
-- account that was never real. There is no failure counter here on purpose — the
-- override's protection is that MASTER_MPIN is a secret, not that it is rate
-- limited; keep it secret and rotate it if it leaks.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_master_owner(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row record;
begin
  if p_email is null or btrim(p_email) = '' then
    return jsonb_build_object('success', false, 'error', 'Enter the account email');
  end if;

  select u.auth_user_id, lower(a.email) as email
  into v_row
  from public.app_users u
  join auth.users a on a.id = u.auth_user_id
  where lower(a.email) = lower(btrim(p_email))
    and u.role = 'owner'
    and u.is_active = true
  limit 1;

  if v_row.auth_user_id is null then
    return jsonb_build_object(
      'success', false,
      'error', 'No active owner account for that email.'
    );
  end if;

  return jsonb_build_object('success', true, 'user_id', v_row.auth_user_id, 'email', v_row.email);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Postgres grants EXECUTE to PUBLIC by default, so revoke before granting —
-- otherwise anon could brute-force the PIN straight through PostgREST.
revoke all on function public.verify_user_mpin(text, text) from public;
revoke all on function public.verify_user_mpin(text, text) from anon;
revoke all on function public.verify_user_mpin(text, text) from authenticated;
grant execute on function public.verify_user_mpin(text, text) to service_role;

revoke all on function public.resolve_master_owner(text) from public;
revoke all on function public.resolve_master_owner(text) from anon;
revoke all on function public.resolve_master_owner(text) from authenticated;
grant execute on function public.resolve_master_owner(text) to service_role;

revoke all on function public.set_user_mpin(text) from public;
revoke all on function public.set_user_mpin(text) from anon;
grant execute on function public.set_user_mpin(text) to authenticated;

revoke all on function public.mpin_status() from public;
revoke all on function public.mpin_status() from anon;
grant execute on function public.mpin_status() to authenticated;

revoke all on function public.clear_user_mpin() from public;
revoke all on function public.clear_user_mpin() from anon;
grant execute on function public.clear_user_mpin() to authenticated;
