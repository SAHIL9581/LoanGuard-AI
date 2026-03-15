import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  User,
  Calendar,
  TrendingUp,
  BadgeCheck,
  XCircle,
  ShieldAlert,
  FileWarning,
  Umbrella,
  CalendarClock,
  ArrowRightLeft,
  Smartphone,
  Users,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LoanExtraction, EMIAnalysis } from '../services/api';
import { formatINR } from '../services/api';


interface Props {
  extraction: LoanExtraction;
  emi: EMIAnalysis;
}


const fmtRate = (n: number) => `${n.toFixed(2)}%`;


// ── Tile types ────────────────────────────────────────────────────────────────

type TileVariant = 'default' | 'warn' | 'danger' | 'good';

interface FieldTile {
  label: string;
  value: string;
  variant?: TileVariant;
  tooltip?: string;
  plainNote?: string;   // NEW: short plain sentence shown inline under the value
}

function tileClasses(variant: TileVariant = 'default'): {
  wrapper: string;
  label: string;
  value: string;
} {
  switch (variant) {
    case 'danger':
      return {
        wrapper: 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800',
        label: 'text-red-400 dark:text-red-500',
        value: 'text-red-600 dark:text-red-400',
      };
    case 'warn':
      return {
        wrapper: 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800',
        label: 'text-yellow-500 dark:text-yellow-600',
        value: 'text-yellow-700 dark:text-yellow-400',
      };
    case 'good':
      return {
        wrapper: 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800',
        label: 'text-green-500 dark:text-green-600',
        value: 'text-green-700 dark:text-green-400',
      };
    default:
      return {
        wrapper: 'bg-gray-50 dark:bg-gray-700/50',
        label: 'text-gray-500 dark:text-gray-400',
        value: 'text-gray-900 dark:text-white',
      };
  }
}


// ── Deviation verdict → tile variant ─────────────────────────────────────────

function deviationVariant(verdict: string | undefined): TileVariant {
  switch (verdict) {
    case 'CRITICAL':
    case 'SIGNIFICANT': return 'danger';
    case 'MINOR': return 'warn';
    default: return 'default';
  }
}


// ── Flag pill ─────────────────────────────────────────────────────────────────

interface FlagPill {
  show: boolean;
  icon: React.ElementType;
  label: string;
  color: string;
}


// ── Plain callout component ───────────────────────────────────────────────────
// Used to surface emi_plain_summary and overcharge_plain as visible banners.

interface CalloutProps {
  type: 'info' | 'warn' | 'danger' | 'good';
  text: string;
}

