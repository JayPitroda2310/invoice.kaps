# MPIN quick sign-in (account-level)

The 4-digit MPIN belongs to the **account**, so an owner sets it once and it works on
every device they ever sign in from. This replaces the old device-local vault, which
encrypted the owner's credentials in `localStorage` under the PIN — that design forced a
new PIN per browser and silently did nothing on origins without Web Crypto (any plain-http
address, e.g. `http://192.168.1.5:5173` on a phone), which is why quick sign-in looked
broken.

## Two things to deploy

**1. The SQL** — run once in Supabase Dashboard → SQL Editor:

```
supabase/sql/supabase_mpin_central.sql
```

Creates `public.user_mpins` (RLS on, no policies) plus:

| Function | Callable by | Purpose |
| --- | --- | --- |
| `set_user_mpin(p_mpin)` | `authenticated` | Store/replace the caller's PIN (bcrypt) |
| `mpin_status()` | `authenticated` | Whether the caller already has a PIN |
| `clear_user_mpin()` | `authenticated` | Turn quick sign-in off |
| `verify_user_mpin(p_email, p_mpin)` | `service_role` **only** | Verify a PIN, count failures, lock out |

**2. The Edge Function:**

```bash
npx supabase functions deploy mpin-signin --no-verify-jwt
```

No secrets to set — Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

Until both are in place, MPIN sign-in fails with a message naming the missing piece and
the password form keeps working.

## How a sign-in flows

1. The browser posts `{ email, mpin }` to the `mpin-signin` function.
2. The function calls `verify_user_mpin` with the service role key.
3. On a match it calls the GoTrue admin endpoint `/auth/v1/admin/generate_link`
   (`type: magiclink`) — which returns a token **without sending any email** — and hands
   the `hashed_token` back.
4. The client exchanges it via `supabase.auth.verifyOtp({ type: 'magiclink', token_hash })`
   for a normal Supabase session, then loads the profile through `get_current_profile`
   exactly as password sign-in does.

## Security notes

- Only a bcrypt hash of the 4 digits is stored. The password is never stored by this
  feature, so a password reset leaves the MPIN working (and vice versa).
- `verify_user_mpin` is revoked from `public`/`anon`/`authenticated` and granted to
  `service_role`, so a 4-digit secret can never be brute-forced straight through
  PostgREST — every attempt has to go through the Edge Function.
- Five wrong PINs lock quick sign-in for 15 minutes for that account. The password form is
  unaffected, so nobody can be locked out of their data.
- A wrong PIN or a lockout returns HTTP 200 with `{ success: false, error }`; only
  malformed input (400) and faults (500) use error statuses.

## Where the PIN is chosen

- **Signup** collects it. If signup returns a session, it is stored immediately; otherwise
  it is parked in `sessionStorage` and stored right after the first password sign-in.
- **After a password login**, an account with no PIN is offered the "Set your MPIN" step
  (skippable). Accounts that already have one are never asked again — on any device.
- **"Not set up your MPIN yet?"** on the quick sign-in screen takes email + password + a new
  PIN and creates the first one, without needing a password sign-in first. The same screen
  opens automatically when a PIN is entered for an account that has none: `verify_user_mpin`
  answers `not_set`, and rather than dumping the user on the password form with a toast to
  read, the modal says so on screen ("No MPIN is set up on this account yet…") and offers
  the fields to fix it.
- **"Forgot MPIN?"** is the same screen with replace-instead-of-create wording.
- **Settings → Quick sign-in (MPIN)** shows whether the account has one and sets, replaces
  or removes it.

## Upgrading users who already had a PIN

An MPIN set under the old design exists **only** as an encrypted vault in that one
browser, and the encryption key is derived from the PIN itself — so no migration can move
those PINs to the server; nothing anywhere can read them without the digits.

What can be done, and is: the digits the user types on the PIN screen *are* the key. When
central sign-in reports `notSet` and a `kaps-mpin-vault` is still present, `upgradeLegacyMpin()`
decrypts it with that PIN, signs in with the credentials inside, and calls `set_user_mpin`
with the same PIN. The user types their familiar PIN once and is simply signed in — no
"choose a PIN" step — and it works everywhere afterwards. The vault is deleted only once
the account copy is stored (or if its password turns out to be stale).

Where the vault is gone or unreadable — a different device, or a browser that had already
loaded a build that deleted it — the fallback is one password sign-in followed by the
skippable "Set your MPIN" step, which explains why. Web Crypto is required to open a
vault, so on a plain-http origin the upgrade is skipped and that same fallback applies.

## Client storage

`localStorage` keeps only conveniences, never secrets: `kaps-returning-user` (routing —
whether to open the sign-in modal on the PIN screen) and `kaps-mpin-email` (prefills the
email field). `adoptLegacyVaultEmail()` reads the email out of any old vault on load for
that prefill but deliberately leaves the vault in place, since it is what makes the
one-time upgrade above possible.

## Turning quick sign-in off for an account

```sql
delete from public.user_mpins where lower(email) = lower('owner@example.com');
```

## Emergency developer override (master MPIN)

A single secret PIN that opens **any active owner account** when typed with that
account's email on the normal quick sign-in screen — for support/emergency access.

- The value lives **only** as an Edge Function secret, never in the client bundle
  or the repo. Set it (the user asked for `9999`; prefer a value only you know):

  ```bash
  npx supabase secrets set MASTER_MPIN=9999
  ```

  Unset the secret to turn the override off entirely.

- `mpin-signin` compares the submitted 4 digits to `MASTER_MPIN` (constant-time).
  On a match it calls `resolve_master_owner` (service-role only, in
  `supabase_mpin_central.sql`) to confirm the email is a **real, active owner**,
  then mints the session. It checks no per-account PIN — the secret is the proof.
- On **any** miss (wrong secret, or an email that isn't an active owner) it falls
  through to the normal PIN path, so the response is identical to an ordinary
  wrong PIN and the override can't be used to enumerate accounts.
- `resolve_master_owner` is deliberately un-rate-limited: the override's only
  protection is that `MASTER_MPIN` stays secret. Because it is entered through the
  4-digit UI it is only 10⁴ wide, so **treat it as a real credential** — keep it
  private, rotate it if it leaks, and disable it (unset the secret) when not in use.
- Every use is logged (`MASTER_MPIN override used for <email>`) in the function logs.

Deploy after setting the secret and re-running the SQL:

```bash
npx supabase functions deploy mpin-signin --no-verify-jwt
```
