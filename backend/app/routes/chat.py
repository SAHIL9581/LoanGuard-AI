import os
import re
import json
import httpx
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from loguru import logger


router = APIRouter(prefix="/api/chat", tags=["chat"])

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────
def _get_api_key() -> str:
    key = os.getenv("SARVAM_API_KEY", "sk_0xca8qn7_9w2hkvoEzFLO7NKjLgkFShUW")
    if not key:
        raise HTTPException(status_code=500, detail="SARVAM_API_KEY environment variable is not set")
    return key

def _strip_think_tags(text: str) -> str:
    # If properly closed, take what's after </think>
    if '</think>' in text:
        return text.split('</think>', 1)[-1].strip()
    # If <think> opened but never closed, the content IS the answer — just remove the opening tag
    if text.strip().startswith('<think>'):
        return text.strip()[len('<think>'):].strip()
    return text.strip()

SARVAM_STT_URL  = "https://api.sarvam.ai/speech-to-text"
SARVAM_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions"
SARVAM_TTS_URL  = "https://api.sarvam.ai/text-to-speech"


LOANGUARD_SYSTEM_PROMPT = """

You are LoanGuard AI, a multilingual financial safety assistant that helps users understand loan agreements, EMI calculations, and potential regulatory violations.

You receive structured audit results from the LoanGuard pipeline (loan extraction, EMI analysis, violations, risk score, escalation suggestions). Use this data to explain findings clearly.

Your tasks:
• Explain loan findings in simple language
• Clarify EMI calculations and possible overcharges
• Explain potential regulatory violations (including RBI guidelines)
• Suggest safe next steps such as filing complaints or escalating issues
• Warn users about risky clauses or unfair terms
• Inform users when escalation letters can be generated

Language:
Reply in the user's language. Supported: English, Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali.

Tone:
Clear, calm, professional, and supportive. Avoid jargon.

Rules:
• Base answers only on the provided audit results
• Do not provide legal advice
• Do not accuse lenders of fraud — say “potential violation”
• If confidence is low, mention results may require verification
• Never output <think> or internal reasoning

"""

FINSIGHT_SYSTEM_PROMPT = """
You are FinSight AI, a multilingual financial health coach helping users understand spending habits, financial health scores, and investment planning.

You receive structured analysis results containing:
• Spending analysis and categorized expenses
• Financial Health Score (0–100) with indicators like savings rate and debt ratio
• Spending anomalies
• Suggested SIP or investment allocations based on risk profile

Your tasks:
• Explain spending patterns and saving opportunities
• Interpret the Financial Health Score and suggest improvements
• Explain investment allocation logic in simple terms
• Highlight suspicious or unusual transactions
• Encourage healthy financial habits

Language:
Reply in the user's language. Supported: English, Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali.

Tone:
Friendly, supportive, and educational.

Rules:
• Base responses only on provided financial analysis
• Never guarantee investment returns
• Do not recommend specific stocks
• Mention that projections rely on historical data
• Encourage professional consultation for complex matters
• Never output <think> or internal reasoning

"""

# In-memory conversation store: { session_id: [messages] }
conversation_store: dict[str, list[dict]] = {}
MAX_HISTORY_MESSAGES = 6
MAX_USER_MESSAGE_CHARS = 1200
MAX_CONTEXT_CHARS = 4000
MAX_PAYLOAD_CHARS = 16000


# ─────────────────────────────────────────────
# Pydantic schemas
# ─────────────────────────────────────────────
class ChatTextRequest(BaseModel):
    session_id: str
    message: str
    audit_context: Optional[dict] = None
    context_type: str = "loanguard"  # "loanguard" or "finsight"
    language_code: str = "en-IN"
    enable_tts: bool = False
    tts_speaker: str = "shubh"


class ChatResponse(BaseModel):
    session_id: str
    user_message: str
    assistant_message: str
    audio_base64: Optional[str] = None
    detected_language: Optional[str] = None


