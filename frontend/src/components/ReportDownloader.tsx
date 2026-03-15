import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Language,
  getTranslation,
} from '../translations/reportTranslations';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';


// ── LoanData interface ────────────────────────────────────────────────────────

interface KeyAction {
  action: string;
  urgency: 'IMMEDIATE' | 'SOON' | 'OPTIONAL';
  why: string;
}

interface LoanData {
  // Core fields
  bankName?: string;
  borrowerName?: string;
  agreementDate?: string;
  principal?: number;
  interestRate?: number;
  effectiveAPR?: number;
  tenureMonths?: number;
  expectedEMI?: number;
  statedEMI?: number;
  processingFee?: number;
  overchargeEstimate?: number;
  riskScore?: number;
  riskCategory?: string;
  appealSuccessProbability?: number;
  systemConfidencePct?: number;
  violationCount?: number;
  criticalCount?: number;
  highCount?: number;
  deterministicCount?: number;
  kfsPresent?: boolean;
  insurancePremium?: number;
  prepaymentPenaltyPct?: number;
  documentCompletenessPct?: number;
  lowConfidenceWarning?: string | null;
  metrics?: {
    emiDeviation?: { value: number; max: number };
    hiddenFees?: { value: number; max: number };
    rbiViolations?: { value: number; max: number };
    penalStacking?: { value: number; max: number };
    transparency?: { value: number; max: number };
    ambiguity?: { value: number; max: number };
    behavioral?: { value: number; max: number };
  };
  flags?: string[];
  emiDeviationPct?: number;
  compliancySummary?: string;

  // ── NEW plain English fields ──────────────────────────────────────────────
  riskCategoryPlain?: string;
  riskSummaryPlain?: string;
  appealPlain?: string;
  keyActions?: KeyAction[];
  emiPlainSummary?: string;
  overchargePlain?: string;
}


interface ReportDownloaderProps {
  data: LoanData | null;
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function getRiskHex(category?: string): string {
  switch (category?.toUpperCase()) {
    case 'LOW': return '#10b981';
    case 'MEDIUM': return '#f59e0b';
    case 'HIGH': return '#ef4444';
    case 'CRITICAL': return '#dc2626';
    default: return '#6b7280';
  }
}

function getMetricHex(percentage: number): string {
  if (percentage < 33) return '#10b981';
  if (percentage < 66) return '#f59e0b';
  return '#ef4444';
}


// ── PDF Builder ───────────────────────────────────────────────────────────────

function buildPDF(data: LoanData, t: (key: string) => string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ── Page footer helper ────────────────────────────────────────────────────
  const addFooter = () => {
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
      doc.setFontSize(7);
      doc.setTextColor(160, 160, 160);
      doc.text(
        `LoanGuard Report · Page ${i} of ${totalPages} · ${new Date().toLocaleDateString('en-IN')}`,
        pageW / 2,
        pageH - 8,
        { align: 'center' }
      );
    }
  };

  // ── Page break helper ─────────────────────────────────────────────────────
  const checkPageBreak = (needed: number) => {
    if (y + needed > pageH - 20) {
      doc.addPage();
      y = margin;
    }
  };

  // ── Section title helper ──────────────────────────────────────────────────
  const sectionTitle = (title: string) => {
    checkPageBreak(14);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    doc.text(title, margin, y);
    y += 2;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 6;
  };

  // ── Key-value pair helper ─────────────────────────────────────────────────
  const kvPair = (label: string, value: string, indent = 0) => {
    checkPageBreak(7);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(107, 114, 128);
    doc.text(label + ':', margin + indent, y);
    const labelW = doc.getTextWidth(label + ': ');
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(17, 24, 39);
    doc.text(value, margin + indent + labelW, y);
    y += 5.5;
  };

