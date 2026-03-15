import axios, { AxiosProgressEvent, AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// ── Helper ────────────────────────────────────────────────────────────────────

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Shared Plain-English Types ────────────────────────────────────────────────

/**
 * A single action item the borrower should take.
 * Returned by the risk engine inside RiskScore.key_actions.
 */
export interface KeyAction {
  action: string;                            // "Contact your bank's GRO within 7 days"
  urgency: 'IMMEDIATE' | 'SOON' | 'OPTIONAL';
  why: string;                               // Plain reason: "Your EMI is ₹1,287 above the correct amount"
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LoanExtraction {
  // Core numeric fields
  principal: number;
  interest_rate: number;
  apr: number;
  emi_stated: number;
  tenure_months: number;
  processing_fee: number;
  processing_fee_percent: number;
  penal_interest_rate: number;
  gst_percent: number;
  bounce_charge: number;

  // Clause flags
  foreclosure_clause: string;
  auto_debit_consent: boolean;
  recovery_agent_clause: boolean;
  floating_rate: boolean;
  rate_reset_clause: string;
  bank_discretion_clause: boolean;

  // Loan meta
  loan_type: string;
  lender_name: string;
  borrower_name: string;
  agreement_date: string;
  raw_text_excerpt: string;

  // Fields from backend rewrite
  kfs_present: boolean;
  moratorium_period_months: number;
  prepayment_penalty_percent: number;
  insurance_premium: number;
  disbursement_date: string;
  interest_start_date: string;
  full_extracted_text: string;
}

export interface EMIAnalysis {
  expected_emi: number;
  stated_emi: number;
  emi_deviation_percent: number;
  total_expected_repayment: number;
  total_stated_repayment: number;
  effective_interest_rate: number;
  penal_stacking_impact: number;
  hidden_fee_impact: number;
  overcharge_estimate: number;
  emi_flag: boolean;
  apr_mismatch: boolean;
  repayment_mismatch: boolean;

  // ── Plain English fields ──────────────────────────────────────────────────
  /**
   * Full plain summary of EMI correctness.
   * e.g. "Your bank charges ₹1,287 more per month than the correct RBI amount.
   *        Over 60 months this totals ₹77,220 in overcharges."
   * Optional — may be absent on older API versions.
   */
  emi_plain_summary?: string;

  /**
   * Plain explanation of total overcharge.
   * e.g. "You have been overcharged ₹15,459 in total across the loan tenure."
   * Optional — may be absent on older API versions.
   */
  overcharge_plain?: string;
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskCategory = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Violation {
  issue_type: string;
  severity: Severity;
  rule_triggered: string;
  clause_reference: string;
  financial_impact: number;
  confidence_score: number;
  circular_ref: string;
  is_deterministic: boolean;

  // ── Plain English fields ──────────────────────────────────────────────────
  /** Plain one-line title. e.g. "Bank is charging illegal prepayment fee" */
  plain_english?: string;
  /** What does this violation actually mean? 2–3 sentence explanation. */
  what_this_means?: string;
  /** Why does this matter financially / legally to the borrower? */
  why_it_matters?: string;
  /** What specific action the borrower should take for this violation. */
  action_hint?: string;
  /** "MATH_PROVEN" | "AI_DETECTED" — more explicit than is_deterministic boolean */
  detection_method?: 'MATH_PROVEN' | 'AI_DETECTED';
}

export interface EscalationLevel {
  level: number;
  title: string;
  recipient: string;
  subject: string;
  body: string;
  rbi_references: string[];

  // ── Plain English fields ──────────────────────────────────────────────────
  /**
   * Plain title for this escalation level.
   * e.g. "Write to your bank first"  (instead of "Grievance Redressal Officer")
   * Optional — may be absent on older API versions.
   */
  level_plain_title?: string;

  /**
   * When the borrower should use this level.
   * e.g. "Use this if your bank has not responded within 30 days."
   * Optional — may be absent on older API versions.
   */
  when_to_use?: string;

  /**
   * What outcome the borrower can realistically expect.
   * e.g. "The RBI Ombudsman can order a full refund plus compensation."
   * Optional — may be absent on older API versions.
   */
  expected_outcome?: string;

  /**
   * How long this level typically takes to resolve.
   * e.g. "30 days"  /  "3–6 months"
   * Optional — may be absent on older API versions.
   */
  time_estimate?: string;
}

export interface RiskScore {
  // Numeric scores
  total_score: number;
  emi_deviation_score: number;
  hidden_fee_score: number;
  rbi_violation_score: number;
  penal_stacking_score: number;
  transparency_score: number;
  ambiguity_score: number;
  behavioral_score: number;

  // Categorical output
  risk_category: RiskCategory;
  appeal_success_probability: number;

  // ── Plain English fields ──────────────────────────────────────────────────
  /**
   * Plain one-line verdict headline.
   * e.g. "HIGH RISK — Your agreement has serious problems that will cost you money."
   * Optional — may be absent on older API versions.
   */
  risk_category_plain?: string;

  /**
   * Full 2–3 sentence plain explanation of the risk score.
   * e.g. "We found 4 violations in your loan agreement. Your bank is charging
   *        ₹1,287 more per month than the RBI formula allows. You have a strong
   *        case if you file a complaint."
   * Optional — may be absent on older API versions.
   */
  risk_summary_plain?: string;

  /**
   * Plain explanation of appeal success probability.
   * e.g. "You have a 90% chance of winning at the RBI Ombudsman because 3 of
   *        your violations are mathematically proven."
   * Optional — may be absent on older API versions.
   */
  appeal_plain?: string;

  /**
   * Personalised action checklist for the borrower.
   * Ordered by urgency. Optional — may be absent on older API versions.
   */
  key_actions?: KeyAction[];
}

export interface BehavioralAlert {
  threat_language_detected: boolean;
  aggressive_tone_detected: boolean;
  consent_misuse_detected: boolean;
  data_abuse_clause_detected: boolean;
  consumer_risk_alert: string;
}

export interface AuditResponse {
  extraction: LoanExtraction;
  emi_analysis: EMIAnalysis;
  violations: Violation[];
  escalations: EscalationLevel[];
  risk_score: RiskScore;
  behavioral_alert: BehavioralAlert;
  compliance_summary: string;
  confidence_overall: number;
  processing_time_ms: number;

  // Fields from backend rewrite
  low_confidence_warning: string | null;

  /**
   * FIX: renamed from `document_completeness_score` → `document_completeness`
   * to match usage in LoanGuard.tsx (`result.document_completeness`).
   * Backend must send this field as `document_completeness`.
   * Range: 0.0 – 1.0
   */
  document_completeness: number;

  plain_summary?: string;
  key_actions?: Array<{
    priority: number;
    action: string;
    description: string;
    related_violation?: string;
  }>;
  critical_violations_plain?: string[];
  document_completeness_plain?: string;
}

// ── Typed API Error ───────────────────────────────────────────────────────────

export interface APIErrorDetail {
  status: number;
  message: string;
  raw?: unknown;
}

export class AuditAPIError extends Error {
  public status: number;
  public raw?: unknown;

  constructor(detail: APIErrorDetail) {
    super(detail.message);
    this.name = 'AuditAPIError';
    this.status = detail.status;
    this.raw = detail.raw;
  }
}

function handleAxiosError(err: unknown, fallback: string): never {
  if (axios.isAxiosError(err)) {
    const axErr = err as AxiosError<{ detail?: string }>;
    const status = axErr.response?.status ?? 0;
    const message =
      axErr.response?.data?.detail ||
      axErr.message ||
      fallback;
    throw new AuditAPIError({ status, message, raw: axErr.response?.data });
  }
  throw new AuditAPIError({ status: 0, message: fallback, raw: err });
}

async function handleFetchResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body?.detail || detail;
    } catch {
      // ignore parse error, use status code
    }
    throw new AuditAPIError({ status: response.status, message: detail });
  }
  return response.json() as Promise<T>;
}

