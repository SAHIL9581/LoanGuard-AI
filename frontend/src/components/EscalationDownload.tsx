import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  ChevronDown,
  ChevronUp,
  Mail,
  Building,
  Scale,
  Loader2,
  CheckCircle,
  MapPin,
  Users,
  Landmark,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  Clock,
  Target,
  Lightbulb,
  ArrowRight,
} from 'lucide-react';
import type { EscalationLevel, LoanExtraction } from '../services/api';
import { auditAPI, AuditAPIError } from '../services/api';


interface Props {
  escalations: EscalationLevel[];
  extraction: LoanExtraction;
}


// ── Level Config ──────────────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<
  number,
  {
    icon: React.ElementType;
    label: string;
    plainLabel: string;          // NEW: plain English name
    color: string;
    bg: string;
    border: string;
    iconBg: string;
    portalLabel: string | null;
    portalUrl: string | null;
    portalNote: string | null;
    defaultWhenToUse: string;    // NEW: fallback if backend doesn't send field
    defaultExpectedOutcome: string; // NEW: fallback expected outcome
    defaultTimeEstimate: string; // NEW: fallback time estimate
  }
> = {
  1: {
    icon: Mail,
    label: 'Grievance Redressal Officer',
    plainLabel: 'Write to your bank first',
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    iconBg: 'bg-green-100 dark:bg-green-900/40',
    portalLabel: null,
    portalUrl: null,
    portalNote: 'Send via email or registered post to your bank\'s Grievance Redressal Officer (GRO)',
    defaultWhenToUse: 'Start here — always try your bank first. Send this letter via email or registered post to your bank\'s GRO.',
    defaultExpectedOutcome: 'Banks are legally required to respond within 30 days. Many issues get resolved here without needing further escalation.',
    defaultTimeEstimate: '30 days',
  },
  2: {
    icon: Building,
    label: 'Nodal Officer',
    plainLabel: 'Escalate inside the bank',
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    border: 'border-orange-200 dark:border-orange-800',
    iconBg: 'bg-orange-100 dark:bg-orange-900/40',
    portalLabel: null,
    portalUrl: null,
    portalNote: 'Send this if the GRO did not resolve your complaint within 30 days',
    defaultWhenToUse: 'Use this if your bank\'s GRO ignored you or gave an unsatisfactory response after 30 days.',
    defaultExpectedOutcome: 'The Nodal Officer has higher authority inside the bank. Most banks settle at this stage to avoid regulatory escalation.',
    defaultTimeEstimate: '15 days',
  },
  3: {
    icon: Scale,
    label: 'RBI Integrated Ombudsman',
    plainLabel: 'File with RBI — the regulator',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    portalLabel: 'cms.rbi.org.in',
    portalUrl: 'https://cms.rbi.org.in',
    portalNote: 'File online at cms.rbi.org.in — free of charge, no lawyer needed',
    defaultWhenToUse: 'Use this if the bank has not resolved your issue after Level 1 and Level 2. The RBI Ombudsman is a free, independent authority.',
    defaultExpectedOutcome: 'The RBI Ombudsman can order the bank to refund money, pay compensation, and fix the violation. Very effective for financial disputes.',
    defaultTimeEstimate: '30–90 days',
  },
  4: {
    icon: Users,
    label: 'Consumer Forum (DCDRC)',
    plainLabel: 'Take the bank to Consumer Court',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-800',
    iconBg: 'bg-purple-100 dark:bg-purple-900/40',
    portalLabel: 'edaakhil.nic.in',
    portalUrl: 'https://edaakhil.nic.in',
    portalNote: 'File under Consumer Protection Act 2019 — free for claims under ₹5 lakh',
    defaultWhenToUse: 'Use this if the RBI Ombudsman did not resolve your issue, or if you want to claim compensation for harassment and mental distress.',
    defaultExpectedOutcome: 'Consumer courts can award refunds, compensation for mental stress, and legal costs. Free to file for claims under ₹5 lakh.',
    defaultTimeEstimate: '3–6 months',
  },
  5: {
    icon: Landmark,
    label: 'RBI CRPC — Systemic Complaint',
    plainLabel: 'Report the bank to RBI directly',
    color: 'text-red-700 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-300 dark:border-red-700',
    iconBg: 'bg-red-100 dark:bg-red-900/40',
    portalLabel: 'rbi.org.in/CRPC',
    portalUrl: 'https://rbi.org.in',
    portalNote: 'Use for systemic violations — triggers regulatory inspection of the lender',
    defaultWhenToUse: 'Use this when violations are widespread or systematic. This triggers an RBI inspection of the lender\'s practices.',
    defaultExpectedOutcome: 'RBI can investigate the lender, impose penalties, and revoke licences for serious violations. Best for industry-wide issues.',
    defaultTimeEstimate: '6–12 months',
  },
};

