import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const fallbackSupabaseUrl = 'https://ynqncdczpumsenjhcmxk.supabase.co';
const fallbackSupabaseAnonKey = 'sb_publishable_gZDEZe5HgReOgCGDueMAzg_VETlA0sh';

const effectiveSupabaseUrl = supabaseUrl || fallbackSupabaseUrl;
const effectiveSupabaseAnonKey = supabaseAnonKey || fallbackSupabaseAnonKey;

export const isSupabaseConfigured = Boolean(effectiveSupabaseUrl && effectiveSupabaseAnonKey);

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Using local development fallback credentials.');
}

// Talk to Supabase through our own origin (/api/sb) instead of supabase.co
// directly. Many users' networks/ISPs can't reach supabase.co (causing
// "TypeError: Failed to fetch" on every device), but they CAN reach our Vercel
// domain — and Vercel's servers reach Supabase fine. The /api/sb edge function
// (api/proxy.ts) forwards the request and strips cookies.
// Set VITE_SUPABASE_PROXY_PATH=direct to force a direct connection.
const configuredProxy = import.meta.env.VITE_SUPABASE_PROXY_PATH;
const proxyPath =
  configuredProxy === 'direct' ? '' : (configuredProxy && configuredProxy.trim()) || '/api/sb';

const clientUrl =
  proxyPath && typeof window !== 'undefined'
    ? `${window.location.origin}${proxyPath}`
    : effectiveSupabaseUrl;

// Never attach cookies to a Supabase call. /api/sb is on our own origin, so the
// browser treats every cookie set on the domain as first-party and sends the
// whole jar with each request. Vercel's edge rejects a request whose headers
// exceed its limit with REQUEST_HEADER_TOO_LARGE *before* api/proxy.ts runs, so
// stripping them inside the proxy is too late — the sign-in call fails with the
// right password and no server log. Supabase authenticates with the apikey and
// Authorization headers alone and has no use for cookies, so omitting them costs
// nothing and puts a hard ceiling on the request size.
const fetchWithoutCookies: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: 'omit' });

export const supabase = createClient(clientUrl, effectiveSupabaseAnonKey, {
  global: { fetch: fetchWithoutCookies },
});
