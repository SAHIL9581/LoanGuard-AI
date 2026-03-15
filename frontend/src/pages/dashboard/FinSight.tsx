import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, X, Loader2, AlertCircle,
  TrendingUp, Shield, Activity, ChevronRight,
  LayoutDashboard, LogOut, Sun, Moon, Languages,
  Zap, Target, BarChart2, CheckCircle, Edit3,
  PiggyBank, Wallet, LineChart, Database
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';
import { Navbar } from '../../components/Navbar';
import { Sidebar } from '../../components/Sidebar';
import { authService } from '../../services/authService';
import { FinSightChat } from '../../components/FinSightChat';

const API_BASE = 'http://localhost:8000';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface SipSuggestion {
  item: string;
  cost: number;
  sip_10yr_potential: number;
  opportunity_cost: number;
  reasoning: string;
  category: string;
}

interface LumpsumOpportunity {
  item: string;
  cost: number;
  future_value_10yr: number;
  opportunity_cost: number;
  reasoning: string;
}

interface HealthScore {
  score: number;
  grade: string;
  grade_label: string;
  message: string;
}

interface ReportCard {
  essentials: { ideal: number; actual: number; status: string; label: string };
  wants: { ideal: number; actual: number; status: string; label: string };
  savings: { ideal: number; actual: number; status: string; label: string };
  total_spend: number;
  monthly_message: string;
}

interface AnalysisResult {
  basic_analysis: {
    summary: string;
    insights: string[];
    sip_suggestions: SipSuggestion[];
    lumpsum_opportunities: LumpsumOpportunity[];
    total_discretionary_spend: number;
    total_potential_savings: number;
    total_lumpsum_spend: number;
    total_lumpsum_opportunity: number;
    detected_income: number;
    income_detected: boolean;
    income_confidence: string;
    income_source: string | null;
    total_expenses: number;
    existing_monthly_savings: number;
    surplus: number;
  };
  health_score: HealthScore;
  report_card: ReportCard;
  anomalies: any[];
  meta: {
    files_processed: number;
    total_transactions: number;
  };
}

interface AllocationResult {
  income: number;
  net_expenses: number;
  surplus: number;
  risk_profile: string;
  existing_monthly_savings: number;
  total_existing_savings: number;
  coverage_label: string;
  coverage_message: string;
  emergency_fund_target: number;
  allocation: {
    emergency_fund: { amount: number; percent: number; where: string; why: string };
    liquid_fund: { amount: number; percent: number; where: string; why: string };
    investment: {
      amount: number;
      percent: number;
      where: string;
      why: string;
      breakdown: {
        primary: { category: string; amount: number; percent: number };
        secondary: { category: string; amount: number; percent: number };
      };
    };
  };
  finsip_prefill: { monthly_amount: number; primary_category: string };
  error?: string;
  message?: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return 'text-emerald-600 dark:text-emerald-400';
    case 'B': return 'text-green-600 dark:text-green-400';
    case 'C': return 'text-yellow-600 dark:text-yellow-400';
    case 'D': return 'text-orange-600 dark:text-orange-400';
    default: return 'text-red-600 dark:text-red-400';
  }
}

