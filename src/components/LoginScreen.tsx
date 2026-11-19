import React, { useState, useEffect } from 'react';
import {
  Factory,
  Lock,
  Mail,
  ArrowRight,
  ShieldCheck,
  Eye,
  EyeOff,
  Crown,
  Smartphone,
  FileCheck2,
  Copy,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AlertBanner } from './ui/DataPrimitives';

const REMEMBER_EMAIL_KEY = 'factoryflow_remembered_email';
const DEMO_SHARED_PASSWORD = 'Password@123';

interface DemoRoleCard {
  role: string;
  shortAction: string;
  roleCode: string;
  name: string;
  email: string;
  password: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClasses: string;
}

const DEMO_ROLES: DemoRoleCard[] = [
  {
    role: 'Owner',
    shortAction: 'Continue as Owner',
    roleCode: 'OWNER',
    name: 'Meenakshi Sundaram',
    email: 'owner@factoryflow.in',
    password: DEMO_SHARED_PASSWORD,
    description: 'Executive dashboard and business insights.',
    icon: Crown,
    accentClasses: 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white',
  },
  {
    role: 'Admin',
    shortAction: 'Continue as Admin',
    roleCode: 'ADMIN',
    name: 'Aravind Krishnan',
    email: 'admin@factoryflow.in',
    password: DEMO_SHARED_PASSWORD,
    description: 'Orders, billing, customers and payments.',
    icon: ShieldCheck,
    accentClasses: 'bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white',
  },
  {
    role: 'Production Supervisor',
    shortAction: 'Continue as Supervisor',
    roleCode: 'PRODUCTION_SUPERVISOR',
    name: 'Senthil Murugan',
    email: 'supervisor@factoryflow.in',
    password: DEMO_SHARED_PASSWORD,
    description: 'BOM, production and inventory.',
    icon: Factory,
    accentClasses: 'bg-violet-50 text-violet-600 group-hover:bg-violet-600 group-hover:text-white',
  },
  {
    role: 'Salesman',
    shortAction: 'Continue as Salesman',
    roleCode: 'SALESMAN',
    name: 'Karthik Rajan',
    email: 'sales@factoryflow.in',
    password: DEMO_SHARED_PASSWORD,
    description: 'Mobile order management.',
    icon: Smartphone,
    accentClasses: 'bg-sky-50 text-sky-600 group-hover:bg-sky-600 group-hover:text-white',
  },
  {
    role: 'Auditor',
    shortAction: 'Continue as Auditor',
    roleCode: 'AUDITOR',
    name: 'Lakshmi Narayanan CA',
    email: 'auditor@factoryflow.in',
    password: DEMO_SHARED_PASSWORD,
    description: 'Financial reports and audit trail.',
    icon: FileCheck2,
    accentClasses: 'bg-slate-100 text-slate-700 group-hover:bg-slate-800 group-hover:text-white',
  },
];

// Decorative illustrative metrics for the branding visual (not live database figures)
const ILLUSTRATIVE_METRICS = [
  {
    label: 'Production Efficiency',
    value: '94%',
    positionClass: 'lg:-top-4 lg:left-3 ff-float-1',
  },
  {
    label: 'Inventory Accuracy',
    value: '98%',
    positionClass: 'lg:-top-4 lg:right-3 ff-float-2',
  },
  {
    label: 'Orders Processed',
    value: '1,240+',
    positionClass: 'lg:-bottom-4 lg:left-3 ff-float-3',
  },
  {
    label: 'Audit Ready',
    value: '100%',
    positionClass: 'lg:-bottom-4 lg:right-3 ff-float-4',
  },
];

const GoogleLogo: React.FC = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
    />
  </svg>
);

