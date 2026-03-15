import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Search, Filter,
  ChevronRight, ChevronLeft, Loader2, AlertCircle,
  BarChart2, Building2, Sparkles, Target,
  ShieldCheck, Activity, LayoutDashboard, Shield, X, Clock3, PlayCircle,
  RefreshCw, AlertTriangle,
} from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';
import { Navbar } from '../../components/Navbar';
import { Sidebar } from '../../components/Sidebar';
import { authService } from '../../services/authService';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface Fund {
  scheme_code: string;
  scheme_name: string;
  fund_house: string;
  scheme_type: string;
  category: string;
  risk: string;
  nav_current: number;
  cagr_1y: number | null;
  cagr_3y: number | null;
  cagr_5y: number | null;
  nav_date: string | null;
}

interface ChartPoint {
  month: number;
  invested: number;
  p10: number;
  p50: number;
  p90: number;
}

interface PredictResult {
  scheme_name: string;
  fund_house: string;
  monthly_amount: number;
  years: number;
  total_invested: number;
  probability_of_profit_pct: number;
  summary: {
    pessimistic: number;
    expected: number;
    optimistic: number;
    gain_pessimistic: number;
    gain_expected: number;
    gain_optimistic: number;
  };
  chart_data: ChartPoint[];
}

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
const API_BASE = 'http://localhost:8000';

const CATEGORIES = ['All', 'Large Cap', 'Mid Cap', 'Small Cap', 'Flexi Cap', 'Index', 'ELSS', 'Sectoral'];

