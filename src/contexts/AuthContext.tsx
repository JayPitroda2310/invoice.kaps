import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { clearLegacyMpinVault, isValidMpin } from '../lib/mpin';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'owner' | 'auditor';
  company_id?: string;
  company_name?: string;
  company_gstin?: string;
  company_logo?: string;
  is_active: boolean;
}

interface Permission {
  permission_name: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

interface AuthMetadata {
  full_name?: string;
  company_name?: string;
  company_gstin?: string;
  company_logo?: string;
  gstin?: string;
}

interface AuditorCompany {
  auditor_id: string;
  company_id: string;
  company_name: string;
  company_logo: string | null;
  full_name: string;
}

interface AuthContextType {
  user: User | null;
  permissions: Permission[];
  isAuthenticated: boolean;
  isOwner: boolean;
  login: (email: string, password: string, role?: 'owner' | 'auditor') => Promise<{ success: boolean; error?: string }>;
  loginWithMpin: (email: string, mpin: string) => Promise<{ success: boolean; error?: string; locked?: boolean; notSet?: boolean }>;
  saveMpin: (mpin: string) => Promise<{ success: boolean; error?: string }>;
  hasMpin: () => Promise<{ set: boolean; known: boolean }>;
  clearMpin: () => Promise<{ success: boolean; error?: string }>;
  lookupAuditorCompanies: (email: string) => Promise<{ success: boolean; companies?: AuditorCompany[]; error?: string }>;
  loginAuditorById: (auditorId: string, password: string) => Promise<{ success: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  completePasswordReset: (
    newPassword: string,
    tokenHash?: string,
  ) => Promise<{ success: boolean; error?: string; linkDead?: boolean }>;
  logout: () => Promise<void>;
  hasPermission: (resource: string, action?: 'view' | 'create' | 'edit' | 'delete') => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const OWNER_PERMISSIONS = [
  'dashboard',
  'customers',
  'items',
  'invoices',
  'delivery-challans',
  'credit-notes',
  'receipts',
  'outstanding',
  'payment-vouchers',
  'reports',
  'auditor-management',
];

const ownerPermissions = OWNER_PERMISSIONS.map((permission_name) => ({
  permission_name,
  can_view: true,
  can_create: true,
  can_edit: true,
  can_delete: true,
}));

const SESSION_RESTORE_TIMEOUT_MS = 5000;

/** Route the emailed password-reset link points back to. */
export const PASSWORD_RESET_PATH = '/reset-password';

/**
 * A recovery link creates a real Supabase session so `updateUser()` can change
 * the password — but it must NOT be treated as a normal sign-in, or clicking the
 * link would hand out full app access without anyone knowing the password. While
 * the reset page is open we ignore auth events instead of storing an app session.
 */
function isPasswordRecoveryContext(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.location.pathname.startsWith(PASSWORD_RESET_PATH);
}

function readStoredSession() {
  try {
    const storedUser = localStorage.getItem('user');
    const storedPermissions = localStorage.getItem('permissions');

    if (!storedUser || !storedPermissions) {
      return { user: null, permissions: [] };
    }

    return {
      user: JSON.parse(storedUser) as User,
      permissions: JSON.parse(storedPermissions) as Permission[],
    };
  } catch (error) {
    console.error('Stored session is invalid:', error);
    localStorage.removeItem('user');
    localStorage.removeItem('permissions');
    localStorage.removeItem('userRole');
    return { user: null, permissions: [] };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out. Please refresh or check your Supabase connection.`));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

const NETWORK_ERROR_MESSAGE =
  'Could not reach the authentication server. This is usually caused by an ad-blocker or privacy extension (uBlock, Brave Shields, AdGuard) blocking the login request, a VPN/corporate proxy, or no internet connection. Disable the blocker for this site (allowlist *.supabase.co) or try an incognito window, then sign in again.';

function isNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch|networkerror|load failed|fetch failed|err_/i.test(message);
}

function describeAuthError(error: unknown, fallback: string): string {
  if (isNetworkFailure(error)) {
    return NETWORK_ERROR_MESSAGE;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

/**
 * Turns a failed recovery-token exchange into something a user can act on. Both
 * "expired" and "already used" come back from GoTrue as the same family of
 * errors, and both mean the same thing here: this link is spent, ask for another.
 */
function describeRecoveryLinkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/expired/i.test(message)) {
    return 'This reset link has expired. Request a new one below.';
  }
  if (/invalid|not found|already/i.test(message)) {
    return 'This reset link is no longer valid — it may already have been used. Request a new one below.';
  }
  return message || 'This reset link could not be verified. Request a new one below.';
}

function buildOwnerUser(profile: any, metadata: AuthMetadata = {}): User {
  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name || metadata.full_name || profile.email,
    role: 'owner',
    company_id: profile.company_id,
    company_name: profile.company_name || metadata.company_name,
    company_gstin: profile.company_gstin || metadata.company_gstin || metadata.gstin,
    company_logo: profile.company_logo || metadata.company_logo,
    is_active: profile.is_active,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [storedSession] = useState(readStoredSession);
  const [user, setUser] = useState<User | null>(storedSession.user);
  const [permissions, setPermissions] = useState<Permission[]>(storedSession.permissions);

  useEffect(() => {
    restoreSession();

    if (!isSupabaseConfigured) {
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isPasswordRecoveryContext()) {
        return;
      }

      if (!session) {
        const storedRole = localStorage.getItem('userRole');
        if (storedRole !== 'auditor') {
          clearSession();
        }
        return;
      }

      const storedRole = localStorage.getItem('userRole');
      if (storedRole !== 'auditor') {
        refreshOwnerSession(session);
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const clearSession = () => {
    setUser(null);
    setPermissions([]);
    localStorage.removeItem('user');
    localStorage.removeItem('permissions');
    localStorage.removeItem('userRole');
  };

  const storeSession = (nextUser: User, nextPermissions: Permission[]) => {
    setUser(nextUser);
    setPermissions(nextPermissions);
    localStorage.setItem('user', JSON.stringify(nextUser));
    localStorage.setItem('permissions', JSON.stringify(nextPermissions));
    localStorage.setItem('userRole', nextUser.role);
  };

  const repairCompanyGstin = async (nextUser: User) => {
    if (!nextUser.company_id || !nextUser.company_gstin) {
      return;
    }

    try {
      await supabase
        .from('companies')
        .update({ gstin: nextUser.company_gstin })
        .eq('id', nextUser.company_id);
    } catch (error) {
      console.warn('Company GSTIN repair skipped:', error);
    }
  };

  const refreshOwnerSession = async (session: any) => {
    const { data, error } = await withTimeout(
      supabase.rpc('get_current_profile'),
      SESSION_RESTORE_TIMEOUT_MS,
      'Profile refresh'
    );

    if (error || !data?.success) {
      return;
    }

    const profile = data.profile;
    const nextUser = buildOwnerUser(profile, session.user.user_metadata as AuthMetadata);
    storeSession(nextUser, ownerPermissions);

    if (!profile.company_gstin) {
      repairCompanyGstin(nextUser);
    }
  };

  const restoreSession = async () => {
    try {
      if (!isSupabaseConfigured || isPasswordRecoveryContext()) {
        return;
      }

      const storedRole = localStorage.getItem('userRole');
      if (storedRole === 'auditor' && user?.id) {
        const { data, error } = await withTimeout(
          supabase.rpc('refresh_auditor_session', { p_auditor_id: user.id }),
          SESSION_RESTORE_TIMEOUT_MS,
          'Auditor session refresh'
        );

        if (!error && data?.success) {
          const auditor = data.auditor;
          storeSession({
            id: auditor.id,
            email: auditor.email,
            full_name: auditor.full_name,
            role: 'auditor',
            company_id: auditor.company_id,
            company_name: auditor.company_name,
            company_gstin: auditor.company_gstin,
            company_logo: auditor.company_logo,
            is_active: true,
          }, auditor.permissions || []);
        } else {
          clearSession();
        }

        return;
      }

      const { data: { session } } = await withTimeout(
        supabase.auth.getSession(),
        SESSION_RESTORE_TIMEOUT_MS,
        'Session restore'
      );

      if (!session) {
        const storedRole = localStorage.getItem('userRole');
        if (storedRole !== 'auditor') {
          clearSession();
        }
        return;
      }

      await refreshOwnerSession(session);
    } catch (error) {
      console.error('Session restore failed:', error);
    }
  };

  const login = async (email: string, password: string, role: 'owner' | 'auditor' = 'owner') => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
    }

    try {
      if (role === 'auditor') {
        const { data, error } = await supabase.rpc('verify_auditor_login', {
          p_email: email,
          p_password: password,
        });

        if (error || !data?.success) {
          if (isNetworkFailure(error)) {
            return { success: false, error: NETWORK_ERROR_MESSAGE };
          }
          return { success: false, error: data?.error || error?.message || 'Invalid auditor credentials' };
        }

        const auditor = data.auditor;
        const auditorPermissions = (auditor.permissions || []).map((permission: Permission) => permission);

        storeSession({
          id: auditor.id,
          email: auditor.email,
          full_name: auditor.full_name,
          role: 'auditor',
          company_id: auditor.company_id,
          company_name: auditor.company_name,
          company_gstin: auditor.company_gstin,
          company_logo: auditor.company_logo,
          is_active: true,
        }, auditorPermissions);

        return { success: true };
      }

      const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return { success: false, error: describeAuthError(error, 'Login failed') };
      }

      return finalizeOwnerSession(authData.user?.user_metadata as AuthMetadata);
    } catch (error) {
      return { success: false, error: describeAuthError(error, 'Login failed') };
    }
  };

  /**
   * Turns a live Supabase session into an app session. Shared by the password
   * and MPIN sign-in paths, which differ only in how the session was obtained.
   */
  const finalizeOwnerSession = async (metadata: AuthMetadata = {}) => {
    const { data, error: profileError } = await supabase.rpc('get_current_profile');
    if (profileError || !data?.success) {
      if (isNetworkFailure(profileError)) {
        return { success: false, error: NETWORK_ERROR_MESSAGE };
      }
      await supabase.auth.signOut();
      return { success: false, error: data?.error || profileError?.message || 'Profile not found' };
    }

    const profile = data.profile;
    const nextUser = buildOwnerUser(profile, metadata);
    storeSession(nextUser, ownerPermissions);

    if (!profile.company_gstin) {
      repairCompanyGstin(nextUser);
    }

    return { success: true };
  };

  /**
   * Quick sign-in with the account's 4-digit MPIN. The PIN is checked by the
   * `mpin-signin` Edge Function (which alone can reach the service-role verify
   * RPC and its lockout counter); on a match it returns a single-use token that
   * verifyOtp() exchanges for a real session. No password is involved, so this
   * works on any device — including one that has never seen this account.
   */
  const loginWithMpin = async (email: string, mpin: string) => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      return { success: false, error: 'Enter the email address you signed up with' };
    }
    if (!isValidMpin(mpin)) {
      return { success: false, error: 'MPIN must be exactly 4 digits' };
    }

    try {
      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        token_hash?: string;
        error?: string;
        locked?: boolean;
        notSet?: boolean;
      }>('mpin-signin', { body: { email: trimmedEmail, mpin } });

      if (error) {
        // A wrong PIN comes back as HTTP 200, so anything here is a real fault.
        // FunctionsHttpError hides the body on the original Response.
        let serverError: string | undefined;
        const context: any = (error as any).context;
        if (context && typeof context.clone === 'function') {
          try {
            serverError = (await context.clone().json())?.error;
          } catch {
            /* non-JSON body */
          }
        }

        const message = (error.message || '').toLowerCase();
        if (!serverError && (message.includes('not found') || message.includes('404'))) {
          serverError =
            'MPIN sign-in is not deployed yet. Run: npx supabase functions deploy mpin-signin --no-verify-jwt';
        }
        if (!serverError && isNetworkFailure(error)) {
          serverError = NETWORK_ERROR_MESSAGE;
        }

        return { success: false, error: serverError || 'Could not sign in with your MPIN. Use your password.' };
      }

      if (!data?.success || !data.token_hash) {
        return {
          success: false,
          error: data?.error || 'Incorrect MPIN',
          locked: Boolean(data?.locked),
          notSet: Boolean(data?.notSet),
        };
      }

      const { data: authData, error: otpError } = await supabase.auth.verifyOtp({
        type: 'magiclink',
        token_hash: data.token_hash,
      });

      if (otpError || !authData?.session) {
        return { success: false, error: describeAuthError(otpError, 'Could not start your session. Use your password.') };
      }

      return finalizeOwnerSession(authData.user?.user_metadata as AuthMetadata);
    } catch (error) {
      return { success: false, error: describeAuthError(error, 'Could not sign in with your MPIN') };
    }
  };

  /**
   * Stores (or replaces) the signed-in owner's MPIN on the account. Only the
   * bcrypt hash is kept server-side, and it is not tied to the password — a
   * password reset leaves the MPIN working.
   */
  const saveMpin = async (mpin: string) => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured.' };
    }
    if (!isValidMpin(mpin)) {
      return { success: false, error: 'MPIN must be exactly 4 digits' };
    }

    try {
      const { data, error } = await supabase.rpc('set_user_mpin', { p_mpin: mpin });

      if (error || !data?.success) {
        if (isNetworkFailure(error)) {
          return { success: false, error: NETWORK_ERROR_MESSAGE };
        }
        if (/could not find the function|does not exist/i.test(error?.message || '')) {
          return {
            success: false,
            error: 'MPIN storage is not set up yet. Run supabase/sql/supabase_mpin_central.sql in the Supabase SQL Editor.',
          };
        }
        return { success: false, error: data?.error || error?.message || 'Could not save your MPIN' };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: describeAuthError(error, 'Could not save your MPIN') };
    }
  };

  /** Turns quick sign-in off for the signed-in owner, on every device. */
  const clearMpin = async () => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured.' };
    }

    try {
      const { data, error } = await supabase.rpc('clear_user_mpin');
      if (error || !data?.success) {
        if (isNetworkFailure(error)) {
          return { success: false, error: NETWORK_ERROR_MESSAGE };
        }
        return { success: false, error: data?.error || error?.message || 'Could not remove your MPIN' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: describeAuthError(error, 'Could not remove your MPIN') };
    }
  };

  /**
   * Whether the signed-in owner already has an MPIN on the account.
   *
   * `known: false` means the check itself failed, which must NOT be read as
   * "already set": doing that silently denies the user the chance to create a
   * PIN, and quick sign-in then reports "not set up" forever with nothing in the
   * UI to fix it. Callers offer the (skippable) set-MPIN step in that case.
   */
  const hasMpin = async (): Promise<{ set: boolean; known: boolean }> => {
    try {
      const { data, error } = await supabase.rpc('mpin_status');
      if (error || !data?.success) {
        console.warn('MPIN status check failed:', error?.message || data?.error);
        return { set: false, known: false };
      }
      return { set: Boolean(data.mpin_set), known: true };
    } catch (error) {
      console.warn('MPIN status check failed:', error);
      return { set: false, known: false };
    }
  };

  /**
   * Emails the owner a single-use recovery link pointing at PASSWORD_RESET_PATH.
   * Supabase deliberately answers the same way whether or not the address is
   * registered, so we never reveal which emails have accounts — only genuine
   * faults (network, rate limit) come back as errors.
   */
  const requestPasswordReset = async (email: string) => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { success: false, error: 'Enter the email address you signed up with' };
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}${PASSWORD_RESET_PATH}`,
      });

      if (error) {
        if (isNetworkFailure(error)) {
          return { success: false, error: NETWORK_ERROR_MESSAGE };
        }
        if ((error as any).status === 429) {
          return { success: false, error: 'Too many reset requests. Wait a minute before trying again.' };
        }
        return { success: false, error: describeAuthError(error, 'Could not send the reset link') };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: describeAuthError(error, 'Could not send the reset link') };
    }
  };