export const LoginScreen: React.FC = () => {
  const { loginWithCredentials, loginWithGoogle, loading } = useAuth();
  const [email, setEmail] = useState('owner@factoryflow.in');
  const [password, setPassword] = useState(DEMO_SHARED_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showForgotHelp, setShowForgotHelp] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [activeQuickRole, setActiveQuickRole] = useState<string | null>(null);
  const [mobileDemoExpanded, setMobileDemoExpanded] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem(REMEMBER_EMAIL_KEY);
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    } catch {
      // Ignore storage access restrictions
    }
  }, []);

  const persistRememberedEmail = (nextEmail: string, shouldRemember: boolean) => {
    try {
      if (shouldRemember && nextEmail.trim()) {
        localStorage.setItem(REMEMBER_EMAIL_KEY, nextEmail.trim());
      } else {
        localStorage.removeItem(REMEMBER_EMAIL_KEY);
      }
    } catch {
      // Ignore storage access restrictions
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setActiveQuickRole(null);
    if (!email.trim() || !password.trim()) {
      setError('Please enter both your work email and password.');
      return;
    }
    persistRememberedEmail(email, rememberMe);
    try {
      await loginWithCredentials(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please verify your credentials.');
    }
  };

  const handleQuickLogin = async (roleItem: DemoRoleCard) => {
    setError(null);
    setActiveQuickRole(roleItem.roleCode);
    setEmail(roleItem.email);
    setPassword(roleItem.password);
    persistRememberedEmail(roleItem.email, rememberMe);
    try {
      await loginWithCredentials(roleItem.email, roleItem.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setActiveQuickRole(null);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setActiveQuickRole(null);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.');
    }
  };

  const handleCopyDemoPassword = async () => {
    try {
      await navigator.clipboard.writeText(DEMO_SHARED_PASSWORD);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
    } catch {
      setCopiedPassword(false);
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden flex flex-col lg:flex-row bg-[#F8FAFC]">
      {/* LEFT PANEL — BRANDING & 3D FACTORY VISUAL STORYTELLING (48% desktop) */}
      <section className="relative lg:w-[48%] lg:min-h-screen bg-[#0B1120] text-white overflow-hidden flex flex-col justify-between px-6 py-7 sm:px-10 sm:py-9 lg:px-11 lg:py-10 xl:px-14 xl:py-12">
        {/* Subtle architectural grid & restrained ambient radial lighting */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(148,163,184,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.35) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 -left-24 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -right-24 w-96 h-96 rounded-full bg-blue-600/15 blur-3xl"
        />

        {/* Top Brand Mark */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-950/50 ring-1 ring-white/15 shrink-0">
            <Factory className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <span className="text-lg sm:text-xl font-bold tracking-tight text-white whitespace-nowrap">
            FactoryFlow ERP
          </span>
        </div>

        {/* Middle Headline + 3D Factory Illustration Stage */}
        <div className="relative z-10 my-7 lg:my-6 flex flex-col justify-center">
          <h1 className="text-2xl sm:text-3xl xl:text-[2.35rem] font-bold tracking-tight text-white leading-[1.15] max-w-xl">
            From Factory Floor to Financial Clarity.
          </h1>
          <p className="mt-3 text-sm sm:text-[15px] text-slate-300 leading-relaxed max-w-lg">
            One intelligent platform connecting sales, production, inventory and financial operations.
          </p>

          {/* 3D Isometric Factory Illustration with Subtle Floating Metric Cards */}
          <div className="relative mt-6 lg:mt-8">
            <div className="relative rounded-2xl bg-[#0A1328] border border-slate-800/80 shadow-2xl shadow-slate-950/70 overflow-hidden">
              <div className="aspect-[16/9] w-full flex items-center justify-center bg-[#0A1328]">
                {!imageError ? (
                  <img
                    src="/assets/factoryflow-3d-factory.jpg"
                    alt="3D isometric illustration of a South Indian packaged food manufacturing facility with automated conveyors, raw material silos, packaging line, warehouse, and dispatch bay"
                    referrerPolicy="no-referrer"
                    onError={() => setImageError(true)}
                    className="w-full h-full object-contain select-none"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                    <Factory className="w-10 h-10 text-indigo-400 mb-2" aria-hidden="true" />
                    <span className="text-xs font-medium text-slate-300">
                      FactoryFlow Manufacturing Operations
                    </span>
                  </div>
                )}
              </div>
              {/* Soft edge vignette so artwork blends seamlessly into midnight navy */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10"
              />
            </div>

            {/* Desktop Floating Metric Cards (Decorative Demonstration Values) */}
            <div className="hidden lg:block" aria-label="Platform highlights">
              {ILLUSTRATIVE_METRICS.map((metric) => (
                <div
                  key={metric.label}
                  className={`absolute ${metric.positionClass} z-20 px-3.5 py-2 rounded-xl bg-slate-900/85 backdrop-blur-md border border-slate-700/70 shadow-xl shadow-slate-950/60`}
                >
                  <div className="text-[11px] font-medium text-slate-300 whitespace-nowrap leading-tight">
                    {metric.label}
                  </div>
                  <div className="mt-0.5 text-sm font-bold font-mono tabular-nums text-white leading-tight">
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Mobile / Tablet Compact 2x2 Metric Grid */}
            <div className="grid grid-cols-2 gap-2.5 mt-3.5 lg:hidden">
              {ILLUSTRATIVE_METRICS.map((metric) => (
                <div
                  key={metric.label}
                  className="px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800/90"
                >
                  <div className="text-[11px] font-medium text-slate-400 leading-tight truncate">
                    {metric.label}
                  </div>
                  <div className="mt-0.5 text-sm font-bold font-mono tabular-nums text-white">
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Brand Footer */}
        <div className="relative z-10 pt-5 border-t border-slate-800/80 text-xs text-slate-400 flex items-center justify-between gap-4">
          <span className="truncate">FactoryFlow ERP | Intelligent Manufacturing Management</span>
        </div>
      </section>

      {/* RIGHT PANEL — AUTHENTICATION & DEMO WORKSPACE (52% desktop) */}
      <section className="relative flex-1 lg:w-[52%] flex items-center justify-center px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-6 xl:px-14 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40">
        <div className="w-full max-w-[540px] space-y-4 ff-card-enter">
          {/* Primary Authentication Card */}
          <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm shadow-slate-200/60 p-5 sm:p-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
              <p className="mt-1 text-sm text-slate-500">
                Sign in to continue to your FactoryFlow workspace.
              </p>
            </div>

            {error && (
              <div className="mt-4">
                <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Work email
                </label>
                <div className="relative">
                  <Mail
                    className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@factoryflow.in"
                    required
                    className="w-full h-10 sm:h-11 pl-10 pr-3.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl placeholder:text-slate-400 transition-colors focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="w-full h-10 sm:h-11 pl-10 pr-11 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl placeholder:text-slate-400 transition-colors focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-700 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember Me + Forgot Password */}
              <div className="flex items-center justify-between gap-3 text-xs">
                <label className="inline-flex items-center gap-2 text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => {
                      setRememberMe(e.target.checked);
                      persistRememberedEmail(email, e.target.checked);
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Remember me</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgotHelp((prev) => !prev)}
                  className="font-medium text-indigo-600 hover:text-indigo-700 transition-colors whitespace-nowrap focus:outline-none focus-visible:underline"
                >
                  Forgot password?
                </button>
              </div>

              {showForgotHelp && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="leading-relaxed">
                    For security, ERP password resets are managed by your FactoryFlow{' '}
                    <span className="font-semibold text-slate-800">Owner</span> or{' '}
                    <span className="font-semibold text-slate-800">Admin</span> under User Management.
                    Demo workspaces use <span className="font-mono font-semibold text-slate-800">{DEMO_SHARED_PASSWORD}</span>.
                  </p>
                </div>
              )}

              {/* Primary Gradient Sign-In Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-10 sm:h-11 inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-60 rounded-xl shadow-sm shadow-indigo-600/25 transition-all duration-150 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                {loading && !activeQuickRole ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </>
                )}
              </button>

              {/* Divider */}
              <div className="relative py-0.5">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-3 text-slate-400 font-medium">or continue with</span>
                </div>
              </div>

              {/* Google Sign-In Button */}
              <button
                type="button"
                onClick={handleGoogle}
                disabled={loading}
                className="w-full h-10 sm:h-11 inline-flex items-center justify-center gap-2.5 px-4 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:border-slate-400 disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                <GoogleLogo />
                <span>Sign in with Google</span>
              </button>

              <p className="text-[11px] text-slate-500 leading-relaxed text-center">
                New Google accounts register in <strong className="text-slate-700">Pending Approval</strong> status until an Owner or Admin assigns a role.
              </p>
            </form>
          </div>

          {/* Compact "Explore Demo Workspace" Role Selector */}
          <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm shadow-slate-200/50 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <button
                type="button"
                onClick={() => setMobileDemoExpanded((v) => !v)}
                className="inline-flex items-center gap-2 text-left lg:cursor-default"
                aria-expanded={mobileDemoExpanded}
              >
                <h3 className="text-sm font-semibold text-slate-900">Explore Demo Workspace</h3>
                <span className="lg:hidden text-slate-400">
                  {mobileDemoExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </button>

              <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <span>Demo password:</span>
                <span className="font-mono font-medium text-slate-700">{DEMO_SHARED_PASSWORD}</span>
                <button
                  type="button"
                  onClick={handleCopyDemoPassword}
                  aria-label="Copy demo password"
                  title="Copy demo password"
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-md transition-colors whitespace-nowrap"
                >
                  {copiedPassword ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      <span className="text-emerald-700">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className={`${mobileDemoExpanded ? 'grid' : 'hidden lg:grid'} grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3`}>
              {DEMO_ROLES.map((item, idx) => {
                const Icon = item.icon;
                const isBusy = loading && activeQuickRole === item.roleCode;
                const isWideCard = idx === DEMO_ROLES.length - 1;

                return (
                  <button
                    key={item.roleCode}
                    type="button"
                    disabled={loading}
                    onClick={() => handleQuickLogin(item)}
                    className={`group text-left px-3 py-2.5 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-white hover:border-indigo-300 hover:shadow-sm transition-all duration-150 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isWideCard ? 'sm:col-span-2' : ''
                    }`}
                  >
                    <div className={`flex ${isWideCard ? 'items-center justify-between gap-3' : 'items-start gap-2.5'}`}>
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-150 ${item.accentClasses}`}
                        >
                          {isBusy ? (
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Icon className="w-4 h-4" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-900 leading-tight">
                            {item.role}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500 leading-snug">
                            {item.description}
                          </p>
                          {!isWideCard && (
                            <div className="mt-1.5 text-[11px] font-medium text-indigo-600 group-hover:text-indigo-700 inline-flex items-center gap-1 whitespace-nowrap">
                              <span>{isBusy ? 'Entering...' : item.shortAction}</span>
                              <ArrowRight
                                className="w-3 h-3 transition-transform duration-150 group-hover:translate-x-0.5"
                                aria-hidden="true"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {isWideCard && (
                        <div className="text-[11px] font-medium text-indigo-600 group-hover:text-indigo-700 inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                          <span>{isBusy ? 'Entering...' : item.shortAction}</span>
                          <ArrowRight
                            className="w-3 h-3 transition-transform duration-150 group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
