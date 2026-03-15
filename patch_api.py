"""
Patches frontend/src/services/api.ts to:
1. Expand AuditResponse with plain English fields
2. Add SUPPORTED_LANGUAGES, LangCode, translateAuditResponse
"""
import pathlib, re

path = pathlib.Path("frontend/src/services/api.ts")
text = path.read_text(encoding="utf-8")

# ── Patch 1: expand AuditResponse plain English section ─────────────────────
OLD1 = (
    "  // \u2500\u2500 Plain English field \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "  /**\n"
    "   * Plain explanation of document completeness.\n"
    '   * e.g. "We could only read 60% of your document \u2014 some clauses may have been missed."\n'
    "   * Optional \u2014 may be absent on older API versions.\n"
    "   */\n"
    "  document_completeness_plain?: string;\n"
    "}"
)
NEW1 = (
    "  // \u2500\u2500 Plain English fields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n"
    "  plain_summary?: string;\n"
    "  key_actions?: Array<{\n"
    "    priority: number;\n"
    "    action: string;\n"
    "    description: string;\n"
    "    related_violation?: string;\n"
    "  }>;\n"
    "  critical_violations_plain?: string[];\n"
    "  document_completeness_plain?: string;\n"
    "}"
)

if OLD1 in text:
    text = text.replace(OLD1, NEW1)
    print("Patch 1 applied: AuditResponse plain fields expanded")
else:
    # Try with CRLF line endings
    OLD1_crlf = OLD1.replace("\n", "\r\n")
    NEW1_crlf = NEW1.replace("\n", "\r\n")
    if OLD1_crlf in text:
        text = text.replace(OLD1_crlf, NEW1_crlf)
        print("Patch 1 applied (CRLF): AuditResponse plain fields expanded")
    else:
        print("WARNING: Patch 1 target not found — skipping")

# ── Patch 2: add translation helpers before Utility Helpers ─────────────────
TRANSLATION_BLOCK = (
    "// \u2500\u2500 Multilingual Translation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n"
    "export const SUPPORTED_LANGUAGES = {\n"
    "  en: 'English',\n"
    "  hi: '\u0939\u093f\u0902\u0926\u0940',\n"
    "  te: '\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41',\n"
    "  ta: '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd',\n"
    "  ml: '\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02',\n"
    "} as const;\n\n"
    "export type LangCode = keyof typeof SUPPORTED_LANGUAGES;\n\n"
    "export async function translateAuditResponse(\n"
    "  auditResponse: AuditResponse,\n"
    "  targetLanguage: LangCode\n"
    "): Promise<AuditResponse> {\n"
    "  if (targetLanguage === 'en') return auditResponse;\n"
    "  const response = await fetch(`${API_BASE_URL}/api/audit/translate`, {\n"
    "    method: 'POST',\n"
    "    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },\n"
    "    body: JSON.stringify({ audit_response: auditResponse, target_language: targetLanguage }),\n"
    "  });\n"
    "  return handleFetchResponse<AuditResponse>(response);\n"
    "}\n\n"
)

if "SUPPORTED_LANGUAGES" in text:
    print("Patch 2 skipped: translation helpers already present")
else:
    # Insert before the Utility Helpers marker
    # Find the line that starts with "// -- Utility Helpers"
    insert_marker = None
    for marker in ["// \u2500\u2500 Utility Helpers", "// Utility Helpers"]:
        if marker in text:
            insert_marker = marker
            break
    if insert_marker:
        text = text.replace(insert_marker, TRANSLATION_BLOCK + insert_marker)
        print("Patch 2 applied: translation helpers added")
    else:
        # Just append before the first export function severityColor
        marker2 = "export function severityColor"
        if marker2 in text:
            text = text.replace(marker2, TRANSLATION_BLOCK + marker2)
            print("Patch 2 applied (fallback): translation helpers added before severityColor")
        else:
            print("WARNING: Patch 2 insert point not found")

path.write_text(text, encoding="utf-8")
print("Done. api.ts patched.")
