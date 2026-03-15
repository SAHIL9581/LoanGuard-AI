import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    AlertCircle,
    Info,
    ShieldAlert,
    BadgeCheck,
    Brain,
    ExternalLink,
    Lightbulb,
    HelpCircle,
    Zap,
} from 'lucide-react';
import type { Violation, Severity } from '../services/api';


interface Props {
    violations: Violation[];
}


// ── Config ────────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<
    Severity,
    {
        icon: React.ElementType;
        bg: string;
        border: string;
        badge: string;
        text: string;
        barColor: string;
        label: string;
        labelDescKey: string;
    }
> = {
    CRITICAL: {
        icon: ShieldAlert,
        bg: 'bg-red-50 dark:bg-red-900/20',
        border: 'border-red-200 dark:border-red-800',
        badge: 'bg-red-600 text-white',
        text: 'text-red-700 dark:text-red-400',
        barColor: 'bg-red-500',
        label: 'CRITICAL',
        labelDescKey: 'components.violations.severity_critical_desc',
    },
    HIGH: {
        icon: AlertTriangle,
        bg: 'bg-orange-50 dark:bg-orange-900/20',
        border: 'border-orange-200 dark:border-orange-800',
        badge: 'bg-orange-500 text-white',
        text: 'text-orange-700 dark:text-orange-400',
        barColor: 'bg-orange-500',
        label: 'HIGH',
        labelDescKey: 'components.violations.severity_high_desc',
    },
    MEDIUM: {
        icon: AlertCircle,
        bg: 'bg-yellow-50 dark:bg-yellow-900/20',
        border: 'border-yellow-200 dark:border-yellow-800',
        badge: 'bg-yellow-500 text-white',
        text: 'text-yellow-700 dark:text-yellow-400',
        barColor: 'bg-yellow-400',
        label: 'MEDIUM',
        labelDescKey: 'components.violations.severity_medium_desc',
    },
    LOW: {
        icon: Info,
        bg: 'bg-blue-50 dark:bg-blue-900/20',
        border: 'border-blue-200 dark:border-blue-800',
        badge: 'bg-blue-500 text-white',
        text: 'text-blue-700 dark:text-blue-400',
        barColor: 'bg-blue-400',
        label: 'LOW',
        labelDescKey: 'components.violations.severity_low_desc',
    },
};

const SEVERITY_ORDER: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
};


// ── Helpers ───────────────────────────────────────────────────────────────────

function confidenceBarColor(score: number): string {
    if (score >= 0.85) return 'bg-green-500';
    if (score >= 0.65) return 'bg-yellow-400';
    return 'bg-red-400';
}

function confidenceLabel(score: number, proven: boolean, t: any): string {
    if (proven) return t('components.violations.confidence_math_proven', '100% — Mathematically Proven');
    const pct = Math.round(score * 100);
    if (pct >= 85) return `${pct}% — ${t('components.violations.confidence_high', 'High Confidence')}`;
    if (pct >= 65) return `${pct}% — ${t('components.violations.confidence_moderate', 'Moderate Confidence')}`;
    return `${pct}% — ${t('components.violations.confidence_lower', 'Lower Confidence')}`;
}

function isMathProven(v: Violation): boolean {
    if (v.detection_method !== undefined) return v.detection_method === 'MATH_PROVEN';
    return v.is_deterministic === true;
}

function resolvePlainTitle(v: Violation): string {
    return v.plain_english?.trim() || v.issue_type;
}

function shouldShowTechnicalLabel(v: Violation): boolean {
    return !!v.plain_english?.trim() && v.plain_english !== v.issue_type;
}


// ── Filter Tabs ───────────────────────────────────────────────────────────────

type FilterTab = 'ALL' | Severity | 'PROVEN';


// ── Violation Card ────────────────────────────────────────────────────────────

interface ViolationCardProps {
    violation: Violation;
    index: number;
    isOpen: boolean;
    onToggle: () => void;
}