// ── API Client ────────────────────────────────────────────────────────────────

export const auditAPI = {
  uploadPDF: async (
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<AuditResponse> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await axios.post<AuditResponse>(
        `${API_BASE_URL}/api/audit/upload`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data', ...getAuthHeader() },
          onUploadProgress: (e: AxiosProgressEvent) => {
            if (onProgress && e.total) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          },
        }
      );
      return response.data;
    } catch (err) {
      handleAxiosError(err, 'Failed to upload and analyze PDF');
    }
  },

  auditText: async (text: string): Promise<AuditResponse> => {
    try {
      const formData = new FormData();
      formData.append('raw_text', text);
      const response = await axios.post<AuditResponse>(
        `${API_BASE_URL}/api/audit/text`,
        formData,
        { headers: { ...getAuthHeader() } }
      );
      return response.data;
    } catch (err) {
      handleAxiosError(err, 'Failed to analyze text');
    }
  },

  downloadPDF: async (
    escalations: EscalationLevel[],
    extraction: LoanExtraction
  ): Promise<Blob> => {
    const response = await fetch(`${API_BASE_URL}/api/audit/download-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ escalations, extraction }),
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        detail = body?.detail || detail;
      } catch { /* ignore */ }
      throw new AuditAPIError({ status: response.status, message: detail });
    }
    return response.blob();
  },

  chat: async (
    message: string,
    context?: Partial<AuditResponse>
  ): Promise<{ reply: string }> => {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ message, context }),
    });
    return handleFetchResponse<{ reply: string }>(response);
  },
};

// ── Utility Helpers ───────────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = {
  en: 'English',
  hi: '\u0939\u093f\u0902\u0926\u0940',
  te: '\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41',
  ta: '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd',
  ml: '\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02',
} as const;

export type LangCode = keyof typeof SUPPORTED_LANGUAGES;

export async function translateAuditResponse(
  auditResponse: AuditResponse,
  targetLanguage: LangCode
): Promise<AuditResponse> {
  if (targetLanguage === 'en') return auditResponse;
  const response = await fetch(`${API_BASE_URL}/api/audit/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ audit_response: auditResponse, target_language: targetLanguage }),
  });
  return handleFetchResponse<AuditResponse>(response);
}