const RISK_COLORS: Record<string, string> = {
  'Moderate': 'text-blue-600   bg-blue-50   dark:bg-blue-900/30   dark:text-blue-300   border-blue-200   dark:border-blue-800',
  'High': 'text-orange-600 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800',
  'Very High': 'text-red-600    bg-red-50    dark:bg-red-900/30    dark:text-red-300    border-red-200    dark:border-red-800',
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function cagrColor(v: number | null) {
  if (v === null) return 'text-gray-400';
  if (v >= 15) return 'text-emerald-600 dark:text-emerald-400';
  if (v >= 10) return 'text-green-600 dark:text-green-400';
  if (v >= 0) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-500 dark:text-red-400';
}

function cagrBarColor(v: number | null) {
  if (v === null) return 'bg-gray-200 dark:bg-gray-700';
  if (v >= 15) return 'bg-emerald-500';
  if (v >= 10) return 'bg-green-500';
  if (v >= 0) return 'bg-yellow-500';
  return 'bg-red-500';
}

function shortName(name: string): string {
  return name
    .replace(/fund/gi, '')
    .replace(/direct/gi, '')
    .replace(/growth/gi, '')
    .replace(/-/g, '')
    .trim()
    .slice(0, 40);
}

const RANK_CONFIG = [
  { bg: 'bg-yellow-400', text: 'text-yellow-900', emoji: '🥇' },
  { bg: 'bg-gray-300 dark:bg-gray-500', text: 'text-gray-800 dark:text-white', emoji: '🥈' },
  { bg: 'bg-orange-300', text: 'text-orange-900', emoji: '🥉' },
];

// ─────────────────────────────────────────────
// ReturnBar — animated bar for 1Y/3Y/5Y
// ─────────────────────────────────────────────
const ReturnBar: React.FC<{ label: string; value: number | null; maxValue: number }> = ({
  label, value, maxValue,
}) => {
  const pct = value !== null && maxValue > 0 ? Math.max(0, (value / maxValue) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-400 w-4 flex-shrink-0 font-medium">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className={`h-full rounded-full ${cagrBarColor(value)}`}
        />
      </div>
      {value !== null ? (
        <span className={`text-[10px] font-bold w-12 text-right tabular-nums ${cagrColor(value)}`}>
          {value > 0 ? '+' : ''}{value}%
        </span>
      ) : (
        <span className="text-[10px] text-gray-300 dark:text-gray-600 w-12 text-right">—</span>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────
// Fund Card
// ─────────────────────────────────────────────
const FundCard: React.FC<{ fund: Fund; rank: number; onClick: () => void }> = ({
  fund, rank, onClick,
}) => {
  const returns = [fund.cagr_1y, fund.cagr_3y, fund.cagr_5y].filter((v): v is number => v !== null);
  const maxReturn = returns.length ? Math.max(...returns, 1) : 30;
  const rc = RANK_CONFIG[rank] ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.03 }}
      onClick={onClick}
      className="group relative cursor-pointer bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-brand-400 dark:hover:border-brand-600 rounded-2xl p-4 transition-all duration-200 hover:shadow-lg hover:shadow-brand-100/40 dark:hover:shadow-brand-900/20 overflow-hidden"
    >
      {/* Subtle hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50/0 group-hover:from-brand-50/40 dark:group-hover:from-brand-900/10 to-transparent transition-all duration-300 rounded-2xl pointer-events-none" />

      {/* Top row */}
      <div className="flex items-start gap-3">
        {/* Rank badge */}
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-sm shadow-sm ${rc ? `${rc.bg} ${rc.text}` : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs font-black'
          }`}>
          {rank < 3 ? rc!.emoji : `#${rank + 1}`}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-white leading-tight line-clamp-1">
            {shortName(fund.scheme_name)}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <Building2 className="w-3 h-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{fund.fund_house}</p>
          </div>
        </div>

        {/* 3Y CAGR */}
        <div className="flex-shrink-0 text-right">
          {fund.cagr_3y !== null && (
            <p className={`text-lg font-black leading-tight tabular-nums ${cagrColor(fund.cagr_3y)}`}>
              {fund.cagr_3y > 0 ? '+' : ''}{fund.cagr_3y}%
            </p>
          )}
          <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">3Y CAGR</p>
        </div>
      </div>

      {/* Tags */}
      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
        <span className="text-[10px] bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 px-2 py-0.5 rounded-full font-semibold border border-brand-100 dark:border-brand-800">
          {fund.category}
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${RISK_COLORS[fund.risk] ?? 'text-gray-500'}`}>
          {fund.risk}
        </span>
      </div>

      {/* Animated return bars */}
      <div className="mt-3 space-y-1.5">
        <ReturnBar label="1Y" value={fund.cagr_1y} maxValue={maxReturn} />
        <ReturnBar label="3Y" value={fund.cagr_3y} maxValue={maxReturn} />
        <ReturnBar label="5Y" value={fund.cagr_5y} maxValue={maxReturn} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          NAV{' '}
          <span className="font-semibold text-gray-600 dark:text-gray-300">
            ₹{fund.nav_current?.toFixed(2)}
          </span>{' '}
          · {fund.nav_date}
        </span>
        <div className="flex items-center gap-1 text-[11px] text-gray-400 group-hover:text-brand-500 transition-colors font-medium">
          <span>Simulate</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// Custom Tooltip
// ─────────────────────────────────────────────
const MCTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ChartPoint;
  if (!d) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 text-xs space-y-1.5 min-w-[160px]">
      <p className="font-bold text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-gray-700 pb-1">
        Month {label} ({Math.ceil(label / 12)}Y)
      </p>
      <div className="flex justify-between gap-4">
        <span className="text-emerald-600 dark:text-emerald-400">Optimistic</span>
        <span className="font-semibold">{fmt(d.p90)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-blue-600 dark:text-blue-400">Expected</span>
        <span className="font-semibold">{fmt(d.p50)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-orange-500 dark:text-orange-400">Pessimistic</span>
        <span className="font-semibold">{fmt(d.p10)}</span>
      </div>
      <div className="flex justify-between gap-4 border-t border-gray-100 dark:border-gray-700 pt-1">
        <span className="text-gray-400">Invested</span>
        <span className="font-semibold text-gray-600 dark:text-gray-300">{fmt(d.invested)}</span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// Monte Carlo Panel
// ─────────────────────────────────────────────
const MCPanel: React.FC<{
  result: PredictResult;
  onBack: () => void;
  darkMode?: boolean;
}> = ({ result, onBack, darkMode }) => {
  const { t } = useTranslation();
  const { summary, chart_data, total_invested, probability_of_profit_pct } = result;
  const step = Math.max(1, Math.floor(chart_data.length / 60));
  const chartPoints = chart_data.filter((_, i) => i % step === 0 || i === chart_data.length - 1);
  const axisColor = darkMode ? '#6b7280' : '#9ca3af';

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-5"
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-500 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Back to funds
      </button>

      {/* Header */}
      <div className="bg-gradient-to-r from-brand-500 via-brand-600 to-brand-700 rounded-2xl p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-black text-base leading-tight">{result.scheme_name}</p>
              <p className="text-brand-100 text-xs mt-0.5">{result.fund_house}</p>
              <p className="text-xs text-brand-200 mt-2">
                ₹{result.monthly_amount.toLocaleString()}/mo × {result.years}Y · {t('finsip.fan_chart_desc')}
              </p>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-brand-200 mb-1">Profit probability</p>
            <p className={`text-3xl font-black ${probability_of_profit_pct >= 70 ? 'text-emerald-300' : 'text-orange-300'}`}>
              {probability_of_profit_pct}%
            </p>
          </div>
        </div>
      </div>

      {/* 4-column summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Invested */}
        <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-col justify-center">
          <div className="flex items-center gap-1 mb-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-brand-500" />
            <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('finsip.invested')}</span>
          </div>
          <p className="text-base font-black text-gray-900 dark:text-white">{fmt(total_invested)}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Total SIP outflow</p>
        </div>

        {[
          { label: 'Pessimistic', value: summary.pessimistic, gain: summary.gain_pessimistic, color: 'orange', icon: TrendingDown },
          { label: 'Expected', value: summary.expected, gain: summary.gain_expected, color: 'blue', icon: Target },
          { label: 'Optimistic', value: summary.optimistic, gain: summary.gain_optimistic, color: 'emerald', icon: TrendingUp },
        ].map(({ label, value, gain, color, icon: Icon }) => (
          <div
            key={label}
            className={`rounded-xl p-3 border bg-${color}-50 dark:bg-${color}-900/20 border-${color}-200 dark:border-${color}-800`}
          >
            <div className="flex items-center gap-1 mb-1.5">
              <Icon className={`w-3.5 h-3.5 text-${color}-500`} />
              <span className={`text-[10px] font-bold text-${color}-600 dark:text-${color}-400 uppercase tracking-wide`}>
                {label}
              </span>
            </div>
            <p className={`text-base font-black text-${color}-700 dark:text-${color}-300 leading-tight`}>
              {fmt(value)}
            </p>
            <p className={`text-[10px] text-${color}-500 mt-0.5`}>
              {gain >= 0 ? '+' : ''}{fmt(gain)} gain
            </p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-brand-500" />
          <p className="text-sm font-bold text-gray-800 dark:text-white">{t('finsip.fan_chart')}</p>
          <span className="text-[10px] text-gray-400 ml-auto bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">
            {t('finsip.fan_chart_desc')}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartPoints} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="p90g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="p50g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.08} />
              </linearGradient>
              <linearGradient id="p10g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#1f2937' : '#f3f4f6'} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: axisColor }}
              tickFormatter={v => `${Math.ceil(v / 12)}Y`}
              interval={Math.floor(chartPoints.length / 5)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: axisColor }}
              tickFormatter={v => fmt(v)}
              width={60}
            />
            <Tooltip content={<MCTooltip />} />
            <Area type="monotone" dataKey="invested" stroke="#9ca3af" strokeDasharray="5 3"
              fill="none" strokeWidth={1.5} dot={false} name="Invested" />
            <Area type="monotone" dataKey="p90" stroke="#10b981" fill="url(#p90g)"
              strokeWidth={2} dot={false} name="Optimistic (P90)" />
            <Area type="monotone" dataKey="p50" stroke="#3b82f6" fill="url(#p50g)"
              strokeWidth={2.5} dot={false} name="Expected (P50)" />
            <Area type="monotone" dataKey="p10" stroke="#f97316" fill="url(#p10g)"
              strokeWidth={2} dot={false} name="Pessimistic (P10)" />
            <Legend iconType="line" wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} />
          </AreaChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-2 text-center">
          Based on historical NAV volatility · Past performance does not guarantee future returns
        </p>
      </div>
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// Main SIP Widget
// ─────────────────────────────────────────────
interface FinSipProps {
  darkMode: boolean;
  toggleDark: () => void;
}

export const FinSip: React.FC<FinSipProps> = ({ darkMode, toggleDark }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [funds, setFunds] = useState<Fund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null);

const location = useLocation();
const [monthly, setMonthly] = useState<number>(() => {
  const state = location.state as { suggestedSip?: number } | null;
  return state?.suggestedSip || 5000;
});
  const [years, setYears] = useState(10);
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<PredictResult | null>(null);
  const [predError, setPredError] = useState<string | null>(null);

  // ── Walkthrough State ──
  const [runTour, setRunTour] = useState(false);

  const tourSteps: Step[] = React.useMemo(() => [
    {
      target: '#finsip-header',
      content: (
        <div>
          <h3 className="font-bold text-lg mb-1">{t('finsip_tour.step1.title')}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('finsip_tour.step1.content')}</p>
        </div>
      ),
      placement: 'bottom',
      disableBeacon: true,
    },
    {
      target: '#finsip-filters',
      content: (
        <div>
          <h3 className="font-bold text-lg mb-1">{t('finsip_tour.step2.title')}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('finsip_tour.step2.content')}</p>
        </div>
      ),
      placement: 'bottom',
    },
    {
      target: '#finsip-filters',
      content: (
        <div>
          <h3 className="font-bold text-lg mb-1">{t('finsip_tour.step2_types.title')}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('finsip_tour.step2_types.content')}</p>
        </div>
      ),
      placement: 'bottom',
    },
    {
      target: '#finsip-grid',
      content: (
        <div>
          <h3 className="font-bold text-lg mb-1">{t('finsip_tour.step3.title')}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('finsip_tour.step3.content')}</p>
        </div>
      ),
      placement: 'top',
    }
  ], [t]);

  useEffect(() => {
    const tourCompleted = localStorage.getItem('finsipTourCompleted');
    if (!tourCompleted) {
      setRunTour(true);
    }
  }, []);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];
    if (finishedStatuses.includes(status)) {
      setRunTour(false);
      localStorage.setItem('finsipTourCompleted', 'true');
    }
  };

  const fetchFunds = useCallback(async (cat: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = cat === 'All'
        ? `${API_BASE}/api/sip/top-funds`
        : `${API_BASE}/api/sip/top-funds?category=${encodeURIComponent(cat)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setFunds(data.funds);
    } catch (e: any) {
      setError(e.message || t('finsip.failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchFunds(category); }, [category, fetchFunds]);

  // Live clock
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिंदी (Hindi)' },
    { code: 'te', label: 'తెలుగు (Telugu)' },
    { code: 'ml', label: 'മലയാളം (Malayalam)' },
    { code: 'ta', label: 'தமிழ் (Tamil)' },
  ];

  const currentLang = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  const toggleLanguage = () => {
    const currentIndex = LANGUAGES.findIndex(l => l.code === i18n.language);
    const nextIndex = (currentIndex + 1) % LANGUAGES.length;
    i18n.changeLanguage(LANGUAGES[nextIndex].code);
  };

  const handleLogout = async () => {
    try {
      await authService.logout();
      localStorage.removeItem('authToken');
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const displayTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const runPrediction = async () => {
    if (!selectedFund) return;
    setPredicting(true);
    setPredError(null);
    setPrediction(null);
    try {
      const res = await fetch(`${API_BASE}/api/sip/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheme_code: selectedFund.scheme_code,
          monthly_amount: monthly,
          years,
          simulations: 1000,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);
      setPrediction(await res.json());
    } catch (e: any) {
      setPredError(e.message || 'Prediction failed');
    } finally {
      setPredicting(false);
    }
  };

  const filteredFunds = funds.filter(f =>
    search === '' ||
    f.scheme_name.toLowerCase().includes(search.toLowerCase()) ||
    f.fund_house.toLowerCase().includes(search.toLowerCase())
  );

  const renderContent = () => {
    if (prediction) {
      return (
        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 [scrollbar-width:thin]">
            <MCPanel result={prediction} onBack={() => setPrediction(null)} darkMode={darkMode} />
          </div>
        </div>
      );
    }

    if (selectedFund) {
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col h-full overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5 [scrollbar-width:thin]">
        <button
          onClick={() => { setSelectedFund(null); setPrediction(null); setPredError(null); }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-500 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Back to funds
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Fund info */}
          <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-black text-gray-900 dark:text-white text-base leading-snug">
                  {selectedFund.scheme_name}
                </h3>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Building2 className="w-3.5 h-3.5 text-gray-400" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">{selectedFund.fund_house}</p>
                </div>
                <div className="flex gap-2 mt-2.5 flex-wrap">
                  <span className="text-xs bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 px-2.5 py-1 rounded-full font-semibold border border-brand-100 dark:border-brand-800">
                    {selectedFund.category}
                  </span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${RISK_COLORS[selectedFund.risk] ?? ''}`}>
                    {selectedFund.risk} Risk
                  </span>
                </div>
              </div>
              <div className="text-right flex-shrink-0 bg-white dark:bg-gray-900 rounded-2xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">NAV</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white mt-0.5">
                  ₹{selectedFund.nav_current?.toFixed(2)}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">{selectedFund.nav_date}</p>
              </div>
            </div>

            {/* CAGR trio */}
            <div className="grid grid-cols-3 gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
              {[
                { label: '1Y CAGR', value: selectedFund.cagr_1y },
                { label: '3Y CAGR', value: selectedFund.cagr_3y },
                { label: '5Y CAGR', value: selectedFund.cagr_5y },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="bg-white dark:bg-gray-900 rounded-xl p-3 text-center border border-gray-200 dark:border-gray-700"
                >
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 font-medium">{label}</p>
                  <p className={`text-xl font-black tabular-nums ${cagrColor(value)}`}>
                    {value !== null ? `${value > 0 ? '+' : ''}${value}%` : '—'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* SIP Calculator */}
          <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                <BarChart2 className="w-4 h-4 text-brand-500" />
              </div>
              <p className="font-bold text-gray-900 dark:text-white">SIP Return Simulator</p>
            </div>

            {/* Monthly amount */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">{t('finsip.monthly_sip')}</label>
                <span className="text-sm font-black text-brand-600 dark:text-brand-400 tabular-nums">
                  ₹{monthly.toLocaleString()}
                </span>
              </div>
              <input
                type="range" min={500} max={100000} step={500}
                value={monthly}
                onChange={e => setMonthly(Number(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer accent-brand-500 bg-gray-200 dark:bg-gray-700"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>₹500</span><span>₹1L</span>
              </div>
            </div>

            {/* Duration */}
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">{t('finsip.duration')}</label>
                <span className="text-sm font-black text-brand-600 dark:text-brand-400">{years} {t('finsip.years')}</span>
              </div>
              <input
                type="range" min={1} max={30} step={1}
                value={years}
                onChange={e => setYears(Number(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer accent-brand-500 bg-gray-200 dark:bg-gray-700"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>1Y</span><span>30Y</span>
              </div>
            </div>

            {/* Quick estimate pill */}
            <div className="bg-white dark:bg-gray-900 border border-brand-100 dark:border-brand-800 rounded-xl p-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{t('finsip.invested')}</p>
                <p className="text-base font-black text-gray-900 dark:text-white mt-0.5 tabular-nums">
                  {fmt(monthly * years * 12)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">
                  {t('finsip.est_return', { cagr: selectedFund.cagr_3y ?? 12 })}
                </p>
                <p className="text-base font-black text-emerald-600 dark:text-emerald-400 mt-0.5 tabular-nums">
                  {fmt(monthly * 12 * years * (1 + (selectedFund.cagr_3y ?? 12) / 100))}
                </p>
              </div>
            </div>

            {predError && (
              <p className="text-xs text-red-500 flex items-center gap-1.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{predError}
              </p>
            )}

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={runPrediction}
              disabled={predicting}
              className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-brand-500/20"
            >
              {predicting
                ? <><Loader2 className="w-4 h-4 animate-spin" />{t('finsip.running_sims')}</>
                : <><Sparkles className="w-4 h-4" />{t('finsip.run_monte_carlo')}</>
              }
            </motion.button>

            <p className="text-[10px] text-gray-400 text-center">
              {t('finsip.fan_chart_desc')}
            </p>
          </div>
        </div>
        </div>
      </motion.div>
    );
  }

  // ── Fund list view ──
  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div id="finsip-header" className="shrink-0 bg-gradient-to-r from-brand-500 via-brand-600 to-brand-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white tracking-tight">{t('finsip.top_performers')}</h2>
              <p className="text-xs text-brand-100 mt-0.5">{t('finsip.top_performers_desc')}</p>
            </div>
          </div>
          {!loading && !error && (
            <div className="text-right hidden sm:block">
              <p className="text-3xl font-black text-white tabular-nums">{filteredFunds.length}</p>
              <p className="text-xs text-brand-200 font-medium">{t('finsip.funds_tracked')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div id="finsip-filters" className="shrink-0 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
        {/* Category tabs */}
        <div className="flex gap-1.5 px-5 pt-3 pb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`flex-shrink-0 text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all duration-150 ${category === cat
                  ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/30'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700 hover:text-brand-600 dark:hover:text-brand-400'
                }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('finsip.search_placeholder')}
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition-all"
            />
          </div>
        </div>
      </div>

      {/* Fund grid */}
      <div className="flex-1 overflow-y-auto p-5 [scrollbar-width:thin]">
        {/* ── Loading Skeleton State ─────────────────────────────────── */}
        <AnimatePresence>
          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              {[...Array(6)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3"
                >
                  {/* rank badge + title */}
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse w-3/4" />
                      <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse w-1/2" />
                    </div>
                    <div className="w-14 h-8 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                  </div>
                  {/* badges */}
                  <div className="flex gap-2">
                    <div className="h-5 w-20 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse" />
                    <div className="h-5 w-16 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse" />
                  </div>
                  {/* CAGR bars */}
                  <div className="space-y-2 pt-1">
                    {[...Array(3)].map((_, j) => (
                      <div key={j} className="flex items-center gap-2">
                        <div className="w-4 h-2 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full animate-pulse" />
                        <div className="w-10 h-2.5 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
                      </div>
                    ))}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Error State ──────────────────────────────────────────────── */}
        <AnimatePresence>
          {!loading && error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl flex items-start gap-4"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-700 dark:text-red-400">{t('finsip.failed', 'Failed to load fund data')}</p>
                <p className="text-xs text-red-500 dark:text-red-500 mt-0.5">{error}</p>
                <button
                  onClick={() => fetchFunds(category)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
                >
                  <RefreshCw className="w-3 h-3" /> Try again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Fund Grid ────────────────────────────────────────────────── */}
        {!loading && !error && (
          <motion.div
            id="finsip-grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {filteredFunds.map((fund, i) => (
              <FundCard
                key={fund.scheme_code}
                fund={fund}
                rank={i}
                onClick={() => { setSelectedFund(fund); setPrediction(null); setPredError(null); }}
              />
            ))}

            {filteredFunds.length === 0 && (
              <div className="col-span-2 text-center py-16 text-gray-400">
                <Filter className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-semibold">{t('finsip.no_funds')} "{search}"</p>
                <p className="text-xs mt-1">{t('finsip.try_different')}</p>
              </div>
            )}
          </motion.div>
        )}
      </div>

      <div className="shrink-0 px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
        <p className="text-[10px] text-gray-400 text-center">
          {t('finsip.disclaimer')}
        </p>
      </div>
    </div>
  );
  };
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors duration-300 lg:h-screen lg:overflow-hidden">
      <Navbar
        darkMode={darkMode}
        toggleDark={toggleDark}
        showReset={false}
        onReset={() => { }}
        onMobileHamburgerClick={() => setMobileSidebarOpen(true)}
        useMobileActionsMenu={false}
        languages={LANGUAGES}
        currentLang={currentLang}
        onLangChange={(code) => i18n.changeLanguage(code)}
        onLogout={handleLogout}
      />

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
                  isCurrentPage="finsip"
                  onMobileClose={() => setMobileSidebarOpen(false)}
                  isMobile={true}
                />
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:h-[calc(100vh-4rem)] lg:py-6 lg:overflow-hidden">
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:h-full">
          {/* Sidebar */}
          <aside className="hidden lg:block lg:col-span-3 lg:sticky lg:top-0 lg:h-full">
            <Sidebar
              displayTime={displayTime}
              onReplayTour={() => setRunTour(true)}
              isCurrentPage="finsip"
            />
          </aside>

          {/* Scrollable Container with custom visual scrollbar width to stop layout overflow issues */}
          <section className="col-span-1 lg:col-span-9 lg:h-full lg:overflow-hidden lg:pr-3">
             <div className="w-full h-full pb-20 lg:pb-0">
               {renderContent()}
             </div>
          </section>
        </div>
      </main>
    </div>
  );
};