function scoreRingColor(score: number): string {
  if (score >= 75) return '#10b981';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

const circumference = 2 * Math.PI * 40;

// ─────────────────────────────────────────────
// Risk Quiz Questions
// ─────────────────────────────────────────────
const getQuizQuestions = (t: ReturnType<typeof useTranslation>['t']) => [
  {
    id: 'q1',
    question: t('finsight.quiz_q1', 'If you had ₹10,000 extra, what would you do?'),
    options: [
      { value: 'A', label: t('finsight.quiz_q1_a', 'Keep it safe in a bank account') },
      { value: 'B', label: t('finsight.quiz_q1_b', 'Split it — some safe, some for growth') },
      { value: 'C', label: t('finsight.quiz_q1_c', 'Put it all where it can grow the most') },
    ],
  },
  {
    id: 'q2',
    question: t('finsight.quiz_q2', "When do you think you'll need this money?"),
    options: [
      { value: 'A', label: t('finsight.quiz_q2_a', 'Within 2 years') },
      { value: 'B', label: t('finsight.quiz_q2_b', 'In 3 to 5 years') },
      { value: 'C', label: t('finsight.quiz_q2_c', "After 7+ years, I'm in no rush") },
    ],
  },
  {
    id: 'q3',
    question: t('finsight.quiz_q3', 'If your savings went down temporarily, how would you feel?'),
    options: [
      { value: 'A', label: t('finsight.quiz_q3_a', "Very uncomfortable — I'd want it back safe") },
      { value: 'B', label: t('finsight.quiz_q3_b', "A bit worried but I'd wait and watch") },
      { value: 'C', label: t('finsight.quiz_q3_c', "Fine — I know it'll bounce back") },
    ],
  },
];

const QUIZ_QUESTIONS = [
  {
    id: 'q1',
    question: 'If you had ₹10,000 extra, what would you do?',
    options: [
      { value: 'A', label: 'Keep it safe in a bank account' },
      { value: 'B', label: 'Split it — some safe, some for growth' },
      { value: 'C', label: 'Put it all where it can grow the most' },
    ],
  },
  {
    id: 'q2',
    question: "When do you think you'll need this money?",
    options: [
      { value: 'A', label: 'Within 2 years' },
      { value: 'B', label: 'In 3 to 5 years' },
      { value: 'C', label: "After 7+ years, I'm in no rush" },
    ],
  },
  {
    id: 'q3',
    question: 'If your savings went down temporarily, how would you feel?',
    options: [
      { value: 'A', label: "Very uncomfortable — I'd want it back safe" },
      { value: 'B', label: "A bit worried but I'd wait and watch" },
      { value: 'C', label: "Fine — I know it'll bounce back" },
    ],
  },
];

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
interface Props {
  darkMode: boolean;
  toggleDark: () => void;
}

type Stage = 'upload' | 'income' | 'savings' | 'quiz' | 'allocation';

const STAGE_LABELS: Stage[] = ['income', 'savings', 'quiz', 'allocation'];

export const FinSight: React.FC<Props> = ({ darkMode, toggleDark }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  // Time display
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const displayTime = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Mobile sidebar
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Upload state
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  // Flow stage
  const [stage, setStage] = useState<Stage>('upload');

  // Income confirmation state
  const [userIncome, setUserIncome] = useState<number>(0);
  const [incomeConfirmed, setIncomeConfirmed] = useState(false);
  const [editingIncome, setEditingIncome] = useState(false);
  const [incomeInput, setIncomeInput] = useState('');

  // Savings form state
  const [existingFdRd, setExistingFdRd] = useState<string>('');
  const [existingMf, setExistingMf] = useState<string>('');
  const [existingOther, setExistingOther] = useState<string>('');

  // Quiz state
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizLoading, setQuizLoading] = useState(false);
  const [riskProfile, setRiskProfile] = useState<string | null>(null);

  // Allocation state
  const [allocation, setAllocation] = useState<AllocationResult | null>(null);
  const [allocationLoading, setAllocationLoading] = useState(false);

  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिंदी' },
    { code: 'te', label: 'తెలుగు' },
    { code: 'ml', label: 'മലയാളം' },
    { code: 'ta', label: 'தமிழ்' },
  ];

  const toggleLanguage = () => {
    const idx = LANGUAGES.findIndex(l => l.code === i18n.language);
    i18n.changeLanguage(LANGUAGES[(idx + 1) % LANGUAGES.length].code);
  };

  const currentLang = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  // Tour state
  const [runTour, setRunTour] = useState(false);

  const tourSteps: Step[] = React.useMemo(
    () => [
      {
        target: 'body',
        placement: 'center',
        content: (
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">
              {t('finsight_tour.step1.title', 'Welcome to FinSight')}
            </h2>
            <p className="text-gray-600">
              {t('finsight_tour.step1.content', 'Upload your bank statement to analyze your spending patterns and get personalized allocation advice.')}
            </p>
          </div>
        ),
        disableBeacon: true,
      },
      {
        target: '#upload-section',
        content: (
          <div>
            <h3 className="font-bold mb-1">
              {t('finsight_tour.step2.title', 'Upload Your Statement')}
            </h3>
            <p className="text-sm">
              {t('finsight_tour.step2.content', 'Drag and drop your bank statement PDF or click to browse. We analyze your transactions securely.')}
            </p>
          </div>
        ),
      },
      {
        target: '#income-section',
        content: (
          <div>
            <h3 className="font-bold mb-1">
              {t('finsight_tour.step3.title', 'Confirm Your Income')}
            </h3>
            <p className="text-sm">
              {t('finsight_tour.step3.content', 'Use the slider to adjust your monthly income. This helps us calculate your ideal spending allocation.')}
            </p>
          </div>
        ),
      },
      {
        target: '#savings-section',
        content: (
          <div>
            <h3 className="font-bold mb-1">
              {t('finsight.quiz_title', 'Quick Risk Assessment')}
            </h3>
            <p className="text-sm">
              {t('finsight_tour.step4.content', 'Tell us about your existing savings in FDs, mutual funds, and other investments.')}
            </p>
          </div>
        ),
      },
    ],
    [t]
  );

  React.useEffect(() => {
    const hasSeenTour = localStorage.getItem('hasSeenFinSightTour');
    if (!hasSeenTour) setRunTour(true);
  }, []);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status as any)) {
      setRunTour(false);
      localStorage.setItem('hasSeenFinSightTour', 'true');
    }
  };

  const handleLogout = async () => {
    await authService.logout();
    localStorage.removeItem('authToken');
    navigate('/');
  };

  // ── File handling ──
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const allowed = arr.filter(f =>
      ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].some(ext =>
        f.name.toLowerCase().endsWith(ext)
      )
    );
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      const fresh = allowed.filter(f => !names.has(f.name));
      return [...prev, ...fresh].slice(0, 5);
    });
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const removeFile = (name: string) =>
    setFiles(prev => prev.filter(f => f.name !== name));

  // ── Stage 1: Analyze ──
  const analyze = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));

      const res = await fetch(`${API_BASE}/api/advisor/analyze`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }

      const data = await res.json();
      setResult(data);

      const detectedIncome = data.basic_analysis?.detected_income || 0;
      setUserIncome(detectedIncome);
      setIncomeInput(detectedIncome.toString());
      setStage('income');
    } catch (e: any) {
      setError(e.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Stage 2: Income confirmation → go to savings stage ──
  const confirmIncome = (income: number) => {
    setUserIncome(income);
    setIncomeConfirmed(true);
    setStage('savings');
  };

  // ── Stage 3: Savings form → go to quiz ──
  const confirmSavings = () => {
    setStage('quiz');
  };

  // ── Stage 4: Risk quiz ──
  const submitQuiz = async () => {
    if (Object.keys(quizAnswers).length < 3) return;
    setQuizLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/advisor/risk-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quizAnswers),
      });

      if (!res.ok) throw new Error('Risk profile scoring failed');
      const data = await res.json();
      setRiskProfile(data.risk_profile);
      await fetchAllocation(data.risk_profile);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setQuizLoading(false);
    }
  };

  // ── Stage 5: Allocation ──
  const fetchAllocation = async (profile: string) => {
    if (!result) return;
    setAllocationLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/advisor/allocation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detected_income: result.basic_analysis.detected_income,
          user_income: userIncome,
          total_expenses: result.basic_analysis.total_expenses,
          existing_monthly_savings: result.basic_analysis.existing_monthly_savings,
          risk_profile: profile,
          existing_fd_rd: parseFloat(existingFdRd) || 0,
          existing_mf: parseFloat(existingMf) || 0,
          existing_other: parseFloat(existingOther) || 0,
        }),
      });

      if (!res.ok) throw new Error('Allocation calculation failed');
      const data = await res.json();
      setAllocation(data);
      setStage('allocation');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAllocationLoading(false);
    }
  };

  const goToFinSip = () => {
    const amount = allocation?.finsip_prefill?.monthly_amount || 5000;
    const category = allocation?.finsip_prefill?.primary_category || 'Flexi Cap';
    navigate('/dashboard/finsip', { state: { suggestedSip: amount, suggestedCategory: category } });
  };

  const resetAll = () => {
    setFiles([]);
    setResult(null);
    setStage('upload');
    setUserIncome(0);
    setIncomeConfirmed(false);
    setEditingIncome(false);
    setIncomeInput('');
    setExistingFdRd('');
    setExistingMf('');
    setExistingOther('');
    setQuizAnswers({});
    setRiskProfile(null);
    setAllocation(null);
    setError(null);
  };

  // ─────────────────────────────────────────────
  // Render stages
  // ─────────────────────────────────────────────

  const renderUpload = () => (
    <div id="upload-section" className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
      <h2 className="text-base font-bold text-gray-800 dark:text-white">{t('finsight.upload_title', 'Upload Your Statements')}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t('finsight.upload_desc', 'Upload your bank statement PDF and optionally your Amazon or Flipkart order pages. Up to 5 files.')}
      </p>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
          dragging
            ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/20'
            : 'border-gray-300 dark:border-gray-700 hover:border-brand-400 hover:bg-gray-50 dark:hover:bg-gray-800/40'
        }`}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <Upload className="w-10 h-10 mx-auto text-gray-400 mb-3" />
        <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">
          {t('finsight.drag_drop', 'Drag & drop files here, or click to browse')}
        </p>
        <p className="text-xs text-gray-400 mt-1">{t('finsight.file_formats', 'PDF, JPG, PNG, WEBP · Max 15MB per file')}</p>
        <input
          id="file-input"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={e => e.target.files && addFiles(e.target.files)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
        {[
          { label: t('finsight.bank_statement', 'Bank Statement'), desc: t('finsight.bank_statement_desc', 'Best source — covers all transactions'), recommended: true },
          { label: t('finsight.amazon', 'Amazon Orders'), desc: t('finsight.amazon_desc', 'For itemized purchase details'), recommended: false },
          { label: t('finsight.flipkart', 'Flipkart Orders'), desc: t('finsight.flipkart_desc', 'For itemized purchase details'), recommended: false },
        ].map(item => (
          <div key={item.label} className={`rounded-xl p-3 border ${item.recommended ? 'border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-900/20' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40'}`}>
            <p className={`text-xs font-bold ${item.recommended ? 'text-brand-700 dark:text-brand-300' : 'text-gray-700 dark:text-gray-300'}`}>
              {item.label} {item.recommended && '⭐'}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {files.map(f => (
          <motion.div
            key={f.name}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-brand-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate max-w-[250px]">{f.name}</p>
                <p className="text-xs text-gray-400">{(f.size / 1024).toFixed(1)} KB</p>
              </div>
            </div>
            <button onClick={() => removeFile(f.name)} className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {error && (
        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={analyze}
        disabled={files.length === 0 || loading}
        className="w-full py-3.5 rounded-xl bg-brand-700 hover:bg-brand-900 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-brand-500/20"
      >
        {loading
          ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('finsight.analyzing', 'Analyzing your spending...')}</>
          : <><Zap className="w-5 h-5" /> {t('finsight.analyze', 'Analyze My Spending')}</>
        }
      </motion.button>
    </div>
  );

  const renderIncome = () => {
    if (!result) return null;
    const detected = result.basic_analysis.detected_income;
    const confidence = result.basic_analysis.income_confidence;
    const source = result.basic_analysis.income_source;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-5"
      >
        {/* Health score + report card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex flex-col items-center text-center">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('finsight.health_score_title', 'Financial Health Score')}</p>
            <div className="relative w-28 h-28">
              <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                <circle
                  cx="50" cy="50" r="40" fill="none"
                  stroke={scoreRingColor(result.health_score.score)}
                  strokeWidth="10"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - result.health_score.score / 100)}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-3xl font-black ${gradeColor(result.health_score.grade)}`}>
                  {result.health_score.grade}
                </span>
                <span className="text-xs text-gray-400">{result.health_score.score}/100</span>
              </div>
            </div>
            <p className="text-sm font-bold text-gray-800 dark:text-white mt-3">{result.health_score.grade_label}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{result.health_score.message}</p>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('finsight.report_card_title', '50-30-20 Report Card')}</p>
            {(['essentials', 'wants', 'savings'] as const).map(key => {
              const item = result.report_card[key];
              return (
                <div key={key}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 capitalize">{t(`finsight.${key}`, key)}</span>
                    <span className="text-xs text-gray-400">{item.actual}% / {item.ideal}% {t('finsight.ideal', 'ideal')} {item.status}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(item.actual, 100)}%` }}
                      transition={{ duration: 0.8 }}
                      className={`h-full rounded-full ${
                        key === 'essentials' ? 'bg-blue-500' :
                        key === 'wants' ? 'bg-orange-500' : 'bg-emerald-500'
                      }`}
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-800">
              {result.report_card.monthly_message}
            </p>
          </div>
        </div>

        {/* Income Confirmation */}
        <div id="income-section" className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-brand-200 dark:border-brand-800 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-brand-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-white">{t('finsight.confirm_income', 'Confirm Your Monthly Income')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('finsight.income_reason', 'We need this to calculate how much you can invest')}</p>
            </div>
          </div>

          {detected > 0 && !editingIncome ? (
            <div className="space-y-3">
              <div className={`rounded-xl p-4 border ${confidence === 'high' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  {confidence === 'high' ? t('finsight.income_high', '✅ Income detected with high confidence') : t('finsight.income_verify', '⚠️ Income detected — please verify')}
                </p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">{fmt(detected)}<span className="text-sm font-normal text-gray-400">{t('finsight.per_month', '/month')}</span></p>
                {source && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('finsight.source', 'Source')}: {source}</p>}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => confirmIncome(detected)}
                  className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <CheckCircle className="w-4 h-4" /> {t('finsight.yes_correct', 'Yes, that\'s correct')}
                </button>
                <button
                  onClick={() => setEditingIncome(true)}
                  className="flex-1 py-3 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold flex items-center justify-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <Edit3 className="w-4 h-4" /> {t('finsight.adjust', 'No, let me adjust')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center mb-3">
                  <label className="text-sm font-bold text-gray-700 dark:text-gray-300">{t('finsight.select_income', 'Select your monthly income')}</label>
                  <span className="text-2xl font-black bg-gradient-to-r from-brand-600 to-brand-700 bg-clip-text text-transparent">{fmt(incomeInput ? parseFloat(incomeInput) : 50000)}</span>
                </div>
                <div className="bg-gradient-to-r from-brand-50 to-brand-100/50 dark:from-brand-900/20 dark:to-brand-800/10 rounded-xl p-4 border border-brand-100 dark:border-brand-800/30">
                  <input
                    type="range"
                    min="10000"
                    max="10000000"
                    step="10000"
                    value={incomeInput || 50000}
                    onChange={e => setIncomeInput(e.target.value)}
                    className="w-full h-2 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <div className="flex justify-between text-xs font-semibold text-gray-500 dark:text-gray-400 mt-3">
                    <span>{t('finsight.10k', '₹10K')}</span>
                    <span>{t('finsight.1cr', '₹1 Cr')}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => confirmIncome(parseFloat(incomeInput) || 50000)}
                disabled={!incomeInput || parseFloat(incomeInput) < 10000}
                className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <ChevronRight className="w-4 h-4" /> {t('finsight.continue', 'Continue')}
              </button>
            </div>
          )}
        </div>

        {/* Summary + Insights */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
          <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('finsight.analysis_summary', 'Analysis Summary')}</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{result.basic_analysis.summary}</p>
          <div className="space-y-2">
            {result.basic_analysis.insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2.5 bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800 rounded-xl px-3 py-2.5">
                <Activity className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-brand-800 dark:text-brand-300">{ins}</p>
              </div>
            ))}
          </div>
        </div>

        {/* SIP Suggestions */}
        {result.basic_analysis.sip_suggestions.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t('finsight.recurring_habits_sip', 'Recurring Habits → SIP Candidates')}
              </p>
              <span className="text-xs bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800 px-2.5 py-1 rounded-full font-semibold">
                {result.basic_analysis.sip_suggestions.length} {t('finsight.habits', 'habits')}
              </span>
            </div>
            {result.basic_analysis.sip_suggestions.map((sip, i) => (
              <div key={i} className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-800 dark:text-white">{sip.item}</p>
                    <span className="text-[10px] bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 px-2 py-0.5 rounded-full border border-brand-100 dark:border-brand-800 font-semibold">
                      {sip.category}
                    </span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-400">{t('finsight.monthly_spend', 'Monthly Spend')}</p>
                    <p className="text-base font-black text-gray-800 dark:text-white">{fmt(sip.cost)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2 text-center border border-emerald-100 dark:border-emerald-800">
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">{t('finsight.sip_10yr_value', '10Y SIP Value')}</p>
                    <p className="text-sm font-black text-emerald-700 dark:text-emerald-300">{fmt(sip.sip_10yr_potential)}</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2 text-center border border-red-100 dark:border-red-800">
                    <p className="text-[10px] text-red-600 dark:text-red-400 font-semibold">{t('finsight.opportunity_cost', 'Opportunity Cost')}</p>
                    <p className="text-sm font-black text-red-700 dark:text-red-300">{fmt(sip.opportunity_cost)}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{sip.reasoning}</p>
              </div>
            ))}
          </div>
        )}

        {/* Lumpsum Opportunities */}
        {result.basic_analysis.lumpsum_opportunities?.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t('finsight.lumpsum_opportunities', 'One-Time Purchases → What They Could Have Become')}
              </p>
              <span className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 px-2.5 py-1 rounded-full font-semibold">
                {result.basic_analysis.lumpsum_opportunities.length} {t('finsight.items', 'items')}
              </span>
            </div>
            {result.basic_analysis.lumpsum_opportunities.map((item, i) => (
              <div key={i} className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-gray-800 dark:text-white">{item.item}</p>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-400">{t('finsight.paid', 'Paid')}</p>
                    <p className="text-base font-black text-gray-800 dark:text-white">{fmt(item.cost)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2 text-center border border-purple-100 dark:border-purple-800">
                    <p className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold">{t('finsight.if_invested_10y', 'If Invested — 10Y Value')}</p>
                    <p className="text-sm font-black text-purple-700 dark:text-purple-300">{fmt(item.future_value_10yr)}</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2 text-center border border-red-100 dark:border-red-800">
                    <p className="text-[10px] text-red-600 dark:text-red-400 font-semibold">{t('finsight.wealth_foregone', 'Wealth Foregone')}</p>
                    <p className="text-sm font-black text-red-700 dark:text-red-300">{fmt(item.opportunity_cost)}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.reasoning}</p>
              </div>
            ))}
          </div>
        )}


      </motion.div>
    );
  };

  const renderSavings = () => (
    <motion.div
      id="savings-section"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-gray-900 rounded-2xl border-2 border-brand-200 dark:border-brand-800 p-6 space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
          <Database className="w-5 h-5 text-brand-500" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-800 dark:text-white">{t('finsight.existing_savings', 'Your Existing Savings')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('finsight.savings_optional', 'Optional — helps us personalize your emergency fund and investment allocation')}
          </p>
        </div>
      </div>

      <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800 rounded-xl p-4">
        <p className="text-xs text-brand-700 dark:text-brand-300 leading-relaxed">
          💡 {t('finsight.fd_help', 'If you already have an FD of ₹3L, your emergency fund is likely covered — we\'ll redirect that allocation straight into investments instead.')}
        </p>
      </div>

      <div className="space-y-5">
        {[
          {
            label: t('finsight.fd_label', 'Fixed Deposits (FD) + Recurring Deposits (RD)'),
            value: existingFdRd,
            setter: setExistingFdRd,
            hint: t('finsight.fd_hint', 'Total current value of all FDs and RDs'),
          },
          {
            label: t('finsight.mf_label', 'Mutual Funds + SIP Portfolio Value'),
            value: existingMf,
            setter: setExistingMf,
            hint: t('finsight.mf_hint', 'Current market value of all MF investments'),
          },
          {
            label: t('finsight.other_label', 'Other Savings'),
            value: existingOther,
            setter: setExistingOther,
            hint: t('finsight.other_hint', 'PPF, NPS, gold, savings account balance, etc.'),
          },
        ].map(field => (
          <div key={field.label} className="space-y-2.5">
            <div className="flex justify-between items-center">
              <label className="text-sm font-bold text-gray-700 dark:text-gray-300">{field.label}</label>
              <span className="text-lg font-black bg-gradient-to-r from-brand-600 to-brand-700 bg-clip-text text-transparent">{fmt(field.value ? parseFloat(field.value) : 0)}</span>
            </div>
            <div className="bg-gradient-to-r from-brand-50 to-brand-100/50 dark:from-brand-900/20 dark:to-brand-800/10 rounded-xl p-3 border border-brand-100 dark:border-brand-800/30">
              <input
                type="range"
                min="0"
                max="10000000"
                step="10000"
                value={field.value || 0}
                onChange={e => field.setter(e.target.value)}
                className="w-full h-2 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
              />
              <div className="flex justify-between text-xs font-semibold text-gray-500 dark:text-gray-400 mt-2">
                <span>{t('finsight.0', '₹0')}</span>
                <span>{t('finsight.1cr', '₹1 Cr')}</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-400">{field.hint}</p>
          </div>
        ))}
      </div>

      {/* Live preview if values entered */}
      {(parseFloat(existingFdRd) > 0 || parseFloat(existingMf) > 0 || parseFloat(existingOther) > 0) && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 space-y-1">
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{t('finsight.total_existing_savings', 'Total Existing Savings')}</p>
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">
            {fmt((parseFloat(existingFdRd) || 0) + (parseFloat(existingMf) || 0) + (parseFloat(existingOther) || 0))}
          </p>
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
            {t('finsight.factored_assessment', 'This will be factored into your emergency fund assessment')}
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={confirmSavings}
          className="flex-1 py-3.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold flex items-center justify-center gap-2 transition-colors"
        >
          <ChevronRight className="w-4 h-4" /> {t('finsight.continue_risk', 'Continue to Risk Assessment')}
        </button>
        <button
          onClick={confirmSavings}
          className="py-3.5 px-5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-semibold text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {t('finsight.skip', 'Skip')}
        </button>
      </div>
    </motion.div>
  );

  const renderQuiz = () => {
    const quizQuestions = getQuizQuestions(t);
    return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
          <Target className="w-5 h-5 text-brand-500" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-800 dark:text-white">{t('finsight.quiz_title', 'Quick Risk Assessment')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('finsight.quiz_desc', '3 simple questions — no financial jargon')}</p>
        </div>
      </div>

      {quizQuestions.map((q, qi) => (
        <div key={q.id} className="space-y-3">
          <p className="text-sm font-bold text-gray-800 dark:text-white">
            {qi + 1}. {q.question}
          </p>
          <div className="space-y-2">
            {q.options.map(opt => (
              <button
                key={opt.value}
                onClick={() => setQuizAnswers(prev => ({ ...prev, [q.id]: opt.value }))}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all text-sm font-medium ${
                  quizAnswers[q.id] === opt.value
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                }`}
              >
                <span className="font-bold mr-2">{opt.value}.</span> {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={submitQuiz}
        disabled={Object.keys(quizAnswers).length < 3 || quizLoading || allocationLoading}
        className="w-full py-3.5 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 transition-colors"
      >
        {quizLoading || allocationLoading
          ? <><Loader2 className="w-5 h-5 animate-spin" /> {t('finsight.building_plan', 'Building your plan...')}</>
          : <><LineChart className="w-5 h-5" /> {t('finsight.get_plan', 'Get My Investment Plan')}</>
        }
      </motion.button>
    </motion.div>
    );
  };

  const renderAllocation = () => {
    if (!allocation || !riskProfile) return null;

    if (allocation.error) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-900 rounded-2xl border border-red-200 dark:border-red-800 p-6 space-y-4"
        >
          <AlertCircle className="w-8 h-8 text-red-500" />
          <p className="text-sm font-bold text-red-700 dark:text-red-400">{allocation.error}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{allocation.message}</p>
        </motion.div>
      );
    }

    const { allocation: alloc, surplus, income, net_expenses, existing_monthly_savings } = allocation;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-5"
      >
        {/* Surplus Overview */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('finsight.monthly_surplus', 'Your Monthly Surplus')}</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 uppercase font-semibold">{t('finsight.income', 'Income')}</p>
              <p className="text-lg font-black text-gray-900 dark:text-white mt-0.5">{fmt(income)}</p>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 border border-red-100 dark:border-red-800">
              <p className="text-[10px] text-red-500 uppercase font-semibold">{t('finsight.expenses', 'Expenses')}</p>
              <p className="text-lg font-black text-red-600 dark:text-red-400 mt-0.5">{fmt(net_expenses)}</p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-100 dark:border-emerald-800">
              <p className="text-[10px] text-emerald-600 uppercase font-semibold">{t('finsight.surplus', 'Surplus')}</p>
              <p className="text-lg font-black text-emerald-700 dark:text-emerald-300 mt-0.5">{fmt(surplus)}</p>
            </div>
          </div>

          {/* Coverage message */}
          {allocation.coverage_message && (
            <div className={`mt-4 rounded-xl px-4 py-3 text-xs leading-relaxed ${
              allocation.coverage_label === 'full'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : allocation.coverage_label === 'partial'
                ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
            }`}>
              {allocation.coverage_message}
            </div>
          )}

          {existing_monthly_savings > 0 && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
              ✅ {t('finsight.detected_investments', 'Detected existing investments of')} {fmt(existing_monthly_savings)}/month — {t('finsight.factored_plan', 'factored into your plan')}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('finsight.risk_profile', 'Risk Profile')}:</span>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              riskProfile === 'Conservative' ? 'bg-blue-50 text-blue-600 border border-blue-200' :
              riskProfile === 'Moderate' ? 'bg-yellow-50 text-yellow-600 border border-yellow-200' :
              'bg-red-50 text-red-600 border border-red-200'
            }`}>
              {t(`spendadvisor.risk_${riskProfile?.toLowerCase()}`, riskProfile)}
            </span>
          </div>
        </div>

        {/* Allocation Buckets */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { key: 'emergency_fund' as const, icon: Shield, color: 'blue', label: t('finsight.allocation_emergency_fund', 'Emergency Fund') },
            { key: 'liquid_fund' as const, icon: PiggyBank, color: 'yellow', label: t('finsight.allocation_liquid_fund', 'Liquid Fund') },
            { key: 'investment' as const, icon: TrendingUp, color: 'emerald', label: t('finsight.allocation_investment', 'Investment') },
          ].map(({ key, icon: Icon, color, label }) => {
            const bucket = alloc[key];
            return (
              <div key={key} className={`bg-${color}-50 dark:bg-${color}-900/20 border border-${color}-200 dark:border-${color}-800 rounded-2xl p-5 space-y-3`}>
                <div className="flex items-center gap-2">
                  <Icon className={`w-5 h-5 text-${color}-500`} />
                  <p className={`text-xs font-bold text-${color}-700 dark:text-${color}-300 uppercase tracking-wide`}>{label}</p>
                </div>
                <p className={`text-3xl font-black text-${color}-700 dark:text-${color}-300`}>{fmt(bucket.amount)}</p>
                <p className={`text-xs text-${color}-600 dark:text-${color}-400 font-semibold`}>{bucket.percent}% {t('finsight.of_surplus', 'of surplus')}</p>
                <div className={`pt-2 border-t border-${color}-200 dark:border-${color}-700 space-y-1`}>
                  <p className={`text-[11px] font-bold text-${color}-700 dark:text-${color}-300`}>{bucket.where}</p>
                  <p className={`text-[10px] text-${color}-500 dark:text-${color}-400`}>{bucket.why}</p>
                </div>
                {key === 'investment' && 'breakdown' in bucket && (
                  <div className="pt-2 border-t border-emerald-200 dark:border-emerald-700 space-y-1">
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">{t('finsight.breakdown', 'Breakdown')}:</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                      {bucket.breakdown.primary.percent}% → {bucket.breakdown.primary.category} ({fmt(bucket.breakdown.primary.amount)})
                    </p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                      {bucket.breakdown.secondary.percent}% → {bucket.breakdown.secondary.category} ({fmt(bucket.breakdown.secondary.amount)})
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CTA → FinSIP */}
        <div className="bg-gradient-to-r from-brand-500 via-brand-600 to-brand-700 rounded-2xl p-6 text-white">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="font-black text-lg">{t('finsight.ready_to_simulate', 'Ready to simulate your returns?')}</p>
                <p className="text-brand-100 text-sm mt-0.5">
                  {t('finsight.invest_monthly', 'Invest')} <span className="font-black text-white">{fmt(alloc.investment.amount)}/month</span> {t('finsight.in_funds', 'in')} {' '}
                  <span className="font-black text-white">{allocation.finsip_prefill.primary_category}</span> {t('finsight.funds', 'funds')}
                </p>
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={goToFinSip}
              className="flex items-center gap-2 bg-white text-brand-600 font-bold px-5 py-3 rounded-xl hover:bg-brand-50 transition-colors shadow-lg flex-shrink-0"
            >
              <TrendingUp className="w-4 h-4" />
              {t('finsight.simulate_finsip', 'Simulate in FinSIP')}
              <ChevronRight className="w-4 h-4" />
            </motion.button>
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center">
          {t('finsight.analyzed_footer', 'Analyzed')} {result?.meta.files_processed} {t('finsight.files', 'file(s)')} · {result?.meta.total_transactions} {t('finsight.transactions', 'transactions')}
        </p>
      </motion.div>
    );
  };

  // ─────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────
  return (
    <>
      <style>{`
        /* Slider styling */
        .slider {
          -webkit-appearance: none;
          width: 100%;
          height: 8px;
          border-radius: 5px;
          background: linear-gradient(to right, #e5e7eb, #d1d5db);
          outline: none;
          -webkit-slider-thumb-appearance: none;
        }
        
        /* Webkit browsers */
        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4);
          border: 2px solid white;
          transition: all 0.2s ease;
        }
        
        .slider::-webkit-slider-thumb:hover {
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.6);
          transform: scale(1.05);
        }
        
        /* Firefox */
        .slider::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4);
          border: 2px solid white;
          transition: all 0.2s ease;
        }
        
        .slider::-moz-range-thumb:hover {
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.6);
          transform: scale(1.05);
        }
        
        .slider::-moz-range-track {
          background: transparent;
          border: none;
        }
        
        /* Dark mode */
        .dark .slider {
          background: linear-gradient(to right, #374151, #4b5563);
        }
      `}</style>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-300 lg:h-screen lg:overflow-hidden">
      <Navbar
        darkMode={darkMode}
        toggleDark={toggleDark}
        showReset={false}
        onReset={() => {}}
        onMobileHamburgerClick={() => setMobileSidebarOpen(true)}
        useMobileActionsMenu={false}
        onLogout={handleLogout}
        languages={LANGUAGES}
        currentLang={currentLang}
        onLangChange={(code) => i18n.changeLanguage(code)}
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
                  isCurrentPage="finsight"
                  onMobileClose={() => setMobileSidebarOpen(false)}
                  isMobile={true}
                />
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <Joyride
        steps={tourSteps}
        run={runTour}
        continuous={true}
        showSkipButton={true}
        callback={handleJoyrideCallback}
        styles={{
          options: {
            primaryColor: '#0ea5e9',
            zIndex: 1000,
          },
          tooltipContainer: {
            textAlign: 'left'
          }
        }}
        locale={{
          back: t('dashboard.tour.back', 'Back'),
          close: t('dashboard.tour.close', 'Close'),
          last: t('dashboard.tour.last', 'Finish'),
          next: t('dashboard.tour.next', 'Next'),
          skip: t('dashboard.tour.skip', 'Skip'),
        }}
      />

      <main className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:h-[calc(100vh-4rem)] lg:py-6 lg:overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:h-full">

          {/* Desktop Sidebar */}
          <aside className="hidden lg:block lg:col-span-3 lg:sticky lg:top-0 lg:h-full">
            <Sidebar
              displayTime={displayTime}
              onReplayTour={() => setRunTour(true)}
              isCurrentPage="finsight"
            />
          </aside>

          {/* Main content */}
          <section className="col-span-1 lg:col-span-9 lg:h-full lg:overflow-hidden lg:pr-3">
            <div className="w-full h-full overflow-y-auto pb-20 lg:pb-0 [scrollbar-width:thin]">
              <div className="space-y-6">
                {/* Header */}
                <div className="rounded-2xl bg-gradient-to-r from-brand-500 via-brand-600 to-brand-700 p-6 text-white">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <BarChart2 className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h1 className="text-2xl font-black tracking-tight">{t('finsight.page_title', 'FinSight')}</h1>
                        <p className="text-brand-100 text-sm mt-0.5">
                          {t('finsight.page_desc', 'Upload your bank statement to reveal your financial blind spots')}
                        </p>
                      </div>
                    </div>

                    {/* Stage indicator — 4 steps */}
                    {stage !== 'upload' && (
                      <div className="hidden sm:flex items-center gap-2">
                        {STAGE_LABELS.map((s, i) => (
                          <div key={s} className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              stage === s
                                ? 'bg-white text-brand-600'
                                : STAGE_LABELS.indexOf(stage) > i
                                ? 'bg-white/40 text-white'
                                : 'bg-white/20 text-white/60'
                            }`}>
                              {i + 1}
                            </div>
                            {i < STAGE_LABELS.length - 1 && <div className="w-4 h-0.5 bg-white/30" />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Reset button */}
                {stage !== 'upload' && (
                  <button
                    onClick={resetAll}
                    className="text-sm text-gray-500 hover:text-brand-500 transition-colors flex items-center gap-1.5"
                  >
                    <X className="w-4 h-4" /> {t('finsight.start_over', 'Start over with different files')}
                  </button>
                )}

                {/* Stage content */}
                {stage === 'upload' && renderUpload()}
                {stage === 'income' && renderIncome()}
                {stage === 'savings' && renderSavings()}
                {stage === 'quiz' && renderQuiz()}
                {stage === 'allocation' && renderAllocation()}
              </div>
            </div>
          </section>
        </div>
      </main>
      </div>
      
      {result && (
        <FinSightChat 
          context={{
            analysis: result,
            allocation: allocation
          }} 
          darkMode={darkMode}
        />
      )}
    </>
  );
};