# Password Reset — Setup

The "Forgot password?" flow in the sign-in modal is **owner-only** (auditors authenticate
through `verify_auditor_login` / pgcrypto and are not Supabase Auth users).

The app code is already in place:

| Piece | File |
| --- | --- |
| `requestPasswordReset()` / `completePasswordReset()` | `src/contexts/AuthContext.tsx` |
| "Forgot password?" entry points + email screens | `src/app/components/LandingPage.tsx` |
| The page the emailed link opens | `src/app/components/auth/ResetPassword.tsx` |
| Route | `src/app/App.tsx` → `/reset-password` |

Delivery uses **Supabase's built-in email service** — no AWS, no SMTP credentials, nothing
to pay for. What remains is four settings in the Supabase dashboard.

> Invoice email is unaffected. It still goes out through AWS SES via the
> `send-invoice-email` Edge Function; only the password-reset email uses Supabase's mailer.

## Direct links

Supabase project ref: `ynqncdczpumsenjhcmxk`

| Step | Where |
| --- | --- |
| 1. URL Configuration | https://supabase.com/dashboard/project/ynqncdczpumsenjhcmxk/auth/url-configuration |
| 2. Email OTP Expiration | https://supabase.com/dashboard/project/ynqncdczpumsenjhcmxk/auth/providers → expand **Email** |
| 3. Email templates | https://supabase.com/dashboard/project/ynqncdczpumsenjhcmxk/auth/templates |
| 4. Rate limits | https://supabase.com/dashboard/project/ynqncdczpumsenjhcmxk/auth/rate-limits |

If a link lands somewhere unexpected — Supabase reshuffles this navigation periodically —
the same settings also live under Project Settings → Authentication:
https://supabase.com/dashboard/project/ynqncdczpumsenjhcmxk/settings/auth

---

## Two limits of the built-in mailer

Both are inherent to the shared service, not something the app code can work around.

**1. The From address says Supabase and cannot be changed.**
Mail arrives from `noreply@mail.app.supabase.io`. The subject, the body, the branding and
the link domain are all fully ours (step 3 below strips every Supabase reference from
them), but the sender line is Supabase's and there is no setting for it. The only way to
send from your own address is Custom SMTP — any provider will do, and several have free
tiers. See "If you want your own From address" at the end.

**2. It is rate limited to a couple of emails per hour, project-wide.**
Supabase documents the built-in service as being for testing, not production. The cap is
shared across the whole project, so a handful of users requesting resets in the same hour
will start getting failures. `requestPasswordReset()` surfaces that as "Too many reset
requests. Wait a minute before trying again." Fine while you're testing and for very low
volume; not fine once real users depend on it.

---

## 1. Allow the redirect URL

**Authentication → URL Configuration**

- **Site URL** — `https://invoice.kapsca.in`
- **Redirect URLs** — add both:
  - `https://invoice.kapsca.in/reset-password`
  - `http://localhost:5173/reset-password`

Supabase refuses any `redirectTo` that is not on this list and silently falls back to the
Site URL, which would drop the user on the marketing page instead of the reset form.

## 2. Set the link lifetime to 15 minutes

**Authentication → Sign In / Providers → Email → Email OTP Expiration** → `900` (seconds).

This is the `MAILER_OTP_EXP` setting and is project-wide: it governs recovery, magic-link,
and confirmation emails alike. The reset screens tell the user "15 minutes", so keep the two
in sync if you change it.

An expired link comes back as `#error_code=otp_expired`, which `ResetPassword.tsx` turns
into a "request a new one" message rather than a dead page.

## 3. Replace the email template

**Authentication → Emails → Templates → Reset Password**

Set the subject to:

```
Reset your GSTInvoice Pro password
```

and replace the message body with the contents of `docs/reset-password-email.html`
(in this repo). It carries GSTInvoice Pro branding, mentions the 15-minute expiry, and
contains no reference to Supabase.

The link in it points straight at our own page and carries the token as a query param:

```
{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery
```

**This is what stops links expiring on arrival.** It deliberately does **not** use
`{{ .ConfirmationURL }}` or any `/auth/v1/verify` URL. A recovery token is single-use, and
`/auth/v1/verify` spends it on the **first GET** — so Outlook Safe Links, corporate mail
gateways, antivirus scanners and chat-app link previewers, all of which fetch every URL in
a message the moment it is delivered, burned the token before the recipient could click.
The user then landed on `#error_code=otp_expired` seconds after the email arrived.

With the token in a query param, `ResetPassword.tsx` reads it, scrubs it from the address
bar and holds it in memory, exchanging it via `verifyOtp({ type: 'recovery', token_hash })`
only when the new password is submitted. Scanners fetch HTML; they do not fill in forms, so
the token survives until a person uses it.

`{{ .RedirectTo }}` is the `redirectTo` that `requestPasswordReset()` passes — the current
origin plus `/reset-password` — so the same template serves production and localhost, as
long as both are on the Redirect URLs allowlist from step 1. Links sent by the older
template still work: the page keeps its `#access_token=…` path as a fallback.

## 4. Rate limits

**Authentication → Rate Limits → Rate limit for sending emails.** On the built-in service
this is capped low and cannot be raised meaningfully — the field only becomes useful once
Custom SMTP is configured. Worth looking at so you know the current number.

---

## How it behaves

1. User clicks **Forgot password?** in the sign-in modal (available on both the MPIN screen
   and the email + password screen) and submits their email.
2. The modal always shows the same "check your inbox" confirmation — it never reveals
   whether an address has an account.
3. The emailed link opens `/reset-password`, where the user sets a password of at least
   8 characters (matching the signup rule) and confirms it.
4. The token is exchanged and the password changed in the same submit. On success the user
   is signed out, the obsolete device vault is cleared (it still holds the old password, so
   quick sign-in would otherwise replay stale credentials), and they are sent back to
   `/?signin=1`, which reopens the modal on the email + password screen.
5. Signing in with the new password lands on a "set your MPIN" step only if the account has
   no MPIN. The MPIN lives on the account as its own bcrypt hash, so a password reset does
   not disturb it — anyone who already had one keeps it.

If the token turns out to be spent or expired at submit time, the page swaps to the "request
a new one" screen rather than looping on a toast.

Quick sign-in has its own doors on the PIN screen: **Forgot MPIN?** replaces an existing PIN
and **Not set up your MPIN yet?** creates a first one. Both take email + password + 4 digits.
A user who has forgotten both resets the password first, then sets a PIN.

### Security note

A recovery link creates a real Supabase session so `updateUser({ password })` is authorised.
`AuthContext` deliberately ignores every auth event while the browser is on
`/reset-password`, so following the link never grants app access on its own — only a
completed password change, followed by a normal sign-in, does.

---

## If you want your own From address

Nothing in the app changes — this is purely
**Authentication → Emails → SMTP Settings → enable Custom SMTP**, then fill in host, port,
username, password, sender email and sender name. The template from step 3 stays as it is.

Any SMTP provider works. Whichever you pick, the sender address (or its domain) has to be
verified with that provider first, and adding SPF/DKIM records to your domain's DNS is what
keeps the mail out of spam folders. You already control `kapsca.in`, so
`noreply@kapsca.in` is the natural sender once you get there.

That also lifts the rate limit — which, more than the From address, is the reason to do it
before real users depend on this.