const FALLBACK_CONFIG = LEVEL_CONFIG[1];


// ── Copy Hook ─────────────────────────────────────────────────────────────────

function useCopyToClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), timeout);
  };
  return { copy, copied };
}


// ── Safe plain field reader ───────────────────────────────────────────────────

function getPlain<T>(obj: unknown, key: string, fallback: T): T {
  if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && val !== undefined && val !== '') return val as T;
  }
  return fallback;
}


// ── Letter Body ───────────────────────────────────────────────────────────────

const LetterBody: React.FC<{ body: string }> = ({ body }) => {
  const { copy, copied } = useCopyToClipboard();
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-gray-400">Letter text</p>
        <button
          onClick={() => copy(body)}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Copy letter body"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-500" />
              <span className="text-green-500">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy text
            </>
          )}
        </button>
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-lg p-3 max-h-52 overflow-y-auto border border-gray-100 dark:border-gray-700">
        <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed font-mono">
          {body}
        </p>
      </div>
    </div>
  );
};


// ── Component ─────────────────────────────────────────────────────────────────

export const EscalationDownload: React.FC<Props> = ({
  escalations,
  extraction,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const sortedEscalations = [...escalations].sort((a, b) => a.level - b.level);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await auditAPI.downloadPDF(escalations, extraction);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'loanguard_escalation_package.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 3000);
    } catch (err: unknown) {
      if (err instanceof AuditAPIError) setDownloadError(err.message);
      else if (err instanceof Error) setDownloadError(err.message);
      else setDownloadError('PDF generation failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  if (escalations.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm"
    >
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-2">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            📬 {t('escalation.header', 'Your Action Plan — Escalation Letters')}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-sm">
            {t('escalation.header_desc', "These are ready-to-send letters. Start at Level 1 and only move up if the bank doesn't respond.")}
          </p>
        </div>

        {/* Download Button */}
        <button
          onClick={handleDownload}
          disabled={downloading}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 flex-shrink-0 ${downloaded
              ? 'bg-green-500 text-white'
              : 'bg-brand-600 hover:bg-brand-700 active:scale-95 text-white'
            } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {downloading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('escalation.generating_pdf', 'Generating PDF…')}
            </>
          ) : downloaded ? (
            <>
              <CheckCircle className="w-4 h-4" />
              {t('escalation.downloaded', 'Downloaded!')}
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              {t('escalation.download_all', 'Download All ({{count}} Letters)', { count: sortedEscalations.length })}
            </>
          )}
        </button>
      </div>

      {/* ── Escalation path visual (NEW) ── */}
      <div className="flex flex-wrap items-center gap-1.5 mb-5 mt-3">
        {sortedEscalations.map((esc, i) => {
          const cfg = LEVEL_CONFIG[esc.level] ?? FALLBACK_CONFIG;
          const plainLabel = getPlain<string>(
            esc,
            'level_plain_title',
            cfg.plainLabel
          );
          return (
            <React.Fragment key={esc.level}>
              <span
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.color}`}
              >
                {i + 1}. {plainLabel}
              </span>
              {i < sortedEscalations.length - 1 && (
                <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Download Error Banner ── */}
      <AnimatePresence>
        {downloadError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                {t('escalation.pdf_download_failed', 'PDF Download Failed')}
              </p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
                {downloadError}
              </p>
            </div>
            <button
              onClick={() => setDownloadError(null)}
              className="text-red-400 hover:text-red-600 transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Escalation Cards ── */}
      <div className="space-y-3">
        {sortedEscalations.map((esc) => {
          const cfg = LEVEL_CONFIG[esc.level] ?? FALLBACK_CONFIG;
          const Icon = cfg.icon;
          const isOpen = expanded === esc.level;

          // Read all plain English fields with fallbacks
          const levelPlainTitle = getPlain<string>(
            esc,
            'level_plain_title',
            cfg.plainLabel
          );
          const whenToUse = getPlain<string>(
            esc,
            'when_to_use',
            cfg.defaultWhenToUse
          );
          const expectedOutcome = getPlain<string>(
            esc,
            'expected_outcome',
            cfg.defaultExpectedOutcome
          );
          const timeEstimate = getPlain<string>(
            esc,
            'time_estimate',
            cfg.defaultTimeEstimate
          );

          return (
            <div
              key={esc.level}
              className={`rounded-xl border ${cfg.bg} ${cfg.border} overflow-hidden`}
            >
              {/* ── Accordion Header ── */}
              <button
                className="w-full flex items-start gap-3 p-4 text-left"
                onClick={() => setExpanded(isOpen ? null : esc.level)}
                aria-expanded={isOpen}
              >
                {/* Icon circle */}
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.iconBg} border ${cfg.border}`}
                >
                  <Icon className={`w-4 h-4 ${cfg.color}`} />
                </div>

                <div className="flex-1 min-w-0">
                  {/* Plain title — prominent */}
                  <p className={`text-sm font-bold leading-snug ${cfg.color}`}>
                    {t('escalation.level_label', 'Level')} {esc.level}: {levelPlainTitle}
                  </p>

                  {/* Technical name — small, below */}
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {cfg.label} · To: {esc.recipient}
                  </p>

                  {/* When to use — shown in collapsed state */}
                  {!isOpen && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                      {whenToUse}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {/* Time estimate badge */}
                  <span
                    className={`hidden sm:flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.color}`}
                  >
                    <Clock className="w-2.5 h-2.5" />
                    {timeEstimate}
                  </span>
                  {/* Portal link badge */}
                  {cfg.portalUrl && (
                    <a
                      href={cfg.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={`hidden sm:flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.color} hover:opacity-80 transition-opacity`}
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      {cfg.portalLabel}
                    </a>
                  )}
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
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-3">

                      {/* ── When to use ── */}
                      <div
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 ${cfg.bg} ${cfg.border}`}
                      >
                        <Lightbulb
                          className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${cfg.color}`}
                        />
                        <div>
                          <p
                            className={`text-[10px] font-bold uppercase tracking-wide mb-0.5 ${cfg.color}`}
                          >
                            {t('escalation.when_to_use', 'When to use this')}
                          </p>
                          <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed">
                            {whenToUse}
                          </p>
                        </div>
                      </div>

                      {/* ── Expected outcome ── */}
                      <div className="flex items-start gap-2 rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-3 py-2.5">
                        <Target className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-gray-400" />
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">
                            {t('escalation.what_to_expect', 'What to expect')}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                            {expectedOutcome}
                          </p>
                        </div>
                      </div>

                      {/* ── Time estimate (mobile — shown here since badge is hidden) ── */}
                      <div className="sm:hidden flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                        <Clock className="w-3.5 h-3.5" />
                        {t('escalation.typical_response_time', 'Typical response time:')} <strong>{timeEstimate}</strong>
                      </div>

                      {/* ── Subject ── */}
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">
                          {t('escalation.email_subject', 'Email / Letter subject')}
                        </p>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 leading-relaxed bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700">
                          {esc.subject}
                        </p>
                      </div>

                      {/* ── Letter Body ── */}
                      <LetterBody body={esc.body} />

                      {/* ── RBI References ── */}
                      {esc.rbi_references.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1">
                            {t('escalation.rbi_rules_cited', 'RBI rules cited in this letter')}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {esc.rbi_references.map((ref, j) => (
                              <span
                                key={j}
                                className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full font-mono"
                              >
                                {ref}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Filing note / portal ── */}
                      <div
                        className={`flex items-start gap-2 p-2.5 rounded-lg border ${cfg.bg} ${cfg.border}`}
                      >
                        <MapPin
                          className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${cfg.color}`}
                        />
                        <div className="min-w-0">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                            {cfg.portalNote}
                          </p>
                          {cfg.portalUrl && (
                            <a
                              href={cfg.portalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`text-[10px] font-semibold flex items-center gap-1 mt-0.5 ${cfg.color} hover:underline`}
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              {cfg.portalUrl}
                            </a>
                          )}
                        </div>
                      </div>

                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="mt-5 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-100 dark:border-gray-700 space-y-3">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
          🌐 {t('escalation.online_portals', 'Online Filing Portals')}
        </p>
        <div className="flex flex-col gap-2">
          <a
            href="https://cms.rbi.org.in"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            <Scale className="w-3.5 h-3.5" />
            RBI Integrated Ombudsman — cms.rbi.org.in
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://edaakhil.nic.in"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400 hover:underline font-medium"
          >
            <Users className="w-3.5 h-3.5" />
            Consumer Forum — edaakhil.nic.in
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
          💡 {t('escalation.footer_tip', "Always attempt Level 1 (write to your bank) before filing with regulators. The RBI Ombudsman requires you to have tried the bank first — keep copies of all letters you send.")}
        </p>
      </div>
    </motion.div>
  );
};
