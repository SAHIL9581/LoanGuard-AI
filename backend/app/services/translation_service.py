"""
app/services/translation_service.py
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Multilingual translation pipeline for AuditResponse.

Design principles
─────────────────
• GoogleTranslator from deep-translator (pip install deep-translator)
• Always translates FROM English (en) TO target — never from target to target
• Deep-copies the AuditResponse before mutating — original is never touched
• SHA-256 keyed in-memory cache — same text + lang combo is only ever sent once
• Long strings (>4900 chars) are split at sentence boundaries before sending
• All Google calls are synchronous — wrapped in asyncio.to_thread() for async use
• Any exception silently returns the original English string for that field only

Fields translated
─────────────────
AuditResponse:
  plain_summary, compliance_summary, document_completeness_plain,
  low_confidence_warning (str|None)

  risk_score:
    risk_summary_plain, risk_category_plain, appeal_plain

  emi_analysis:
    emi_plain_summary, overcharge_plain

  behavioral_alert:
    consumer_risk_alert

  critical_violations_plain: List[str]

  violations[]:
    plain_english, what_this_means, why_it_matters, action_hint

  key_actions[]:
    action, description

  escalations[]:
    title, body, summary (EscalationLevel.level_plain_title, body)

Fields NEVER translated (data, not prose)
──────────────────────────────────────────
  lender_name, borrower_name, monetary values, RBI circular IDs,
  PAN/Aadhaar numbers, percentages, dates, issue_type, rule_triggered,
  clause_reference, recipient, subject, rbi_references
"""

import asyncio
import copy
import hashlib
import re
from typing import Optional

from loguru import logger

# ── Supported language codes ───────────────────────────────────────────────────

SUPPORTED_LANGUAGES: dict[str, str] = {
    "en": "English",
    "hi": "हिंदी",
    "te": "తెలుగు",
    "ta": "தமிழ்",
    "ml": "മലയാളം",
}

# ── In-memory translation cache ────────────────────────────────────────────────
# Key: sha256(f"{lang}::{text}")   Value: translated string
_CACHE: dict[str, str] = {}


def get_cache_stats() -> dict:
    return {"size": len(_CACHE), "keys_sample": list(_CACHE.keys())[:5]}


def clear_translation_cache() -> None:
    _CACHE.clear()
    logger.info("Translation cache cleared")


# ── Internal helpers ───────────────────────────────────────────────────────────

_MAX_CHARS = 4900  # Google Translate hard limit is 5000; keep safety margin


def _cache_key(lang: str, text: str) -> str:
    return hashlib.sha256(f"{lang}::{text}".encode("utf-8")).hexdigest()


def _split_into_chunks(text: str, max_chars: int = _MAX_CHARS) -> list[str]:
    """
    Split a long string into chunks at sentence boundaries so each chunk is
    smaller than *max_chars*.  Falls back to hard-split if a single sentence
    exceeds the limit.
    """
    if len(text) <= max_chars:
        return [text]

    # Split on sentence-ending punctuation followed by whitespace / end-of-string
    sentences = re.split(r'(?<=[.!?।])\s+', text)
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) + 1 > max_chars:
            if current:
                chunks.append(current.strip())
            # If single sentence is too long, hard-split it
            if len(sentence) > max_chars:
                for i in range(0, len(sentence), max_chars):
                    chunks.append(sentence[i: i + max_chars])
                current = ""
            else:
                current = sentence
        else:
            current = (current + " " + sentence).strip() if current else sentence

    if current:
        chunks.append(current.strip())

    return chunks


