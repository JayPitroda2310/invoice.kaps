import { useNavigate } from 'react-router';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Menu,
  X,
  Eye,
  EyeOff,
  Upload,
  FileText,
  Sparkles,
  Receipt,
  Zap,
  IndianRupee,
  Clock,
  Search,
  Plus,
  LayoutDashboard,
  Users,
  Package,
  FileMinus,
  CircleCheck,
  AlertCircle,
  BarChart3,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  Bell,
  Sun,
  Moon,
  MailCheck,
  Store,
  Truck,
  Factory,
  Briefcase,
  ShoppingCart
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { toast, Toaster } from 'sonner';
import { supabase } from '../../lib/supabase';
import { extractPanFromGstin, normalizeGstin } from '../../lib/gstin';
import {
  isReturningUser,
  markReturningUser,
  getRememberedEmail,
  rememberEmail,
  isValidMpin,
  setPendingMpin,
  takePendingMpin,
  clearPendingMpin,
  adoptLegacyVaultEmail,
  hasLegacyMpinVault,
  getLegacyVaultEmail,
  unlockLegacyVault,
  clearLegacyMpinVault,
} from '../../lib/mpin';
import { TOAST_MOBILE_OFFSET } from '../../lib/safeArea';

type Theme = 'dark' | 'light';
const THEME_KEY = 'kaps-landing-theme';

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [loginRole, setLoginRole] = useState<'user' | 'auditor'>('user');
  // Owner login can be done by 4-digit MPIN (quick) or email + password, and
  // branches off into the emailed password-reset flow.
  const [userLoginMode, setUserLoginMode] = useState<
    'mpin' | 'password' | 'forgot' | 'forgot-sent' | 'forgot-mpin' | 'set-mpin'
  >('mpin');
  const [resetLoading, setResetLoading] = useState(false);
  // New PIN captured while re-provisioning the vault (forgot-mpin / set-mpin).
  const [newMpin, setNewMpin] = useState('');
  // Whether the forgot-mpin screen is being used to create a FIRST MPIN rather
  // than replace one. Mechanically identical — password proves identity, then
  // set_user_mpin stores the digits — but an account that never had a PIN has to
  // be told so, otherwise "Forgot MPIN?" is the only door and it reads as the
  // wrong one.
  const [mpinSetupIsNew, setMpinSetupIsNew] = useState(false);
  const [confirmNewMpin, setConfirmNewMpin] = useState('');
  const [mpinDigits, setMpinDigits] = useState<string[]>(['', '', '', '']);
  const [mpinLoading, setMpinLoading] = useState(false);
  const [mpinError, setMpinError] = useState('');
  const mpinInputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const mpinEmailInputRef = useRef<HTMLInputElement | null>(null);
  type AuditorCompanyOption = { auditor_id: string; company_id: string; company_name: string; company_logo: string | null; full_name: string };
  const [auditorStage, setAuditorStage] = useState<'email' | 'pick' | 'password'>('email');
  const [auditorCompanies, setAuditorCompanies] = useState<AuditorCompanyOption[]>([]);
  const [selectedAuditor, setSelectedAuditor] = useState<AuditorCompanyOption | null>(null);
  const [auditorLoading, setAuditorLoading] = useState(false);

  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = window.localStorage.getItem(THEME_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const isDark = theme === 'dark';

  // Scroll-driven scene: window scales up while pinned hero fades behind it
  const windowFrameRef = useRef<HTMLDivElement | null>(null);
  const heroContentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const winEl = windowFrameRef.current;
    const heroEl = heroContentRef.current;
    if (!winEl) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      winEl.style.transform = 'scale(1)';
      if (heroEl) heroEl.style.opacity = '1';
      return;
    }

    let rafId = 0;
    const update = () => {
      const winRect = winEl.getBoundingClientRect();
      const vh = window.innerHeight;

      // Window scale animation as it rises into view
      const scaleStart = vh;
      const scaleEnd = vh * 0.3;
      const scaleProgress = Math.max(
        0,
        Math.min(1, (scaleStart - winRect.top) / (scaleStart - scaleEnd))
      );
      const scale = 0.94 + scaleProgress * 0.06;
      winEl.style.transform = `scale(${scale.toFixed(3)})`;

      // Hero fade — starts when window's top reaches 80% from top, fully faded at 20%
      if (heroEl) {
        const fadeStart = vh * 0.80;
        const fadeEnd = vh * 0.20;
        const fadeProgress = Math.max(
          0,
          Math.min(1, (fadeStart - winRect.top) / (fadeStart - fadeEnd))
        );
        const opacity = 1 - fadeProgress;
        heroEl.style.opacity = opacity.toFixed(3);
      }
    };

    const onScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const [signupData, setSignupData] = useState({
    fullName: '',
    email: '',
    password: '',
    phone: '',
    companyName: '',
    taxpayerType: 'regular',
    gstin: '',
    pan: '',
    address: '',
    city: '',
    state: '',
    pinCode: '',
    companyLogo: '',
    mpin: '',
    confirmMpin: ''
  });

  const { login, loginWithMpin, saveMpin, hasMpin, lookupAuditorCompanies, loginAuditorById, requestPasswordReset, user } = useAuth();
  const navigate = useNavigate();

  // Recognise a browser that still holds a pre-central MPIN vault, so its owner
  // is greeted by name on the PIN screen. The vault stays put until their next
  // PIN entry upgrades it (see upgradeLegacyMpin).
  useEffect(() => {
    adoptLegacyVaultEmail();
  }, []);

  // Users who have signed in from this browser before never get dropped on the
  // marketing page. If they still have an active session, send them into the
  // app; otherwise open the sign-in modal straight to the MPIN screen.
  // Reacts to `user` so logging out (which lands back here) reopens the modal.
  // It won't re-trigger while a modal is already open, so closing it to browse
  // the page is fine.
  useEffect(() => {
    if (!isReturningUser()) {
      return; // brand-new visitor → show the marketing page
    }
    if (user) {
      navigate('/app', { replace: true });
      return;
    }
    if (!showLoginModal && !showSignupModal) {
      setLoginRole('user');
      setUserLoginMode('mpin');
      setMpinDigits(['', '', '', '']);
      setMpinError('');
      setLoginEmail(getRememberedEmail() || '');
      setShowLoginModal(true);
      setTimeout(() => mpinInputsRef.current[0]?.focus(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // /reset-password sends the user back here with ?signin=1 after a successful
  // password change — open the modal on the email + password screen (their MPIN
  // vault was wiped along with the old password).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signin') !== '1') {
      return;
    }
    window.history.replaceState({}, '', window.location.pathname);
    openLoginModal('user');
    setUserLoginMode('password');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAuditorFlow = () => {
    setAuditorStage('email');
    setAuditorCompanies([]);
    setSelectedAuditor(null);
    setAuditorLoading(false);
  };

  const handleAuditorLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail) {
      toast.error('Enter your email to continue');
      return;
    }
    setAuditorLoading(true);
    const result = await lookupAuditorCompanies(loginEmail);
    setAuditorLoading(false);

    if (!result.success) {
      toast.error(result.error || 'Lookup failed');
      return;
    }
    const companies = result.companies || [];
    if (companies.length === 0) {
      toast.error('No auditor account found with this email');
      return;
    }
    setAuditorCompanies(companies);
    if (companies.length === 1) {
      setSelectedAuditor(companies[0]);
      setAuditorStage('password');
    } else {
      setAuditorStage('pick');
    }
  };

  const handleAuditorPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAuditor) return;
    if (!loginPassword) {
      toast.error('Enter your password');
      return;
    }
    setAuditorLoading(true);
    const result = await loginAuditorById(selectedAuditor.auditor_id, loginPassword);
    setAuditorLoading(false);

    if (result.success) {
      toast.success(`Signed in to ${selectedAuditor.company_name}`);
      setShowLoginModal(false);
      resetAuditorFlow();
      setLoginEmail('');
      setLoginPassword('');
      navigate('/app');
    } else {
      toast.error(result.error || 'Invalid password');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await login(loginEmail, loginPassword, loginRole === 'auditor' ? 'auditor' : 'owner');
      if (result.success) {
        if (loginRole === 'user') {
          markReturningUser();
          rememberEmail(loginEmail);

          // Signup collects an MPIN but cannot store it until a session exists.
          // There is one now, so apply the parked choice without asking again.
          const pending = takePendingMpin(loginEmail);
          if (pending) {
            const saved = await saveMpin(pending);
            if (!saved.success) {
              toast.error(saved.error || 'Could not save your MPIN. You can set it after signing in.');
            }
          } else {
            // Offer a PIN when the account has none — and also when the check
            // itself failed, since guessing "already set" would quietly leave
            // this account without quick sign-in and no way to notice. The step
            // is skippable either way.
            const status = await hasMpin();
            if (!status.set) {
              setNewMpin('');
              setConfirmNewMpin('');
              setUserLoginMode('set-mpin');
              return;
            }
          }
        }
        toast.success('Login successful!');
        setShowLoginModal(false);
        navigate('/app');
      } else {
        toast.error(result.error || 'Invalid email or password');
      }
    } catch (error) {
      toast.error('Login failed. Please try again.');
    }
  };

  // Emails a 15-minute, single-use recovery link that lands on /reset-password.
  // The response is intentionally the same whether or not the address has an
  // account, so this screen can't be used to probe for registered emails.
  const handleForgotPassword = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!loginEmail.trim()) {
      toast.error('Enter the email address you signed up with');
      return;
    }

    setResetLoading(true);
    const result = await requestPasswordReset(loginEmail);
    setResetLoading(false);

    if (result.success) {
      setUserLoginMode('forgot-sent');
    } else {
      toast.error(result.error || 'Could not send the reset link');
    }
  };

  // Setting the PIN needs a live session, not the old PIN — the account stores
  // only a hash of the digits, so a forgotten PIN is replaced by proving identity
  // with the password. The new PIN then works on every device immediately.
  const saveNewMpin = async (email: string) => {
    if (!isValidMpin(newMpin)) {
      toast.error('MPIN must be exactly 4 digits');
      return false;
    }
    if (newMpin !== confirmNewMpin) {
      toast.error('MPIN and confirmation do not match');
      return false;
    }

    const result = await saveMpin(newMpin);
    if (!result.success) {
      toast.error(result.error || 'Could not save your MPIN');
      return false;
    }

    markReturningUser();
    rememberEmail(email);
    clearPendingMpin();
    clearLegacyMpinVault(); // the account copy governs now
    setNewMpin('');
    setConfirmNewMpin('');
    return true;
  };

  const finishLogin = (message: string) => {
    toast.success(message);
    setShowLoginModal(false);
    setLoginPassword('');
    navigate('/app');
  };

  // Forgot MPIN: prove identity with email + password, then replace the vault.
  const handleForgotMpin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      toast.error('Enter your email and password');
      return;
    }
    if (!isValidMpin(newMpin)) {
      toast.error('MPIN must be exactly 4 digits');
      return;
    }
    if (newMpin !== confirmNewMpin) {
      toast.error('MPIN and confirmation do not match');
      return;
    }

    setMpinLoading(true);
    const result = await login(loginEmail, loginPassword, 'owner');
    if (!result.success) {
      setMpinLoading(false);
      toast.error(result.error || 'Invalid email or password');
      return;
    }

    const saved = await saveNewMpin(loginEmail);
    setMpinLoading(false);
    if (saved) {
      finishLogin(mpinSetupIsNew ? 'MPIN set up. Signed in.' : 'MPIN updated. Signed in.');
    }
  };

  // Set MPIN: reached straight after a successful password login on an account
  // that has no MPIN yet, so the session needed to store it is already live.
  const handleSetMpin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMpinLoading(true);
    const saved = await saveNewMpin(loginEmail);
    setMpinLoading(false);
    if (saved) {
      finishLogin('MPIN set. Quick sign-in now works on any device.');
    }
  };

  const skipSetMpin = () => {
    setNewMpin('');
    setConfirmNewMpin('');
    finishLogin('Login successful!');
  };

  const openForgotMpin = () => {
    setMpinSetupIsNew(false);
    openMpinPasswordStep();
  };

  // Same screen, different story: this account has no MPIN at all yet. Reached
  // from the "Not set up your MPIN yet?" link and automatically whenever quick
  // sign-in reports the account has none.
  const openSetupMpin = () => {
    setMpinSetupIsNew(true);
    openMpinPasswordStep();
  };

  const openMpinPasswordStep = () => {
    setUserLoginMode('forgot-mpin');
    setLoginPassword('');
    setNewMpin('');
    setConfirmNewMpin('');
    setMpinError('');
    setMpinDigits(['', '', '', '']);
    if (!loginEmail) {
      setLoginEmail(getRememberedEmail() || '');
    }
  };

  const openForgotPassword = () => {
    setUserLoginMode('forgot');
    setLoginPassword('');
    setMpinError('');
    setMpinDigits(['', '', '', '']);
    if (!loginEmail) {
      setLoginEmail(getRememberedEmail() || '');
    }
  };

  // Clears the boxes and puts the cursor back on the first one. `keepError`
  // keeps a just-set message on screen — a wrong PIN has to say so, and the
  // digits it clears would otherwise take the explanation with them.
  const resetMpin = (keepError = false) => {
    setMpinDigits(['', '', '', '']);
    if (!keepError) {
      setMpinError('');
    }
    setTimeout(() => mpinInputsRef.current[0]?.focus(), 0);
  };

  // A PIN set before MPINs moved to the account exists only as an encrypted vault
  // in this browser, and the digits the user just typed are its key. So rather
  // than making a long-standing user invent a PIN again, decrypt the vault, sign
  // in with the credentials inside, and store that same PIN on the account — from
  // then on it works everywhere and the vault is gone.
  const upgradeLegacyMpin = async (email: string, mpin: string): Promise<boolean> => {
    // The vault is locked by the PIN alone, so it must only ever be opened for
    // the account it belongs to. On a shared device — several customers signing
    // in from one browser — skipping this check could sign someone in as the
    // vault's owner instead of themselves.
    const vaultEmail = getLegacyVaultEmail();
    if (!vaultEmail || vaultEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return false;
    }

    const creds = await unlockLegacyVault(mpin);
    if (!creds) {
      return false; // wrong PIN for this vault, or no Web Crypto — fall through
    }

    // The vault's own address wins: the email field may have been edited.
    const result = await login(creds.email, creds.password, 'owner');
    if (!result.success) {
      // The stored password is stale (changed on another device), so the vault is
      // dead weight — drop it and let the caller fall back to the password form.
      clearLegacyMpinVault();
      return false;
    }

    const saved = await saveMpin(mpin);
    markReturningUser();
    rememberEmail(creds.email);

    if (saved.success) {
      clearLegacyMpinVault(); // upgraded — the device copy is no longer needed
      toast.success('Signed in. Your MPIN now works on every device.');
    } else {
      // Keep the vault so the upgrade can be retried on the next sign-in.
      toast.success('Login successful!');
    }

    setShowLoginModal(false);
    navigate('/app');
    return true;
  };

  // Quick sign-in: the account's PIN is verified server-side, so this works on a
  // device that has never seen the account — the email is all we need alongside it.
  const submitMpin = async (mpin: string) => {
    if (mpinLoading) {
      return;
    }
    if (!isValidMpin(mpin)) {
      setMpinError('Enter all 4 digits of your MPIN.');
      return;
    }
    const email = loginEmail.trim();
    if (!email) {
      setMpinError('Enter the email address you signed up with.');
      mpinEmailInputRef.current?.focus();
      return;
    }

    setMpinLoading(true);
    setMpinError('');

    try {
      const result = await loginWithMpin(email, mpin);

      if (result.success) {
        markReturningUser();
        rememberEmail(email);
        toast.success('Login successful!');
        setShowLoginModal(false);
        navigate('/app');
        return;
      }

      // The account has no PIN stored centrally. Before sending them to the
      // password form, try the pre-central vault in this browser — for a
      // long-standing user the digits they just typed will open it, and that
      // upgrades them silently instead of asking for a new PIN.
      if (result.notSet) {
        if (hasLegacyMpinVault() && (await upgradeLegacyMpin(email, mpin))) {
          return;
        }

        // Say what is actually wrong — the account has no MPIN — and open the
        // screen that creates one, rather than dropping the user on the password
        // form to work it out for themselves.
        openSetupMpin();
        return;
      }

      setMpinError(result.error || 'Could not sign in. Use email & password below.');
      resetMpin(true);
    } finally {
      setMpinLoading(false);
    }
  };

  const handleMpinChange = (index: number, raw: string) => {
    setMpinError('');
    const value = raw.replace(/\D/g, '');

    if (!value) {
      const next = [...mpinDigits];
      next[index] = '';
      setMpinDigits(next);
      return;
    }

    const next = [...mpinDigits];
    let cursor = index;
    for (const char of value.split('')) {
      if (cursor >= 4) break;
      next[cursor] = char;
      cursor++;
    }
    setMpinDigits(next);
    mpinInputsRef.current[Math.min(cursor, 3)]?.focus();

    // Auto-submit once the PIN is complete, but only when the email is already
    // there — otherwise wait for the button rather than flashing an error.
    if (next.every((d) => d !== '') && loginEmail.trim()) {
      submitMpin(next.join(''));
    }
  };

  const handleMpinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !mpinDigits[index] && index > 0) {
      e.preventDefault();
      const next = [...mpinDigits];
      next[index - 1] = '';
      setMpinDigits(next);
      mpinInputsRef.current[index - 1]?.focus();
    }
  };

  const openLoginModal = (role: 'user' | 'auditor' = 'user') => {
    setLoginRole(role);
    setShowLoginModal(true);
    setMobileMenuOpen(false);
    resetAuditorFlow();
    setLoginPassword('');
    // Owners who have signed in from this browser before start on the quick MPIN
    // screen; a first-time visitor starts on email + password (they can still
    // switch to the PIN screen, since the PIN lives on the account).
    const returning = isReturningUser();
    setUserLoginMode(role === 'user' && returning ? 'mpin' : 'password');
    setMpinDigits(['', '', '', '']);
    setMpinError('');
    setMpinSetupIsNew(false);
    if (role === 'user') {
      setLoginEmail(getRememberedEmail() || '');
    }
  };

  const closeLoginModal = () => {
    // Dismissing the post-login "set your MPIN" step is the same as skipping it —
    // the session is already live, so send them into the app rather than back to
    // the marketing page.
    if (loginRole === 'user' && userLoginMode === 'set-mpin') {
      skipSetMpin();
      return;
    }
    setShowLoginModal(false);
    setLoginEmail('');
    setLoginPassword('');
    setLoginRole('user');
    resetAuditorFlow();
  };

  const openSignupModal = () => {
    setShowSignupModal(true);
    setMobileMenuOpen(false);
  };

  const handleLogoUpload = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file for the company logo');
      return;
    }
    if (file.size > 1024 * 1024) {
      toast.error('Company logo must be under 1 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSignupData((current) => ({ ...current, companyLogo: String(reader.result || '') }));
    };
    reader.onerror = () => toast.error('Could not read company logo');
    reader.readAsDataURL(file);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupData.fullName || !signupData.email || !signupData.password ||
        !signupData.phone || !signupData.companyName ||
        !signupData.address || !signupData.city || !signupData.state || !signupData.pinCode) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (signupData.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (signupData.gstin && signupData.gstin.length !== 15) {
      toast.error('GSTIN must be 15 characters');
      return;
    }
    if (signupData.pinCode.length !== 6 || !/^\d+$/.test(signupData.pinCode)) {
      toast.error('PIN Code must be 6 digits');
      return;
    }
    const phoneDigits = signupData.phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      toast.error('Phone number must be 10 digits');
      return;
    }
    if (!isValidMpin(signupData.mpin)) {
      toast.error('MPIN must be exactly 4 digits');
      return;
    }
    if (signupData.mpin !== signupData.confirmMpin) {
      toast.error('MPIN and confirmation do not match');
      return;
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email: signupData.email,
        password: signupData.password,
        options: {
          data: {
            full_name: signupData.fullName,
            phone: signupData.phone,
            company_name: signupData.companyName,
            taxpayer_type: signupData.taxpayerType,
            gstin: signupData.gstin,
            pan: signupData.pan,
            address: signupData.address,
            city: signupData.city,
            state: signupData.state,
            pin_code: signupData.pinCode,
            company_logo: signupData.companyLogo
          }
        }
      });
      if (error) {
        console.error('Signup error:', error);
        if (error.message.toLowerCase().includes('database error saving new user')) {
          toast.error('Signup trigger failed. Run supabase/sql/supabase_signup_repair.sql in Supabase SQL Editor, then try again.');
          return;
        }
        toast.error('Signup failed: ' + error.message);
        return;
      }
      if (!data.user) {
        toast.error('Signup failed. Please try again.');
        return;
      }
      // The access token minted by signUp still embeds the metadata we just sent
      // — including the base64 logo — which makes it ~100 KB and too large for
      // the ~32 KB header limit, so every request with it is rejected upstream.
      // The signup trigger strips the logo from the metadata, so refreshing here
      // reissues a small token. Without this the very next call fails.
      if (data.session) {
        try {
          await supabase.auth.refreshSession();
        } catch {
          /* a slim token is a bonus, not a precondition for the account */
        }
      }

      // Store the chosen MPIN on the account so it works on every device. That
      // needs a session: signUp returns one when email confirmation is off, and
      // when it doesn't we park the PIN and apply it after the first sign-in.
      markReturningUser();
      rememberEmail(signupData.email);
      if (data.session) {
        const saved = await saveMpin(signupData.mpin);
        if (!saved.success) {
          setPendingMpin(signupData.email, signupData.mpin);
        }
      } else {
        setPendingMpin(signupData.email, signupData.mpin);
      }
      toast.success('Account created successfully! Please login to continue.');
      setShowSignupModal(false);
      setUserLoginMode('password');
      setShowLoginModal(true);
      setLoginEmail(signupData.email);
      setSignupData({
        fullName: '', email: '', password: '', phone: '', companyName: '', taxpayerType: 'regular',
        gstin: '', pan: '', address: '', city: '', state: '', pinCode: '', companyLogo: '', mpin: '', confirmMpin: ''
      });
    } catch (error) {
      console.error('Signup error:', error);
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (/failed to fetch|networkerror|load failed|fetch failed|err_/i.test(message)) {
        toast.error('Could not reach the server. An ad-blocker/privacy extension, VPN/proxy, or your connection may be blocking the request. Disable the blocker for this site (allowlist *.supabase.co) or try an incognito window.');
      } else {
        toast.error('An error occurred during signup. Please try again.');
      }
    }
  };

  return (
    <>
      <Toaster position="top-right" richColors theme={theme} mobileOffset={TOAST_MOBILE_OFFSET} />
      <div className={`kaps-root ${isDark ? 'dark' : ''} min-h-screen w-full text-slate-900 dark:text-white antialiased relative [overflow-x:clip]`}>
        {/* ============================== AMBIENT BG ============================== */}
        <div aria-hidden className="fixed inset-0 -z-10 kaps-bg" />
        <div aria-hidden className="fixed inset-0 -z-10 kaps-stars" />
        <div aria-hidden className="fixed inset-x-0 top-0 -z-10 h-[60vh] kaps-glow-top" />

        {/* ============================== NAVBAR ============================== */}
        <header className="kaps-safe-top kaps-safe-x sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
            <nav className="flex items-center justify-between gap-2 rounded-full border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/[0.04] backdrop-blur-xl pl-3 pr-1.5 sm:pl-4 sm:pr-2 py-1.5 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.10)] dark:shadow-[0_4px_24px_-6px_rgba(0,0,0,0.55)]">
              <a href="#" className="flex items-center gap-2.5 shrink-0">
                <div className="relative h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-[0_0_18px_rgba(139,92,246,0.45)]">
                  <Receipt className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
                </div>
                <span className="hidden sm:inline text-[15px] font-medium tracking-tight text-slate-900 dark:text-white">
                  GSTInvoice<span className="text-violet-600 dark:text-violet-300"> Pro</span>
                </span>
              </a>

              <div className="hidden md:flex items-center gap-0.5">
                <PillNav href="#" active>Home</PillNav>
                <PillNav href="#product">Product</PillNav>
                <PillNav href="#features">Features</PillNav>
                <PillNav href="#stories">Customers</PillNav>
                <PillNav href="#contact">Contact</PillNav>
              </div>

              <div className="hidden md:flex items-center gap-1.5 shrink-0">
                <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
                <button
                  onClick={() => openLoginModal('user')}
                  className="text-[13px] font-medium px-3 h-8 inline-flex items-center text-slate-700 dark:text-white/80 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  Sign in
                </button>
                <button
                  onClick={openSignupModal}
                  className="text-[13px] font-semibold inline-flex items-center px-4 h-8 rounded-full bg-violet-500 hover:bg-violet-400 text-white shadow-[0_4px_18px_-4px_rgba(139,92,246,0.65)] transition-colors"
                >
                  Get Started
                </button>
              </div>

              <div className="md:hidden flex items-center gap-1 shrink-0">
                <ThemeToggle isDark={isDark} onToggle={toggleTheme} compact />
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-full text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  aria-label="Toggle menu"
                >
                  {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </button>
              </div>
            </nav>
          </div>

          {mobileMenuOpen && (
            <div className="md:hidden mt-3 mx-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d0d2a]/95 backdrop-blur p-4 space-y-1 shadow-lg">
              <a onClick={() => setMobileMenuOpen(false)} href="#" className="block px-3 py-2 rounded-md text-[13px] text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5">Home</a>
              <a onClick={() => setMobileMenuOpen(false)} href="#product" className="block px-3 py-2 rounded-md text-[13px] text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5">Product</a>
              <a onClick={() => setMobileMenuOpen(false)} href="#features" className="block px-3 py-2 rounded-md text-[13px] text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5">Features</a>
              <a onClick={() => setMobileMenuOpen(false)} href="#stories" className="block px-3 py-2 rounded-md text-[13px] text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5">Customers</a>
              <a onClick={() => setMobileMenuOpen(false)} href="#contact" className="block px-3 py-2 rounded-md text-[13px] text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5">Contact</a>
              <div className="h-px bg-slate-200 dark:bg-white/10 my-2" />
              <button onClick={() => openLoginModal('user')} className="w-full text-center px-3 py-2 rounded-md text-[13px] text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/5">Sign in</button>
              <button onClick={openSignupModal} className="w-full text-center px-3 py-2 rounded-md text-[13px] font-medium border border-slate-300 dark:border-white/15 bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white">Get Started</button>
            </div>
          )}
        </header>

        {/* ============================== STICKY HERO + WINDOW SCROLL ZONE ============================== */}
        <div className="relative">
        {/* ============================== HERO (pinned) ============================== */}
        <section className="sticky top-[60px] z-0 min-h-[calc(100vh-60px)] flex items-center justify-center pt-8 sm:pt-12 lg:pt-16 pb-12 lg:pb-16 px-4 sm:px-6 lg:px-8">
          <div
            ref={heroContentRef}
            className="max-w-7xl mx-auto w-full -mt-6 sm:-mt-10 will-change-[opacity]"
            style={{ opacity: 1 }}
          >
            <div className="grid lg:grid-cols-12 gap-10 lg:gap-8 items-center">
              <div className="lg:col-span-6 text-center lg:text-left">
                <p className="text-[13px] font-medium text-violet-600 dark:text-violet-300/90 tracking-wide">GST Compliance, Built for India</p>
                <h1 className="mt-5 text-[32px] sm:text-[44px] md:text-[52px] lg:text-[58px] leading-[1.08] sm:leading-[1.06] font-medium tracking-[-0.025em] text-slate-900 dark:text-white">
                  Streamline GST Invoicing with Smart Automation
                </h1>
                <p className="mt-7 max-w-xl mx-auto lg:mx-0 text-[15px] leading-relaxed text-slate-600 dark:text-white/55">
                  GSTInvoice Pro creates compliant tax invoices, files GSTR-1,
                  tracks payments and exports books — all from one workspace built for Indian businesses.
                </p>

                <div className="mt-9 flex flex-col sm:flex-row items-center lg:justify-start justify-center gap-3">
                  <button
                    onClick={openSignupModal}
                    className="group inline-flex items-center justify-center gap-1.5 h-11 px-6 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all"
                  >
                    Start free trial
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
                  </button>
                  <a
                    href="#product"
                    className="inline-flex items-center justify-center h-11 px-6 rounded-full border border-slate-300 dark:border-white/15 bg-white dark:bg-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.08] text-slate-900 dark:text-white text-[14px] font-medium transition-colors shadow-sm dark:shadow-none"
                  >
                    See the product
                  </a>
                </div>
              </div>

              <div className="lg:col-span-6 flex justify-center lg:justify-end">
                <img
                  src="/hero-illustration-light.png"
                  alt="GSTInvoice Pro features — Tax Invoices, Customers, Reports, GSTR-1 and more orbiting a paid invoice"
                  className="block dark:hidden w-full max-w-[640px] h-auto select-none pointer-events-none"
                  draggable={false}
                />
                <img
                  src="/hero-illustration-dark.png"
                  alt="GSTInvoice Pro features — Tax Invoices, Customers, Reports, GSTR-1 and more orbiting a paid invoice"
                  className="hidden dark:block w-full max-w-[640px] h-auto select-none pointer-events-none"
                  draggable={false}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ============================== DASHBOARD WINDOW MOCKUP (rises over pinned hero) ============================== */}
        <section id="product" className="relative z-10 px-4 sm:px-6 lg:px-8 pb-24 lg:pb-32">
          <div className="max-w-6xl mx-auto relative">

            {/* Glass bezel wrapping the window — scroll-driven rise animation */}
            <div
              ref={windowFrameRef}
              className="relative rounded-[28px] p-2 sm:p-3 bg-gradient-to-br from-white/55 via-violet-100/45 to-violet-200/40 dark:from-violet-500/[0.10] dark:via-white/[0.04] dark:to-violet-400/[0.12] backdrop-blur-2xl border border-white/85 dark:border-violet-300/20 shadow-[0_0_70px_rgba(139,92,246,0.35),0_25px_55px_-8px_rgba(139,92,246,0.32),0_10px_25px_-4px_rgba(139,92,246,0.22),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(139,92,246,0.18),inset_1px_0_0_rgba(255,255,255,0.65),inset_-1px_0_0_rgba(139,92,246,0.20)] dark:shadow-[0_0_80px_rgba(167,139,250,0.32),0_25px_60px_-10px_rgba(167,139,250,0.35),0_50px_120px_-30px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(167,139,250,0.30),inset_1px_0_0_rgba(255,255,255,0.10),inset_-1px_0_0_rgba(167,139,250,0.28)]"
              style={{
                transform: 'scale(0.94)',
                transformOrigin: 'center top',
                willChange: 'transform'
              }}
            >
              {/* Diagonal glass surface highlight — top-left light catch */}
              <div aria-hidden className="absolute inset-0 rounded-[28px] bg-gradient-to-br from-white/55 via-transparent to-transparent dark:from-white/[0.10] pointer-events-none" />
              {/* Violet refractive bleed — bottom-right tint */}
              <div aria-hidden className="absolute inset-0 rounded-[28px] bg-gradient-to-tl from-violet-300/30 via-transparent to-transparent dark:from-violet-400/25 pointer-events-none" />
              {/* Top-right light catch */}
              <div aria-hidden className="absolute inset-0 rounded-[28px] bg-gradient-to-bl from-white/25 via-transparent to-transparent dark:from-white/[0.07] pointer-events-none" />
              {/* Bottom-left violet bleed */}
              <div aria-hidden className="absolute inset-0 rounded-[28px] bg-gradient-to-tr from-violet-300/25 via-transparent to-transparent dark:from-violet-400/20 pointer-events-none" />
              <div className="relative rounded-[20px] overflow-hidden bg-[#0F1424] shadow-[inset_0_0_0_1px_rgba(139,92,246,0.18)]">
                {/* Window chrome */}
                <div className="h-10 px-4 flex items-center justify-between bg-[#0B0F1C] border-b border-white/[0.06]">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
                    <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
                    <span className="h-3 w-3 rounded-full bg-[#28C840]" />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-white/[0.04] border border-white/[0.06] flex-1 min-w-0 sm:min-w-[260px] sm:flex-initial max-w-md sm:w-1/2">
                    <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                    <span className="text-[11px] font-mono text-white/55 truncate">app.gstinvoicepro.in / dashboard</span>
                  </div>
                  <div className="flex items-center gap-2 text-white/30">
                    <span className="hidden sm:block h-3 w-3 rounded-sm border border-current" />
                    <span className="hidden sm:block h-1 w-3 rounded-sm bg-current" />
                  </div>
                </div>

                {/* App body */}
                <div className="flex min-h-[460px] lg:min-h-[540px]">
                  {/* ===== Sidebar ===== */}
                  <aside className="hidden md:flex w-[200px] lg:w-[220px] flex-col bg-[#0F1A33] border-r border-white/[0.06]">
                    <div className="px-4 py-4 border-b border-white/[0.06] flex items-center gap-2">
                      <div className="h-7 w-7 rounded-md bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-[0_0_15px_rgba(139,92,246,0.4)]">
                        <Receipt className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
                      </div>
                      <div className="leading-tight">
                        <div className="text-[12px] font-semibold text-white">GSTInvoice</div>
                        <div className="text-[9px] text-violet-300/80 font-medium tracking-wider uppercase">Pro</div>
                      </div>
                    </div>
                    <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-hidden">
                      <SbItem icon={<LayoutDashboard className="h-3.5 w-3.5" />} label="Dashboard" active />
                      <SbItem icon={<Users className="h-3.5 w-3.5" />} label="Customers" />
                      <SbItem icon={<Package className="h-3.5 w-3.5" />} label="Items & Services" />
                      <SbItem icon={<Receipt className="h-3.5 w-3.5" />} label="Tax Invoices" badge="142" />
                      <SbItem icon={<FileMinus className="h-3.5 w-3.5" />} label="Credit / Debit Notes" />
                      <SbItem icon={<CircleCheck className="h-3.5 w-3.5" />} label="Receipts" />
                      <SbItem icon={<AlertCircle className="h-3.5 w-3.5" />} label="Outstanding" badge="12" warn />
                      <SbItem icon={<BarChart3 className="h-3.5 w-3.5" />} label="Reports & GSTR-1" />
                      <SbItem icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Auditor Management" />
                    </nav>
                    <div className="m-2.5 p-3 rounded-lg bg-gradient-to-br from-violet-500/15 to-violet-700/5 border border-violet-400/20">
                      <div className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold">Free trial</div>
                      <div className="text-[12px] text-white/80 mt-0.5 font-medium">9 days remaining</div>
                      <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full w-[65%] bg-gradient-to-r from-violet-400 to-violet-500" />
                      </div>
                    </div>
                  </aside>

                  {/* ===== Main pane ===== */}
                  <div className="flex-1 bg-[#0B1020] p-4 sm:p-5 lg:p-6 overflow-hidden">
                    <div className="flex items-center justify-between gap-3 mb-5">
                      <div>
                        <div className="flex items-center gap-2 text-[10px] text-white/40 mb-0.5 font-medium tracking-wider uppercase">
                          <span>Today</span>
                          <span>·</span>
                          <span>27 May 2026</span>
                          <span>·</span>
                          <span className="text-violet-300/90">FY 26-27</span>
                        </div>
                        <h3 className="text-[18px] lg:text-[20px] font-semibold text-white tracking-tight">Dashboard</h3>
                      </div>
                      <div className="hidden sm:flex items-center gap-2">
                        <div className="hidden lg:flex items-center gap-2 px-2.5 h-8 rounded-md border border-white/[0.08] bg-white/[0.02] text-[11px] text-white/55 w-[180px]">
                          <Search className="h-3 w-3" />
                          <span>Search invoices…</span>
                        </div>
                        <button className="h-8 w-8 rounded-md border border-white/[0.08] bg-white/[0.02] flex items-center justify-center text-white/55">
                          <Bell className="h-3.5 w-3.5" />
                        </button>
                        <button className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-violet-500 hover:bg-violet-400 text-white text-[11px] font-semibold shadow-[0_4px_18px_-6px_rgba(139,92,246,0.7)]">
                          <Plus className="h-3 w-3" />
                          New invoice
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
                      <KpiCard label="Total Revenue" value="₹12,42,500" delta="+ 18.4%" deltaTone="positive" icon={<IndianRupee className="h-3.5 w-3.5" />} accent="violet" />
                      <KpiCard label="Total Invoices" value="142" delta="+ 23 this month" deltaTone="positive" icon={<FileText className="h-3.5 w-3.5" />} accent="sky" />
                      <KpiCard label="Pending Amount" value="₹2,84,000" delta="12 invoices" deltaTone="warning" icon={<Clock className="h-3.5 w-3.5" />} accent="amber" />
                    </div>

                    <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.06]">
                        <div className="flex items-center gap-2">
                          <h4 className="text-[12.5px] font-semibold text-white">Recent invoices</h4>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white/[0.06] text-white/55">Last 7 days</span>
                        </div>
                        <a href="#" className="text-[11px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-0.5">
                          View all <ChevronRight className="h-3 w-3" />
                        </a>
                      </div>
                      <div className="hidden sm:grid grid-cols-12 px-4 py-2 text-[9.5px] font-semibold tracking-wider uppercase text-white/35 border-b border-white/[0.04]">
                        <div className="col-span-3">Invoice</div>
                        <div className="col-span-4">Customer</div>
                        <div className="col-span-3 text-right">Amount</div>
                        <div className="col-span-2 text-right">Status</div>
                      </div>
                      <div>
                        <InvoiceRow num="INV/2026/0142" date="27 May" name="Lumen Digital LLP" gstin="27ABCDE1234F1Z5" amount="₹1,77,000" status="paid" />
                        <InvoiceRow num="INV/2026/0141" date="26 May" name="Northwind & Co" gstin="29AABCN5678P1ZK" amount="₹54,400" status="pending" />
                        <InvoiceRow num="INV/2026/0140" date="25 May" name="Aarav Studios" gstin="06AAACA9012R1ZQ" amount="₹2,10,000" status="paid" />
                        <InvoiceRow num="INV/2026/0139" date="22 May" name="Helix Motors Pvt Ltd" gstin="33AAFCH7654P1Z2" amount="₹38,500" status="overdue" />
                        <InvoiceRow num="INV/2026/0138" date="20 May" name="Saffron Foods" gstin="07AAVFS3210M1Z8" amount="₹92,600" status="paid" last />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>
        </div>
        {/* ============================== /STICKY HERO + WINDOW SCROLL ZONE ============================== */}

        {/* ============================== BENTO ============================== */}
        <section className="relative pb-20 lg:pb-24 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-5 lg:gap-6">
            <div className="kaps-card relative rounded-2xl p-7 lg:p-8 min-h-[360px] overflow-hidden flex flex-col">
              <div className="kaps-card-glow" aria-hidden />
              <h3 className="relative text-[17px] sm:text-[18px] font-medium leading-snug text-slate-900 dark:text-white">
                Trusted across every<br />
                kind of business
              </h3>
              <div className="relative flex-1 flex items-center justify-center">
                <OrbitVisual />
              </div>
            </div>

            <div className="grid grid-rows-[auto_1fr] gap-5 lg:gap-6">
              <div className="kaps-card relative rounded-2xl p-7 lg:p-8">
                <div className="kaps-card-glow" aria-hidden />
                <div className="relative flex items-center gap-3 mb-5">
                  <span className="shrink-0 h-7 w-7 rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04] flex items-center justify-center">
                    <Receipt className="h-3.5 w-3.5 text-slate-500 dark:text-white/70" />
                  </span>
                  <div className="flex-1 flex items-center justify-between px-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} className="relative h-1.5 w-1.5">
                        <span className="absolute inset-0 rounded-full bg-slate-300 dark:bg-white/20" />
                        <span
                          className="kaps-pulse absolute inset-0 rounded-full bg-violet-500 shadow-[0_0_6px_1px_rgba(139,92,246,0.75)]"
                          style={{ animationDelay: `${i * 0.2}s` }}
                        />
                      </span>
                    ))}
                  </div>
                  <span className="shrink-0 h-7 w-7 rounded-md border border-violet-400/40 bg-violet-500/15 flex items-center justify-center">
                    <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" />
                  </span>
                </div>

                <h3 className="relative text-[17px] sm:text-[18px] font-medium leading-snug text-slate-900 dark:text-white">
                  Compliant invoicing,<br />
                  in a single workspace
                </h3>
              </div>

              <div className="kaps-card relative rounded-2xl p-7 lg:p-8">
                <div className="kaps-card-glow" aria-hidden />
                <p className="relative text-[17px] sm:text-[18px] font-medium leading-snug text-slate-900 dark:text-white">
                  Built for the way<br />
                  Indian businesses bill
                </p>
                <ul className="relative mt-7 space-y-4">
                  {[
                    'GSTIN with auto-derived PAN',
                    'HSN / SAC code lookup',
                    'Place-of-supply CGST · SGST · IGST',
                    'Reverse charge & e-Invoice ready',
                    'Audit-trail for every revision'
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3.5">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/15 ring-1 ring-violet-400/30 dark:ring-violet-400/30">
                        <Zap className="h-3 w-3 text-violet-600 dark:text-violet-300" fill="currentColor" />
                      </span>
                      <span className="text-[13.5px] text-slate-700 dark:text-white/75">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ============================== FEATURES ============================== */}
        <section id="features" className="relative py-20 lg:py-24 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-[13px] font-medium text-violet-600 dark:text-violet-300/90 tracking-wide">Key Features and Benefits</p>
            <h2 className="mt-5 text-[28px] sm:text-[34px] md:text-[44px] lg:text-[52px] leading-[1.1] sm:leading-[1.06] font-medium tracking-[-0.025em] text-slate-900 dark:text-white">
              Effortless billing,
              <br />
              audit-ready books
            </h2>
            <p className="mt-6 max-w-xl mx-auto text-[14.5px] leading-relaxed text-slate-600 dark:text-white/55">
              Everything an Indian business needs to invoice, collect, and file —
              <br className="hidden sm:block" />
              consolidated into one polished interface.
            </p>
          </div>

          <div className="mt-16 max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <FeatureCard illustration={<TaxInvoiceIllustration />} title="Tax Invoices" description="Auto-numbered, IRP-ready GST invoices with CGST/SGST/IGST splits" />
            <FeatureCard illustration={<CreditNoteIllustration />} title="Credit & Debit Notes" description="Issue and reconcile notes with a complete audit trail per invoice" />
            <FeatureCard illustration={<OutstandingIllustration />} title="Outstanding & Receipts" description="Track every rupee outstanding and send smart payment reminders" />
            <FeatureCard illustration={<GstrIllustration />} title="GSTR-1 & Excel" description="Export GSTR-1, multi-sheet Excel reports and e-Sign in one click" />
          </div>
        </section>

        {/* ============================== TESTIMONIALS ============================== */}
        <section id="stories" className="relative py-20 lg:py-24 overflow-hidden">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto text-center">
              <p className="text-[13px] font-medium text-violet-600 dark:text-violet-300/90 tracking-wide">Loved by founders, trusted by CAs</p>
              <h2 className="mt-5 text-[28px] sm:text-[34px] md:text-[44px] lg:text-[52px] leading-[1.1] sm:leading-[1.06] font-medium tracking-[-0.025em] text-slate-900 dark:text-white">
                Experience the
                <br />
                Future of GST Invoicing
              </h2>
              <p className="mt-6 max-w-lg mx-auto text-[14.5px] leading-relaxed text-slate-600 dark:text-white/55">
                From two-person studios to nationwide distributors,
                <br className="hidden sm:block" />
                GSTInvoice Pro powers thousands of Indian businesses.
              </p>
            </div>
          </div>

          <div className="mt-16 space-y-5 kaps-marquee-mask">
            {/* Row 1 */}
            <div className="kaps-marquee-track">
              <div className="kaps-marquee flex gap-5 w-max">
                {[
                  { initials: 'PS', name: 'Priya Sharma', location: 'CFO · Lumen Digital, Mumbai', gradient: 'from-orange-400 to-rose-500', quote: 'We replaced Excel templates, an e-Invoice utility and a separate GSTR filer with one product. Month-end now closes in two hours.' },
                  { initials: 'AI', name: 'CA Anjali Iyer', location: 'Partner · Iyer & Associates, Bengaluru', gradient: 'from-violet-400 to-indigo-600', quote: 'Cleanest GST product I’ve used as a chartered accountant. The GSTR-1 export matches the portal byte for byte.' },
                  { initials: 'RM', name: 'Rohan Mehta', location: 'Founder · Saffron Foods, Pune', gradient: 'from-amber-400 to-orange-500', quote: 'Our field team raises invoices from their phone within seconds of delivery. Payments are reconciled before I reach my desk.' },
                  { initials: 'NK', name: 'Neha Kapoor', location: 'Owner · Saanvi Boutique, Delhi', gradient: 'from-emerald-400 to-teal-600', quote: 'I run my boutique from my phone. WhatsApp invoices, instant receipts, and a clean GSTR-1 every month — everything I needed.' }
                ].concat([
                  { initials: 'PS', name: 'Priya Sharma', location: 'CFO · Lumen Digital, Mumbai', gradient: 'from-orange-400 to-rose-500', quote: 'We replaced Excel templates, an e-Invoice utility and a separate GSTR filer with one product. Month-end now closes in two hours.' },
                  { initials: 'AI', name: 'CA Anjali Iyer', location: 'Partner · Iyer & Associates, Bengaluru', gradient: 'from-violet-400 to-indigo-600', quote: 'Cleanest GST product I’ve used as a chartered accountant. The GSTR-1 export matches the portal byte for byte.' },
                  { initials: 'RM', name: 'Rohan Mehta', location: 'Founder · Saffron Foods, Pune', gradient: 'from-amber-400 to-orange-500', quote: 'Our field team raises invoices from their phone within seconds of delivery. Payments are reconciled before I reach my desk.' },
                  { initials: 'NK', name: 'Neha Kapoor', location: 'Owner · Saanvi Boutique, Delhi', gradient: 'from-emerald-400 to-teal-600', quote: 'I run my boutique from my phone. WhatsApp invoices, instant receipts, and a clean GSTR-1 every month — everything I needed.' }
                ]).map((t, i) => (
                  <div key={`row1-${i}`} className="shrink-0 w-[300px] sm:w-[340px] lg:w-[360px] h-[200px]" aria-hidden={i >= 4}>
                    <Testimonial {...t} />
                  </div>
                ))}
              </div>
            </div>

            {/* Row 2 — slower, offset */}
            <div className="kaps-marquee-track">
              <div className="kaps-marquee-slow flex gap-5 w-max">
                {[
                  { initials: 'VR', name: 'Vikram Rao', location: 'Director · Helix Motors, Chennai', gradient: 'from-sky-400 to-blue-600', quote: 'Place-of-supply logic and reverse-charge handling alone saved us hours every month. Implementation took an evening.' },
                  { initials: 'AS', name: 'Arjun Singh', location: 'Founder · Indigo Labs, Hyderabad', gradient: 'from-fuchsia-400 to-pink-600', quote: 'The fastest GST tool I’ve used. Sub-100ms interactions, beautiful interface, and the auditor view is genuinely thoughtful.' },
                  { initials: 'MP', name: 'Meera Patel', location: 'CFO · Ahaan Textiles, Surat', gradient: 'from-teal-400 to-emerald-600', quote: 'Excel exports are a dream. Our auditor receives a perfectly formatted multi-sheet workbook with one click.' },
                  { initials: 'KR', name: 'Karan Reddy', location: 'Founder · Vega Logistics, Hyderabad', gradient: 'from-indigo-400 to-violet-600', quote: 'e-Way bill generation in under five seconds. Our dispatch team has reclaimed their afternoons.' }
                ].concat([
                  { initials: 'VR', name: 'Vikram Rao', location: 'Director · Helix Motors, Chennai', gradient: 'from-sky-400 to-blue-600', quote: 'Place-of-supply logic and reverse-charge handling alone saved us hours every month. Implementation took an evening.' },
                  { initials: 'AS', name: 'Arjun Singh', location: 'Founder · Indigo Labs, Hyderabad', gradient: 'from-fuchsia-400 to-pink-600', quote: 'The fastest GST tool I’ve used. Sub-100ms interactions, beautiful interface, and the auditor view is genuinely thoughtful.' },
                  { initials: 'MP', name: 'Meera Patel', location: 'CFO · Ahaan Textiles, Surat', gradient: 'from-teal-400 to-emerald-600', quote: 'Excel exports are a dream. Our auditor receives a perfectly formatted multi-sheet workbook with one click.' },
                  { initials: 'KR', name: 'Karan Reddy', location: 'Founder · Vega Logistics, Hyderabad', gradient: 'from-indigo-400 to-violet-600', quote: 'e-Way bill generation in under five seconds. Our dispatch team has reclaimed their afternoons.' }
                ]).map((t, i) => (
                  <div key={`row2-${i}`} className="shrink-0 w-[300px] sm:w-[340px] lg:w-[360px] h-[200px]" aria-hidden={i >= 4}>
                    <Testimonial {...t} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============================== BORDERED CTA ============================== */}
        <section className="relative py-12 lg:py-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <div className="relative rounded-3xl p-[1px] bg-gradient-to-br from-violet-500/40 via-white/5 to-violet-500/30">
              <div className="relative rounded-[22px] bg-[#0a0a26]/95 backdrop-blur-sm px-6 sm:px-12 py-14 sm:py-16 text-center overflow-hidden">
                <div aria-hidden className="absolute inset-0 kaps-cta-stars opacity-60" />
                <div aria-hidden className="absolute -top-32 left-1/2 -translate-x-1/2 h-64 w-[80%] rounded-full bg-violet-600/15 blur-3xl" />

                <h2 className="relative text-[28px] sm:text-[38px] lg:text-[44px] leading-[1.1] font-medium tracking-[-0.02em] text-white">
                  Send your first GST invoice
                  <br />
                  before your chai gets cold.
                </h2>
                <p className="relative mt-5 max-w-lg mx-auto text-[14px] text-white/55">
                  Join 10,400+ Indian businesses that have moved off spreadsheets.<br className="hidden sm:block" />
                  Free for 14 days. No credit card required.
                </p>

                <div className="relative mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={openSignupModal}
                    className="inline-flex items-center justify-center gap-1.5 h-11 px-7 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all"
                  >
                    Create your account
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openLoginModal('user')}
                    className="inline-flex items-center justify-center h-11 px-6 rounded-full border border-white/15 bg-white/[0.03] hover:bg-white/[0.08] text-white text-[14px] font-semibold transition-colors"
                  >
                    Sign in
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================== FOOTER ============================== */}
        <footer id="contact" className="relative pt-16 border-t border-slate-200 dark:border-white/[0.06] overflow-hidden">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
              <div className="md:col-span-5">
                <a href="#" className="flex items-center gap-2.5">
                  <div className="relative h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-[0_0_22px_rgba(139,92,246,0.45)]">
                    <Receipt className="h-4 w-4 text-white" strokeWidth={2.25} />
                  </div>
                  <span className="text-[17px] font-medium tracking-tight text-slate-900 dark:text-white">
                    GSTInvoice<span className="text-violet-600 dark:text-violet-300"> Pro</span>
                  </span>
                </a>
                <p className="mt-5 text-[13px] text-slate-600 dark:text-white/55 leading-relaxed max-w-sm">
                  The modern billing stack for Indian businesses — from your first GST invoice to your hundred-thousandth.
                </p>
                <p className="mt-4 text-[13px] text-slate-700 dark:text-white/75">hello@gstinvoicepro.in</p>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-400/30 text-[11px] font-medium text-emerald-600 dark:text-emerald-300">
                    <ShieldCheck className="w-3 h-3" />
                    GSTN-aligned
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 text-[11px] font-medium text-slate-700 dark:text-white/70">
                    <TrendingUp className="w-3 h-3" />
                    SOC 2
                  </span>
                </div>
              </div>

              <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-8">
                <FooterCol heading="Product" links={['Tax Invoices', 'Customers', 'Items & Services', 'Reports & GSTR-1', 'Receipts']} />
                <FooterCol heading="Company" links={['About', 'Customers', 'Contact', 'Pricing', 'Press kit']} />
                <FooterCol heading="Legal" links={['Privacy Policy', 'Terms of Service', 'Security', 'GDPR']} />
              </div>
            </div>

            <div className="mt-12 pt-6 border-t border-slate-200 dark:border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-[12px] text-slate-500 dark:text-white/40">© 2026 GSTInvoice Pro · Crafted in Vadodara · All rights reserved.</p>
              <button
                onClick={() => openLoginModal('auditor')}
                className="text-[12px] text-slate-600 dark:text-white/55 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Auditor sign-in →
              </button>
            </div>
          </div>

          {/* Giant brand wordmark */}
          <div className="relative mt-10 sm:mt-14 select-none">
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-[80%] bg-[radial-gradient(55%_70%_at_50%_100%,rgba(139,92,246,0.22),transparent_72%)] pointer-events-none" />
            <div className="relative flex items-end justify-center overflow-hidden">
              <h2
                aria-label="GSTInvoice Pro"
                className="font-black tracking-[-0.06em] leading-[0.85] text-[14.4vw] translate-y-[14%] sm:translate-y-[12%] whitespace-nowrap"
              >
                <span className="bg-gradient-to-b from-slate-900 via-slate-900 to-slate-900/25 dark:from-white dark:via-white dark:to-white/15 bg-clip-text text-transparent">
                  GSTInvoice
                </span>
                <span className="bg-gradient-to-b from-violet-500 via-violet-500 to-violet-500/25 dark:from-violet-300 dark:via-violet-300 dark:to-violet-300/20 bg-clip-text text-transparent">
                  Pro
                </span>
              </h2>
            </div>
          </div>
        </footer>

        {/* ============================== LOGIN MODAL ============================== */}
        {showLoginModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center kaps-safe-overlay bg-slate-900/40 dark:bg-black/70 backdrop-blur-md"
            onClick={closeLoginModal}
          >
            <div
              className="relative max-w-md w-full rounded-2xl p-[1px] bg-gradient-to-br from-violet-500/50 via-slate-200 dark:via-white/10 to-violet-500/30"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rounded-[15px] bg-white dark:bg-[#0a0a26]/95 backdrop-blur overflow-hidden">
                <div className="relative px-6 pt-7 pb-3 border-b border-slate-200 dark:border-white/[0.08]">
                  <button
                    onClick={closeLoginModal}
                    className="absolute right-5 top-5 p-1 rounded-md text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
                      <Receipt className="w-4 h-4 text-white" strokeWidth={2.25} />
                    </div>
                    <h3 className="text-[16px] font-medium tracking-tight text-slate-900 dark:text-white">
                      {loginRole !== 'user'
                        ? 'Auditor sign-in'
                        : userLoginMode === 'forgot'
                          ? 'Reset your password'
                          : userLoginMode === 'forgot-sent'
                            ? 'Check your inbox'
                            : userLoginMode === 'forgot-mpin'
                              ? (mpinSetupIsNew ? 'Set up your MPIN' : 'Set a new MPIN')
                              : userLoginMode === 'set-mpin'
                                ? 'Set your MPIN'
                                : 'Welcome back'}
                    </h3>
                  </div>
                  <p className="text-[13px] text-slate-600 dark:text-white/55 mt-4">
                    {loginRole !== 'user'
                      ? 'Sign in with the auditor credentials shared by the business owner.'
                      : userLoginMode === 'forgot'
                        ? "We'll email you a secure link to set a new password."
                        : userLoginMode === 'forgot-sent'
                          ? `If an account exists for ${loginEmail}, a reset link is on its way.`
                          : userLoginMode === 'forgot-mpin'
                            ? mpinSetupIsNew
                              ? "This account doesn't have an MPIN yet. Confirm your password to create one."
                              : 'Confirm your password to choose a new PIN for your account.'
                            : userLoginMode === 'set-mpin'
                              ? 'Pick a 4-digit PIN for faster sign-in on any device.'
                              : 'Sign in with the owner account you created at signup.'}
                  </p>
                </div>

                {loginRole === 'user' && userLoginMode === 'mpin' ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); submitMpin(mpinDigits.join('')); }}
                    className="p-6 space-y-5"
                  >
                    <div>
                      <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Email address</label>
                      <input
                        ref={mpinEmailInputRef}
                        type="email"
                        value={loginEmail}
                        onChange={(e) => { setLoginEmail(e.target.value); setMpinError(''); }}
                        className="kaps-input"
                        placeholder="you@company.com"
                        autoComplete="username"
                        disabled={mpinLoading}
                      />
                    </div>

                    <div className="text-center">
                      <p className="text-[12px] font-medium text-slate-700 dark:text-white/70 mb-3">Enter your 4-digit MPIN</p>
                      <div className="flex justify-center gap-3">
                        {mpinDigits.map((digit, index) => (
                          <input
                            key={index}
                            ref={(el) => { mpinInputsRef.current[index] = el; }}
                            type="password"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={1}
                            value={digit}
                            disabled={mpinLoading}
                            onChange={(e) => handleMpinChange(index, e.target.value)}
                            onKeyDown={(e) => handleMpinKeyDown(index, e)}
                            className={`w-12 h-14 text-center text-2xl font-semibold rounded-xl border bg-white dark:bg-white/[0.03] text-slate-900 dark:text-white focus:outline-none focus:ring-2 disabled:opacity-50 transition ${
                              mpinError
                                ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                                : 'border-violet-300/50 dark:border-white/10 focus:border-violet-500 focus:ring-violet-500/20'
                            }`}
                          />
                        ))}
                      </div>
                      {mpinError ? (
                        <p className="mt-3 text-[12px] font-medium text-red-500">{mpinError}</p>
                      ) : (
                        <p className="mt-3 text-[12px] text-slate-500 dark:text-white/50">
                          {mpinLoading ? 'Signing in…' : 'Your MPIN works on any device'}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={mpinLoading}
                      className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                      {mpinLoading ? 'Signing in…' : 'Sign in with MPIN'}
                      {!mpinLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />}
                    </button>

                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                      <span className="text-[11px] text-slate-400 dark:text-white/40">or</span>
                      <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                    </div>

                    <button
                      type="button"
                      onClick={() => { setUserLoginMode('password'); setMpinError(''); setLoginPassword(''); }}
                      className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-full border border-violet-300/60 dark:border-white/12 text-violet-700 dark:text-violet-200 text-[13px] font-semibold hover:bg-violet-50 dark:hover:bg-white/[0.04] transition-colors"
                    >
                      Sign in with email &amp; password
                    </button>

                    <div className="flex items-center justify-center gap-3 text-[10px]">
                      <button
                        type="button"
                        onClick={openForgotMpin}
                        className="text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-medium"
                      >
                        Forgot MPIN?
                      </button>
                      <span className="text-slate-300 dark:text-white/20">|</span>
                      <button
                        type="button"
                        onClick={openSetupMpin}
                        className="text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-medium"
                      >
                        Not set up your MPIN yet?
                      </button>
                    </div>

                    <p className="text-[12px] text-center text-slate-500 dark:text-white/50">
                      Don't have an account?{' '}
                      <button
                        type="button"
                        onClick={() => { setShowLoginModal(false); setShowSignupModal(true); }}
                        className="text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-semibold"
                      >
                        Create one
                      </button>
                    </p>
                  </form>
                ) : loginRole === 'user' && userLoginMode === 'forgot-mpin' ? (
                  <form onSubmit={handleForgotMpin} className="p-6 space-y-4">
                    {mpinSetupIsNew && (
                      <div className="flex gap-2.5 px-3.5 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/[0.08] border border-amber-200 dark:border-amber-400/25">
                        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
                        <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-200">
                          No MPIN is set up on this account yet, so quick sign-in has nothing to
                          check. Enter your password and pick 4 digits below — from then on the PIN
                          works on every device you sign in from.
                        </p>
                      </div>
                    )}
                    <div>
                      <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Email address</label>
                      <input
                        type="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="kaps-input"
                        placeholder="you@company.com"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          className="kaps-input pr-11"
                          placeholder="Enter your password"
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
                      <p className="mt-1.5 text-[10px] text-right">
                        <button
                          type="button"
                          onClick={openForgotPassword}
                          className="text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-medium"
                        >
                          Forgot password too?
                        </button>
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">
                          {mpinSetupIsNew ? 'Choose MPIN' : 'New MPIN'}
                        </label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={4}
                          value={newMpin}
                          onChange={(e) => setNewMpin(e.target.value.replace(/\D/g, ''))}
                          className="kaps-input font-mono tracking-[0.5em]"
                          placeholder="4 digits"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Confirm MPIN</label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={4}
                          value={confirmNewMpin}
                          onChange={(e) => setConfirmNewMpin(e.target.value.replace(/\D/g, ''))}
                          className="kaps-input font-mono tracking-[0.5em]"
                          placeholder="Re-enter"
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={mpinLoading}
                      className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                      {mpinLoading ? 'Saving…' : mpinSetupIsNew ? 'Set MPIN & sign in' : 'Save MPIN & sign in'}
                      {!mpinLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />}
                    </button>

                    <p className="text-[11.5px] leading-relaxed text-slate-500 dark:text-white/45">
                      {mpinSetupIsNew
                        ? 'The MPIN is stored on your account, not on this phone or laptop, so it works everywhere you sign in. Only a one-way hash of the digits is kept, which is why the password is what proves it is you.'
                        : 'The new MPIN replaces the old one on your account and works on every device. Only a one-way hash of the digits is stored, so the password is what proves it is you.'}
                    </p>

                    <p className="text-[12px] text-center pt-1">
                      <button
                        type="button"
                        onClick={() => { setMpinSetupIsNew(false); setUserLoginMode('mpin'); resetMpin(); }}
                        className="inline-flex items-center gap-1.5 text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-semibold"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Back to MPIN sign-in
                      </button>
                    </p>
                  </form>
                ) : loginRole === 'user' && userLoginMode === 'set-mpin' ? (
                  <form onSubmit={handleSetMpin} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Choose MPIN</label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={4}
                          value={newMpin}
                          onChange={(e) => setNewMpin(e.target.value.replace(/\D/g, ''))}
                          className="kaps-input font-mono tracking-[0.5em]"
                          placeholder="4 digits"
                          autoFocus
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Confirm MPIN</label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={4}
                          value={confirmNewMpin}
                          onChange={(e) => setConfirmNewMpin(e.target.value.replace(/\D/g, ''))}
                          className="kaps-input font-mono tracking-[0.5em]"
                          placeholder="Re-enter"
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={mpinLoading}
                      className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                      {mpinLoading ? 'Saving…' : 'Save MPIN & continue'}
                      {!mpinLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />}
                    </button>

                    {hasLegacyMpinVault() ? (
                      <p className="text-[11.5px] leading-relaxed text-slate-500 dark:text-white/45">
                        Your earlier MPIN was saved only inside this browser, so it cannot be read
                        and carried over. Enter the same 4 digits (or new ones) once — from now on
                        the PIN lives on your account and works on every device.
                      </p>
                    ) : (
                      <p className="text-[11.5px] leading-relaxed text-slate-500 dark:text-white/45">
                        You're already signed in. This just enables the 4-digit quick sign-in next
                        time — on this device or any other.
                      </p>
                    )}

                    <p className="text-[12px] text-center pt-1">
                      <button
                        type="button"
                        onClick={skipSetMpin}
                        className="text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/70 font-medium"
                      >
                        Skip for now
                      </button>
                    </p>
                  </form>
                ) : loginRole === 'user' && userLoginMode === 'forgot' ? (
                  <form onSubmit={handleForgotPassword} className="p-6 space-y-4">
                    <div>
                      <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Email address</label>
                      <input
                        type="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="kaps-input"
                        placeholder="you@company.com"
                        autoFocus
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={resetLoading}
                      className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                      {resetLoading ? 'Sending…' : 'Send reset link'}
                      {!resetLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />}
                    </button>

                    <p className="text-[11.5px] leading-relaxed text-slate-500 dark:text-white/45">
                      The link expires 15 minutes after it is sent and can only be used once.
                    </p>

                    <p className="text-[12px] text-center pt-1">
                      <button
                        type="button"
                        onClick={() => setUserLoginMode(isReturningUser() ? 'mpin' : 'password')}
                        className="inline-flex items-center gap-1.5 text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-semibold"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Back to sign in
                      </button>
                    </p>
                  </form>
                ) : loginRole === 'user' && userLoginMode === 'forgot-sent' ? (
                  <div className="p-6 space-y-5">
                    <div className="flex gap-3 px-4 py-3.5 rounded-xl bg-violet-50/70 dark:bg-violet-500/[0.07] border border-violet-200 dark:border-violet-400/25">
                      <MailCheck className="w-4 h-4 text-violet-600 dark:text-violet-300 shrink-0 mt-0.5" />
                      <div className="text-[12.5px] leading-relaxed text-slate-700 dark:text-white/70 space-y-1.5">
                        <p>Open the email and follow the link to choose a new password.</p>
                        <p className="text-slate-500 dark:text-white/50">
                          It expires in 15 minutes. Nothing in your inbox? Check the spam folder before resending.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleForgotPassword()}
                      disabled={resetLoading}
                      className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-full border border-violet-300/60 dark:border-white/12 text-violet-700 dark:text-violet-200 text-[13px] font-semibold hover:bg-violet-50 dark:hover:bg-white/[0.04] transition-colors disabled:opacity-60 disabled:cursor-wait"
                    >
                      {resetLoading ? 'Sending…' : 'Resend link'}
                    </button>

                    <p className="text-[12px] text-center">
                      <button
                        type="button"
                        onClick={() => setUserLoginMode(isReturningUser() ? 'mpin' : 'password')}
                        className="inline-flex items-center gap-1.5 text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-semibold"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Back to sign in
                      </button>
                    </p>
                  </div>
                ) : loginRole === 'user' ? (
                  <form onSubmit={handleLogin} className="p-6 space-y-4">
                    <div>
                      <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Email address</label>
                      <input
                        type="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="kaps-input"
                        placeholder="you@company.com"
                        required
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70">Password</label>
                        <button
                          type="button"
                          onClick={openForgotPassword}
                          className="text-[12px] text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-semibold"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          className="kaps-input pr-11"
                          placeholder="Enter your password"
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

                    <button
                      type="submit"
                      className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all"
                    >
                      Sign in
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                    </button>

                    {/* The MPIN lives on the account, so quick sign-in is offered
                        here even on a device that has never seen it. */}
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                      <span className="text-[11px] text-slate-400 dark:text-white/40">or</span>
                      <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                    </div>
                    <button
                      type="button"
                      onClick={() => { setUserLoginMode('mpin'); resetMpin(); }}
                      className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-full border border-violet-300/60 dark:border-white/12 text-violet-700 dark:text-violet-200 text-[13px] font-semibold hover:bg-violet-50 dark:hover:bg-white/[0.04] transition-colors"
                    >
                      Sign in with MPIN
                    </button>

                    <p className="text-[12px] text-center text-slate-500 dark:text-white/50 pt-1">
                      Don't have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setShowLoginModal(false);
                          setShowSignupModal(true);
                        }}
                        className="text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-semibold"
                      >
                        Create one
                      </button>
                    </p>
                  </form>
                ) : auditorStage === 'email' ? (
                  <form onSubmit={handleAuditorLookup} className="p-6 space-y-4">
                    <div>
                      <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Email address</label>
                      <input
                        type="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="kaps-input"
                        placeholder="you@company.com"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={auditorLoading}
                      className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                      {auditorLoading ? 'Checking…' : 'Continue'}
                      {!auditorLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />}
                    </button>
                  </form>
                ) : auditorStage === 'pick' ? (
                  <div className="p-6 space-y-3">
                    <div className="text-[12px] text-slate-600 dark:text-white/55">
                      You audit <span className="font-semibold text-slate-900 dark:text-white">{auditorCompanies.length}</span> workspaces. Pick the one you want to sign in to.
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {auditorCompanies.map((opt) => (
                        <button
                          key={opt.auditor_id}
                          type="button"
                          onClick={() => {
                            setSelectedAuditor(opt);
                            setAuditorStage('password');
                            setLoginPassword('');
                          }}
                          className="w-full inline-flex items-center gap-3 px-3 py-3 border border-slate-200 dark:border-white/10 rounded-xl bg-white dark:bg-white/[0.03] hover:border-violet-400 dark:hover:border-violet-400/40 hover:bg-violet-50/60 dark:hover:bg-violet-500/[0.06] transition-colors text-left"
                        >
                          <div className="h-10 w-10 rounded-lg bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0 overflow-hidden">
                            {opt.company_logo ? (
                              <img src={opt.company_logo} alt={opt.company_name} className="w-full h-full object-contain" />
                            ) : (
                              <span className="text-[14px] font-semibold">{opt.company_name.slice(0, 1).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold text-slate-900 dark:text-white truncate">{opt.company_name}</div>
                            <div className="text-[11.5px] text-slate-500 dark:text-white/55 truncate">Signed in as {opt.full_name}</div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-400 dark:text-white/40 shrink-0" />
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAuditorStage('email');
                        setAuditorCompanies([]);
                      }}
                      className="inline-flex items-center gap-1.5 text-[12px] text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-semibold"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Use a different email
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleAuditorPasswordLogin} className="p-6 space-y-4">
                    {selectedAuditor && (
                      <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-violet-50/60 dark:bg-violet-500/[0.06] border border-violet-200 dark:border-violet-400/25">
                        <div className="h-9 w-9 rounded-lg bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0 overflow-hidden">
                          {selectedAuditor.company_logo ? (
                            <img src={selectedAuditor.company_logo} alt={selectedAuditor.company_name} className="w-full h-full object-contain" />
                          ) : (
                            <span className="text-[13px] font-semibold">{selectedAuditor.company_name.slice(0, 1).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{selectedAuditor.company_name}</div>
                          <div className="text-[11px] text-slate-500 dark:text-white/55 truncate">{selectedAuditor.full_name}</div>
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">Password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          className="kaps-input pr-11"
                          placeholder="Enter your password"
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
                    <button
                      type="submit"
                      disabled={auditorLoading}
                      className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                      {auditorLoading ? 'Signing in…' : 'Sign in'}
                      {!auditorLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (auditorCompanies.length > 1) {
                          setAuditorStage('pick');
                          setSelectedAuditor(null);
                          setLoginPassword('');
                        } else {
                          setAuditorStage('email');
                          setAuditorCompanies([]);
                          setSelectedAuditor(null);
                          setLoginPassword('');
                        }
                      }}
                      className="inline-flex items-center gap-1.5 text-[12px] text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-semibold"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      {auditorCompanies.length > 1 ? 'Pick a different workspace' : 'Use a different email'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================== SIGNUP MODAL ============================== */}
        {showSignupModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center kaps-safe-overlay bg-slate-900/40 dark:bg-black/70 backdrop-blur-md"
            onClick={() => {
              setShowSignupModal(false);
              setSignupData({
                fullName: '', email: '', password: '', phone: '', companyName: '',
                gstin: '', pan: '', address: '', city: '', state: '', pinCode: '', companyLogo: '', mpin: '', confirmMpin: ''
              });
            }}
          >
            <div
              className="relative max-w-2xl w-full max-h-[92vh] rounded-2xl p-[1px] bg-gradient-to-br from-violet-500/50 via-slate-200 dark:via-white/10 to-violet-500/30"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rounded-[15px] bg-white dark:bg-[#0a0a26]/95 backdrop-blur overflow-hidden flex flex-col max-h-[calc(92vh-2px)]">
                <div className="relative px-6 pt-7 pb-5 border-b border-slate-200 dark:border-white/[0.08] flex-shrink-0">
                  <button
                    onClick={() => {
                      setShowSignupModal(false);
                      setSignupData({
                        fullName: '', email: '', password: '', phone: '', companyName: '',
                        gstin: '', pan: '', address: '', city: '', state: '', pinCode: '', companyLogo: '', mpin: '', confirmMpin: ''
                      });
                    }}
                    className="absolute right-5 top-5 p-1 rounded-md text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
                      <Receipt className="w-4 h-4 text-white" strokeWidth={2.25} />
                    </div>
                    <h3 className="text-[16px] font-medium tracking-tight text-slate-900 dark:text-white">Create your workspace</h3>
                  </div>
                  <p className="text-[13px] text-slate-600 dark:text-white/55 mt-2.5">
                    Set up your business profile to start raising GST-compliant invoices in minutes.
                  </p>
                </div>

                <form onSubmit={handleSignup} className="overflow-y-auto flex-1 kaps-modal-scroll">
                  <div className="p-6 space-y-7">
                    <FormSection label="Personal information">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Full name" required>
                          <input type="text" value={signupData.fullName} onChange={(e) => setSignupData({ ...signupData, fullName: e.target.value })} className="kaps-input" placeholder="Priya Sharma" required />
                        </Field>
                        <Field label="Phone number" required>
                          <input type="tel" value={signupData.phone} onChange={(e) => setSignupData({ ...signupData, phone: e.target.value })} className="kaps-input" placeholder="+91 98765 43210" required />
                        </Field>
                        <Field label="Email address" required className="sm:col-span-2">
                          <input type="email" value={signupData.email} onChange={(e) => setSignupData({ ...signupData, email: e.target.value })} className="kaps-input" placeholder="you@company.com" required />
                        </Field>
                        <Field label="Password" required className="sm:col-span-2">
                          <div className="relative">
                            <input type={showSignupPassword ? 'text' : 'password'} value={signupData.password} onChange={(e) => setSignupData({ ...signupData, password: e.target.value })} className="kaps-input pr-11" placeholder="Minimum 8 characters" required />
                            <button type="button" onClick={() => setShowSignupPassword(!showSignupPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white">
                              {showSignupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </Field>
                        <Field label="MPIN" required hint="4-digit PIN for quick sign-in on any device">
                          <input
                            type="password"
                            inputMode="numeric"
                            value={signupData.mpin}
                            onChange={(e) => setSignupData({ ...signupData, mpin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                            maxLength={4}
                            className="kaps-input font-mono tracking-[0.5em]"
                            placeholder="••••"
                            required
                          />
                        </Field>
                        <Field label="Confirm MPIN" required hint="Re-enter the same 4 digits">
                          <input
                            type="password"
                            inputMode="numeric"
                            value={signupData.confirmMpin}
                            onChange={(e) => setSignupData({ ...signupData, confirmMpin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                            maxLength={4}
                            className="kaps-input font-mono tracking-[0.5em]"
                            placeholder="••••"
                            required
                          />
                        </Field>
                      </div>
                    </FormSection>

                    <FormSection label="Company information">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Company name" required className="sm:col-span-2">
                          <input type="text" value={signupData.companyName} onChange={(e) => setSignupData({ ...signupData, companyName: e.target.value })} className="kaps-input" placeholder="Your Company Pvt Ltd" required />
                        </Field>
                        <Field label="Taxpayer type" required className="sm:col-span-2" hint="Choose Composition Scheme / Unregistered User if you are under the GST Composition Scheme or not registered under GST">
                          <select value={signupData.taxpayerType} onChange={(e) => setSignupData({ ...signupData, taxpayerType: e.target.value })} className="kaps-input" required>
                            <option value="regular">Regular taxpayer</option>
                            <option value="composition">Composition Scheme / Unregistered User</option>
                          </select>
                        </Field>
                        <Field label="Company logo" className="sm:col-span-2">
                          <div className="flex items-center gap-4">
                            <div className="h-14 w-14 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04] flex items-center justify-center overflow-hidden">
                              {signupData.companyLogo ? (
                                <img src={signupData.companyLogo} alt="Company logo preview" className="w-full h-full object-contain" />
                              ) : (
                                <FileText className="w-5 h-5 text-slate-400 dark:text-white/40" />
                              )}
                            </div>
                            <label className="inline-flex items-center gap-2 px-3.5 h-9 border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.08] transition-colors cursor-pointer text-[13px] font-medium text-slate-700 dark:text-white/85">
                              <Upload className="w-3.5 h-3.5" />
                              Upload logo
                              <input type="file" accept="image/*" onChange={(event) => handleLogoUpload(event.target.files?.[0])} className="hidden" />
                            </label>
                            {signupData.companyLogo && (
                              <button type="button" onClick={() => setSignupData({ ...signupData, companyLogo: '' })} className="text-[12px] text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white">
                                Remove
                              </button>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 dark:text-white/40 mt-2">PNG, JPG, or SVG · under 1 MB.</p>
                        </Field>
                        <Field label="GSTIN" className="sm:col-span-2" hint="Optional — 15-character GST identification number">
                          <input
                            type="text"
                            value={signupData.gstin}
                            onChange={(e) => {
                              const gstin = normalizeGstin(e.target.value);
                              setSignupData({ ...signupData, gstin, pan: extractPanFromGstin(gstin) });
                            }}
                            maxLength={15}
                            className="kaps-input font-mono"
                            placeholder="22AAAAA0000A1Z5"
                          />
                        </Field>
                        <Field label="PAN number" className="sm:col-span-2">
                          <input
                            type="text"
                            value={signupData.pan}
                            onChange={(e) => setSignupData({ ...signupData, pan: e.target.value.toUpperCase().slice(0, 10) })}
                            maxLength={10}
                            className="kaps-input font-mono"
                            placeholder="AAAAA0000A"
                          />
                        </Field>
                      </div>
                    </FormSection>

                    <FormSection label="Business address">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Address" required className="sm:col-span-2">
                          <textarea rows={2} value={signupData.address} onChange={(e) => setSignupData({ ...signupData, address: e.target.value })} className="kaps-input resize-none py-2.5" placeholder="Street address, building name, floor" required />
                        </Field>
                        <Field label="City" required>
                          <input type="text" value={signupData.city} onChange={(e) => setSignupData({ ...signupData, city: e.target.value })} className="kaps-input" placeholder="Mumbai" required />
                        </Field>
                        <Field label="State" required>
                          <select value={signupData.state} onChange={(e) => setSignupData({ ...signupData, state: e.target.value })} className="kaps-input" required>
                            <option value="">Select state</option>
                            <option value="Maharashtra">Maharashtra</option>
                            <option value="Karnataka">Karnataka</option>
                            <option value="Tamil Nadu">Tamil Nadu</option>
                            <option value="Gujarat">Gujarat</option>
                            <option value="Delhi">Delhi</option>
                            <option value="Uttar Pradesh">Uttar Pradesh</option>
                            <option value="West Bengal">West Bengal</option>
                            <option value="Rajasthan">Rajasthan</option>
                            <option value="Telangana">Telangana</option>
                            <option value="Andhra Pradesh">Andhra Pradesh</option>
                            <option value="Kerala">Kerala</option>
                            <option value="Punjab">Punjab</option>
                            <option value="Haryana">Haryana</option>
                            <option value="Madhya Pradesh">Madhya Pradesh</option>
                            <option value="Bihar">Bihar</option>
                          </select>
                        </Field>
                        <Field label="PIN code" required>
                          <input type="text" value={signupData.pinCode} onChange={(e) => setSignupData({ ...signupData, pinCode: e.target.value })} maxLength={6} className="kaps-input" placeholder="400001" required />
                        </Field>
                      </div>
                    </FormSection>
                  </div>

                  <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.02] flex-shrink-0">
                    <button
                      type="submit"
                      className="group w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-[14px] font-semibold shadow-[0_8px_30px_-8px_rgba(139,92,246,0.7)] transition-all"
                    >
                      Create my workspace
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                    </button>
                    <p className="text-[12px] text-center text-slate-500 dark:text-white/50 mt-3">
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setShowSignupModal(false);
                          setShowLoginModal(true);
                        }}
                        className="text-violet-600 dark:text-violet-300 hover:text-violet-700 dark:hover:text-violet-200 font-semibold"
                      >
                        Sign in
                      </button>
                    </p>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Local helper styles */}
      <style>{`
        .kaps-root {
          font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          background: #fafbfd;
        }
        .kaps-root.dark {
          background: #050516;
        }

        /* Light theme background */
        .kaps-bg {
          background:
            radial-gradient(70% 50% at 50% 0%, rgba(139, 92, 246, 0.10), transparent 60%),
            radial-gradient(50% 40% at 50% 100%, rgba(139, 92, 246, 0.06), transparent 60%),
            linear-gradient(180deg, #fafbfd 0%, #f4f3fb 30%, #fafbfd 60%, #ffffff 100%);
        }
        .dark .kaps-bg {
          background:
            radial-gradient(80% 60% at 50% 0%, rgba(76, 29, 149, 0.25), transparent 60%),
            radial-gradient(60% 50% at 50% 100%, rgba(76, 29, 149, 0.18), transparent 60%),
            linear-gradient(180deg, #060617 0%, #08081f 30%, #06061a 60%, #04040f 100%);
        }

        /* Stars only in dark */
        .kaps-stars { display: none; }
        .dark .kaps-stars {
          display: block;
          background-image:
            radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,0.55), transparent 50%),
            radial-gradient(1px 1px at 28% 42%, rgba(255,255,255,0.35), transparent 50%),
            radial-gradient(1.5px 1.5px at 48% 22%, rgba(255,255,255,0.55), transparent 50%),
            radial-gradient(1px 1px at 72% 38%, rgba(255,255,255,0.4), transparent 50%),
            radial-gradient(1px 1px at 84% 12%, rgba(255,255,255,0.55), transparent 50%),
            radial-gradient(1px 1px at 18% 78%, rgba(255,255,255,0.5), transparent 50%),
            radial-gradient(1.5px 1.5px at 64% 88%, rgba(255,255,255,0.45), transparent 50%),
            radial-gradient(1px 1px at 36% 92%, rgba(255,255,255,0.35), transparent 50%),
            radial-gradient(1px 1px at 92% 70%, rgba(255,255,255,0.45), transparent 50%),
            radial-gradient(1px 1px at 8% 60%, rgba(255,255,255,0.4), transparent 50%),
            radial-gradient(1px 1px at 58% 64%, rgba(255,255,255,0.35), transparent 50%),
            radial-gradient(1.5px 1.5px at 22% 32%, rgba(167, 139, 250, 0.55), transparent 50%),
            radial-gradient(1.5px 1.5px at 78% 56%, rgba(167, 139, 250, 0.5), transparent 50%);
          background-size: 800px 800px;
          opacity: 0.9;
        }

        /* Top glow */
        .kaps-glow-top {
          background: radial-gradient(60% 60% at 50% 0%, rgba(139, 92, 246, 0.08), transparent 65%);
        }
        .dark .kaps-glow-top {
          background: radial-gradient(60% 60% at 50% 0%, rgba(139, 92, 246, 0.18), transparent 65%);
        }

        /* Cards */
        .kaps-card {
          background: #ffffff;
          border: 1px solid rgba(15, 23, 42, 0.06);
          box-shadow:
            0 1px 0 rgba(255,255,255,0.6) inset,
            0 20px 50px -30px rgba(15, 23, 42, 0.14);
        }
        .dark .kaps-card {
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015));
          border: 1px solid rgba(255,255,255,0.07);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.05),
            0 30px 80px -40px rgba(0,0,0,0.6);
        }

        /* Violet border for testimonial cards in light theme */
        .kaps-testimonial-card {
          border-color: rgba(139, 92, 246, 0.38);
          border-width: 2px;
        }
        .dark .kaps-testimonial-card { border-width: 2px; }

        /* Card inner glow */
        .kaps-card-glow {
          position: absolute;
          inset: 0;
          background: radial-gradient(60% 60% at 50% 0%, rgba(139, 92, 246, 0.05), transparent 65%);
          opacity: 0.6;
          pointer-events: none;
          border-radius: inherit;
        }
        .dark .kaps-card-glow {
          background: radial-gradient(60% 60% at 50% 0%, rgba(139, 92, 246, 0.18), transparent 65%);
        }

        /* CTA stars (always dark surface) */
        .kaps-cta-stars {
          background-image:
            radial-gradient(1px 1px at 10% 30%, rgba(255,255,255,0.4), transparent 50%),
            radial-gradient(1px 1px at 28% 70%, rgba(255,255,255,0.35), transparent 50%),
            radial-gradient(1.5px 1.5px at 48% 12%, rgba(255,255,255,0.5), transparent 50%),
            radial-gradient(1px 1px at 72% 80%, rgba(255,255,255,0.4), transparent 50%),
            radial-gradient(1px 1px at 84% 22%, rgba(255,255,255,0.45), transparent 50%),
            radial-gradient(1.5px 1.5px at 60% 50%, rgba(167, 139, 250, 0.55), transparent 50%);
          background-size: 400px 400px;
        }

        /* Inputs — light by default, dark when ancestor has .dark */
        /* Modal scrollbar — match the dark theme instead of falling back to the system white scrollbar */
        .kaps-modal-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(15, 23, 42, 0.20) transparent;
        }
        .dark .kaps-modal-scroll {
          scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
        }
        .kaps-modal-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .kaps-modal-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .kaps-modal-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(15, 23, 42, 0.20);
          border-radius: 9999px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .kaps-modal-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgba(15, 23, 42, 0.30);
        }
        .dark .kaps-modal-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.14);
        }
        .dark .kaps-modal-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.22);
        }

        .kaps-input {
          width: 100%;
          padding-left: 0.875rem;
          padding-right: 0.875rem;
          height: 2.75rem;
          border: 1px solid rgba(139, 92, 246, 0.35);
          border-radius: 0.625rem;
          font-size: 14px;
          color: #0f172a;
          background: #ffffff;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .kaps-input::placeholder { color: #94a3b8; }
        .kaps-input:focus {
          outline: none;
          border-color: rgba(139, 92, 246, 0.6);
          background: #ffffff;
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
        }
        .dark .kaps-input {
          border-color: rgba(255,255,255,0.10);
          color: #ffffff;
          background: rgba(255,255,255,0.03);
        }
        .dark .kaps-input::placeholder { color: rgba(255,255,255,0.35); }
        .dark .kaps-input:focus {
          border-color: rgba(139, 92, 246, 0.6);
          background: rgba(255,255,255,0.05);
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
        }
        textarea.kaps-input { height: auto; }
        select.kaps-input {
          appearance: none;
          background-image:
            linear-gradient(45deg, transparent 50%, #64748b 50%),
            linear-gradient(135deg, #64748b 50%, transparent 50%);
          background-position: calc(100% - 16px) center, calc(100% - 11px) center;
          background-size: 5px 5px, 5px 5px;
          background-repeat: no-repeat;
        }
        .dark select.kaps-input {
          background-image:
            linear-gradient(45deg, transparent 50%, rgba(255,255,255,0.5) 50%),
            linear-gradient(135deg, rgba(255,255,255,0.5) 50%, transparent 50%);
        }
        select.kaps-input option { background: #ffffff; color: #0f172a; }
        .dark select.kaps-input option { background: #0a0a26; color: #ffffff; }

        /* Floating animations */
        @keyframes kaps-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        .kaps-float { animation: kaps-float 5s ease-in-out infinite; }
        .kaps-float-slow { animation: kaps-float 7s ease-in-out infinite; }

        /* Purple pulse travelling across the dotted connector between two icons.
         * Each dot's violet overlay fades in on a staggered delay, so the glow
         * appears to flow from the left icon to the right one. */
        .kaps-pulse {
          opacity: 0;
          animation: kaps-pulse 1.6s ease-in-out infinite;
          will-change: opacity, transform;
        }
        @keyframes kaps-pulse {
          0%, 100% { opacity: 0; transform: scale(0.8); }
          45%      { opacity: 1; transform: scale(1.5); }
        }
        @media (prefers-reduced-motion: reduce) {
          .kaps-pulse { animation: none; }
        }

        /* Orbital revolution around the hub. The trailing counter-rotation keeps
         * each node upright while it travels the ring. Radius/start/duration are
         * supplied per node via CSS variables. */
        @keyframes kaps-orbit {
          from { transform: rotate(var(--start)) translateX(var(--radius)) rotate(calc(-1 * var(--start))); }
          to   { transform: rotate(calc(var(--start) + 360deg)) translateX(var(--radius)) rotate(calc(-1 * (var(--start) + 360deg))); }
        }
        .kaps-orbiter {
          top: 50%;
          left: 50%;
          margin-top: -14px;
          margin-left: -14px;
          animation: kaps-orbit var(--dur, 30s) linear infinite;
          will-change: transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .kaps-orbiter { animation: none; transform: rotate(var(--start)) translateX(var(--radius)) rotate(calc(-1 * var(--start))); }
        }

        /* Testimonials marquee */
        .kaps-marquee-mask {
          -webkit-mask-image: linear-gradient(to right, transparent, black 6%, black 94%, transparent);
          mask-image: linear-gradient(to right, transparent, black 6%, black 94%, transparent);
        }
        .kaps-marquee-track { overflow: hidden; }
        @keyframes kaps-marquee-scroll {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(calc(-50% - 0.625rem), 0, 0); }
        }
        .kaps-marquee { animation: kaps-marquee-scroll 60s linear infinite; will-change: transform; }
        .kaps-marquee-slow { animation: kaps-marquee-scroll 60s linear infinite; animation-delay: -7.5s; will-change: transform; }

        /* Feature cards — static glowing violet border on each card */
        .kaps-feature-card::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          box-shadow:
            0 0 0 1px rgba(139, 92, 246, 0.42),
            0 0 24px rgba(139, 92, 246, 0.22),
            0 0 60px rgba(139, 92, 246, 0.10);
        }
        .dark .kaps-feature-card::after {
          box-shadow:
            0 0 0 1px rgba(167, 139, 250, 0.42),
            0 0 24px rgba(139, 92, 246, 0.30),
            0 0 60px rgba(139, 92, 246, 0.18);
        }
        .kaps-marquee-mask:hover .kaps-marquee,
        .kaps-marquee-mask:hover .kaps-marquee-slow { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) {
          .kaps-marquee, .kaps-marquee-slow { animation: none; }
        }
      `}</style>
    </>
  );
}

/* ============================== SUB-COMPONENTS ============================== */

function ThemeToggle({ isDark, onToggle, compact }: { isDark: boolean; onToggle: () => void; compact?: boolean }) {
  return (
    <button
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`relative inline-flex items-center justify-center rounded-full border border-slate-300 dark:border-white/15 bg-white dark:bg-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.08] text-slate-700 dark:text-white/80 transition-colors shadow-sm dark:shadow-none ${
        compact ? 'h-9 w-9' : 'h-9 w-9'
      }`}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function PillNav({ href, children, active }: { href: string; children: React.ReactNode; active?: boolean }) {
  return (
    <a
      href={href}
      className={`px-4 h-8 inline-flex items-center text-[13px] rounded-full transition-colors ${
        active
          ? 'bg-violet-500 text-white shadow-[0_4px_18px_-6px_rgba(139,92,246,0.7)]'
          : 'text-slate-600 dark:text-white/70 hover:text-slate-900 dark:hover:text-white'
      }`}
    >
      {children}
    </a>
  );
}

/* ===== Dashboard mockup sub-parts (always dark) ===== */

function SbItem({
  icon, label, active, badge, warn
}: { icon: React.ReactNode; label: string; active?: boolean; badge?: string; warn?: boolean }) {
  return (
    <div
      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
        active
          ? 'bg-violet-500/15 text-white border border-violet-400/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
          : 'text-white/60 hover:text-white hover:bg-white/[0.04] border border-transparent'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={active ? 'text-violet-300' : 'text-white/45 group-hover:text-white/70'}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      {badge && (
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums ${
          warn ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.06] text-white/55'
        }`}>
          {badge}
        </span>
      )}
    </div>
  );
}

function KpiCard({
  label, value, delta, deltaTone, icon, accent
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone: 'positive' | 'warning' | 'neutral';
  icon: React.ReactNode;
  accent: 'violet' | 'sky' | 'amber';
}) {
  const accentClasses: Record<string, string> = {
    violet: 'from-violet-400/30 to-violet-600/10 text-violet-300 border-violet-400/30',
    sky: 'from-sky-400/30 to-sky-600/10 text-sky-300 border-sky-400/30',
    amber: 'from-amber-400/30 to-amber-600/10 text-amber-300 border-amber-400/30'
  };
  const deltaClasses: Record<string, string> = {
    positive: 'text-emerald-300',
    warning: 'text-amber-300',
    neutral: 'text-white/50'
  };
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 lg:p-4">
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-wider text-white/45 font-semibold">{label}</div>
        <div className={`h-6 w-6 rounded-md border bg-gradient-to-br flex items-center justify-center ${accentClasses[accent]}`}>
          {icon}
        </div>
      </div>
      <div className="mt-2 text-[18px] lg:text-[22px] font-semibold text-white tracking-tight tabular-nums">{value}</div>
      <div className={`text-[10px] font-semibold mt-0.5 ${deltaClasses[deltaTone]}`}>{delta}</div>
    </div>
  );
}

function InvoiceRow({
  num, date, name, gstin, amount, status, last
}: {
  num: string; date: string; name: string; gstin: string; amount: string; status: 'paid' | 'pending' | 'overdue'; last?: boolean;
}) {
  const statusStyles: Record<string, string> = {
    paid: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30',
    pending: 'bg-amber-500/10 text-amber-300 border-amber-400/30',
    overdue: 'bg-rose-500/10 text-rose-300 border-rose-400/30'
  };
  return (
    <div className={`grid grid-cols-12 px-4 py-2.5 items-center text-[11px] ${last ? '' : 'border-b border-white/[0.04]'} hover:bg-white/[0.015]`}>
      <div className="col-span-12 sm:col-span-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-400/70 hidden sm:inline-block" />
        <div className="min-w-0">
          <div className="font-mono text-white/85 truncate">{num}</div>
          <div className="text-[10px] text-white/40">{date}</div>
        </div>
      </div>
      <div className="hidden sm:block col-span-4 min-w-0">
        <div className="text-white/85 font-medium truncate">{name}</div>
        <div className="text-[10px] text-white/40 font-mono truncate">{gstin}</div>
      </div>
      <div className="hidden sm:block col-span-3 text-right font-semibold text-white tabular-nums">{amount}</div>
      <div className="hidden sm:flex col-span-2 justify-end">
        <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${statusStyles[status]}`}>
          {status}
        </span>
      </div>
    </div>
  );
}

/* ===== Bento orbit ===== */

function OrbitVisual() {
  // Each node gets its OWN ring (no two share a radius) and every node spins at
  // a different speed. Because the rings are spaced a full node-width apart,
  // even when two nodes line up at the same angle their bubbles never touch —
  // so independent speeds can never cause an overlap or cut-through.
  const orbiters = [
    { Icon: Briefcase, label: 'Services', g: 'from-sky-400 to-indigo-500', radius: 44, start: 30, dur: 22 },
    { Icon: Truck, label: 'Logistics', g: 'from-fuchsia-400 to-pink-500', radius: 72, start: 150, dur: 30 },
    { Icon: Store, label: 'Retail', g: 'from-orange-400 to-rose-500', radius: 100, start: 260, dur: 38 },
    { Icon: Factory, label: 'Manufacturing', g: 'from-emerald-400 to-teal-500', radius: 128, start: 70, dur: 26 },
    { Icon: ShoppingCart, label: 'E-commerce', g: 'from-amber-400 to-orange-500', radius: 156, start: 200, dur: 34 }
  ];
  const rings = [312, 256, 200, 144, 88];
  return (
    <div className="relative w-full h-[350px] flex items-center justify-center">
      {rings.map((d, i) => (
        <div
          key={d}
          className={`absolute rounded-full border ${i % 2 === 1 ? 'border-dashed' : ''} border-slate-200 dark:border-white/[0.07]`}
          style={{ height: d, width: d }}
        />
      ))}

      {orbiters.map((o, i) => (
        <div
          key={i}
          className={`kaps-orbiter absolute h-7 w-7 rounded-full bg-gradient-to-br ${o.g} ring-2 ring-white dark:ring-[#0a0a26] flex items-center justify-center text-white`}
          style={{ '--radius': `${o.radius}px`, '--start': `${o.start}deg`, '--dur': `${o.dur}s` } as React.CSSProperties}
          title={o.label}
          aria-label={o.label}
        >
          <o.Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
        </div>
      ))}

      <div className="relative">
        <div className="absolute -inset-3 rounded-full bg-violet-500/30 blur-xl" />
        <div className="relative h-14 w-14 rounded-full bg-gradient-to-br from-violet-400 to-violet-700 ring-2 ring-white dark:ring-white/15 flex items-center justify-center shadow-[0_0_30px_-4px_rgba(139,92,246,0.7)]">
          <span className="text-[11px] font-bold text-white">10K+</span>
        </div>
        <p className="absolute left-1/2 -translate-x-1/2 mt-2 text-[11px] text-slate-500 dark:text-white/60 whitespace-nowrap top-full">Businesses</p>
      </div>
    </div>
  );
}

/* ===== Feature illustrations (theme aware) ===== */

function FeatureCard({
  illustration, title, description
}: { illustration: React.ReactNode; title: string; description: string }) {
  return (
    <div className="kaps-card kaps-feature-card relative rounded-2xl p-6 lg:p-7 flex flex-col">
      <div className="kaps-card-glow" aria-hidden />
      <div className="relative h-24 mb-6 flex items-center">{illustration}</div>
      <h3 className="relative text-[15px] font-medium text-slate-900 dark:text-white">{title}</h3>
      <p className="relative mt-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-white/55">{description}</p>
    </div>
  );
}

function TaxInvoiceIllustration() {
  return (
    <div className="relative w-full">
      <div className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[8.5px] font-mono text-slate-500 dark:text-white/50">INV/2026/0142</span>
          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-400/30">Paid</span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between">
            <div className="h-1.5 w-12 rounded-full bg-slate-300 dark:bg-white/20" />
            <div className="h-1.5 w-10 rounded-full bg-violet-400/80" />
          </div>
          <div className="flex justify-between">
            <div className="h-1.5 w-16 rounded-full bg-slate-200 dark:bg-white/12" />
            <div className="h-1.5 w-8 rounded-full bg-slate-300 dark:bg-white/20" />
          </div>
          <div className="flex justify-between pt-1 border-t border-slate-200 dark:border-white/5">
            <div className="h-1.5 w-10 rounded-full bg-slate-400 dark:bg-white/30" />
            <div className="h-2 w-14 rounded-full bg-violet-500" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CreditNoteIllustration() {
  return (
    <div className="relative w-full">
      <div className="absolute -top-1 left-3 right-6 h-10 rounded-md border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-1.5">
        <div className="h-1.5 w-12 rounded-full bg-slate-300 dark:bg-white/15" />
        <div className="h-1.5 w-16 rounded-full bg-slate-200 dark:bg-white/10 mt-1.5" />
      </div>
      <div className="relative ml-6 mt-6 h-10 rounded-md border border-violet-400/40 bg-violet-500/10 p-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[8px] font-semibold tracking-wider uppercase text-violet-600 dark:text-violet-300">Credit Note</span>
          <FileMinus className="h-3 w-3 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-white/15 mt-1.5" />
      </div>
    </div>
  );
}

function OutstandingIllustration() {
  return (
    <div className="relative w-full">
      <div className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Clock className="h-3 w-3 text-amber-500 dark:text-amber-300" />
          <span className="text-[8.5px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300">Pending · 12</span>
        </div>
        <div className="space-y-1.5">
          {[80, 60, 45].map((w, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-white/15" />
              <div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-400 to-amber-500" style={{ width: `${w}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GstrIllustration() {
  return (
    <div className="relative w-full">
      <div className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[8.5px] font-bold uppercase tracking-wider text-slate-700 dark:text-white/65">GSTR-1 · May</span>
          <BarChart3 className="h-3 w-3 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="flex items-end gap-1 h-8">
          {[40, 65, 50, 80, 60, 95, 75].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-violet-500/30 to-violet-400" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Testimonial({
  initials, name, location, gradient, quote
}: { initials: string; name: string; location: string; gradient: string; quote: string }) {
  return (
    <div className="kaps-card kaps-testimonial-card relative rounded-2xl p-5 lg:p-6 h-full flex flex-col">
      <div className="kaps-card-glow" aria-hidden />
      <div className="relative flex items-center gap-3 mb-4">
        <div className={`h-9 w-9 shrink-0 rounded-full bg-gradient-to-br ${gradient} ring-2 ring-white dark:ring-white/10 flex items-center justify-center text-[11px] font-bold text-white`}>
          {initials}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-900 dark:text-white truncate">{name}</div>
          <div className="text-[11px] text-slate-500 dark:text-white/45 truncate">{location}</div>
        </div>
      </div>
      <p className="relative text-[12.5px] leading-relaxed text-slate-700 dark:text-white/65 line-clamp-4">{quote}</p>
    </div>
  );
}

function FooterCol({ heading, links }: { heading: string; links: string[] }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-500 dark:text-white/40 mb-4">{heading}</h4>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l}>
            <a href="#" className="text-[13px] text-slate-700 dark:text-white/70 hover:text-slate-900 dark:hover:text-white transition-colors">{l}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-500 dark:text-white/45 mb-3.5">{label}</h4>
      {children}
    </div>
  );
}

function Field({
  label, required, children, className, hint
}: { label: string; required?: boolean; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <div className={className}>
      <label className="block text-[12px] font-medium text-slate-700 dark:text-white/70 mb-1.5">
        {label}{required && <span className="text-rose-500 dark:text-rose-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1.5">{hint}</p>}
    </div>
  );
}