const ViolationCard = React.forwardRef<HTMLDivElement, ViolationCardProps>(
    ({ violation, index, isOpen, onToggle }, ref) => {
    const { t } = useTranslation();
    const [showExpert, setShowExpert] = useState(false);
    const cfg = SEVERITY_CONFIG[violation.severity] ?? SEVERITY_CONFIG.LOW;
    const Icon = cfg.icon;
    const proven = isMathProven(violation);

    const mainTitle = resolvePlainTitle(violation);
    const showTechnicalLabel = shouldShowTechnicalLabel(violation);

    return (
        <motion.div
            ref={ref}
            key={`${violation.issue_type}-${index}`}
            layout
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ delay: index * 0.04 }}
            className={`rounded-xl border ${cfg.bg} ${cfg.border} overflow-hidden`}
        >
            {/* ── Accordion Header ── */}
            <button
                className="w-full flex items-start gap-3 p-4 text-left"
                onClick={onToggle}
                aria-expanded={isOpen}
            >
                <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${cfg.text}`} />

                <div className="flex-1 min-w-0">
                    {/* Plain-English title — primary */}
                    <p className={`text-sm font-semibold leading-snug ${cfg.text}`}>
                        {mainTitle}
                    </p>

                    {/* Technical issue_type — secondary, only if different */}
                    {showTechnicalLabel && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 font-mono truncate">
                            {violation.issue_type}
                        </p>
                    )}

                    {/* Badges row */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {proven ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 px-1.5 py-0.5 rounded-full">
                                <BadgeCheck className="w-2.5 h-2.5" />
                                {t('components.violations.math_proven_badge', 'MATH PROVEN')}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 px-1.5 py-0.5 rounded-full">
                                <Brain className="w-2.5 h-2.5" />
                                {t('components.violations.ai_detected_badge', 'AI DETECTED')}
                            </span>
                        )}
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            {t(cfg.labelDescKey)}
                        </span>
                    </div>
                </div>

                {/* Right: financial impact + severity badge + chevron */}
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {violation.financial_impact > 0 && (
                        <span className="text-xs font-mono font-bold text-red-500 whitespace-nowrap">
                            ₹{violation.financial_impact.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${cfg.badge}`}>
                        {violation.severity}
                    </span>
                    {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                </div>
            </button>

            {/* ── Expanded Detail ── */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-4 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-4">

                            {/* ── What This Means ── */}
                            {violation.what_this_means && (
                                <div className="bg-white dark:bg-gray-800/60 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <HelpCircle className="w-3.5 h-3.5 text-gray-500" />
                                        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                                            {t('components.violations.what_this_means', 'What This Means')}
                                        </p>
                                    </div>
                                    <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
                                        {violation.what_this_means}
                                    </p>
                                </div>
                            )}

                            {/* ── Why It Matters ── */}
                            {violation.why_it_matters && (
                                <div className={`rounded-lg p-3 border ${cfg.bg} ${cfg.border}`}>
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <Zap className={`w-3.5 h-3.5 ${cfg.text}`} />
                                        <p className={`text-xs font-semibold uppercase tracking-wide ${cfg.text}`}>
                                            {t('components.violations.why_it_matters', 'Why It Matters to You')}
                                        </p>
                                    </div>
                                    <p className={`text-sm leading-relaxed ${cfg.text}`}>
                                        {violation.why_it_matters}
                                    </p>
                                </div>
                            )}

                            {/* ── Action Hint ── */}
                            {violation.action_hint && (
                                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <Lightbulb className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                                        <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">
                                            {t('components.violations.what_you_can_do', 'What You Can Do')}
                                        </p>
                                    </div>
                                    <p className="text-sm text-green-800 dark:text-green-200 leading-relaxed">
                                        {violation.action_hint}
                                    </p>
                                </div>
                            )}

                            {/* ── Financial Impact ── */}
                            {violation.financial_impact > 0 ? (
                                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 border border-red-100 dark:border-red-800">
                                    <span className="text-xs text-red-500 font-medium">💸 {t('components.violations.money_at_stake', 'Money at stake')}:</span>
                                    <span className="text-sm font-bold text-red-600 dark:text-red-400">
                                        ₹{violation.financial_impact.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                    </span>
                                    <span className="text-xs text-red-400">{t('components.violations.overcharged_at_risk', 'overcharged / at risk')}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                                    <span className="text-xs text-gray-500">⚖️ {t('components.violations.no_money_loss', 'No direct money loss — but this is a')}</span>
                                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                        {t('components.violations.regulatory_rights', 'regulatory rights violation')}
                                    </span>
                                </div>
                            )}

                            {/* ── Detection Confidence ── */}
                            <div>
                                <p className="text-xs text-gray-400 mb-1.5">{t('components.violations.detection_confidence', 'Detection Confidence')}</p>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all ${proven ? 'bg-blue-500' : confidenceBarColor(violation.confidence_score)
                                                }`}
                                            style={{ width: `${proven ? 100 : violation.confidence_score * 100}%` }}
                                        />
                                    </div>
                                    <span className="text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                        {confidenceLabel(violation.confidence_score, proven, t)}
                                    </span>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-1">
                                    {proven
                                        ? `⚡ ${t('components.violations.math_proven_desc', 'Detected via deterministic formula — not AI-dependent, 100% certain')}`
                                        : `🤖 ${t('components.violations.ai_detected_desc', 'Detected via AI analysis of document text against RBI guidelines')}`}
                                </p>
                            </div>

                            {/* ── Expert View (collapsible) ── */}
                            <div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowExpert((p) => !p); }}
                                    className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors font-medium"
                                >
                                    {showExpert ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    🔬 {t('components.violations.expert_details', 'Expert / Technical Details')}
                                </button>

                                <AnimatePresence>
                                    {showExpert && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.15 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 pl-2 border-l-2 border-gray-200 dark:border-gray-700">

                                                {/* Rule Triggered */}
                                                <div className="sm:col-span-2">
                                                    <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">
                                                        {t('components.violations.rule_triggered', 'Rule Triggered')}
                                                    </p>
                                                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 leading-relaxed">
                                                        {violation.rule_triggered || '—'}
                                                    </p>
                                                </div>

                                                {/* Clause Reference */}
                                                <div>
                                                    <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">
                                                        {t('components.violations.clause_reference', 'Clause Reference')}
                                                    </p>
                                                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                        {violation.clause_reference || '—'}
                                                    </p>
                                                </div>

                                                {/* RBI Circular */}
                                                <div>
                                                    <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">
                                                        {t('components.violations.rbi_circular', 'RBI Circular')}
                                                    </p>
                                                    {violation.circular_ref ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                                                                {violation.circular_ref}
                                                            </span>
                                                            <a
                                                                href="https://rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-indigo-400 hover:text-indigo-600 transition-colors"
                                                                title="Search on RBI website"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <ExternalLink className="w-3 h-3" />
                                                            </a>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-gray-400">—</span>
                                                    )}
                                                </div>

                                                {/* Detection Method */}
                                                <div>
                                                    <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">
                                                        {t('components.violations.detection_method', 'Detection Method')}
                                                    </p>
                                                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                        {violation.detection_method ?? (violation.is_deterministic ? 'MATH_PROVEN' : 'AI_DETECTED')}
                                                    </p>
                                                </div>

                                                {/* Raw Confidence Score */}
                                                <div>
                                                    <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">
                                                        {t('components.violations.raw_confidence', 'Raw Confidence Score')}
                                                    </p>
                                                    <p className="text-xs font-mono font-medium text-gray-700 dark:text-gray-300">
                                                        {proven ? '1.000' : violation.confidence_score.toFixed(3)}
                                                    </p>
                                                </div>

                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
});

ViolationCard.displayName = 'ViolationCard';


// ── Main Component ────────────────────────────────────────────────────────────

export const ViolationList: React.FC<Props> = ({ violations }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState<number | null>(0);
    const [activeFilter, setActiveFilter] = useState<FilterTab>('ALL');

    const sorted = [...violations].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4)
    );

    const filtered =
        activeFilter === 'ALL' ? sorted
            : activeFilter === 'PROVEN' ? sorted.filter(isMathProven)
                : sorted.filter((v) => v.severity === activeFilter);

    const provenCount = violations.filter(isMathProven).length;
    const aiCount = violations.length - provenCount;
    const totalFinancialImpact = violations.reduce((sum, v) => sum + (v.financial_impact ?? 0), 0);

    // ── Empty State ──────────────────────────────────────────────────────────

    if (violations.length === 0) {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-8 text-center"
            >
                <div className="text-4xl mb-3">✅</div>
                <p className="text-green-700 dark:text-green-400 font-semibold text-base">
                    {t('components.violations.no_violations_title', 'No violations detected')}
                </p>
                <p className="text-sm text-green-600 dark:text-green-500 mt-1">
                    {t('components.violations.no_violations_desc', 'This agreement appears compliant with reviewed RBI guidelines')}
                </p>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm"
        >
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
                <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">
                        {t('components.violations.problems_found', 'Problems Found in Your Agreement')}{' '}
                        <span className="text-gray-400 dark:text-gray-500 font-normal">
                            ({violations.length})
                        </span>
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-sm">
                        {t('components.violations.problems_desc', 'Each item below is a rule your bank may have broken. Tap any item to understand what it means for you.')}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                        {provenCount > 0 && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 font-medium">
                                <BadgeCheck className="w-3 h-3" />
                                {provenCount} {t('components.violations.math_proven_count', 'mathematically proven')}
                            </span>
                        )}
                        {aiCount > 0 && (
                            <span className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1 font-medium">
                                <Brain className="w-3 h-3" />
                                {aiCount} {t('components.violations.ai_detected_count', 'AI-detected')}
                            </span>
                        )}
                        {totalFinancialImpact > 0 && (
                            <span className="text-xs text-red-500 font-semibold">
                                💸 {t('components.violations.total_money_at_stake', 'Total money at stake')}: ₹{totalFinancialImpact.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </span>
                        )}
                    </div>
                </div>

                {/* Severity count badges */}
                <div className="flex flex-wrap gap-2 flex-shrink-0">
                    {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]).map((sev) => {
                        const count = violations.filter((v) => v.severity === sev).length;
                        if (count === 0) return null;
                        return (
                            <span
                                key={sev}
                                className={`text-xs px-2 py-0.5 rounded-full font-bold ${SEVERITY_CONFIG[sev].badge}`}
                            >
                                {count} {sev}
                            </span>
                        );
                    })}
                </div>
            </div>

            {/* ── Filter Tabs ── */}
            <div className="flex flex-wrap gap-2 mb-4">
                {(
                    [
                        { key: 'ALL' as FilterTab, label: `All (${violations.length})` },
                        ...(provenCount > 0
                            ? [{ key: 'PROVEN' as FilterTab, label: `⚡ Proven (${provenCount})` }]
                            : []),
                        ...(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[])
                            .filter((s) => violations.some((v) => v.severity === s))
                            .map((s) => ({
                                key: s as FilterTab,
                                label: `${s} (${violations.filter((v) => v.severity === s).length})`,
                            })),
                    ]
                ).map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => { setActiveFilter(key); setExpanded(null); }}
                        className={`text-xs px-3 py-1 rounded-full font-medium border transition-all ${activeFilter === key
                            ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white'
                            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
                            }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* ── Violation Cards ── */}
            <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                    {filtered.map((violation, i) => (
                        <ViolationCard
                            key={`${violation.issue_type}-${i}`}
                            violation={violation}
                            index={i}
                            isOpen={expanded === i}
                            onToggle={() => setExpanded(expanded === i ? null : i)}
                        />
                    ))}
                </AnimatePresence>
            </div>

            {/* ── Footer ── */}
            <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-4 text-center">
                ⚡ {t('components.violations.footer_math', 'Math-proven = 100% certain via formula')} &nbsp;·&nbsp; 🤖 {t('components.violations.footer_ai', 'AI-detected = ≥65% confidence threshold applied')}
            </p>
        </motion.div>
    );
};