  /**
   * Sets the new password using the short-lived session the recovery link
   * created. Afterwards the user is signed out so they have to sign in with the
   * new password. The MPIN is unaffected — it is stored on the account as its own
   * secret rather than as a wrapper around the password — so it keeps working.
   */
  const completePasswordReset = async (newPassword: string, tokenHash?: string) => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured.' };
    }

    try {
      if (tokenHash) {
        // The emailed link hands the recovery token to this page as a query
        // param rather than pointing at /auth/v1/verify, and it is spent HERE —
        // at the moment a real person submits a new password. That endpoint
        // consumes the single-use token on its first GET, and mail scanners,
        // link previewers and antivirus proxies fetch every URL in a message
        // before the recipient ever clicks one, which is what made reset links
        // read as "expired" the instant the email landed.
        const { error: verifyError } = await supabase.auth.verifyOtp({
          type: 'recovery',
          token_hash: tokenHash,
        });

        if (verifyError) {
          if (isNetworkFailure(verifyError)) {
            return { success: false, error: NETWORK_ERROR_MESSAGE };
          }
          return { success: false, error: describeRecoveryLinkError(verifyError), linkDead: true };
        }
      } else {
        // Older links (and any /auth/v1/verify redirect) arrive with the session
        // already established from the URL fragment.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          return {
            success: false,
            error: 'Your reset link has expired. Request a new one and try again.',
            linkDead: true,
          };
        }
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        if (isNetworkFailure(error)) {
          return { success: false, error: NETWORK_ERROR_MESSAGE };
        }
        return { success: false, error: describeAuthError(error, 'Could not update your password') };
      }

      // Only the obsolete device vault goes: it wrapped the old password.
      clearLegacyMpinVault();
      await supabase.auth.signOut();
      clearSession();

      return { success: true };
    } catch (error) {
      return { success: false, error: describeAuthError(error, 'Could not update your password') };
    }
  };

  const logout = async () => {
    if (user?.role === 'owner') {
      await supabase.auth.signOut();
    }
    clearSession();
  };

  const lookupAuditorCompanies = async (email: string) => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured.' };
    }

    try {
      const { data, error } = await supabase.rpc('auditor_list_companies', { p_email: email });
      if (error || !data?.success) {
        if (isNetworkFailure(error)) {
          return { success: false, error: NETWORK_ERROR_MESSAGE };
        }
        return { success: false, error: data?.error || error?.message || 'Could not look up auditor companies' };
      }
      return { success: true, companies: (data.companies || []) as AuditorCompany[] };
    } catch (error) {
      return { success: false, error: describeAuthError(error, 'Lookup failed') };
    }
  };

  const loginAuditorById = async (auditorId: string, password: string) => {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured.' };
    }

    try {
      const { data, error } = await supabase.rpc('verify_auditor_login_by_id', {
        p_auditor_id: auditorId,
        p_password: password,
      });

      if (error || !data?.success) {
        if (isNetworkFailure(error)) {
          return { success: false, error: NETWORK_ERROR_MESSAGE };
        }
        return { success: false, error: data?.error || error?.message || 'Invalid password' };
      }

      const auditor = data.auditor;
      const auditorPermissions = (auditor.permissions || []).map((permission: Permission) => permission);

      storeSession({
        id: auditor.id,
        email: auditor.email,
        full_name: auditor.full_name,
        role: 'auditor',
        company_id: auditor.company_id,
        company_name: auditor.company_name,
        company_gstin: auditor.company_gstin,
        company_logo: auditor.company_logo,
        is_active: true,
      }, auditorPermissions);

      return { success: true };
    } catch (error) {
      return { success: false, error: describeAuthError(error, 'Login failed') };
    }
  };

  const hasPermission = (resource: string, action: 'view' | 'create' | 'edit' | 'delete' = 'view'): boolean => {
    if (user?.role === 'owner') {
      return true;
    }

    const permission = permissions.find((p) => p.permission_name === resource);
    if (!permission) {
      return false;
    }

    const actionKey = `can_${action}` as keyof Permission;
    return Boolean(permission[actionKey]);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        isAuthenticated: !!user,
        isOwner: user?.role === 'owner',
        login,
        loginWithMpin,
        saveMpin,
        hasMpin,
        clearMpin,
        lookupAuditorCompanies,
        loginAuditorById,
        requestPasswordReset,
        completePasswordReset,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