# ─────────────────────────────────────────────
# Helper – Speech to Text
# ─────────────────────────────────────────────
async def speech_to_text(audio_bytes: bytes, filename: str, language_code: str = "unknown") -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        files = {"file": (filename, audio_bytes, "application/octet-stream")}
        data  = {
            "model": "saaras:v3",
            "mode": "transcribe",
            "language_code": language_code,
        }
        headers = {"api-subscription-key": _get_api_key()}
        response = await client.post(SARVAM_STT_URL, headers=headers, files=files, data=data)

        if response.status_code != 200:
            logger.error(f"STT error {response.status_code}: {response.text}")
            raise HTTPException(status_code=502, detail=f"Speech-to-text failed: {response.text}")

        result = response.json()
        return {
            "transcript": result.get("transcript", ""),
            "detected_language": result.get("language_code"),
        }


# ─────────────────────────────────────────────
# Helper – Chat Completion
# ─────────────────────────────────────────────
def _clip_text(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)].rstrip() + "..."


def _compact_loanguard_context(audit_context: dict) -> dict:
    extraction = audit_context.get("extraction", {}) or {}
    emi_analysis = audit_context.get("emi_analysis", {}) or {}
    risk_score = audit_context.get("risk_score", {}) or {}
    key_actions = audit_context.get("key_actions", []) or []
    violations = audit_context.get("violations", []) or []

    compact = {
        "plain_summary": _clip_text(audit_context.get("plain_summary", ""), 700),
        "loan_snapshot": {
            "lender_name": extraction.get("lender_name"),
            "borrower_name": extraction.get("borrower_name"),
            "loan_type": extraction.get("loan_type"),
            "principal": extraction.get("principal"),
            "interest_rate": extraction.get("interest_rate"),
            "apr": extraction.get("apr"),
            "emi_stated": extraction.get("emi_stated"),
            "tenure_months": extraction.get("tenure_months"),
        },
        "risk_snapshot": {
            "risk_category": risk_score.get("risk_category"),
            "total_score": risk_score.get("total_score"),
            "appeal_success_probability": risk_score.get("appeal_success_probability"),
            "overcharge_estimate": emi_analysis.get("overcharge_estimate"),
        },
        "critical_violations": (_clip_text(item, 180) for item in audit_context.get("critical_violations_plain", [])[:4]),
        "top_violations": [
            {
                "issue_type": item.get("issue_type"),
                "severity": item.get("severity"),
                "plain_english": _clip_text(item.get("plain_english", ""), 140),
                "action_hint": _clip_text(item.get("action_hint", ""), 160),
            }
            for item in violations[:5]
        ],
        "key_actions": [
            {
                "priority": item.get("priority"),
                "action": _clip_text(item.get("action", ""), 120),
                "description": _clip_text(item.get("description", ""), 180),
            }
            for item in key_actions[:4]
        ],
    }
    compact["critical_violations"] = list(compact["critical_violations"])
    return compact


def _compact_finsight_context(audit_context: dict) -> dict:
    return {
        "summary": _clip_text(audit_context.get("summary", ""), 700),
        "insights": [_clip_text(item, 180) for item in (audit_context.get("insights", []) or [])[:5]],
        "financial_health_score": audit_context.get("financial_health_score"),
        "total_expenses": audit_context.get("total_expenses"),
        "existing_monthly_savings": audit_context.get("existing_monthly_savings"),
        "surplus": audit_context.get("surplus"),
        "sip_suggestions": [
            {
                "item": item.get("item"),
                "cost": item.get("cost"),
                "sip_10yr_potential": item.get("sip_10yr_potential"),
                "reasoning": _clip_text(item.get("reasoning", ""), 160),
            }
            for item in (audit_context.get("sip_suggestions", []) or [])[:4]
        ],
    }


def _compact_context(audit_context: Optional[dict], context_type: str) -> str:
    if not audit_context:
        return ""

    compact = (
        _compact_finsight_context(audit_context)
        if context_type == "finsight"
        else _compact_loanguard_context(audit_context)
    )
    return _clip_text(json.dumps(compact, ensure_ascii=False, indent=2), MAX_CONTEXT_CHARS)


def _build_user_content(message: str, audit_context: Optional[dict], context_type: str) -> str:
    clipped_message = _clip_text(message, MAX_USER_MESSAGE_CHARS)
    context_str = _compact_context(audit_context, context_type)
    if context_str:
        return f"[AUDIT CONTEXT]\n{context_str}\n\n[USER MESSAGE]\n{clipped_message}"
    return clipped_message


