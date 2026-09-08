// @ts-nocheck — this is a Deno Edge Function; the `Deno` global resolves at
// deploy time, not in VSCode's Node-flavoured TS checker.
//
// MPIN quick sign-in. Takes { email, mpin }, verifies the 4 digits against the
// bcrypt hash in public.user_mpins, and — only on a match — mints a one-shot
// magic-link token the browser exchanges for a real Supabase session.
//
// The password is never involved, which is what makes the PIN work on every
// device: nothing has to be stored on the device at all.
//
// Deploy:
//   npx supabase functions deploy mpin-signin --no-verify-jwt
//
// Prerequisite: run supabase/sql/supabase_mpin_central.sql once (creates the
// table plus verify_user_mpin, which is granted to service_role only).
//
// Secrets: none to set by hand — Supabase injects SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY into every function.
//
// Note on status codes: a wrong PIN / locked account comes back as HTTP 200 with
// { success: false, error }. Only malformed input (400) and misconfiguration or
// upstream faults (500) use error statuses, so the client can always read the
// message without unwrapping a FunctionsHttpError.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Length-checked, constant-time-ish string compare so the master-PIN check does
// not leak its value through timing. For a 4-digit secret this is belt-and-
// braces, but it costs nothing.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey) {
    return json(
      {
        success: false,
        error:
          'MPIN sign-in is not configured on the server (missing service role key). Redeploy the function.',
      },
      500,
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const email = String(payload?.email ?? '').trim().toLowerCase();
  const mpin = String(payload?.mpin ?? '').trim();

  if (!email || !/^\d{4}$/.test(mpin)) {
    return json({ success: false, error: 'Enter your email and 4-digit MPIN' }, 400);
  }

  const adminHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  let verdict = null;

  // ---- 0. Emergency developer override (master MPIN) ----
  // If the submitted PIN equals the MASTER_MPIN secret, skip per-account PIN
  // verification and open the named account directly — but only if it is a real,
  // active owner. resolve_master_owner enforces that; without it generate_link
  // would create a session (and a user) for any email typed here. MASTER_MPIN
  // unset = override off. On any miss we fall through to the normal PIN path, so
  // the response is indistinguishable from an ordinary wrong-PIN attempt and the
  // override can't be used to probe which emails are owners.
  const masterMpin = (Deno.env.get('MASTER_MPIN') || '').trim();
  if (masterMpin && safeEqual(mpin, masterMpin)) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_master_owner`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ p_email: email }),
      });
      const body = await response.text();
      if (response.ok) {
        const resolved = body ? JSON.parse(body) : null;
        if (resolved?.success) {
          console.warn('MASTER_MPIN override used for', email);
          verdict = { success: true, email: resolved.email || email, user_id: resolved.user_id };
        }
      } else {
        // A missing RPC shouldn't kill the normal path — just log and fall through.
        console.error('resolve_master_owner failed:', response.status, body);
      }
    } catch (error) {
      console.error('resolve_master_owner threw:', error);
    }
  }

  // ---- 1. Verify the PIN (rate limiting / lockout lives in the RPC) ----
  if (!verdict) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/verify_user_mpin`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ p_email: email, p_mpin: mpin }),
      });

      const body = await response.text();

      if (!response.ok) {
        console.error('verify_user_mpin failed:', response.status, body);
        const missing = /could not find the function|does not exist/i.test(body);
        return json(
          {
            success: false,
            error: missing
              ? 'MPIN sign-in is not set up on this project yet. Run supabase/sql/supabase_mpin_central.sql in the Supabase SQL Editor.'
              : 'Could not verify your MPIN right now. Sign in with your password.',
          },
          500,
        );
      }

      verdict = body ? JSON.parse(body) : null;
    } catch (error) {
      console.error('verify_user_mpin threw:', error);
      return json(
        { success: false, error: 'Could not verify your MPIN right now. Sign in with your password.' },
        500,
      );
    }
  }

  if (!verdict?.success) {
    // Wrong PIN, unknown email, or a lockout — the RPC already wrote a
    // user-facing message, and this is a normal outcome, not a fault.
    return json({
      success: false,
      error: verdict?.error || 'Incorrect MPIN',
      locked: Boolean(verdict?.locked),
      notSet: Boolean(verdict?.not_set),
    });
  }

  // ---- 2. Mint a single-use magic-link token for the verified account ----
  // The admin endpoint returns the token without emailing anything; the browser
  // trades it for a session via supabase.auth.verifyOtp().
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ type: 'magiclink', email: verdict.email || email }),
    });

    const body = await response.text();

    if (!response.ok) {
      console.error('generate_link failed:', response.status, body);
      return json(
        { success: false, error: 'Could not start your session. Sign in with your password.' },
        500,
      );
    }

    const parsed = body ? JSON.parse(body) : {};
    // The raw admin API returns these at the top level; supabase-js nests them
    // under `properties`. Accept either shape.
    const tokenHash = parsed?.hashed_token || parsed?.properties?.hashed_token;

    if (!tokenHash) {
      console.error('generate_link returned no hashed_token:', body);
      return json(
        { success: false, error: 'Could not start your session. Sign in with your password.' },
        500,
      );
    }

    return json({ success: true, token_hash: tokenHash, email: verdict.email || email });
  } catch (error) {
    console.error('generate_link threw:', error);
    return json(
      { success: false, error: 'Could not start your session. Sign in with your password.' },
      500,
    );
  }
});
