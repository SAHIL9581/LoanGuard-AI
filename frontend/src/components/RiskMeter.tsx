import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import type { RiskScore } from '../services/api';


interface Props {
  risk: RiskScore;
}


// ── Config ────────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  LOW: '#22c55e',
  MEDIUM: '#f59e0b',
  HIGH: '#ef4444',
  CRITICAL: '#dc2626',
};

const CATEGORY_BG: Record<string, string> = {
  LOW: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  MEDIUM: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
  HIGH: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  CRITICAL: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700',
};

// Fallback plain category labels if backend field is missing
const CATEGORY_PLAIN_FALLBACK: Record<string, string> = {
  LOW: 'LOW RISK — Your loan agreement looks mostly fine',
  MEDIUM: 'MEDIUM RISK — Your agreement has some problems worth addressing',
  HIGH: 'HIGH RISK — Your agreement has serious problems that cost you money',
  CRITICAL: 'CRITICAL RISK — Your agreement breaks multiple major laws and needs urgent action',
};

function barColor(ratio: number): string {
  if (ratio >= 0.75) return '#ef4444';
  if (ratio >= 0.45) return '#f59e0b';
  return '#22c55e';
}

const GAUGE_TRACK = 'var(--gauge-track, #e5e7eb)';


// ── Tooltip ───────────────────────────────────────────────────────────────────

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number }[];
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow text-xs text-gray-700 dark:text-gray-300">
      Risk Score: <span className="font-bold">{payload[0].value.toFixed(1)}</span> / 100
    </div>
  );
};


// ── Component ─────────────────────────────────────────────────────────────────

