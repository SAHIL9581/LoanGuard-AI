import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CheckCircle, XCircle, Clock, Shield, ShieldCheck,
  ShieldAlert, Brain, ArrowLeft, LayoutDashboard, Clock3, ChevronRight,
  X, Moon, Sun, BadgeCheck, PlayCircle, FileWarning,
  Lightbulb, ListChecks, AlertCircle, LogOut, DollarSign, Calendar,
  TrendingDown, Scale, CreditCard, Building2, Users, FileText, Zap, Lock,
  Globe, ChevronDown, Loader2,
} from 'lucide-react';



import { Link, useNavigate } from 'react-router-dom';
import { Navbar } from '../../components/Navbar';
import { Sidebar } from '../../components/Sidebar';
import { UploadSection } from '../../components/UploadSection';
import { AnalysisStages } from '../../components/AnalysisStages';
import { LoanSummaryCard } from '../../components/LoanSummaryCard';
import { EMIGraph } from '../../components/EMIGraph';
import { RiskMeter } from '../../components/RiskMeter';
import { ViolationList } from '../../components/ViolationList';
import { EscalationDownload } from '../../components/EscalationDownload';
import { ReportDownloader } from '../../components/ReportDownloader';
import { auditAPI, AuditAPIError, AuditResponse, translateAuditResponse, LangCode } from '../../services/api';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { authService } from '../../services/authService';
import { LoanGuardChat } from '../../components/Finshieldchat';
import { useTranslation } from 'react-i18next';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';

interface Props {
  darkMode: boolean;
  toggleDark: () => void;
}

// ── Report Data Mapper ────────────────────────────────────────────────────────

const mapAuditResponseToLoanData = (result: AuditResponse) => {
  const flags: string[] = [];
  if (result.behavioral_alert?.threat_language_detected)
    flags.push('Threat Language Detected');
  if (result.behavioral_alert?.aggressive_tone_detected)
    flags.push('Aggressive Tone Detected');
  if (result.behavioral_alert?.consent_misuse_detected)
    flags.push('Consent Misuse Detected');
  if (result.behavioral_alert?.data_abuse_clause_detected)
    flags.push('Data Abuse Clause Detected');
  if (result.extraction?.auto_debit_consent)
    flags.push('Auto-Debit Mandate Present');
  if (!result.extraction?.kfs_present)
    flags.push('Key Facts Statement (KFS) Missing');
  if (result.extraction?.prepayment_penalty_percent > 0 && result.extraction?.floating_rate)
    flags.push('Illegal Prepayment Penalty on Floating Rate Loan');
  if (result.extraction?.insurance_premium > 0)
    flags.push('Insurance Premium Bundled — Verify Consent');

  const deterministicCount =
    result.violations?.filter((v) => v.is_deterministic).length ?? 0;
  const criticalCount =
    result.violations?.filter((v) => v.severity === 'CRITICAL').length ?? 0;
  const highCount =
    result.violations?.filter((v) => v.severity === 'HIGH').length ?? 0;

  return {
    bankName: result.extraction?.lender_name,
    borrowerName: result.extraction?.borrower_name,
    agreementDate: result.extraction?.agreement_date,
    principal: result.extraction?.principal,
    interestRate: result.extraction?.interest_rate,
    effectiveAPR: result.extraction?.apr,
    tenureMonths: result.extraction?.tenure_months,
    expectedEMI: result.emi_analysis?.expected_emi,
    statedEMI: result.emi_analysis?.stated_emi,
    processingFee: result.extraction?.processing_fee,
    overchargeEstimate: result.emi_analysis?.overcharge_estimate,
    riskScore: result.risk_score?.total_score,
    riskCategory: result.risk_score?.risk_category,
    appealSuccessProbability: result.risk_score?.appeal_success_probability,
    systemConfidencePct: result.confidence_overall,
    violationCount: result.violations?.length ?? 0,
    criticalCount,
    highCount,
    deterministicCount,
    kfsPresent: result.extraction?.kfs_present,
    insurancePremium: result.extraction?.insurance_premium,
    prepaymentPenaltyPct: result.extraction?.prepayment_penalty_percent,
    metrics: {
      emiDeviation: { value: result.risk_score?.emi_deviation_score ?? 0, max: 25 },
      hiddenFees: { value: result.risk_score?.hidden_fee_score ?? 0, max: 20 },
      rbiViolations: { value: result.risk_score?.rbi_violation_score ?? 0, max: 25 },
      penalStacking: { value: result.risk_score?.penal_stacking_score ?? 0, max: 10 },
      transparency: { value: result.risk_score?.transparency_score ?? 0, max: 10 },
      ambiguity: { value: result.risk_score?.ambiguity_score ?? 0, max: 10 },
      behavioral: { value: result.risk_score?.behavioral_score ?? 0, max: 10 },
    },
    flags,
    emiDeviationPct: result.emi_analysis?.emi_deviation_percent ?? 0,
    compliancySummary: result.compliance_summary,
    lowConfidenceWarning: result.low_confidence_warning ?? null,
  };
};