const Callout: React.FC<CalloutProps> = ({ type, text }) => {
  const styles = {
    info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
    warn: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300',
    danger: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
    good: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
  };
  const icons = {
    info: <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />,
    warn: <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />,
    danger: <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />,
    good: <BadgeCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />,
  };
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${styles[type]}`}>
      {icons[type]}
      <p className="text-xs leading-relaxed">{text}</p>
    </div>
  );
};


// ── Component ─────────────────────────────────────────────────────────────────

export const LoanSummaryCard: React.FC<Props> = ({ extraction, emi }) => {
  const { t } = useTranslation();
  const [showAllDisclosures, setShowAllDisclosures] = useState(false);

  // Safely read new plain English fields (backward-compatible)
  const emiPlainSummary = (emi as any).emi_plain_summary as string | undefined;
  const overchargePlain = (emi as any).overcharge_plain as string | undefined;
  const deviationVerdict = (emi as any).deviation_verdict as string | undefined;

  // Determine callout type for EMI summary
  const emiCalloutType: CalloutProps['type'] =
    deviationVerdict === 'CRITICAL' ? 'danger' :
      deviationVerdict === 'SIGNIFICANT' ? 'danger' :
        deviationVerdict === 'MINOR' ? 'warn' :
          'good';

  // ── Core financial tiles ──────────────────────────────────────────────────

  const coreTiles: FieldTile[] = [
    {
      label: t('loanguard.summary.principal', 'Loan Amount'),
      value: formatINR(extraction.principal),
      variant: extraction.principal > 0 ? 'default' : 'warn',
      plainNote: extraction.principal > 0
        ? 'The total money you borrowed'
        : 'Could not detect your loan amount',
    },
    {
      label: t('loanguard.summary.interest_rate', 'Interest Rate (yearly)'),
      value: extraction.interest_rate > 0
        ? fmtRate(extraction.interest_rate)
        : 'Not disclosed',
      variant: extraction.interest_rate > 0 ? 'default' : 'danger',
      plainNote: extraction.interest_rate > 0
        ? `You pay ${fmtRate(extraction.interest_rate)} of your balance as interest each year`
        : '⚠️ Bank did not clearly state the interest rate',
    },
    {
      label: t('loanguard.summary.effective_apr', 'True Cost Rate (APR)'),
      value: emi.effective_interest_rate > 0
        ? fmtRate(emi.effective_interest_rate)
        : 'Not calculable',
      variant: emi.apr_mismatch ? 'danger' : 'default',
      plainNote: emi.apr_mismatch
        ? '⚠️ Real cost is higher than what the bank stated — hidden charges are inflating it'
        : 'Includes all fees — this is what you truly pay',
    },
    {
      label: t('loanguard.summary.tenure', 'Loan Duration'),
      value: extraction.tenure_months > 0
        ? `${extraction.tenure_months} months`
        : 'Not stated',
      variant: extraction.tenure_months > 0 ? 'default' : 'warn',
      plainNote: extraction.tenure_months > 0
        ? `You will be paying EMIs for ${Math.round(extraction.tenure_months / 12 * 10) / 10} year(s)`
        : undefined,
    },
    {
      label: t('loanguard.summary.expected_emi', 'Correct Monthly Payment'),
      value: emi.expected_emi > 0 ? formatINR(emi.expected_emi) : '—',
      variant: 'default',
      plainNote: 'What your EMI should be, calculated by us using the standard formula',
    },
    {
      label: t('loanguard.summary.stated_emi', "Bank's Monthly Payment"),
      value: emi.stated_emi > 0 ? formatINR(emi.stated_emi) : '—',
      variant: deviationVariant(deviationVerdict),
      plainNote: emi.emi_flag
        ? `⚠️ ${emi.emi_deviation_percent.toFixed(2)}% higher than the correct amount`
        : '✓ Matches the correct calculation',
    },
    {
      label: t('loanguard.summary.processing_fee', 'Setup / Processing Fee'),
      value: extraction.processing_fee > 0
        ? formatINR(extraction.processing_fee)
        : extraction.processing_fee_percent > 0
          ? fmtRate(extraction.processing_fee_percent)
          : '₹0',
      variant: 'default',
      plainNote: extraction.processing_fee > 0
        ? 'Deducted upfront — you received less than your loan amount'
        : undefined,
    },
    {
      label: t('loanguard.summary.overcharge_est', 'Total Overcharge'),
      value: emi.overcharge_estimate > 0
        ? formatINR(emi.overcharge_estimate)
        : '₹0',
      variant: emi.overcharge_estimate > 0 ? 'danger' : 'good',
      plainNote: emi.overcharge_estimate > 0
        ? 'Extra money charged beyond what is legally allowed — you can demand this back'
        : '✓ No significant overcharge detected',
    },
  ];


  // ── Disclosure / compliance tiles ─────────────────────────────────────────

  const disclosureTiles: FieldTile[] = [
    {
      label: t('loanguard.summary.kfs', 'Key Facts Page (KFS)'),
      value: extraction.kfs_present ? 'Present ✓' : 'Missing ✗',
      variant: extraction.kfs_present ? 'good' : 'danger',
      plainNote: extraction.kfs_present
        ? 'Bank gave you the required 1-page loan summary'
        : '⚠️ Bank legally must give you this — it is missing',
    },
    {
      label: t('loanguard.summary.penal_rate', 'Late Payment Penalty'),
      value: extraction.penal_interest_rate > 0
        ? `${fmtRate(extraction.penal_interest_rate)} p.a.`
        : 'Not stated',
      variant:
        extraction.penal_interest_rate > 36 ? 'danger' :
          extraction.penal_interest_rate > 0 ? 'warn' : 'default',
      plainNote:
        extraction.penal_interest_rate > 36
          ? '⚠️ Over 3%/month — RBI says this is too high'
          : extraction.penal_interest_rate > 0
            ? 'Check that this is not also compounding into your balance'
            : undefined,
    },
    {
      label: t('loanguard.summary.bounce_charge', 'Missed Payment Fee'),
      value: extraction.bounce_charge > 0
        ? formatINR(extraction.bounce_charge)
        : 'Not stated',
      variant: extraction.bounce_charge > 500 ? 'danger' : 'default',
      plainNote: extraction.bounce_charge > 500
        ? `⚠️ RBI cap is ₹500 — you're being charged ₹${extraction.bounce_charge - 500} extra`
        : extraction.bounce_charge > 0
          ? 'Charged if your EMI payment fails — within legal limit'
          : undefined,
    },
    {
      label: t('loanguard.summary.prepayment_penalty', 'Early Closure Penalty'),
      value:
        (extraction as any).prepayment_penalty_percent > 0
          ? fmtRate((extraction as any).prepayment_penalty_percent)
          : 'Nil',
      variant:
        (extraction as any).prepayment_penalty_percent > 0 && extraction.floating_rate
          ? 'danger'
          : (extraction as any).prepayment_penalty_percent > 0
            ? 'warn'
            : 'good',
      plainNote:
        (extraction as any).prepayment_penalty_percent > 0 && extraction.floating_rate
          ? '⚠️ Charging you for early closure on a floating-rate loan is illegal under RBI'
          : (extraction as any).prepayment_penalty_percent > 0
            ? 'You will be penalised if you try to pay off this loan early'
            : '✓ No penalties for paying off early',
    },
    {
      label: t('loanguard.summary.insurance_premium', 'Bundled Insurance'),
      value:
        extraction.insurance_premium > 0
          ? formatINR(extraction.insurance_premium)
          : 'None',
      variant: extraction.insurance_premium > 0 ? 'warn' : 'default',
      plainNote: extraction.insurance_premium > 0
        ? '⚠️ Was this insurance added without clearly asking you? You may be able to reject it'
        : '✓ No insurance bundled into this loan',
    },
    {
      label: t('loanguard.summary.moratorium', 'Payment Holiday'),
      value:
        extraction.moratorium_period_months > 0
          ? `${extraction.moratorium_period_months} months`
          : 'None',
      variant: extraction.moratorium_period_months > 0 ? 'warn' : 'default',
      plainNote: extraction.moratorium_period_months > 0
        ? '⚠️ Interest during this break may be quietly added to your loan balance'
        : undefined,
    },
  ];


  // ── Flag pills ─────────────────────────────────────────────────────────────

  const flags: FlagPill[] = [
    {
      show: extraction.floating_rate,
      icon: TrendingUp,
      label: extraction.rate_reset_clause
        ? `Floating Rate (reset defined)`
        : 'Floating Rate — No Reset Clause ⚠️',
      color: extraction.rate_reset_clause
        ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    },
    {
      show: extraction.bank_discretion_clause,
      icon: ShieldAlert,
      label: 'Bank can change your interest rate anytime',
      color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    },
    {
      show: extraction.auto_debit_consent,
      icon: Smartphone,
      label: 'Auto-debit authorised',
      color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    },
    {
      show: extraction.recovery_agent_clause,
      icon: Users,
      label: 'Debt collectors authorised',
      color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
    },
    {
      show: (extraction as any).prepayment_penalty_percent > 0 && extraction.floating_rate,
      icon: FileWarning,
      label: 'Illegal early closure charge',
      color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    },
    {
      show: extraction.insurance_premium > 0,
      icon: Umbrella,
      label: 'Insurance bundled in',
      color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    },
    {
      show:
        !!(extraction as any).interest_start_date &&
        !!(extraction as any).disbursement_date &&
        (extraction as any).interest_start_date < (extraction as any).disbursement_date,
      icon: CalendarClock,
      label: 'Interest charged before disbursement ⚠️',
      color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    },
    {
      show: emi.apr_mismatch,
      icon: ArrowRightLeft,
      label: `True rate higher than stated — ${emi.emi_deviation_percent.toFixed(1)}% deviation`,
      color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    },
  ];

  const activeFlags = flags.filter((f) => f.show);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm"
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-5 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Building2 className="w-4 h-4 text-brand-500 flex-shrink-0" />
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
              {extraction.lender_name || 'Unknown Lender'}
            </span>
            {extraction.kfs_present ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                <BadgeCheck className="w-2.5 h-2.5" />
                KFS Present
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-700 px-1.5 py-0.5 rounded-full flex-shrink-0"
                title="Key Facts Statement missing — this is a violation">
                <XCircle className="w-2.5 h-2.5" />
                No KFS — Violation
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white capitalize">
            {t(
              `loanguard.summary.${extraction.loan_type.toLowerCase()}`,
              extraction.loan_type.replace(/_/g, ' ')
            )}{' '}
            Agreement
          </h3>
        </div>

        <div className="text-right text-sm text-gray-400 flex-shrink-0">
          <div className="flex items-center gap-1 justify-end">
            <User className="w-3 h-3" />
            <span className="max-w-[120px] truncate">
              {extraction.borrower_name || 'N/A'}
            </span>
          </div>
          <div className="flex items-center gap-1 justify-end mt-1">
            <Calendar className="w-3 h-3" />
            <span>{extraction.agreement_date || 'N/A'}</span>
          </div>
          {(extraction as any).disbursement_date && (
            <div className="flex items-center gap-1 justify-end mt-1">
              <CalendarClock className="w-3 h-3" />
              <span className="text-xs">
                Disbursed: {(extraction as any).disbursement_date}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── EMI Plain Summary callout (NEW) ── */}
      {/* Shown only when there is a deviation — most impactful info surfaced first */}
      {emiPlainSummary && deviationVerdict && deviationVerdict !== 'OK' && (
        <div className="mb-4">
          <Callout type={emiCalloutType} text={emiPlainSummary} />
        </div>
      )}
      {emiPlainSummary && (!deviationVerdict || deviationVerdict === 'OK') && (
        <div className="mb-4">
          <Callout type="good" text={emiPlainSummary} />
        </div>
      )}

      {/* ── Core Financial Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {coreTiles.map(({ label, value, variant, plainNote }) => {
          const cls = tileClasses(variant);
          return (
            <div
              key={label}
              className={`rounded-xl p-3 ${cls.wrapper}`}
            >
              <p className={`text-xs mb-1 ${cls.label}`}>{label}</p>
              <p className={`text-sm font-bold break-words ${cls.value}`}>
                {value}
              </p>
              {plainNote && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">
                  {plainNote}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Overcharge Plain callout (NEW) ── */}
      {/* Shown only when there is a meaningful overcharge */}
      {overchargePlain && emi.overcharge_estimate > 500 && (
        <div className="mb-4">
          <Callout type="danger" text={overchargePlain} />
        </div>
      )}

      {/* ── Safety Rules Grid ── */}
      <div className="mb-4">
        <button
          onClick={() => setShowAllDisclosures((p) => !p)}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {showAllDisclosures ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          Safety Rules Check
          <span className="text-[10px] font-normal normal-case text-gray-400">
            — did your bank follow the rules?
          </span>
        </button>

        <AnimatePresence>
          {showAllDisclosures && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {disclosureTiles.map(({ label, value, variant, plainNote }) => {
                  const cls = tileClasses(variant);
                  return (
                    <div
                      key={label}
                      className={`rounded-xl p-3 ${cls.wrapper}`}
                    >
                      <p className={`text-xs mb-1 ${cls.label}`}>{label}</p>
                      <p className={`text-sm font-bold break-words ${cls.value}`}>
                        {value}
                      </p>
                      {plainNote && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">
                          {plainNote}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Always-visible quick summary when collapsed */}
        {!showAllDisclosures && (
          <div className="flex flex-wrap gap-2">
            {disclosureTiles.map(({ label, value, variant }) => (
              <span
                key={label}
                className={`text-xs px-2 py-0.5 rounded-full font-medium border ${variant === 'danger'
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
                    : variant === 'warn'
                      ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400'
                      : variant === 'good'
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                        : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
              >
                {label}: {value}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Flag Pills ── */}
      {activeFlags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFlags.map(({ icon: Icon, label, color }) => (
            <span
              key={label}
              className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium ${color}`}
            >
              <Icon className="w-3 h-3 flex-shrink-0" />
              {label}
            </span>
          ))}
        </div>
      )}

      {/* ── Repayment Totals Footer ── */}
      {(emi.total_expected_repayment > 0 || emi.total_stated_repayment > 0) && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">
              What you <strong>should</strong> pay back (total)
            </p>
            <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
              {formatINR(emi.total_expected_repayment)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">
              What the bank <strong>claims</strong> you owe (total)
            </p>
            <p
              className={`text-sm font-bold ${emi.repayment_mismatch
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-700 dark:text-gray-300'
                }`}
            >
              {formatINR(emi.total_stated_repayment)}
              {emi.repayment_mismatch && (
                <span className="text-[10px] font-normal text-red-400 ml-1.5">
                  ⚠️ higher than correct
                </span>
              )}
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
};