def _translate_sync(text: str, target_lang: str) -> str:
    """
    Synchronous translation of *text* to *target_lang*.
    Results are cached by (lang, text) SHA-256.
    Returns original text on any error.
    """
    if not text or not text.strip():
        return text

    key = _cache_key(target_lang, text)
    if key in _CACHE:
        return _CACHE[key]

    try:
        from deep_translator import GoogleTranslator  # lazy import

        chunks = _split_into_chunks(text)
        translated_chunks: list[str] = []

        for chunk in chunks:
            result = GoogleTranslator(source="en", target=target_lang).translate(chunk)
            translated_chunks.append(result if result else chunk)

        translated = " ".join(translated_chunks)
        _CACHE[key] = translated
        return translated

    except Exception as exc:  # noqa: BLE001
        logger.warning(
            f"Translation failed [{target_lang}], falling back to English: {exc}"
        )
        return text  # silent fallback


async def _translate(text: str, target_lang: str) -> str:
    """Async wrapper — runs the sync call in a thread pool."""
    return await asyncio.to_thread(_translate_sync, text, target_lang)


async def _translate_opt(text: Optional[str], target_lang: str) -> Optional[str]:
    """Translates an optional string; returns None if None."""
    if text is None:
        return None
    return await _translate(text, target_lang)


async def _translate_list(items: list[str], target_lang: str) -> list[str]:
    """Translate a list of strings concurrently."""
    tasks = [_translate(item, target_lang) for item in items]
    return list(await asyncio.gather(*tasks))


# ── Main public API ────────────────────────────────────────────────────────────

