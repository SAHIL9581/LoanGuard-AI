import axios, { AxiosProgressEvent, AxiosError } from 'axios';

// ── Base URL ──────────────────────────────────────────────────────────────────
// Set VITE_API_BASE_URL in Vercel environment variables to your Render backend URL
// e.g. https://delta-build-api.onrender.com
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000';

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
  action: string;
  urgency: 'IMMEDIATE' | 'SOON' | 'OPTIONAL';
  why: string;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LoanExtraction {
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
  foreclosure_clause: string;
  auto_debit_consent: boolean;
  recovery_agent_clause: boolean;
  floating_rate: boolean;
  rate_reset_clause: string;
  bank_discretion_clause: boolean;
  loan_type: string;
  lender_name: string;
  borrower_name: string;
  agreement_date: string;
  raw_text_excerpt: string;
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
  emi_plain_summary?: string;
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
  plain_english?: string;
  what_this_means?: string;
  why_it_matters?: string;
  action_hint?: string;
  detection_method?: 'MATH_PROVEN' | 'AI_DETECTED';
}

export interface EscalationLevel {
  level: number;
  title: string;
  recipient: string;
  subject: string;
  body: string;
  rbi_references: string[];
  level_plain_title?: string;
  when_to_use?: string;
  expected_outcome?: string;
  time_estimate?: string;
}

export interface RiskScore {
  total_score: number;
  emi_deviation_score: number;
  hidden_fee_score: number;
  rbi_violation_score: number;
  penal_stacking_score: number;
  transparency_score: number;
  ambiguity_score: number;
  behavioral_score: number;
  risk_category: RiskCategory;
  appeal_success_probability: number;
  risk_category_plain?: string;
  risk_summary_plain?: string;
  appeal_plain?: string;
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
  low_confidence_warning: string | null;
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

    // Detect Render cold-start timeout specifically
    if (axErr.code === 'ECONNABORTED' || status === 0) {
      throw new AuditAPIError({
        status: 0,
        message: 'Server is waking up — please retry in a few seconds.',
        raw: axErr.response?.data,
      });
    }

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

// ── Retry utility (handles Render cold-start) ─────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 3000
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isNetworkError =
        err instanceof AuditAPIError && err.status === 0;
      if (isNetworkError && attempt < retries) {
        await new Promise((res) => setTimeout(res, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── API Client ────────────────────────────────────────────────────────────────

export const auditAPI = {
  uploadPDF: async (
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<AuditResponse> => {
    return withRetry(async () => {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const response = await axios.post<AuditResponse>(
          `${API_BASE_URL}/api/audit/upload`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data', ...getAuthHeader() },
            timeout: 120_000, // 2 min — PDF parsing + LLM can be slow on Render free tier
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
    });
  },

  auditText: async (text: string): Promise<AuditResponse> => {
    return withRetry(async () => {
      try {
        const formData = new FormData();
        formData.append('raw_text', text);
        const response = await axios.post<AuditResponse>(
          `${API_BASE_URL}/api/audit/text`,
          formData,
          {
            headers: { ...getAuthHeader() },
            timeout: 90_000,
          }
        );
        return response.data;
      } catch (err) {
        handleAxiosError(err, 'Failed to analyze text');
      }
    });
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

  /** Ping the backend health endpoint — useful to wake Render from cold start */
  ping: async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/health`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  },
};

// ── Utility Helpers ───────────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = {
  en: 'English',
  hi: 'हिंदी',
  te: 'తెలుగు',
  ta: 'தமிழ்',
  ml: 'മലയാളം',
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
    case 'HIGH':     return 'text-orange-500';
    case 'MEDIUM':   return 'text-yellow-500';
    case 'LOW':      return 'text-green-500';
    default:         return 'text-gray-400';
  }
}

export function severityBadge(level: Severity | RiskCategory): string {
  switch (level) {
    case 'CRITICAL': return 'bg-red-100 text-red-700 border border-red-300';
    case 'HIGH':     return 'bg-orange-100 text-orange-700 border border-orange-300';
    case 'MEDIUM':   return 'bg-yellow-100 text-yellow-700 border border-yellow-300';
    case 'LOW':      return 'bg-green-100 text-green-700 border border-green-300';
    default:         return 'bg-gray-100 text-gray-600 border border-gray-300';
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
    case 1:  return 'border-green-500 bg-green-50';
    case 2:  return 'border-orange-500 bg-orange-50';
    case 3:  return 'border-blue-600 bg-blue-50';
    case 4:  return 'border-purple-600 bg-purple-50';
    case 5:  return 'border-red-700 bg-red-50';
    default: return 'border-gray-400 bg-gray-50';
  }
}