def _prune_history(history: list[dict]) -> list[dict]:
    if not history:
        return []

    system_message = history[0]
    recent_messages = history[1:]
    if len(recent_messages) > MAX_HISTORY_MESSAGES:
        recent_messages = recent_messages[-MAX_HISTORY_MESSAGES:]

    budget = MAX_PAYLOAD_CHARS - len(system_message.get("content", ""))
    selected: list[dict] = []
    running = 0
    for message in reversed(recent_messages):
        content = message.get("content", "")
        if running + len(content) > budget and selected:
            break
        selected.append(message)
        running += len(content)

    selected.reverse()
    return [system_message] + selected


def _build_minimal_retry_history(history: list[dict]) -> list[dict]:
    if not history:
        return []

    system_message = history[0]
    latest_user_message = next(
        (message for message in reversed(history[1:]) if message.get("role") == "user"),
        None,
    )
    if latest_user_message is None:
        return [system_message]

    compact_user_message = latest_user_message.get("content", "")
    if "[USER MESSAGE]" in compact_user_message:
        compact_user_message = compact_user_message.split("[USER MESSAGE]", 1)[-1].strip()

    return [
        system_message,
        {
            "role": "user",
            "content": _clip_text(compact_user_message, 500),
        },
    ]


async def chat_completion(session_id: str, user_message: str, audit_context: Optional[dict], context_type: str = "loanguard") -> str:
    if session_id not in conversation_store:
        system_prompt = FINSIGHT_SYSTEM_PROMPT if context_type == "finsight" else LOANGUARD_SYSTEM_PROMPT
        conversation_store[session_id] = [
            {"role": "system", "content": system_prompt}
        ]

    history = conversation_store[session_id]
    user_content = _build_user_content(user_message, audit_context, context_type)
    history.append({"role": "user", "content": user_content})
    history = _prune_history(history)
    conversation_store[session_id] = history

    payload = {
        "model": "sarvam-m",
        "messages": history,
        "temperature": 0.3,
        "max_tokens": 1000,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            SARVAM_CHAT_URL,
            headers={"api-subscription-key": _get_api_key(), "Content-Type": "application/json"},
            json=payload,
        )

        if response.status_code != 200:
            response_text = response.text
            if response.status_code == 400 and "Prompt is too long" in response_text:
                retry_history = _build_minimal_retry_history(history)
                retry_payload = {
                    "model": "sarvam-m",
                    "messages": retry_history,
                    "temperature": 0.3,
                    "max_tokens": 1000,
                }
                retry_response = await client.post(
                    SARVAM_CHAT_URL,
                    headers={"api-subscription-key": _get_api_key(), "Content-Type": "application/json"},
                    json=retry_payload,
                )
                if retry_response.status_code == 200:
                    retry_data = retry_response.json()
                    retry_raw = retry_data["choices"][0]["message"]["content"]
                    retry_clean = _strip_think_tags(retry_raw)
                    retry_history.append({"role": "assistant", "content": retry_clean})
                    conversation_store[session_id] = _prune_history(retry_history)
                    logger.warning(f"[{session_id}] Chat payload was too large; retried with minimal context")
                    return retry_clean

                logger.error(f"Chat retry error {retry_response.status_code}: {retry_response.text}")
                raise HTTPException(status_code=502, detail=f"Chat completion failed after retry: {retry_response.text}")

            logger.error(f"Chat error {response.status_code}: {response_text}")
            raise HTTPException(status_code=502, detail=f"Chat completion failed: {response_text}")

        data = response.json()
        raw = data["choices"][0]["message"]["content"]
        clean = _strip_think_tags(raw)
        history.append({"role": "assistant", "content": clean})
        conversation_store[session_id] = _prune_history(history)
        return clean


