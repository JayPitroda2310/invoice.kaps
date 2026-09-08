import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, CircleCheck, Eye, EyeOff, Lock, Receipt, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';

/** Shared with LandingPage so the reset page opens in the theme the user picked. */
const THEME_KEY = 'kaps-landing-theme';
const MIN_PASSWORD_LENGTH = 8;

type Stage = 'checking' | 'ready' | 'invalid' | 'done';

/**
 * Landing page for the emailed password-reset link.
 *
 * The link carries the recovery token as `?token_hash=…&type=recovery` and this
 * page holds onto it, spending it only when the form is submitted. That matters:
 * a recovery token is single-use, and the older link — which pointed straight at
 * Supabase's `/auth/v1/verify` — was consumed by the first GET, so mail scanners,
 * link previewers and antivirus proxies burned it before the user could click.
 * The link then looked expired the moment the email arrived. Nothing fetches this
 * page's form and submits it, so the token now survives until a person uses it.
 *
 * Older links (and anything still routed through `/auth/v1/verify`) instead land
 * with `#access_token=…`, which the client turns into a session automatically
 * (detectSessionInUrl); that path still works. AuthContext deliberately ignores
 * whichever session results so the link can't be used as a back door into the
 * app — it only exists so `updateUser({ password })` is authorised. A dead link
 * arrives as `#error_code=…` with no session at all.
 */
export function ResetPassword() {
  const navigate = useNavigate();
  const { completePasswordReset } = useAuth();

  const [stage, setStage] = useState<Stage>('checking');
  const [linkError, setLinkError] = useState('');
  // Held, not spent: the token is exchanged in handleSubmit so a link-scanning
  // bot can never consume it on the user's behalf.
  const [tokenHash, setTokenHash] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const isDark = (() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark';
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    // The current email template puts the token in the query string. Take it,
    // then scrub it out of the address bar so it is not left in history or
    // leaked through a Referer header.
    const queryParams = new URLSearchParams(window.location.search);
    const queryToken = queryParams.get('token_hash') || queryParams.get('token');

    if (queryToken) {
      setTokenHash(queryToken);
      setStage('ready');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    // Read the hash before Supabase strips it — a dead link carries its reason
    // there and never produces a session.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const errorCode = hashParams.get('error_code') || hashParams.get('error');

    if (errorCode) {
      setLinkError(
        errorCode === 'otp_expired'
          ? 'This reset link has expired. Reset links are only valid for 15 minutes — request a new one below.'
          : (hashParams.get('error_description') || '').replace(/\+/g, ' ') ||
            'This reset link is no longer valid. Request a new one below.'
      );
      setStage('invalid');
      return;
    }

    let active = true;

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) {
        setStage((current) => (current === 'done' ? current : 'ready'));
      }
    });

    // getSession() resolves only after the client has finished parsing the URL,
    // so a null session here means the link carried no usable token.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) {
        return;
      }
      if (session) {
        setStage((current) => (current === 'done' ? current : 'ready'));
        return;
      }
      setLinkError('This reset link is invalid or has already been used. Request a new one below.');
      setStage((current) => (current === 'done' ? current : 'invalid'));
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setSaving(true);
    const result = await completePasswordReset(password, tokenHash || undefined);
    setSaving(false);

    if (result.success) {
      setPassword('');
      setConfirmPassword('');
      setStage('done');
      return;
    }

    // A spent or expired token can't be retried by typing again — swap the form
    // for the "request another link" screen instead of looping on a toast.
    if (result.linkDead) {
      setLinkError(result.error || 'This reset link is no longer valid. Request a new one below.');
      setStage('invalid');
      return;
    }

    toast.error(result.error || 'Could not update your password');
  };

  const goToSignIn = () => navigate('/?signin=1', { replace: true });

  return (
    <div
      className={`${isDark ? 'dark' : ''} min-h-screen w-full flex items-center justify-center p-4 bg-[#fafbfd] dark:bg-[#050516] text-slate-900 dark:text-white antialiased`}
      style={{ fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif" }}
    >
      <div className="relative max-w-md w-full rounded-2xl p-[1px] bg-gradient-to-br from-violet-500/50 via-slate-200 dark:via-white/10 to-violet-500/30">
        <div className="rounded-[15px] bg-white dark:bg-[#0a0a26]/95 backdrop-blur overflow-hidden">
          <div className="px-6 pt-7 pb-4 border-b border-slate-200 dark:border-white/[0.08]">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
                <Receipt className="w-4 h-4 text-white" strokeWidth={2.25} />
              </div>
              <h1 className="text-[16px] font-medium tracking-tight text-slate-900 dark:text-white">
                {stage === 'done' ? 'Password updated' : 'Choose a new password'}
              </h1>
            </div>
            <p className="text-[13px] text-slate-600 dark:text-white/55 mt-4">
              {stage === 'done'
                ? 'Sign in with your new password to get back into your workspace.'
                : 'Set a new password for your GSTInvoice Pro owner account.'}
            </p>
          </div>

          {stage === 'checking' && (
            <div className="p-6 flex items-center gap-3 text-[13px] text-slate-600 dark:text-white/60">
              <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              Verifying your reset link…
            </div>
          )}

          {stage === 'invalid' && (
            <div className="p-6 space-y-5">
              <div className="flex gap-3 px-4 py-3.5 rounded-xl bg-amber-50 dark:bg-amber-500/[0.08] border border-amber-200 dark:border-amber-400/25">
                <TriangleAlert className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
                <p className="text-[12.5px] leading-relaxed text-amber-800 dark:text-amber-200">{linkError}</p>
              </div>
              <button
                type="button"
                onClick={goToSignIn}
                className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all"
              >
                Back to sign in
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
              </button>
            </div>
          )}

          {stage === 'ready' && (
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">
                  New password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-white/40" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-11 pl-10 pr-11 text-[14px] rounded-[0.625rem] border border-violet-500/35 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 focus:outline-none focus:border-violet-500/60 focus:ring-[3px] focus:ring-violet-500/15 transition"
                    placeholder={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
                    autoComplete="new-password"
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">
                  Confirm new password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-white/40" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full h-11 pl-10 pr-4 text-[14px] rounded-[0.625rem] border border-violet-500/35 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 focus:outline-none focus:border-violet-500/60 focus:ring-[3px] focus:ring-violet-500/15 transition"
                    placeholder="Re-enter the new password"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all disabled:opacity-60 disabled:cursor-wait"
              >
                {saving ? 'Updating…' : 'Update password'}
                {!saving && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />}
              </button>

              <p className="text-[11.5px] leading-relaxed text-slate-500 dark:text-white/45">
                Your 4-digit MPIN is not affected — it belongs to your account, not to the password,
                so quick sign-in keeps working on every device.
              </p>
            </form>
          )}

          {stage === 'done' && (
            <div className="p-6 space-y-5">
              <div className="flex gap-3 px-4 py-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/[0.08] border border-emerald-200 dark:border-emerald-400/25">
                <CircleCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
                <p className="text-[12.5px] leading-relaxed text-emerald-800 dark:text-emerald-200">
                  Your password has been changed. You've been signed out everywhere for safety.
                </p>
              </div>
              <button
                type="button"
                onClick={goToSignIn}
                className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all"
              >
                Sign in
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