  // ── Wrapped text helper ───────────────────────────────────────────────────
  const wrappedText = (text: string, fontSize = 9, color: [number, number, number] = [55, 65, 81]) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, contentW);
    const lineH = fontSize * 0.45;
    checkPageBreak(lines.length * lineH + 4);
    doc.text(lines, margin, y);
    y += lines.length * lineH + 3;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════════════════════════════════════════
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(17, 24, 39);
  doc.text(t('title'), margin, y);
  y += 7;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(107, 114, 128);
  doc.text(t('subtitle'), margin, y);
  y += 8;

  // Identity row
  doc.setFontSize(8.5);
  doc.setTextColor(107, 114, 128);
  const infoLine = [
    data.bankName ? `${t('bank')}: ${data.bankName}` : null,
    data.borrowerName ? `${t('borrower')}: ${data.borrowerName}` : null,
    data.agreementDate ? `${t('agreementDate')}: ${data.agreementDate}` : null,
    `${t('generatedOn')}: ${new Date().toLocaleDateString('en-IN')}`,
  ].filter(Boolean).join('  ·  ');
  doc.text(infoLine, margin, y);
  y += 3;

  // Divider
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(1);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION A: Risk Verdict
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(t('complianceAssessment'));

  // Risk category badge (plain)
  if (data.riskCategoryPlain) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...hexToRGB(getRiskHex(data.riskCategory)));
    const lines = doc.splitTextToSize(data.riskCategoryPlain, contentW);
    doc.text(lines, margin, y);
    y += lines.length * 5 + 4;
  }

  // Risk summary paragraph
  if (data.riskSummaryPlain) {
    wrappedText(data.riskSummaryPlain);
  }

  // Quick stats table
  const statsRows: string[][] = [];
  statsRows.push([t('violationsFound'), `${data.violationCount ?? 0}`]);
  if (data.criticalCount) statsRows.push([t('critical'), `${data.criticalCount}`]);
  if (data.highCount) statsRows.push([t('high'), `${data.highCount}`]);
  if (data.deterministicCount) statsRows.push([t('mathProven'), `${data.deterministicCount}`]);
  if (data.overchargeEstimate) statsRows.push([t('overchargeEstimate'), fmtINR(data.overchargeEstimate)]);
  statsRows.push([t('riskCategory'), data.riskCategory ?? 'N/A']);
  statsRows.push([t('appealSuccessProbability'), `${((data.appealSuccessProbability ?? 0) * 100).toFixed(0)}%`]);
  if (data.systemConfidencePct != null) statsRows.push([t('systemConfidence'), `${data.systemConfidencePct}%`]);
  if (data.documentCompletenessPct != null) statsRows.push([t('docCompleteness'), `${data.documentCompletenessPct}%`]);
  if (data.kfsPresent != null) statsRows.push([t('kfsPresent'), data.kfsPresent ? '✓ Present' : '✗ Missing']);

  checkPageBreak(statsRows.length * 7 + 10);
  autoTable(doc, {
    startY: y,
    head: [],
    body: statsRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2.5, textColor: [17, 24, 39] },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [107, 114, 128], cellWidth: contentW * 0.45 },
      1: { fontStyle: 'bold', cellWidth: contentW * 0.55 },
    },
    margin: { left: margin, right: margin },
    tableWidth: contentW,
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Appeal plain
  if (data.appealPlain) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(55, 65, 81);
    const lines = doc.splitTextToSize(`📋 ${data.appealPlain}`, contentW);
    checkPageBreak(lines.length * 4.5 + 4);
    doc.text(lines, margin, y);
    y += lines.length * 4.5 + 4;
  }

  // Low confidence warning
  if (data.lowConfidenceWarning) {
    checkPageBreak(12);
    doc.setFillColor(254, 243, 199);
    doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text(`⚠ ${t('lowConfidenceWarning')}: ${data.lowConfidenceWarning}`, margin + 3, y + 6);
    y += 14;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION B: Loan Details
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(t('loanDetails'));

  const loanRows: string[][] = [];
  if (data.principal) loanRows.push([t('principal'), fmtINR(data.principal)]);
  if (data.interestRate) loanRows.push([t('interestRate'), `${data.interestRate}%`]);
  if (data.effectiveAPR) loanRows.push([t('effectiveAPR'), `${data.effectiveAPR}%`]);
  if (data.tenureMonths) loanRows.push([t('tenure'), `${data.tenureMonths} ${t('months')}`]);
  if (data.expectedEMI) loanRows.push([t('expectedEMI'), fmtINR(data.expectedEMI)]);
  if (data.statedEMI) loanRows.push([t('statedEMI'), fmtINR(data.statedEMI)]);
  if (data.processingFee) loanRows.push([t('processingFee'), fmtINR(data.processingFee)]);
  if (data.prepaymentPenaltyPct != null && data.prepaymentPenaltyPct > 0)
    loanRows.push([t('prepaymentPenalty'), `${data.prepaymentPenaltyPct}%`]);
  if (data.insurancePremium != null && data.insurancePremium > 0)
    loanRows.push([t('insurancePremium'), fmtINR(data.insurancePremium)]);
  if (data.overchargeEstimate)
    loanRows.push([t('overchargeEst'), fmtINR(data.overchargeEstimate)]);

  if (loanRows.length > 0) {
    checkPageBreak(loanRows.length * 7 + 10);
    autoTable(doc, {
      startY: y,
      head: [],
      body: loanRows,
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 3, textColor: [17, 24, 39] },
      columnStyles: {
        0: { fontStyle: 'bold', textColor: [107, 114, 128], cellWidth: contentW * 0.45 },
        1: { fontStyle: 'bold', cellWidth: contentW * 0.55 },
      },
      margin: { left: margin, right: margin },
      tableWidth: contentW,
      alternateRowStyles: { fillColor: [249, 250, 251] },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION C: Risk Intelligence
  // ═══════════════════════════════════════════════════════════════════════════
  if (data.metrics) {
    sectionTitle(t('riskIntelligence'));

    // Score header
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...hexToRGB(getRiskHex(data.riskCategory)));
    doc.text(`${data.riskScore ?? 0}`, margin, y);
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    doc.text(`/100 ${t('score')}`, margin + doc.getTextWidth(`${data.riskScore ?? 0} `), y);
    y += 10;

    // Metric bars
    const metricsConfig = [
      { key: 'emiDeviation', label: t('emiDeviation'), data: data.metrics.emiDeviation },
      { key: 'hiddenFees', label: t('hiddenFees'), data: data.metrics.hiddenFees },
      { key: 'rbiViolations', label: t('rbiViolations'), data: data.metrics.rbiViolations },
      { key: 'penalStacking', label: t('penalStacking'), data: data.metrics.penalStacking },
      { key: 'transparency', label: t('transparency'), data: data.metrics.transparency },
      { key: 'ambiguity', label: t('ambiguity'), data: data.metrics.ambiguity },
      { key: 'behavioral', label: t('behavioralRisk'), data: data.metrics.behavioral },
    ];

    for (const m of metricsConfig) {
      if (!m.data) continue;
      checkPageBreak(10);
      const pct = m.data.max > 0 ? (m.data.value / m.data.max) * 100 : 0;
      const color = getMetricHex(pct);

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(55, 65, 81);
      doc.text(m.label, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 114, 128);
      doc.text(`${m.data.value.toFixed(1)}/${m.data.max}`, pageW - margin, y, { align: 'right' });
      y += 3;

      // Background bar
      doc.setFillColor(229, 231, 235);
      doc.roundedRect(margin, y, contentW, 3, 1.5, 1.5, 'F');
      // Filled bar
      const barW = (Math.min(pct, 100) / 100) * contentW;
      if (barW > 0) {
        doc.setFillColor(...hexToRGB(color));
        doc.roundedRect(margin, y, barW, 3, 1.5, 1.5, 'F');
      }
      y += 7;
    }
    y += 4;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION D: Key Actions
  // ═══════════════════════════════════════════════════════════════════════════
  if (data.keyActions && data.keyActions.length > 0) {
    sectionTitle('📋 Key Actions');

    for (let i = 0; i < data.keyActions.length; i++) {
      const action = data.keyActions[i];
      checkPageBreak(16);

      // Urgency badge
      const urgencyColor = action.urgency === 'IMMEDIATE' ? '#ef4444'
        : action.urgency === 'SOON' ? '#f59e0b' : '#10b981';

      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...hexToRGB(urgencyColor));
      doc.text(`${action.urgency}`, margin, y);
      y += 4;

      // Action text
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(17, 24, 39);
      const actionLines = doc.splitTextToSize(`${i + 1}. ${action.action}`, contentW);
      doc.text(actionLines, margin, y);
      y += actionLines.length * 4.5;

      // Why
      if (action.why) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8.5);
        doc.setTextColor(107, 114, 128);
        const whyLines = doc.splitTextToSize(`→ ${action.why}`, contentW - 4);
        doc.text(whyLines, margin + 4, y);
        y += whyLines.length * 4 + 4;
      }
    }
    y += 4;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION E: EMI Analysis
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(t('emiAnalysis'));

  if (data.emiPlainSummary) {
    wrappedText(data.emiPlainSummary);
  }
  if (data.overchargePlain) {
    wrappedText(data.overchargePlain);
  }

  // EMI deviation indicator
  const devPct = data.emiDeviationPct ?? 0;
  checkPageBreak(10);
  const devColor = devPct > 1.5 ? '#991b1b' : '#166534';
  const devBg = devPct > 1.5 ? [254, 226, 226] : [220, 252, 231];
  doc.setFillColor(devBg[0], devBg[1], devBg[2]);
  doc.roundedRect(margin, y, contentW, 8, 2, 2, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...hexToRGB(devColor));
  doc.text(
    `${devPct > 1.5 ? '⚠' : '✓'} ${devPct.toFixed(2)}% ${t('emiDeviation')}`,
    margin + 3, y + 5.5
  );
  y += 14;

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION F: Flags
  // ═══════════════════════════════════════════════════════════════════════════
  if (data.flags && data.flags.length > 0) {
    sectionTitle(t('flags'));
    for (const flag of data.flags) {
      checkPageBreak(6);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(55, 65, 81);
      doc.text(`• ${flag}`, margin + 2, y);
      y += 5;
    }
    y += 4;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION G: Compliance Summary
  // ═══════════════════════════════════════════════════════════════════════════
  if (data.compliancySummary) {
    sectionTitle('Compliance Summary');
    wrappedText(data.compliancySummary);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DISCLAIMER
  // ═══════════════════════════════════════════════════════════════════════════
  checkPageBreak(25);
  y += 4;
  doc.setFillColor(249, 250, 251);
  doc.setDrawColor(229, 231, 235);

  const disclaimerText = t('disclaimer');
  doc.setFontSize(7);
  const disclaimerLines = doc.splitTextToSize(disclaimerText, contentW - 8);
  const boxH = disclaimerLines.length * 3.5 + 14;

  doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(107, 114, 128);
  doc.text('Disclaimer', margin + 4, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(107, 114, 128);
  doc.text(disclaimerLines, margin + 4, y + 10);

  y += boxH + 4;

  // ── Add footers to all pages ────────────────────────────────────────────
  addFooter();

  return doc;
}


// ── Hex → RGB helper ──────────────────────────────────────────────────────────

function hexToRGB(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}


// ── Component ─────────────────────────────────────────────────────────────────

export const ReportDownloader: React.FC<ReportDownloaderProps> = ({ data }) => {
  const { i18n } = useTranslation();
  const [generating, setGenerating] = useState(false);

  const langCode = (i18n.language || 'en') as Language;
  const t = (key: string) => getTranslation(langCode, key as any);

  const handleDownload = async () => {
    if (!data) return;
    setGenerating(true);

    try {
      // Slight delay to allow UI to update
      await new Promise(r => setTimeout(r, 50));

      const doc = buildPDF(data, t);
      const borrowerName = data.borrowerName?.replace(/[^a-zA-Z0-9]/g, '_') ?? 'Report';
      const today = new Date().toISOString().split('T')[0];
      doc.save(`LoanGuard_Report_${borrowerName}_${today}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  if (!data) {
    return (
      <div className="max-w-2xl mx-auto mt-6 p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('noData')}</p>
      </div>
    );
  }

  return (
    <button
      onClick={handleDownload}
      disabled={generating}
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold 
                 bg-brand-600 hover:bg-brand-700 active:scale-95 text-white 
                 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {generating ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('downloadButton')}…
        </>
      ) : (
        <>
          <Download className="w-4 h-4" />
          {t('downloadButton')}
        </>
      )}
    </button>
  );
};
