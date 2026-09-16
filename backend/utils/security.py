import os
import re
import hmac
import logging
from functools import wraps
from flask import request, jsonify, current_app
from better_profanity import profanity
from config import URL_REGEX, JAILBREAK_THRESHOLD

logger = logging.getLogger(__name__)

profanity.load_censor_words()

# ====== SENSITIVE DATA PATTERNS ======
SENSITIVE_PATTERNS = {
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    # India-focused mobile patterns (precision over global coverage)
    # Matches:
    # - 9876543210
    # - 98765 43210
    # - +91 9876543210
    # - +91-98765-43210
    "phone": re.compile(
        r"\b(?:\+91[\s-]?)?[6-9]\d{9}\b"
        r"|\b(?:\+91[\s-]?)?[6-9]\d{4}[\s-]\d{5}\b"
    ),
    "credit_card": re.compile(r"\b(?:\d[ -]?){13,19}\b"),
    "pan": re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"),
    "aadhaar": re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b"),
    "ssn_like": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
}


# ====== LUHN CHECK (for credit cards) ======
def _luhn_check(number: str) -> bool:
    digits = [int(d) for d in number if d.isdigit()]
    if len(digits) < 13:
        return False

    checksum = 0
    reverse = digits[::-1]

    for i, d in enumerate(reverse):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d

    return checksum % 10 == 0


# ====== VERHOEFF CHECK (for Aadhaar) ======
# Verhoeff multiplication table
_VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

# Verhoeff permutation table
_VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def _verhoeff_check(number: str) -> bool:
    digits = [int(d) for d in number if d.isdigit()]
    if len(digits) != 12:
        return False

    c = 0
    for i, digit in enumerate(reversed(digits)):
        # Verhoeff permutation table has an 8-step repeating cycle; i % 8 is intentional.
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][digit]]

    return c == 0


def _is_valid_indian_phone(number: str) -> bool:
    digits = "".join(c for c in (number or "") if c.isdigit())
    if not digits:
        return False

    # Allow optional leading country code/prefixes
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]

    return len(digits) == 10 and digits[0] in "6789"


def detect_sensitive(text: str) -> dict:
    summary = {"found": False, "matches": {}}
    if not text:
        return summary

    any_found = False

    for name, pattern in SENSITIVE_PATTERNS.items():
        try:
            hits = pattern.findall(text)
            if not hits:
                continue

            # ===== Credit card special handling =====
            if name == "credit_card":
                valid_hits = []

                for h in hits:
                    clean = "".join(c for c in h if c.isdigit())

                    if _luhn_check(clean):
                        valid_hits.append(h)

                if valid_hits:
                    any_found = True
                    summary["matches"][name] = len(valid_hits)

            # ===== Aadhaar special handling (Verhoeff checksum) =====
            elif name == "aadhaar":
                valid_hits = []

                for h in hits:
                    clean = "".join(c for c in h if c.isdigit())
                    if _verhoeff_check(clean):
                        valid_hits.append(h)

                if valid_hits:
                    any_found = True
                    summary["matches"][name] = len(valid_hits)

            # ===== Phone special handling (India mobile heuristics) =====
            elif name == "phone":
                valid_hits = []

                for h in hits:
                    if _is_valid_indian_phone(h):
                        valid_hits.append(h)

                if valid_hits:
                    any_found = True
                    summary["matches"][name] = len(valid_hits)

            else:
                any_found = True
                summary["matches"][name] = len(hits)

        except Exception as e:
            # Prevent silently swallow errors
            logger.warning("Sensitive detection error for %s: %s", name, e)

    summary["found"] = any_found

    # Use debug level
    logger.debug(
        "[Sensitive Check] found=%s matches=%s",
        summary["found"],
        summary["matches"],
    )

    return summary


def contains_link(text: str) -> bool:
    return bool(URL_REGEX.search(text))


def contains_profanity(text: str) -> bool:
    return profanity.contains_profanity(text)


# ====== GREETING / SMALL-TALK DETECTION ======
GREET_WORDS = {
    "hi", "hello", "hey", "yo", "hola", "namaste",
    "good morning", "good afternoon", "good evening",
    "gm", "gn"
}