export const RiskMeter: React.FC<Props> = ({ risk }) => {
  const { t } = useTranslation();
  const [showBreakdown, setShowBreakdown] = useState(false);

  const color = CATEGORY_COLORS[risk.risk_category] ?? '#6b7280';
  const bg = CATEGORY_BG[risk.risk_category] ?? '';

  // Safely read new plain English fields (backward-compatible)
  const riskCategoryPlain = (risk as any).risk_category_plain as string | undefined;
  const riskSummaryPlain = (risk as any).risk_summary_plain as string | undefined;
  const scoreBreakdownPlain = (risk as any).score_breakdown_plain as string[] | undefined;
  const appealPlain = (risk as any).appeal_plain as string | undefined;

  // behavioral_risk_score — handle both field names
  const behavioralScore: number =
    (risk as any).behavioral_risk_score ??
    (risk as any).behavioral_score ??
    0;

  const gaugeData = [{ value: Math.min(risk.total_score, 100), fill: color }];

  const breakdown: {
    label: string;
    plainLabel: string;
    score: number;
    max: number;
    technicalDesc: string;
    isNew?: boolean;
  }[] = [
      {
        label: t('loanguard.risk.payment_diff', 'EMI Deviation'),
        plainLabel: scoreBreakdownPlain?.[0] ?? 'Monthly payment accuracy',
        score: risk.emi_deviation_score,
        max: 25,
        technicalDesc: 'Difference between stated and RBI-formula EMI',
      },
      {
        label: t('loanguard.risk.hidden_fees', 'Hidden Fees'),
        plainLabel: scoreBreakdownPlain?.[1] ?? 'Hidden and undisclosed fees',
        score: risk.hidden_fee_score,
        max: 20,
        technicalDesc: 'Processing fee above permitted cap + undisclosed charges',
      },
      {
        label: t('loanguard.risk.rule_breaks', 'RBI Violations'),
        plainLabel: scoreBreakdownPlain?.[2] ?? 'RBI rule violations',
        score: risk.rbi_violation_score,
        max: 25,
        technicalDesc: 'Weighted count of RBI guideline breaches',
      },
      {
        label: t('loanguard.risk.unfair_penalties', 'Penal Stacking'),
        plainLabel: scoreBreakdownPlain?.[3] ?? 'Penalty stacking on missed payments',
        score: risk.penal_stacking_score,
        max: 10,
        technicalDesc: 'Compounded penal charges on overdue payments',
      },
      {
        label: t('loanguard.risk.missing_info', 'Transparency'),
        plainLabel: scoreBreakdownPlain?.[4] ?? 'How transparent the bank is about costs',
        score: risk.transparency_score,
        max: 10,
        technicalDesc: 'Missing KFS, APR, foreclosure clause disclosures',
      },
      {
        label: t('loanguard.risk.hidden_meaning', 'Ambiguity'),
        plainLabel: scoreBreakdownPlain?.[5] ?? 'How many vague or one-sided clauses exist',
        score: risk.ambiguity_score,
        max: 10,
        technicalDesc: 'Vague conditions that put the borrower at risk',
      },
      {
        label: t('loanguard.risk.behavioral', 'Behavioral Risk'),
        plainLabel: scoreBreakdownPlain?.[6] ?? 'Threatening or manipulative language',
        score: behavioralScore,
        max: 10,
        technicalDesc: 'Threatening language, consent misuse, data abuse clauses',
        isNew: true,
      },
    ];

  const totalMaxPoints = breakdown.reduce((s, b) => s + b.max, 0); // 110

  // Derive the appeal callout type from probability
  const appealPct = Math.round(risk.appeal_success_probability * 100);
  const appealCalloutColor =
    appealPct >= 80 ? 'text-green-600 dark:text-green-400' :
      appealPct >= 60 ? 'text-blue-600 dark:text-blue-400' :
        appealPct >= 40 ? 'text-yellow-600 dark:text-yellow-400' :
          'text-gray-600 dark:text-gray-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm"
    >
      <style>{`
        :root { --gauge-track: #e5e7eb; }
        .dark  { --gauge-track: #374151; }
      `}</style>

      <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">
        {t('loanguard.risk.title', 'Risk Intelligence Score')}
      </h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
        How risky is this loan agreement for you?
      </p>

      <div className="flex flex-col items-center gap-6">

        {/* ── Gauge ── */}
        <div className="relative w-40 h-40 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%" cy="50%"
              innerRadius="65%" outerRadius="85%"
              data={gaugeData}
              startAngle={220} endAngle={-40}
            >
              <PolarAngleAxis
                type="number" domain={[0, 100]}
                angleAxisId={0} tick={false}
              />
              <RadialBar
                background={{ fill: GAUGE_TRACK }}
                dataKey="value"
                angleAxisId={0}
                cornerRadius={8}
              />
              <Tooltip content={<CustomTooltip />} />
            </RadialBarChart>
          </ResponsiveContainer>

          {/* Center Score */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <motion.span
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, type: 'spring' }}
              className="text-3xl font-black leading-none"
              style={{ color }}
            >
              {Math.round(Math.min(risk.total_score, 100))}
            </motion.span>
            <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">/ 100</span>
            {risk.total_score > 100 && (
              <span className="text-[9px] text-red-400 font-medium mt-0.5">(capped)</span>
            )}
          </div>
        </div>

        {/* ── Risk category plain label ── */}
        <div className="w-full space-y-3">
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-bold ${bg}`}
            style={{ color }}
          >
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />
            {riskCategoryPlain ?? CATEGORY_PLAIN_FALLBACK[risk.risk_category] ?? `${risk.risk_category} RISK`}
          </div>

          {/* ── Risk summary plain paragraph (NEW) ── */}
          {riskSummaryPlain && (
            <div className={`rounded-xl border p-3 ${bg}`}>
              <p className="text-sm leading-relaxed" style={{ color }}>
                {riskSummaryPlain}
              </p>
            </div>
          )}
        </div>

        {/* ── Score Breakdown ── */}
        <div className="w-full">
          {/* Collapsible toggle */}
          <button
            onClick={() => setShowBreakdown((p) => !p)}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors mb-3 w-full justify-between"
          >
            <span className="uppercase tracking-wide">Score Breakdown</span>
            <span className="flex items-center gap-1 text-gray-400">
              <Info className="w-3 h-3" />
              {showBreakdown ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </span>
          </button>

          <AnimatePresence>
            {showBreakdown && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="space-y-4 pb-2">
                  {breakdown.map(({ label, plainLabel, score, max, technicalDesc, isNew }) => {
                    const ratio = max > 0 ? score / max : 0;
                    const fill = barColor(ratio);

                    return (
                      <div key={label}>
                        {/* Plain label — prominent */}
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-700 dark:text-gray-200 leading-snug">
                              {plainLabel}
                            </p>
                            {/* Technical name — small, muted, below plain label */}
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 font-mono">
                              {label}
                              {isNew && (
                                <span className="ml-1.5 text-[9px] bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 px-1 rounded font-bold">
                                  NEW
                                </span>
                              )}
                            </p>
                          </div>
                          {/* Score — right aligned */}
                          <span
                            className="text-sm font-mono font-bold flex-shrink-0"
                            style={{ color: fill }}
                          >
                            {score.toFixed(1)}
                            <span className="text-xs font-normal text-gray-400">/{max}</span>
                          </span>
                        </div>

                        {/* Bar */}
                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${ratio * 100}%` }}
                            transition={{ duration: 0.8, delay: 0.2 }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: fill }}
                          />
                        </div>

                        {/* Technical description — shown below bar, very small */}
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                          {technicalDesc}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                  Components sum to {totalMaxPoints} pts — final score capped at 100
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* When collapsed — show mini pills for non-zero components only */}
          {!showBreakdown && (
            <div className="flex flex-wrap gap-1.5">
              {breakdown
                .filter((b) => b.score > 0)
                .map(({ label, score, max }) => {
                  const ratio = max > 0 ? score / max : 0;
                  const fill = barColor(ratio);
                  return (
                    <span
                      key={label}
                      className="text-[10px] px-2 py-0.5 rounded-full font-mono border"
                      style={{
                        color: fill,
                        borderColor: fill + '55',
                        backgroundColor: fill + '11',
                      }}
                    >
                      {label}: {score.toFixed(1)}/{max}
                    </span>
                  );
                })}
            </div>
          )}
        </div>

        {/* ── Appeal + Behavioral cards ── */}
        <div className="w-full grid grid-cols-2 gap-3">

          {/* Appeal Success */}
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 flex flex-col gap-1">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              Complaint Success Chance
            </p>
            <p className={`text-2xl font-black text-center leading-none ${appealCalloutColor}`}>
              {appealPct}%
            </p>
            {/* appeal_plain — the most valuable field here */}
            {appealPlain ? (
              <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug mt-1">
                {appealPlain}
              </p>
            ) : (
              <p className="text-[10px] text-gray-400 text-center mt-1">
                {appealPct >= 80
                  ? 'Very strong — file a complaint'
                  : appealPct >= 60
                    ? 'Solid case — worth filing'
                    : appealPct >= 40
                      ? 'Moderate — document carefully'
                      : 'Low — consult an advisor'}
              </p>
            )}
          </div>

          {/* Behavioral Risk */}
          <div
            className={`p-3 rounded-xl border flex flex-col gap-1 ${behavioralScore > 0
                ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
                : 'bg-gray-50 dark:bg-gray-700/40 border-gray-200 dark:border-gray-700'
              }`}
          >
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              Threatening Language
            </p>
            <p
              className={`text-2xl font-black text-center leading-none ${behavioralScore > 0
                  ? 'text-purple-600 dark:text-purple-400'
                  : 'text-green-600 dark:text-green-400'
                }`}
            >
              {behavioralScore.toFixed(1)}
              <span className="text-xs font-normal text-gray-400 ml-0.5">/10</span>
            </p>
            <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug mt-1">
              {behavioralScore >= 7
                ? '🔴 Agreement uses serious threats and manipulation'
                : behavioralScore >= 4
                  ? '⚠️ Some aggressive or intimidating language found'
                  : behavioralScore > 0
                    ? '⚠️ Minor concerning language detected'
                    : '✅ No threatening language found'}
            </p>
          </div>
        </div>

      </div>
    </motion.div>
  );
};