// ── Stage Config ──────────────────────────────────────────────────────────────

const STAGE_TIMINGS_MS = [900, 600, 1100, 700, 1000, 600, 500];

// ── Plain field safe-readers (backward-compatible) ────────────────────────────

function getPlain<T>(obj: unknown, key: string, fallback: T): T {
  if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
    return (obj as Record<string, unknown>)[key] as T;
  }
  return fallback;
}

// ── Key Actions Checklist ─────────────────────────────────────────────────────

interface KeyAction {
  action: string;
  urgency: 'IMMEDIATE' | 'SOON' | 'OPTIONAL';
  why: string;
}

const urgencyConfig: Record<
  KeyAction['urgency'],
  { color: string; label: string; dot: string }
> = {
  IMMEDIATE: {
    color:
      'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    label: 'Do this now',
    dot: 'bg-red-500',
  },
  SOON: {
    color:
      'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    label: 'Do this soon',
    dot: 'bg-yellow-400',
  },
  OPTIONAL: {
    color:
      'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    label: 'Worth doing',
    dot: 'bg-blue-400',
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export const LoanGuard: React.FC<Props> = ({ darkMode, toggleDark }) => {
  const { t, i18n } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [displayName, setDisplayName] = useState('there');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const navigate = useNavigate();

  const [translatedResult, setTranslatedResult] = useState<AuditResponse | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  const [runTour, setRunTour] = useState(false);
  const tourSteps = React.useMemo<Step[]>(
    () => [
      {
        target: 'body',
        placement: 'center',
        content: (
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">
              {t('loanguard_tour.step1.title')}
            </h2>
            <p className="text-gray-600">{t('loanguard_tour.step1.content')}</p>
          </div>
        ),
        disableBeacon: true,
      },
      {
        target: '#upload-section',
        content: (
          <div>
            <h3 className="font-bold mb-1">
              {t('loanguard_tour.step2.title')}
            </h3>
            <p className="text-sm">{t('loanguard_tour.step2.content')}</p>
          </div>
        ),
      },
      {
        target: '#analysis-stages-preview',
        content: (
          <div>
            <h3 className="font-bold mb-1">
              {t('loanguard_tour.step3.title')}
            </h3>
            <p className="text-sm">{t('loanguard_tour.step3.content')}</p>
          </div>
        ),
      },
    ],
    [t]
  );

  React.useEffect(() => {
    const hasSeenTour = localStorage.getItem('hasSeenLoanGuardTour');
    if (!hasSeenTour) setRunTour(true);
  }, []);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status as any)) {
      setRunTour(false);
      localStorage.setItem('hasSeenLoanGuardTour', 'true');
    }
  };

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  React.useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      const fallbackRaw =
        localStorage.getItem('userName') ||
        localStorage.getItem('displayName') ||
        localStorage.getItem('email') ||
        localStorage.getItem('userEmail') ||
        '';
      const fallback = fallbackRaw.includes('@')
        ? fallbackRaw.split('@')[0]
        : fallbackRaw;
      setDisplayName(
        user?.displayName ||
        (user?.email ? user.email.split('@')[0] : '') ||
        fallback ||
        'there'
      );
    });
    return () => unsub();
  }, []);

  const hour = now.getHours();
  const getGreetingKey = () => {
    if (hour < 12) return 'greeting.morning';
    if (hour < 18) return 'greeting.afternoon';
    return 'greeting.evening';
  };
  const displayTime = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const languages = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिंदी' },
    { code: 'te', label: 'తె�ుగు' },
    { code: 'ta', label: 'தமிழ்' },
    { code: 'ml', label: 'മലയാളം' },
  ];
  const currentLang =
    languages.find((l) => l.code === i18n.language) || languages[0];

  // ── Audit Pipeline ────────────────────────────────────────────────────────

  const simulateStages = async (fn: () => Promise<AuditResponse>) => {
    setIsLoading(true);
    setResult(null);
    setError(null);
    setUploadProgress(0);
    setCurrentStage(1);
    let stageIndex = 1;
    const advanceStages = setInterval(() => {
      stageIndex++;
      setCurrentStage(stageIndex);
      if (stageIndex >= STAGE_TIMINGS_MS.length) clearInterval(advanceStages);
    }, STAGE_TIMINGS_MS[stageIndex - 1] ?? 800);
    try {
      const data = await fn();
      clearInterval(advanceStages);
      setCurrentStage(STAGE_TIMINGS_MS.length + 1);
      await new Promise((r) => setTimeout(r, 400));
      setResult(data);
    } catch (err: unknown) {
      clearInterval(advanceStages);
      if (err instanceof AuditAPIError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Analysis failed. Please try again.');
    } finally {
      setIsLoading(false);
      setCurrentStage(0);
      setUploadProgress(0);
    }
  };

  const handleFileUpload = useCallback(
    (file: File) =>
      simulateStages(() =>
        auditAPI.uploadPDF(file, (pct) => setUploadProgress(pct))
      ),
    []
  );
  const handleTextSubmit = useCallback(
    (text: string) => simulateStages(() => auditAPI.auditText(text)),
    []
  );
  const handleReset = () => {
    setResult(null);
    setTranslatedResult(null);
    setError(null);
    setCurrentStage(0);
    setUploadProgress(0);
  };

  const handleLogout = async () => {
    try {
      await authService.logout();
      localStorage.removeItem('authToken');
      navigate('/');
    } catch (e) {
      console.error('Logout failed:', e);
    }
  };

  // ── Auto-translate when global language changes ──────────────────────────────
  React.useEffect(() => {
    const translateIfNeeded = async () => {
      if (!result || i18n.language === 'en') {
        setTranslatedResult(null);
        return;
      }
      setIsTranslating(true);
      try {
        const translated = await translateAuditResponse(result, i18n.language as LangCode);
        setTranslatedResult(translated);
      } catch (err) {
        console.error('Translation failed, falling back to English:', err);
        setTranslatedResult(null);
      } finally {
        setIsTranslating(false);
      }
    };
    translateIfNeeded();
  }, [i18n.language, result]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-300 lg:h-screen lg:overflow-hidden">
      <Joyride
        steps={tourSteps}
        run={runTour}
        continuous
        showProgress
        showSkipButton
        callback={handleJoyrideCallback}
        styles={{
          options: { primaryColor: '#0ea5e9', zIndex: 1000 },
          tooltip: { borderRadius: '16px', padding: '24px' },
        }}
      />
      <Navbar
        darkMode={darkMode}
        toggleDark={toggleDark}
        showReset={!!result}
        onReset={handleReset}
        onMobileHamburgerClick={() => setMobileSidebarOpen(true)}
        useMobileActionsMenu={false}
        languages={languages}
        currentLang={currentLang}
        onLangChange={(code) => i18n.changeLanguage(code)}
        onLogout={handleLogout}
      />

      {/* Mobile Sidebar Drawer */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <motion.div
            className="fixed inset-0 z-[60] lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 top-16 bg-black/40"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="absolute left-0 top-16 h-[calc(100vh-4rem)] w-[85%] max-w-xs bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col"
            >
              <div className="p-4 flex flex-col h-full overflow-hidden">
                <Sidebar
                  displayTime={displayTime}
                  onReplayTour={() => setRunTour(true)}
                  isCurrentPage="loanguard"
                  onMobileClose={() => setMobileSidebarOpen(false)}
                  isMobile={true}
                />
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Layout */}
      <main className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:h-[calc(100vh-4rem)] lg:py-6 lg:overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:h-full">

          {/* Desktop Sidebar */}
          <aside className="hidden lg:block lg:col-span-3 lg:sticky lg:top-0 lg:h-full">
            <Sidebar
              displayTime={displayTime}
              onReplayTour={() => setRunTour(true)}
              isCurrentPage="loanguard"
            />
          </aside>

          {/* Main Content */}
          <section className="lg:col-span-9 flex flex-col lg:h-full lg:overflow-hidden">

            {/* Hero — idle state */}
            <AnimatePresence mode="wait">
              {!result && !isLoading && (
                <motion.div
                  key="hero"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="text-center mb-6"
                >
                  <h1 className="font-sans text-3xl sm:text-3xl lg:text-4xl font-black leading-[1.08] tracking-tight text-gray-900 dark:text-white mb-3">
                    {t('dashboard.loanguard.title', 'LoanGuard')}
                  </h1>
                  <p className="text-base text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
                    {t(
                      'dashboard.loanguard.desc',
                      'Upload any Indian bank or NBFC loan agreement to detect hidden charges, validate EMI calculations, identify RBI regulatory violations, and generate ready-to-send escalation letters.'
                    )}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Upload / Loading */}
            {!result && (
              <div className="space-y-4">
                <div id="upload-section">
                  <UploadSection
                    onFileUpload={handleFileUpload}
                    onTextSubmit={handleTextSubmit}
                    isLoading={isLoading}
                    uploadProgress={uploadProgress}
                  />
                </div>
                <div id="analysis-stages-preview">
                  <AnimatePresence>
                    {isLoading && (
                      <AnalysisStages
                        currentStage={currentStage}
                        isVisible={isLoading}
                        totalStages={STAGE_TIMINGS_MS.length}
                      />
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* Error State */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="max-w-2xl mx-auto mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl flex items-start gap-3"
                >
                  <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                      {t('loanguard_tour.error', 'Analysis Failed')}
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
                      {error}
                    </p>
                    <button
                      onClick={handleReset}
                      className="mt-2 text-xs text-red-600 dark:text-red-400 underline hover:no-underline"
                    >
                      {t('loanguard_tour.try_again', 'Try again')}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ══════════════════════════════════════════════════════════════ */}
            {/* Results Panel                                                 */}
            {/* ══════════════════════════════════════════════════════════════ */}
            <AnimatePresence>
              {result && (() => {
                // Active result: prefer translated copy, fall back to original
                const activeResult = translatedResult ?? result;

                // Read all plain-English fields from activeResult
                const riskSummaryPlain = getPlain<string>(activeResult.risk_score, 'risk_summary_plain', '');
                const riskCategoryPlain = getPlain<string>(activeResult.risk_score, 'risk_category_plain', '');
                const appealPlain = getPlain<string>(activeResult.risk_score, 'appeal_plain', '');
                const keyActions = getPlain<KeyAction[]>(activeResult.risk_score, 'key_actions', []);
                const docCompletenessPlain = getPlain<string>(activeResult, 'document_completeness_plain', '');
                const lowConfidenceWarn = getPlain<string | null>(activeResult, 'low_confidence_warning', null);
                const emiPlainSummary = getPlain<string>(activeResult.emi_analysis, 'emi_plain_summary', '');
                const overchargePlain = getPlain<string>(activeResult.emi_analysis, 'overcharge_plain', '');

                // Verdict headline fallback (identical to what was there before)
                const verdictHeadline =
                  result.risk_score.risk_category === 'LOW'
                    ? t('loanguard.verdict.safe', '✓ Your loan appears safe')
                    : result.risk_score.risk_category === 'CRITICAL'
                      ? t('loanguard.verdict.critical', '⚠ This loan is very dangerous')
                      : result.risk_score.risk_category === 'HIGH'
                        ? t('loanguard.verdict.high', '⚠ Serious problems found')
                        : t('loanguard.verdict.medium', '⚡ Some concerns found');

                // The main plain summary
                const mainSummaryText = riskSummaryPlain || activeResult.compliance_summary;
                const normalizedScore = Math.round(
                  Math.min(Math.max(result.risk_score.total_score, 0), 100)
                );

                return (
                  <motion.div
                    key="results"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                    className="flex flex-col flex-1 min-h-0 overflow-hidden"
                  >
                    {/* Translation loading banner */}
                    {isTranslating && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-center gap-2 mb-3 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl text-sm text-indigo-700 dark:text-indigo-300"
                      >
                        <svg className="animate-spin w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        Translating to {i18n.language === 'hi' ? 'हिंदी' : i18n.language === 'te' ? 'తెలుగు' : i18n.language === 'ta' ? 'தமிழ்' : i18n.language === 'ml' ? 'മലയാളം' : 'English'}…
                      </motion.div>
                    )}

                    {/* Sticky Header row */}
                    <div className="flex items-center justify-between gap-3 mb-3 flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <Link to="/dashboard">
                          <motion.div
                            whileHover={{ x: -2 }}
                            className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-brand-500 dark:hover:text-brand-400 transition-colors"
                          >
                            <ArrowLeft className="w-4 h-4" />
                            {t('loanguard_tour.back', 'Back to Dashboard')}
                          </motion.div>
                        </Link>
                        {/* <div className="text-xs text-gray-400 dark:text-gray-500 px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">
                          {currentLang.label}
                        </div> */}
                      </div>
                      {/* <ReportDownloader data={mapAuditResponseToLoanData(translatedResult ?? result)} /> */}
                    </div>

                    {/* Scrollable Results Body */}
                    <div className="flex-1 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pb-8 space-y-5">

                      {/* ══ SECTION 0: Low-confidence warning (if present) ══ */}
                      {/* Must be first — warns user before they read any results */}
                      {lowConfidenceWarn && (
                        <motion.div
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-start gap-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-xl px-4 py-3"
                        >
                          <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-yellow-700 dark:text-yellow-400 mb-0.5 uppercase tracking-wide">
                              Accuracy Notice
                            </p>
                            <p className="text-sm text-yellow-800 dark:text-yellow-200 leading-relaxed">
                              {lowConfidenceWarn}
                            </p>
                          </div>
                        </motion.div>
                      )}

                      {/* ══ SECTION 1: Big Verdict Card ══ */}
                      <motion.div
                        id="compliance-summary"
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`rounded-2xl p-6 border-2 ${result.risk_score.risk_category === 'LOW'
                          ? 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/10 border-green-300 dark:border-green-700'
                          : result.risk_score.risk_category === 'CRITICAL'
                            ? 'bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/10 border-red-300 dark:border-red-700'
                            : result.risk_score.risk_category === 'HIGH'
                              ? 'bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/10 border-orange-300 dark:border-orange-700'
                              : 'bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-900/20 dark:to-amber-900/10 border-yellow-300 dark:border-yellow-700'
                          }`}
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex items-start gap-4 flex-1 min-w-0">
                            {/* Big icon */}
                            <div className="text-4xl flex-shrink-0 mt-1">
                              {result.risk_score.risk_category === 'LOW'
                                ? <CheckCircle className="w-12 h-12 text-green-600" />
                                : result.risk_score.risk_category === 'CRITICAL'
                                  ? <AlertTriangle className="w-12 h-12 text-red-600" />
                                  : result.risk_score.risk_category === 'HIGH'
                                    ? <AlertCircle className="w-12 h-12 text-orange-600" />
                                    : <AlertCircle className="w-12 h-12 text-yellow-600" />}
                            </div>

                            <div className="flex-1 min-w-0">
                              {/* Verdict headline */}
                              <p
                                className={`text-xl font-black mb-1 ${result.risk_score.risk_category === 'LOW'
                                  ? 'text-green-700 dark:text-green-400'
                                  : result.risk_score.risk_category === 'CRITICAL'
                                    ? 'text-red-700 dark:text-red-400'
                                    : result.risk_score.risk_category === 'HIGH'
                                      ? 'text-orange-700 dark:text-orange-400'
                                      : 'text-yellow-700 dark:text-yellow-400'
                                  }`}
                              >
                                {riskCategoryPlain || verdictHeadline}
                              </p>

                              <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
                                {mainSummaryText}
                              </p>

                              <div className="flex flex-wrap items-center gap-3 mt-3">
                                <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {t('loanguard.verdict.analyzed', 'Analyzed in')}{' '}
                                  {result.processing_time_ms.toFixed(0)}ms
                                </span>
                                <span
                                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${result.confidence_overall >= 0.85
                                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                                    : result.confidence_overall >= 0.65
                                      ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400'
                                      : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                                    }`}
                                >
                                  {t('loanguard.verdict.ai_confidence', 'AI Confidence')}:{' '}
                                  {(result.confidence_overall * 100).toFixed(0)}%
                                </span>
                                {result.document_completeness > 0 && (
                                  <span
                                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${result.document_completeness >= 0.8
                                      ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                                      : result.document_completeness >= 0.5
                                        ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400'
                                        : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                                      }`}
                                    title={docCompletenessPlain || undefined}
                                  >
                                    {result.document_completeness >= 0.8
                                      ? '📄 Complete document'
                                      : result.document_completeness >= 0.5
                                        ? '📄 Partial document'
                                        : '📄 Incomplete document'}
                                  </span>
                                )}
                                <span
                                  className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${result.extraction.kfs_present
                                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                                    : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                                    }`}
                                >
                                  {result.extraction.kfs_present ? (
                                    <>
                                      <BadgeCheck className="w-3 h-3" />
                                      {t('loanguard.verdict.kfs_ok', 'Key Document Present')}
                                    </>
                                  ) : (
                                    <>
                                      <AlertTriangle className="w-3 h-3" />
                                      {t('loanguard.verdict.kfs_missing', 'Key Document Missing')}
                                    </>
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="w-full sm:w-[170px] flex-shrink-0">
                            <div className="rounded-xl border border-white/60 dark:border-gray-700/70 bg-white/80 dark:bg-gray-900/40 p-3">
                              <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">
                                Risk Score
                              </p>
                              <div className="mt-1 flex items-end gap-1.5">
                                <span
                                  className={`text-3xl leading-none font-black ${result.risk_score.risk_category === 'LOW'
                                    ? 'text-green-700 dark:text-green-400'
                                    : result.risk_score.risk_category === 'CRITICAL'
                                      ? 'text-red-700 dark:text-red-400'
                                      : result.risk_score.risk_category === 'HIGH'
                                        ? 'text-orange-700 dark:text-orange-400'
                                        : 'text-yellow-700 dark:text-yellow-400'
                                    }`}
                                >
                                  {normalizedScore}
                                </span>
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">/100</span>
                              </div>
                              <div className="mt-3 h-2 rounded-full bg-gray-200/90 dark:bg-gray-700/90 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${result.risk_score.risk_category === 'LOW'
                                    ? 'bg-green-500'
                                    : result.risk_score.risk_category === 'CRITICAL'
                                      ? 'bg-red-500'
                                      : result.risk_score.risk_category === 'HIGH'
                                        ? 'bg-orange-500'
                                        : 'bg-yellow-500'
                                    }`}
                                  style={{ width: `${normalizedScore}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* NEW: appeal_plain — shown right inside the verdict card */}
                        {appealPlain && (
                          <div className="mt-4 pt-4 border-t border-white/40 dark:border-gray-700/40">
                            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                              <span className="font-semibold flex items-center gap-1"><Scale className="w-3 h-3" />Your appeal chances: </span>
                              {appealPlain}
                            </p>
                          </div>
                        )}
                      </motion.div>

                      {/* ══ SECTION 1b: Key Actions (NEW — the most valuable section) ══ */}
                      {keyActions.length > 0 && (
                        <motion.div
                          id="key-actions"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 }}
                          className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
                        >
                          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                            <ListChecks className="w-4 h-4 text-brand-500" />
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                              What should you do now?
                            </h3>
                            <span className="text-xs text-gray-400 ml-1">
                              — personalised action plan
                            </span>
                          </div>
                          <div className="p-4 space-y-2.5">
                            {keyActions.map((action, i) => {
                              const cfg = urgencyConfig[action.urgency] ?? urgencyConfig.OPTIONAL;
                              return (
                                <motion.div
                                  key={i}
                                  initial={{ opacity: 0, x: -8 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: 0.05 * i }}
                                  className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${cfg.color}`}
                                >
                                  <div className="flex-shrink-0 mt-1.5">
                                    <span
                                      className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`}
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">
                                        {action.action}
                                      </p>
                                      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                        {cfg.label}
                                      </span>
                                    </div>
                                    {action.why && (
                                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                        {action.why}
                                      </p>
                                    )}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}

                      {/* ══ SECTION 2: Four Quick Numbers ══ */}
                      <div
                        id="loan-details"
                        className="grid grid-cols-2 lg:grid-cols-4 gap-3"
                      >
                        {[
                          {
                            icon: <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
                            label: t('loanguard.quicknum.loan_amount', 'Loan Amount'),
                            value:
                              result.extraction.principal > 0
                                ? `₹${(result.extraction.principal / 100000).toFixed(1)}L`
                                : '—',
                            sub: t(
                              'loanguard.quicknum.loan_amount_desc',
                              'The money you borrowed'
                            ),
                            color:
                              'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
                            textColor: 'text-blue-700 dark:text-blue-300',
                          },
                          {
                            icon: <Calendar className="w-5 h-5 text-orange-600 dark:text-orange-400" />,
                            label: t(
                              'loanguard.quicknum.monthly_payment',
                              'Your Monthly Payment'
                            ),
                            value:
                              result.emi_analysis.stated_emi > 0
                                ? `₹${result.emi_analysis.stated_emi.toLocaleString('en-IN')}`
                                : '—',
                            // NEW: prefer emi_plain_summary for the sub-line
                            sub:
                              emiPlainSummary ||
                              (result.emi_analysis.emi_flag
                                ? `${t('loanguard.quicknum.overpaying', 'You may be overpaying!')} (${result.emi_analysis.emi_deviation_percent.toFixed(1)}%)`
                                : t('loanguard.quicknum.emi_ok', 'Looks correct')),
                            color: result.emi_analysis.emi_flag
                              ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                              : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700',
                            textColor: result.emi_analysis.emi_flag
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-gray-800 dark:text-white',
                          },
                          {
                            icon: <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />,
                            label: t(
                              'loanguard.quicknum.hidden_overcharge',
                              'Hidden Overcharge'
                            ),
                            value:
                              result.emi_analysis.overcharge_estimate > 0
                                ? `₹${result.emi_analysis.overcharge_estimate.toLocaleString('en-IN')}`
                                : '₹0',
                            // NEW: prefer overcharge_plain for the sub-line
                            sub:
                              overchargePlain ||
                              (result.emi_analysis.overcharge_estimate > 0
                                ? t(
                                  'loanguard.quicknum.overcharge_warn',
                                  'Extra money charged to you'
                                )
                                : t(
                                  'loanguard.quicknum.no_overcharge',
                                  'No hidden overcharges found'
                                )),
                            color:
                              result.emi_analysis.overcharge_estimate > 0
                                ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                                : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
                            textColor:
                              result.emi_analysis.overcharge_estimate > 0
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-green-700 dark:text-green-400',
                          },
                          {
                            icon: <Scale className="w-5 h-5 text-purple-600 dark:text-purple-400" />,
                            label: t(
                              'loanguard.quicknum.appeal_chance',
                              'Appeal Success Chance'
                            ),
                            value: `${(result.risk_score.appeal_success_probability * 100).toFixed(0)}%`,
                            // NEW: prefer appeal_plain for the sub-line if short enough
                            sub:
                              appealPlain && appealPlain.length < 80
                                ? appealPlain
                                : t(
                                  'loanguard.quicknum.appeal_desc',
                                  'Chance of winning a complaint'
                                ),
                            color:
                              'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
                            textColor: 'text-purple-700 dark:text-purple-300',
                          },
                        ].map((card) => (
                          <motion.div
                            key={card.label}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`rounded-xl border p-4 ${card.color}`}
                          >
                            <div className="mb-2">{card.icon}</div>
                            <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold mb-0.5">
                              {card.label}
                            </p>
                            <p className={`text-xl font-black ${card.textColor}`}>
                              {card.value}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-tight">
                              {card.sub}
                            </p>
                          </motion.div>
                        ))}
                      </div>

                      {/* ══ SECTION 3: Behavioral Alert ══ */}
                      {(result.behavioral_alert.threat_language_detected ||
                        result.behavioral_alert.aggressive_tone_detected ||
                        result.behavioral_alert.consent_misuse_detected ||
                        result.behavioral_alert.data_abuse_clause_detected) && (
                          <motion.div
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="bg-purple-50 dark:bg-purple-900/20 border border-purple-300 dark:border-purple-700 rounded-2xl p-4"
                          >
                            <p className="text-sm font-bold text-purple-700 dark:text-purple-400 mb-1 flex items-center gap-2">
                              <Brain className="w-4 h-4" />
                              ⚠{' '}
                              {t(
                                'loanguard.behavioral.title',
                                'Warning: Aggressive Loan Agreement Language'
                              )}
                            </p>
                            <p className="text-sm text-purple-700 dark:text-purple-200 leading-relaxed">
                              {result.behavioral_alert.consumer_risk_alert}
                            </p>
                            {/* NEW: show individual behavioral flags in plain English */}
                            <div className="mt-2 flex flex-wrap gap-2">
                              {result.behavioral_alert.threat_language_detected && (
                                <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
                                  <Zap className="w-3 h-3" /> Threatening language
                                </span>
                              )}
                              {result.behavioral_alert.aggressive_tone_detected && (
                                <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
                                  <AlertTriangle className="w-3 h-3" /> Aggressive tone
                                </span>
                              )}
                              {result.behavioral_alert.consent_misuse_detected && (
                                <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
                                  <FileText className="w-3 h-3" /> Consent misuse
                                </span>
                              )}
                              {result.behavioral_alert.data_abuse_clause_detected && (
                                <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
                                  <Lock className="w-3 h-3" /> Data abuse clause
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-purple-500 dark:text-purple-400 mt-2 italic">
                              {t(
                                'loanguard.behavioral.tip',
                                '💡 Intimidating language or one-sided clauses put you at a disadvantage. Consider consulting a legal advisor.'
                              )}
                            </p>
                          </motion.div>
                        )}

                      {/* ══ SECTION 4: Safety Checklist ══ */}
                      <motion.div
                        id="safety-rules"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
                      >
                        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                          <Shield className="w-4 h-4 text-brand-500" />
                          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                            {t('loanguard.safety.title', '📋 Safety Checklist')}
                          </h3>
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                            {t(
                              'loanguard.safety.subtitle',
                              '— Did your bank follow the rules?'
                            )}
                          </span>
                        </div>
                        <div className="divide-y divide-gray-50 dark:divide-gray-800">
                          {[
                            {
                              id: 'kfs',
                              pass: result.extraction.kfs_present,
                              label: t('loanguard.safety.kfs', 'Key Facts Page (KFS)'),
                              passMsg: t(
                                'loanguard.safety.kfs_pass',
                                'Your loan has a required 1-page summary sheet ✓'
                              ),
                              failMsg: t(
                                'loanguard.safety.kfs_fail',
                                'Missing! Banks are legally required to give you a simple 1-page summary of your loan terms. This alone is a violation.'
                              ),
                            },
                            {
                              id: 'emi',
                              pass: !result.emi_analysis.emi_flag,
                              label: t(
                                'loanguard.safety.emi',
                                'Monthly Payment (EMI) is correct'
                              ),
                              passMsg: t(
                                'loanguard.safety.emi_pass',
                                'Your EMI matches the RBI formula ✓'
                              ),
                              failMsg:
                                emiPlainSummary ||
                                t(
                                  'loanguard.safety.emi_fail',
                                  `They are charging ₹${(
                                    result.emi_analysis.stated_emi -
                                    result.emi_analysis.expected_emi
                                  ).toLocaleString('en-IN')} more per month than the correct amount.`
                                ),
                            },
                            {
                              id: 'prepay',
                              pass: !(
                                result.extraction.prepayment_penalty_percent > 0 &&
                                result.extraction.floating_rate
                              ),
                              label: t(
                                'loanguard.safety.prepay',
                                'No Illegal Early Closure Charges'
                              ),
                              passMsg: t(
                                'loanguard.safety.prepay_pass',
                                'No illegal prepayment charges ✓'
                              ),
                              failMsg: t(
                                'loanguard.safety.prepay_fail',
                                'Charging for early closure on a floating-rate loan is prohibited by RBI. You are entitled to a refund.'
                              ),
                            },
                            {
                              id: 'apr',
                              pass: !result.emi_analysis.apr_mismatch,
                              label: t(
                                'loanguard.safety.apr',
                                'True Interest Rate (APR) is honest'
                              ),
                              passMsg: t(
                                'loanguard.safety.apr_pass',
                                'The stated interest rate accurately reflects total cost ✓'
                              ),
                              failMsg: t(
                                'loanguard.safety.apr_fail',
                                'The real cost of your loan is significantly higher than advertised — a sign of hidden charges.'
                              ),
                            },
                            {
                              id: 'insurance',
                              pass: result.extraction.insurance_premium === 0,
                              label: t('loanguard.safety.insurance', 'No Forced Insurance'),
                              passMsg: t(
                                'loanguard.safety.insurance_pass',
                                'No bundled insurance charges ✓'
                              ),
                              failMsg: t(
                                'loanguard.safety.insurance_fail',
                                `Insurance of ₹${result.extraction.insurance_premium?.toLocaleString(
                                  'en-IN'
                                )} was added. Did you explicitly agree to this?`
                              ),
                            },
                          ].map((check) => (
                            <div
                              key={check.id}
                              className={`flex items-start gap-3 px-5 py-3.5 ${check.pass ? '' : 'bg-red-50/40 dark:bg-red-900/10'
                                }`}
                            >
                              <div className="flex-shrink-0 mt-0.5">
                                {check.pass ? (
                                  <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                                  {check.label}
                                </p>
                                <p
                                  className={`text-xs mt-0.5 leading-relaxed ${check.pass
                                    ? 'text-gray-400 dark:text-gray-500'
                                    : 'text-red-600 dark:text-red-400'
                                    }`}
                                >
                                  {check.pass ? check.passMsg : check.failMsg}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>

                      {/* ══ SECTION 5: All Violations (Problems Found) - MOVED UP ══ */}
                      <ViolationList violations={(translatedResult ?? result).violations} />

                      {/* ══ SECTION 6: Red Flags ══ */}
                      {(() => {
                        const activeFlags = [
                          {
                            show: result.extraction.bank_discretion_clause,
                            icon: <Building2 className="w-4 h-4" />,
                            label: t(
                              'loanguard.flags.bank_discretion',
                              'Bank can change your interest rate without notice'
                            ),
                          },
                          {
                            show: result.extraction.auto_debit_consent,
                            icon: <CreditCard className="w-4 h-4" />,
                            label: t(
                              'loanguard.flags.auto_debit_expanded',
                              'Bank can automatically take money from your account'
                            ),
                          },
                          {
                            show: result.extraction.recovery_agent_clause,
                            icon: <Users className="w-4 h-4" />,
                            label: t(
                              'loanguard.flags.recovery_agent',
                              'Debt collectors are authorised in the agreement'
                            ),
                          },
                          {
                            show: result.extraction.insurance_premium > 0,
                            icon: <ShieldAlert className="w-4 h-4" />,
                            label: t(
                              'loanguard.flags.forced_insurance',
                              'Insurance was bundled into your loan without clear consent'
                            ),
                          },
                          {
                            show: result.behavioral_alert.threat_language_detected,
                            icon: <Zap className="w-4 h-4" />,
                            label: t(
                              'loanguard.flags.threatening',
                              'Agreement uses threatening or aggressive language'
                            ),
                          },
                          {
                            show: result.behavioral_alert.consent_misuse_detected,
                            icon: <FileText className="w-4 h-4" />,
                            label: t(
                              'loanguard.flags.consent_misuse',
                              'Consent misuse clauses detected'
                            ),
                          },
                        ].filter((f) => f.show);

                        if (activeFlags.length === 0) return null;

                        return (
                          <motion.div
                            id="red-flags-list"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
                          >
                            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-orange-500" />
                              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                {t(
                                  'loanguard.flags.title',
                                  'Red Flags in Your Agreement'
                                )}
                              </h3>
                            </div>
                            <div className="p-5 flex flex-col gap-2.5">
                              {activeFlags.map((f) => (
                                <div
                                  key={f.label}
                                  className="flex items-start gap-2.5 bg-red-50 dark:bg-red-900/15 rounded-xl px-3.5 py-2.5"
                                >
                                  <span className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5 ">
                                    {f.icon}
                                  </span>
                                  <p className="text-sm text-red-700 dark:text-red-300 leading-relaxed">
                                    {f.label}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        );
                      })()}



                      {/* ══ SECTION 7: Expert View (collapsed) ══ */}
                      <details className="group bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                        <summary className="flex items-center justify-between px-5 py-4 cursor-pointer list-none select-none hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
                          <div className="flex items-center gap-2">
                            <Brain className="w-4 h-4 text-gray-500" />
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">
                              {t(
                                'loanguard.expert.title',
                                'Expert View — Full Risk Breakdown'
                              )}
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400 group-open:rotate-90 transition-transform" />
                        </summary>
                        <div className="border-t border-gray-100 dark:border-gray-800 p-4 space-y-4">
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {t(
                              'loanguard.expert.desc',
                              'This section shows the detailed mathematical breakdown of your risk score. For advanced users.'
                            )}
                          </p>
                          <div id="risk-meter">
                            <RiskMeter risk={result.risk_score} />
                          </div>
                          <div id="emi-graph">
                            <EMIGraph emi={result.emi_analysis} />
                          </div>
                          <div className="[&_*]:min-w-0 [&_*]:break-words">
                            <LoanSummaryCard
                              extraction={result.extraction}
                              emi={result.emi_analysis}
                            />
                          </div>
                        </div>
                      </details>

                      {/* ══ SECTION 8: Escalation / Next Steps ══ */}
                      <EscalationDownload
                        escalations={result.escalations}
                        extraction={result.extraction}
                      />

                    </div>
                  </motion.div>
                );
              })()}
            </AnimatePresence>

          </section>
        </div>
      </main>

      <LoanGuardChat auditContext={result ?? undefined} darkMode={darkMode} />

      <footer className="border-t border-gray-200 dark:border-gray-800 mt-16 py-6 lg:hidden">
        <div className="w-full mx-auto px-4 text-center text-xs text-gray-400 dark:text-gray-600">
          LoanGuard LoanGuard · RBI-Aligned Loan Intelligence Platform · Built
          for Indian Borrowers · Not a substitute for licensed legal counsel
        </div>
      </footer>
    </div>
  );
};