SMALL_TALK = {"how are you", "what's up", "sup", "howdy"}
WISHES = {"have a nice day", "good day", "good night"}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def is_greeting_or_smalltalk(text: str) -> bool:
    s = _norm(text)
    if not s:
        return False

    # Only treat short messages as greetings/small-talk.
    # This avoids misclassifying real questions that merely contain words like "hey".
    if len(s) > 40:
        return False

    # Normalize simple trailing punctuation.
    s_trim = re.sub(r"[\s\.!?,]+$", "", s)

    # If it's a question, only allow the known small-talk questions (e.g., "how are you?").
    if "?" in s:
        return s_trim in SMALL_TALK

    # Non-question: match only if the whole message is essentially a greeting/smalltalk/wish.
    if s_trim in GREET_WORDS or s_trim in SMALL_TALK or s_trim in WISHES:
        return True

    # Allow a small set of friendly variants like "hello there".
    if re.fullmatch(r"(?:hi|hello|hey|yo|hola|namaste)\s+there", s_trim):
        return True

    return False


# ====== JAILBREAK / PROMPT-INJECTION (USER INPUT) ======
# Use *high-precision* patterns and a conservative threshold to avoid false positives.
# We intentionally DO NOT match broad phrases like "act as" or "pretend you are".
HIGH_RISK_PATTERNS = (
    (re.compile(r"ignore\s+(all\s+)?previous\s+instructions?", re.IGNORECASE), 3),
    (re.compile(r"disregard\s+(all\s+)?instructions?", re.IGNORECASE), 3),
    (re.compile(r"forget\s+your\s+instructions?", re.IGNORECASE), 3),
    (re.compile(r"reveal\s+(your|the)\s+(system|developer)\s+prompt", re.IGNORECASE), 4),
    (re.compile(r"print\s+(your|the)\s+(system|developer)\s+prompt", re.IGNORECASE), 4),
    (re.compile(r"developer\s+mode", re.IGNORECASE), 3),
    (re.compile(r"system\s+prompt", re.IGNORECASE), 2),
    (re.compile(r"prompt\s+leak", re.IGNORECASE), 3),
    (re.compile(r"jailbreak", re.IGNORECASE), 3),
    (re.compile(r"bypass\s+(your|the)\s+(rules|restrictions|guardrails)", re.IGNORECASE), 3),
    (re.compile(r"answer\s+using\s+outside\s+knowledge", re.IGNORECASE), 2),
    (re.compile(r"ignore\s+the\s+document", re.IGNORECASE), 2),
)


def jailbreak_score(text: str) -> int:
    s = (text or "").strip()
    if not s:
        return 0

    score = 0
    for pattern, weight in HIGH_RISK_PATTERNS:
        if pattern.search(s):
            score += weight

    return score


def contains_jailbreak_attempt(text: str) -> bool:
    """Return True if the text exceeds the configured jailbreak-risk threshold."""
    return jailbreak_score(text) >= JAILBREAK_THRESHOLD


# ====== SERVICE AUTHENTICATION (DEFAULT-DENY) ======
def public_route(f):
    """Decorator to mark a route as publicly accessible without a service token."""
    f._is_public = True
    return f

def verify_service_token_default():
    """Default-deny check for incoming service requests. Validates x-service-token using hmac.compare_digest."""
    # Allow OPTIONS requests for CORS preflights
    if request.method == "OPTIONS":
        return None
    # Allow health checks and root
    if request.path in ("/healthz", "/"):
        return None

    if request.endpoint:
        view_func = current_app.view_functions.get(request.endpoint)
        if view_func and getattr(view_func, "_is_public", False):
            return None

    token = request.headers.get("x-service-token")
    expected = os.environ.get("SERVICE_TOKEN")
    if not expected:
        return jsonify({"error": "Service configuration error: SERVICE_TOKEN not set"}), 500

    if not token or not hmac.compare_digest(token, expected):
        return jsonify({"error": "Unauthorized: Invalid service token"}), 401

    # Log user ID if provided
    user_id = request.headers.get("x-user-id")
    if user_id:
        current_app.logger.info(f"[Service Auth] Request from user {user_id} on {request.path}")

    return None