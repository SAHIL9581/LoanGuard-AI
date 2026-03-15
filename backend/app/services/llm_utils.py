import json
import re
from typing import Any


_CODE_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
_TRAILING_COMMA_RE = re.compile(r",(?=\s*[}\]])")
_INVALID_ESCAPE_RE = re.compile(r'\\(?!["\\/bfnrtu])')
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")


def coerce_content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content") or ""
                if text:
                    parts.append(str(text))
            elif item:
                parts.append(str(item))
        return "\n".join(parts).strip()
    if content is None:
        return ""
    return str(content).strip()


def _strip_code_fences(text: str) -> str:
    match = _CODE_FENCE_RE.search(text)
    if match:
        return match.group(1).strip()
    return text.strip()


def _extract_json_slice(text: str) -> str:
    start_candidates = [index for index in (text.find("{"), text.find("[")) if index != -1]
    if not start_candidates:
        return text

    start = min(start_candidates)
    end_object = text.rfind("}")
    end_array = text.rfind("]")
    end = max(end_object, end_array)
    if end == -1 or end <= start:
        return text[start:]
    return text[start : end + 1]


def _escape_string_newlines(text: str) -> str:
    result: list[str] = []
    in_string = False
    escaped = False

    for char in text:
        if in_string:
            if escaped:
                result.append(char)
                escaped = False
                continue
            if char == "\\":
                result.append(char)
                escaped = True
                continue
            if char == '"':
                result.append(char)
                in_string = False
                continue
            if char == "\n":
                result.append("\\n")
                continue
            if char == "\r":
                continue
            if char == "\t":
                result.append("\\t")
                continue
            result.append(char)
            continue

        result.append(char)
        if char == '"':
            in_string = True

    return "".join(result)


def _repair_json_text(text: str) -> str:
    repaired = _strip_code_fences(text)
    repaired = _extract_json_slice(repaired)
    repaired = _escape_string_newlines(repaired)
    repaired = _INVALID_ESCAPE_RE.sub(r"\\\\", repaired)
    repaired = _TRAILING_COMMA_RE.sub("", repaired)
    repaired = _CONTROL_CHARS_RE.sub("", repaired)
    return repaired.strip()


def parse_json_payload(content: Any) -> Any:
    raw_text = coerce_content_to_text(content)
    if not raw_text:
        raise ValueError("Empty LLM response content")

    candidates = [raw_text]
    stripped = _strip_code_fences(raw_text)
    if stripped != raw_text:
        candidates.append(stripped)
    sliced = _extract_json_slice(stripped)
    if sliced not in candidates:
        candidates.append(sliced)

    repaired_candidates: list[str] = []
    for candidate in candidates:
        repaired = _repair_json_text(candidate)
        if repaired and repaired not in candidates and repaired not in repaired_candidates:
            repaired_candidates.append(repaired)
    candidates.extend(repaired_candidates)

    last_error: Exception | None = None
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as exc:
            last_error = exc

    raise ValueError(f"Failed to parse JSON response: {last_error}")