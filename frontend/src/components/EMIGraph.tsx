import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  TrendingDown,
  TrendingUp,
  CheckCircle,
  ArrowRightLeft,
  Layers,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  TooltipProps,
} from 'recharts';
import { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { EMIAnalysis } from '../services/api';
import { formatINR } from '../services/api';

interface Props {
  emi: EMIAnalysis;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// FIX: Smart formatter — shows K/L/Cr depending on magnitude
function fmtAxis(v: number): string {
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(1)}Cr`;
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(1)}L`;
  if (v >= 1_000) return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${v}`;
}

function deviationColor(pct: number): string {
  if (pct > 5) return '#ef4444';
  if (pct > 1.5) return '#f59e0b';
  return '#22c55e';
}

// ── Typed Tooltip ─────────────────────────────────────────────────────────────

// FIX: remove all `any` — use Recharts generic types
const CustomTooltip = ({
  active,
  payload,
  label,
}: TooltipProps<ValueType, NameType>) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 dark:bg-gray-950 text-white px-3 py-2.5 rounded-xl text-xs shadow-xl border border-gray-700 min-w-[160px]">
      <p className="font-semibold mb-2 text-gray-200">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 mb-0.5">
          <span style={{ color: p.color ?? p.fill as string }} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: p.color ?? p.fill as string }}
            />
            {p.name}
          </span>
          <span className="font-mono font-bold text-white">
            {formatINR(Number(p.value))}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  variant?: 'default' | 'danger' | 'warn' | 'good';
  icon?: React.ElementType;
}

const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subtext,
  variant = 'default',
  icon: Icon,
}) => {
  const styles: Record<string, string> = {
    default: 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700',
    danger: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    warn: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    good: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
  };
  const valueColor: Record<string, string> = {
    default: 'text-gray-900 dark:text-white',
    danger: 'text-red-600 dark:text-red-400',
    warn: 'text-yellow-700 dark:text-yellow-400',
    good: 'text-green-700 dark:text-green-400',
  };

  return (
    <div className={`rounded-xl p-3 border ${styles[variant]}`}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}
        {label}
      </p>
      <p className={`text-sm font-bold ${valueColor[variant]}`}>{value}</p>
      {subtext && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight">
          {subtext}
        </p>
      )}
    </div>
  );
};

// ── Chart tab type ────────────────────────────────────────────────────────────

type ChartTab = 'emi' | 'repayment';

// ── Component ─────────────────────────────────────────────────────────────────

export const EMIGraph: React.FC<Props> = ({ emi }) => {
  const [activeTab, setActiveTab] = useState<ChartTab>('emi');

  const devColor = deviationColor(emi.emi_deviation_percent);

  // FIX: Split into two separate charts to fix scale mismatch.
  // Previously, monthly EMI (~₹15K) and total repayment (~₹5.4L)
  // were in the same chart, making EMI bars near-invisible.

  const emiChartData = [
    {
      name: 'Monthly EMI',
      Expected: emi.expected_emi,
      Stated: emi.stated_emi,
    },
  ];

  const repaymentChartData = [
    {
      name: 'Total Repayment',
      Expected: emi.total_expected_repayment,
      Stated: emi.total_stated_repayment,
    },
  ];

  const activeData = activeTab === 'emi' ? emiChartData : repaymentChartData;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            EMI Analysis
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Deterministic formula vs lender-stated values
          </p>
        </div>

        {/* Deviation Badge */}
        <div className="text-right flex-shrink-0">
          <div className="text-sm font-bold" style={{ color: devColor }}>
            {emi.emi_deviation_percent > 0 ? '+' : ''}
            {emi.emi_deviation_percent.toFixed(2)}% deviation
          </div>
          {emi.emi_flag ? (
            <span className="text-xs text-red-500 flex items-center gap-1 justify-end mt-0.5">
              <AlertCircle className="w-3 h-3" />
              Exceeds 1.5% RBI threshold
            </span>
          ) : (
            <span className="text-xs text-green-500 flex items-center gap-1 justify-end mt-0.5">
              <CheckCircle className="w-3 h-3" />
              Within threshold
            </span>
          )}
          {/* NEW: APR mismatch flag */}
          {emi.apr_mismatch && (
            <span className="text-xs text-orange-500 flex items-center gap-1 justify-end mt-0.5">
              <ArrowRightLeft className="w-3 h-3" />
              APR mismatch detected
            </span>
          )}
          {/* NEW: Repayment mismatch flag */}
          {emi.repayment_mismatch && (
            <span className="text-xs text-red-400 flex items-center gap-1 justify-end mt-0.5">
              <Layers className="w-3 h-3" />
              Repayment total mismatch
            </span>
          )}
        </div>
      </div>

      {/* Chart Tab Toggle */}
      <div className="flex bg-gray-100 dark:bg-gray-700/50 rounded-lg p-1 mb-4 w-fit">
        {(
          [
            { key: 'emi', label: 'Monthly EMI' },
            { key: 'repayment', label: 'Total Repayment' },
          ] as { key: ChartTab; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${activeTab === key
                ? 'bg-white dark:bg-gray-800 text-brand-600 dark:text-brand-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={activeData}
          margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
          barCategoryGap="40%"
          barGap={6}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#374151"
            opacity={0.25}
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={fmtAxis}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            width={55}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,102,241,0.05)' }} />
          <Legend
            wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
            formatter={(value) => (
              <span style={{ color: '#9ca3af' }}>{value}</span>
            )}
          />
          {/* FIX: reference line for expected value in EMI tab */}
          {activeTab === 'emi' && emi.expected_emi > 0 && (
            <ReferenceLine
              y={emi.expected_emi}
              stroke="#3b82f6"
              strokeDasharray="4 2"
              strokeOpacity={0.5}
            />
          )}
          <Bar
            dataKey="Expected"
            fill="#3b82f6"
            radius={[5, 5, 0, 0]}
            maxBarSize={80}
          />
          <Bar
            dataKey="Stated"
            fill={emi.emi_flag ? '#ef4444' : '#f59e0b'}
            radius={[5, 5, 0, 0]}
            maxBarSize={80}
          />
        </BarChart>
      </ResponsiveContainer>

      {/* NEW: Stat Summary Grid */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Effective Interest Rate"
          value={`${emi.effective_interest_rate.toFixed(2)}%`}
          subtext={emi.apr_mismatch ? 'Mismatch with disclosed APR' : 'Matches disclosed APR'}
          variant={emi.apr_mismatch ? 'danger' : 'good'}
          icon={emi.apr_mismatch ? TrendingUp : CheckCircle}
        />
        <StatCard
          label="Hidden Fee Impact"
          value={
            emi.hidden_fee_impact > 0
              ? formatINR(emi.hidden_fee_impact)
              : '₹0'
          }
          subtext={
            emi.hidden_fee_impact > 0
              ? 'Undisclosed charge contribution'
              : 'No hidden fee impact'
          }
          variant={emi.hidden_fee_impact > 0 ? 'warn' : 'good'}
          icon={emi.hidden_fee_impact > 0 ? AlertCircle : CheckCircle}
        />
        <StatCard
          label="Penal Stacking Impact"
          value={
            emi.penal_stacking_impact > 0
              ? formatINR(emi.penal_stacking_impact)
              : '₹0'
          }
          subtext={
            emi.penal_stacking_impact > 0
              ? 'Compounded penal charge effect'
              : 'No penal stacking detected'
          }
          variant={emi.penal_stacking_impact > 0 ? 'danger' : 'good'}
          icon={emi.penal_stacking_impact > 0 ? AlertCircle : CheckCircle}
        />
        <StatCard
          label="Overcharge Estimate"
          value={
            emi.overcharge_estimate > 0
              ? formatINR(emi.overcharge_estimate)
              : '₹0'
          }
          subtext={
            emi.overcharge_estimate > 0
              ? 'Total recoverable amount'
              : 'No overcharge detected'
          }
          variant={emi.overcharge_estimate > 0 ? 'danger' : 'good'}
          icon={emi.overcharge_estimate > 0 ? TrendingDown : CheckCircle}
        />
      </div>

      {/* Overcharge banner (only if significant) */}
      {emi.overcharge_estimate > 0 && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl"
        >
          <p className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Estimated Overcharge:{' '}
            {formatINR(emi.overcharge_estimate)}
          </p>
          <p className="text-xs text-red-500 dark:text-red-500 mt-0.5">
            Combines EMI deviation (
            {formatINR(Math.abs(emi.stated_emi - emi.expected_emi))} × tenure) +
            hidden fees (
            {formatINR(emi.hidden_fee_impact)}) + penal stacking (
            {formatINR(emi.penal_stacking_impact)}).
            This amount may be recoverable via RBI escalation.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};