# ─────────────────────────────────────────────
# Helper – Text to Speech
# ─────────────────────────────────────────────
async def text_to_speech(text: str, language_code: str, speaker: str) -> Optional[str]:
    if len(text) > 2500:
        text = text[:2500]

    payload = {
        "text": text,
        "target_language_code": language_code,
        "model": "bulbul:v3",
        "speaker": speaker,
        "speech_sample_rate": "22050",
        "pace": 1.0,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            SARVAM_TTS_URL,
            headers={"api-subscription-key": _get_api_key(), "Content-Type": "application/json"},
            json=payload,
        )

        if response.status_code != 200:
            logger.warning(f"TTS warning {response.status_code}: {response.text}")
            return None

        data = response.json()
        audios = data.get("audios", [])
        return audios[0] if audios else None


# ─────────────────────────────────────────────
# Endpoint 1 – Text chat
# ─────────────────────────────────────────────
@router.post("/text", response_model=ChatResponse, summary="Text-based chat with LoanGuard AI")
async def chat_with_text(body: ChatTextRequest):
    logger.info(f"[{body.session_id}] Text chat | lang={body.language_code}")

    assistant_reply = await chat_completion(
        session_id=body.session_id,
        user_message=body.message,
        audit_context=body.audit_context,
        context_type=body.context_type
    )

    audio_b64 = None
    if body.enable_tts:
        audio_b64 = await text_to_speech(
            text=assistant_reply,
            language_code=body.language_code,
            speaker=body.tts_speaker,
        )

    return ChatResponse(
        session_id=body.session_id,
        user_message=body.message,
        assistant_message=assistant_reply,
        audio_base64=audio_b64,
    )


# ─────────────────────────────────────────────
# Endpoint 2 – Voice chat
# ─────────────────────────────────────────────
@router.post("/voice", response_model=ChatResponse, summary="Voice-based chat with LoanGuard AI")
async def chat_with_voice(
    session_id: str = Form(...),
    audio_file: UploadFile = File(...),
    language_code: str = Form("unknown"),
    enable_tts: bool = Form(True),
    tts_speaker: str = Form("shubh"),
    audit_context: Optional[str] = Form(None),
    context_type: str = Form("loanguard"),
):
    logger.info(f"[{session_id}] Voice chat | lang={language_code} | file={audio_file.filename}")

    audit_dict = None
    if audit_context:
        try:
            audit_dict = json.loads(audit_context)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="audit_context must be valid JSON")

    audio_bytes = await audio_file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty")

    stt_result = await speech_to_text(
        audio_bytes=audio_bytes,
        filename=audio_file.filename or "audio.wav",
        language_code=language_code,
    )
    transcript = stt_result["transcript"]
    detected_lang = stt_result.get("detected_language")

    if not transcript.strip():
        raise HTTPException(status_code=422, detail="Could not transcribe audio — please try again")

    logger.info(f"[{session_id}] Transcript: {transcript[:120]}...")

    assistant_reply = await chat_completion(
        session_id=session_id,
        user_message=transcript,
        audit_context=audit_dict,
        context_type=context_type
    )

    tts_lang = detected_lang if detected_lang else (language_code if language_code != "unknown" else "en-IN")
    audio_b64 = None
    if enable_tts:
        audio_b64 = await text_to_speech(
            text=assistant_reply,
            language_code=tts_lang,
            speaker=tts_speaker,
        )

    return ChatResponse(
        session_id=session_id,
        user_message=transcript,
        assistant_message=assistant_reply,
        audio_base64=audio_b64,
        detected_language=detected_lang,
    )


# ─────────────────────────────────────────────
# Endpoint 3 – Clear session
# ─────────────────────────────────────────────
@router.delete("/session/{session_id}", summary="Clear conversation history for a session")
async def clear_session(session_id: str):
    if session_id in conversation_store:
        del conversation_store[session_id]
        logger.info(f"Session {session_id} cleared")
        return {"message": f"Session '{session_id}' cleared successfully"}
    return JSONResponse(status_code=404, content={"message": f"Session '{session_id}' not found"})


# ─────────────────────────────────────────────
# Endpoint 4 – Get session history
# ─────────────────────────────────────────────
@router.get("/session/{session_id}", summary="Retrieve conversation history for a session")
async def get_session(session_id: str):
    if session_id not in conversation_store:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    messages = [m for m in conversation_store[session_id] if m["role"] != "system"]
    return {"session_id": session_id, "messages": messages, "turn_count": len(messages) // 2}