async def translate_audit_response(audit_response, target_lang: str):
    """
    Translate all plain-English prose fields of *audit_response* into
    *target_lang* and return a **new** deep-copied AuditResponse object.

    The original *audit_response* is never mutated.

    Parameters
    ----------
    audit_response : AuditResponse  (from app.models.schemas)
    target_lang    : str  — one of {"hi", "te", "ta", "ml"}
                     "en" is a no-op (returns the original object)

    Returns
    -------
    AuditResponse with all translatable fields replaced with the translated
    equivalents; all numeric / identifier fields are preserved as-is.
    """
    if target_lang == "en" or target_lang not in SUPPORTED_LANGUAGES:
        return audit_response

    # Deep copy — never mutate the canonical English response
    r = copy.deepcopy(audit_response)

    # ── Top-level AuditResponse string fields ──────────────────────────────
    (
        r.plain_summary,
        r.compliance_summary,
        r.document_completeness_plain,
        r.low_confidence_warning,
    ) = await asyncio.gather(
        _translate(r.plain_summary or "", target_lang),
        _translate(r.compliance_summary or "", target_lang),
        _translate(r.document_completeness_plain or "", target_lang),
        _translate_opt(r.low_confidence_warning, target_lang),
    )

    # ── risk_score plain fields ────────────────────────────────────────────
    if r.risk_score:
        (
            r.risk_score.risk_summary_plain,
            r.risk_score.risk_category_plain,
            r.risk_score.appeal_plain,
        ) = await asyncio.gather(
            _translate(r.risk_score.risk_summary_plain or "", target_lang),
            _translate(r.risk_score.risk_category_plain or "", target_lang),
            _translate(r.risk_score.appeal_plain or "", target_lang),
        )

        # score_breakdown_plain (List[str])
        if hasattr(r.risk_score, "score_breakdown_plain") and r.risk_score.score_breakdown_plain:
            r.risk_score.score_breakdown_plain = await _translate_list(
                r.risk_score.score_breakdown_plain, target_lang
            )

        # key_actions on risk_score (action + why fields)
        if hasattr(r.risk_score, "key_actions") and r.risk_score.key_actions:
            async def _translate_rs_action(ka):
                action_text = getattr(ka, "action", None) or (ka.get("action") if isinstance(ka, dict) else None)
                why_text = getattr(ka, "why", None) or (ka.get("why") if isinstance(ka, dict) else None)
                translated_action = await _translate(action_text or "", target_lang) if action_text else action_text
                translated_why = await _translate(why_text or "", target_lang) if why_text else why_text
                if isinstance(ka, dict):
                    ka["action"] = translated_action or ka.get("action", "")
                    ka["why"] = translated_why or ka.get("why", "")
                else:
                    if hasattr(ka, "action"): ka.action = translated_action
                    if hasattr(ka, "why"): ka.why = translated_why
                return ka

            tasks = [_translate_rs_action(ka) for ka in r.risk_score.key_actions]
            r.risk_score.key_actions = list(await asyncio.gather(*tasks))

    # ── emi_analysis plain fields ──────────────────────────────────────────
    if r.emi_analysis:
        (
            r.emi_analysis.emi_plain_summary,
            r.emi_analysis.overcharge_plain,
        ) = await asyncio.gather(
            _translate(r.emi_analysis.emi_plain_summary or "", target_lang),
            _translate(r.emi_analysis.overcharge_plain or "", target_lang),
        )

    # ── behavioral_alert ──────────────────────────────────────────────────
    if r.behavioral_alert:
        r.behavioral_alert.consumer_risk_alert = await _translate(
            r.behavioral_alert.consumer_risk_alert or "", target_lang
        )
        # plain_warning
        if hasattr(r.behavioral_alert, "plain_warning") and r.behavioral_alert.plain_warning:
            r.behavioral_alert.plain_warning = await _translate(
                r.behavioral_alert.plain_warning, target_lang
            )
        # flags_plain (List[str])
        if hasattr(r.behavioral_alert, "flags_plain") and r.behavioral_alert.flags_plain:
            r.behavioral_alert.flags_plain = await _translate_list(
                r.behavioral_alert.flags_plain, target_lang
            )

    # ── critical_violations_plain (List[str]) ─────────────────────────────
    if r.critical_violations_plain:
        r.critical_violations_plain = await _translate_list(
            r.critical_violations_plain, target_lang
        )

    # ── violations[].plain fields ─────────────────────────────────────────
    if r.violations:
        async def _translate_violation(v):
            (
                v.plain_english,
                v.what_this_means,
                v.why_it_matters,
                v.action_hint,
            ) = await asyncio.gather(
                _translate(v.plain_english or "", target_lang),
                _translate(v.what_this_means or "", target_lang),
                _translate(v.why_it_matters or "", target_lang),
                _translate(v.action_hint or "", target_lang),
            )
            return v

        r.violations = list(
            await asyncio.gather(*[_translate_violation(v) for v in r.violations])
        )

    # ── key_actions[].action + description ───────────────────────────────
    if r.key_actions:
        async def _translate_action(ka):
            (ka.action, ka.description) = await asyncio.gather(
                _translate(ka.action or "", target_lang),
                _translate(ka.description or "", target_lang),
            )
            return ka

        r.key_actions = list(
            await asyncio.gather(*[_translate_action(ka) for ka in r.key_actions])
        )

    # ── escalations[].title + body + when_to_use + expected_outcome + subject
    if r.escalations:
        async def _translate_escalation(esc):
            (esc.title, esc.body) = await asyncio.gather(
                _translate(esc.title or "", target_lang),
                _translate(esc.body or "", target_lang),
            )
            # Also translate level_plain_title if present
            if hasattr(esc, "level_plain_title") and esc.level_plain_title:
                esc.level_plain_title = await _translate(
                    esc.level_plain_title, target_lang
                )
            # Translate when_to_use
            if hasattr(esc, "when_to_use") and esc.when_to_use:
                esc.when_to_use = await _translate(esc.when_to_use, target_lang)
            # Translate expected_outcome
            if hasattr(esc, "expected_outcome") and esc.expected_outcome:
                esc.expected_outcome = await _translate(esc.expected_outcome, target_lang)
            # Translate subject
            if hasattr(esc, "subject") and esc.subject:
                esc.subject = await _translate(esc.subject, target_lang)
            return esc

        r.escalations = list(
            await asyncio.gather(*[_translate_escalation(e) for e in r.escalations])
        )

    logger.info(
        f"Translation complete: {target_lang} | cache size: {len(_CACHE)} entries"
    )
    return r