export function severityColor(level: Severity | RiskCategory): string {
  switch (level) {
    case 'CRITICAL': return 'text-red-600';
    case 'HIGH': return 'text-orange-500';
    case 'MEDIUM': return 'text-yellow-500';
    case 'LOW': return 'text-green-500';
    default: return 'text-gray-400';
  }
}

export function severityBadge(level: Severity | RiskCategory): string {
  switch (level) {
    case 'CRITICAL': return 'bg-red-100 text-red-700 border border-red-300';
    case 'HIGH': return 'bg-orange-100 text-orange-700 border border-orange-300';
    case 'MEDIUM': return 'bg-yellow-100 text-yellow-700 border border-yellow-300';
    case 'LOW': return 'bg-green-100 text-green-700 border border-green-300';
    default: return 'bg-gray-100 text-gray-600 border border-gray-300';
  }
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function confidenceDisplay(score: number): { label: string; color: string } {
  const pct = Math.round(score * 100);
  const color =
    pct >= 85 ? 'text-green-600' :
      pct >= 65 ? 'text-yellow-500' :
        'text-red-500';
  return { label: `${pct}%`, color };
}

export function escalationLevelColor(level: number): string {
  switch (level) {
    case 1: return 'border-green-500 bg-green-50';
    case 2: return 'border-orange-500 bg-orange-50';
    case 3: return 'border-blue-600 bg-blue-50';
    case 4: return 'border-purple-600 bg-purple-50';
    case 5: return 'border-red-700 bg-red-50';
    default: return 'border-gray-400 bg-gray-50';
  }
}
