from flask import Flask, request, jsonify, send_file
from werkzeug.exceptions import HTTPException
from flask_cors import CORS
import os, io, PyPDF2
from docx import Document as DocxDocument
import google.generativeai as genai
from quiz import quiz_bp, init_quiz
from flashcard import flashcard_bp, init_flashcards
import chromadb
import requests
import tempfile, os, importlib
import hashlib
from better_profanity import profanity
import concurrent.futures
import threading
profanity.load_censor_words()
import re
from spellchecker import SpellChecker

# Cache for converted PDFs (in production, use Redis or file-based cache)
pdf_cache = {}
_spell_lock = threading.Lock()
_spell_checker = None

def get_spellchecker():
    global _spell_checker
    if _spell_checker is None:
        with _spell_lock:
            if _spell_checker is None:
                try:
                    _spell_checker = SpellChecker(language='en')
                except Exception as e:
                    print("[Spell] init error:", e)
                    _spell_checker = None
    return _spell_checker

# ====== CONFIG ======
app = Flask(__name__)
# CORS: allowlist via FRONTEND_ORIGINS env (comma-separated), default to localhost:3000 in dev
_origins = os.environ.get("FRONTEND_ORIGINS", "http://localhost:3000")
try:
    _raw_allow = [o.strip() for o in _origins.split(",") if o.strip()]
except Exception:
    _raw_allow = ["http://localhost:3000"]

# Convert wildcard entries like "*.vercel.app" to a regex Flask-CORS understands
_allow_processed = []
for entry in _raw_allow:
    if entry.startswith("*."):
        # Escape the domain part and allow http/https
        import re as _re
        domain = _re.escape(entry[2:])  # drop *.
        _allow_processed.append(fr"https?://.*\.{domain}$")
    elif entry.startswith("http://*.") or entry.startswith("https://*."):
        # Support scheme-qualified wildcard like "https://*.vercel.app"
        import re as _re
        scheme, rest = entry.split("://", 1)
        domain = rest[2:]  # drop *.
        domain_escaped = _re.escape(domain)
        _allow_processed.append(fr"{scheme}://.*\.{domain_escaped}$")
    else:
        _allow_processed.append(entry)

CORS(app, resources={r"/*": {"origins": _allow_processed}})

# Limit upload size to avoid overwhelming the server (25 MB)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024

URL_REGEX = re.compile(r"(https?://[^\s]+|www\.[^\s]+|ftp://[^\s]+|mailto:[^\s]+|t\.me/[^\s]+|discord\.gg/[^\s]+)", re.IGNORECASE)

# Configuration via environment variables for production readiness
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
NODE_BASE_URL = os.environ.get("NODE_BASE_URL", "http://localhost:5000")
SERVICE_TOKEN = os.environ.get("SERVICE_TOKEN", "smartdoc-service-token")
NODE_FETCH_TIMEOUT = int(os.environ.get("NODE_FETCH_TIMEOUT", "45"))
CHUNK_UPSERT_URL = os.environ.get("CHUNK_UPSERT_URL", f"{NODE_BASE_URL}/api/search/internal/chunks/upsert")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

TEXT_MODEL = os.environ.get("TEXT_MODEL", "models/gemini-2.5-flash")  # stable free model
EMBED_MODEL = os.environ.get("EMBED_MODEL", "models/text-embedding-004")

# Persistent Chroma DB (configurable path)
# Use CHROMA_DB_PATH to place the vector store on a persistent disk in production (e.g., /var/data/chroma_db on Render)
CHROMA_DB_PATH = os.environ.get("CHROMA_DB_PATH", os.path.join(os.getcwd(), "chroma_db"))

def _ensure_dir(p: str) -> str:
    try:
        os.makedirs(p, exist_ok=True)
        return p
    except Exception as e:
        print("[Chroma] Failed to create directory", p, "=>", e)
        return ""

def _init_chroma_client():
    # Try env path (absolute normalized), then fallback to ./chroma_db,
    # finally fallback to ephemeral client so the app stays up.
    env_path = os.path.abspath(CHROMA_DB_PATH)
    if _ensure_dir(env_path):
        try:
            cli = chromadb.PersistentClient(path=env_path)
            print(f"[Chroma] Persistent path: {env_path}")
            return cli
        except Exception as e:
            print("[Chroma] PersistentClient failed for", env_path, "=>", e)
    default_path = os.path.abspath(os.path.join(os.getcwd(), "chroma_db"))
    if _ensure_dir(default_path):
        try:
            cli = chromadb.PersistentClient(path=default_path)
            print(f"[Chroma] Fallback persistent path: {default_path}")
            return cli
        except Exception as e:
            print("[Chroma] PersistentClient failed for default path", default_path, "=>", e)
    try:
        cli = chromadb.EphemeralClient()
        print("[Chroma] Using EphemeralClient (no persistence)")
        return cli
    except Exception as e:
        # As the last resort, rethrow to fail fast
        raise e

chroma_client = _init_chroma_client()
collection = chroma_client.get_or_create_collection("documents")

def contains_link(text):
    return bool(URL_REGEX.search(text))

# Treat high-distance (low similarity) results as not relevant
NOISE_DISTANCE_THRESHOLD = 0.6

# ====== GREETING/SMALL-TALK DETECTION & TOPIC SUGGESTIONS ======
GREET_WORDS = {
    "hi", "hello", "hey", "yo", "hola", "namaste",
    "good morning", "good afternoon", "good evening",
    "gm", "ge", "gn"
}
SMALL_TALK = {"how are you", "what's up", "sup", "howdy"}
WISHES = {"have a nice day", "good day", "good night"}

GENERIC_TOPICS = [
    "Introduction", "Overview", "Summary", "Background", "Objectives",
    "Methodology", "Approach", "Results", "Discussion", "Conclusion",
    "Features", "Requirements", "Limitations", "Future Work"
]

def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())

def is_greeting_or_smalltalk(text: str) -> bool:
    s = _norm(text)
    if not s:
        return False
    # very short, no question mark
    if len(s) <= 40 and "?" not in s:
        for kw in list(GREET_WORDS) + list(SMALL_TALK) + list(WISHES):
            if s == kw or re.search(rf"(^|\b){re.escape(kw)}(\b|$)", s):
                return True
    # explicit greetings even if longer
    for kw in GREET_WORDS:
        if re.search(rf"(^|\b){re.escape(kw)}(\b|$)", s):
            return True
    return False

def extract_headings_from_text(text: str, limit: int = 6) -> list:
    if not text:
        return []
    lines = [ln.strip() for ln in text.splitlines()]
    candidates = []
    seen = set()
    num_pat = re.compile(r"^\d+(?:\.\d+){0,3}\s+.{3,80}$")
    keyword_set = {k.lower() for k in GENERIC_TOPICS}
    for ln in lines:
        if not ln or len(ln) > 100:
            continue
        low = ln.lower()
        is_upperish = (ln == ln.upper() and 3 <= len(ln) <= 80)
        ends_colon = ln.endswith(":") and 3 <= len(ln) <= 80
        looks_numbered = bool(num_pat.match(ln))
        has_keyword = any(k in low for k in keyword_set)
        words = ln.split()
        short_title = 1 <= len(words) <= 8 and ln[0].isupper()
        if looks_numbered or is_upperish or ends_colon or has_keyword or short_title:
            key = low.strip(":")
            if key not in seen:
                seen.add(key)
                # Clean trailing colon and excessive dots
                clean = ln.strip().rstrip(": .")
                candidates.append(clean)
                if len(candidates) >= limit:
                    break
    return candidates

def suggest_topics_for_doc(doc_id: str) -> list:
    # If consent indicates sensitive and not confirmed, don't parse the doc; return generic topics
    st = consent_state.get(doc_id) or {}
    if st.get("sensitive") and not st.get("confirmed"):
        return GENERIC_TOPICS[:6]
    # Try to fetch and parse
    try:
        ok, filename, mimetype, data_bytes = fetch_doc_from_node(doc_id)
        if not ok:
            return GENERIC_TOPICS[:6]
        text = extract_text_for_mimetype(filename or "document", mimetype or "", data_bytes or b"")
        heads = extract_headings_from_text(text, limit=6)
        return heads if heads else GENERIC_TOPICS[:6]
    except Exception:
        return GENERIC_TOPICS[:6]

# ====== SENSITIVE DATA DETECTION STATE & PATTERNS ======
# In-memory consent state per document. Persist in DB/Redis in production.
# { doc_id: { "sensitive": bool, "confirmed": bool, "awaiting": bool, "last_scan": str, "summary": dict } }
consent_state = {}
general_fallback = {}

SENSITIVE_PATTERNS = {
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "phone": re.compile(r"\b(?:\+?\d{1,3}[\s-]?)?(?:\d{3}[\s-]?){2}\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d[ -]?){13,19}\b"),
    "pan": re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"),
    "aadhaar": re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b"),
    "ssn_like": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
}

def detect_sensitive(text: str) -> dict:
    summary = {"found": False, "matches": {}}
    if not text:
        return summary
    any_found = False
    for name, pattern in SENSITIVE_PATTERNS.items():
        try:
            hits = pattern.findall(text)
            if hits:
                any_found = True
                summary["matches"][name] = len(hits)
        except Exception:
            continue
    summary["found"] = any_found
    # Log only counts/types, not values
    print("[Sensitive Check] Summary:", {"found": summary["found"], "matches": summary["matches"]})
    return summary

# ====== HELPERS ======
def extract_text_from_pdf_bytes(data: bytes) -> str:
    text = ""
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(data))
        for page in reader.pages:
            content = page.extract_text() or ""
            text += content + "\n"
    except Exception as e:
        print("PDF extraction error:", e)
    return text

def extract_text_from_docx_bytes(data: bytes) -> str:
    text = ""
    try:
        with io.BytesIO(data) as f:
            doc = DocxDocument(f)
            for p in doc.paragraphs:
                text += p.text + "\n"
    except Exception as e:
        print("DOCX extraction error:", e)
    return text

def extract_text_from_txt_bytes(data: bytes) -> str:
    try:
        return data.decode("utf-8", errors="ignore")
    except Exception as e:
        print("TXT extraction error:", e)
        return ""

def extract_text_for_mimetype(filename: str, mimetype: str, data: bytes) -> str:
    ext = (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")
    if mimetype == "application/pdf" or ext == "pdf":
        return extract_text_from_pdf_bytes(data)
    elif mimetype in ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword") or ext in ("docx", "doc"):
        return extract_text_from_docx_bytes(data)
    elif mimetype == "text/plain" or ext == "txt":
        return extract_text_from_txt_bytes(data)
    return ""

def chunk_text(text, size=1000, overlap=200):
    """Paragraph-aware chunking with overlap.
    - Prefer splitting on double newlines (paragraphs) to preserve context boundaries.
    - Then pack paragraphs into windows up to ~size characters with overlap between windows.
    """
    text = (text or "").strip()
    if not text:
        return []

    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paras:
        paras = [text]

    windows = []
    buf = []
    cur_len = 0
    for p in paras:
        p_len = len(p) + 2  # account for a newline joiner
        if cur_len + p_len <= size or not buf:
            buf.append(p)
            cur_len += p_len
        else:
            windows.append("\n\n".join(buf))
            # start next window with overlap from the tail of previous buffer
            join = "\n\n".join(buf)
            if overlap > 0 and len(join) > overlap:
                tail = join[-overlap:]
                buf = [tail, p]
                cur_len = len(tail) + p_len
            else:
                buf = [p]
                cur_len = p_len
    if buf:
        windows.append("\n\n".join(buf))
    return windows

def split_sheet_sections(text: str):
    """Split text into sections by lines that start with '# Sheet: <name>'.
    Returns list of tuples (sheet_name, content_str). If no markers found, returns [(None, text)].
    """
    lines = (text or "").splitlines()
    sections = []
    current_name = None
    current_lines = []
    found = False
    for ln in lines:
        if ln.startswith("# Sheet: "):
            found = True
            if current_lines:
                sections.append((current_name, "\n".join(current_lines).strip()))
                current_lines = []
            current_name = ln[len("# Sheet: "):].strip() or None
        else:
            current_lines.append(ln)
    if current_lines:
        sections.append((current_name, "\n".join(current_lines).strip()))
    if not found:
        return [(None, text or "")]
    return [(name, body) for (name, body) in sections if (body or "").strip()]

def _embed_call(text: str):
    return genai.embed_content(
        model=EMBED_MODEL,
        content=text,
        task_type="retrieval_document"
    )

def generate_embeddings(text, timeout_sec: int = 20):
    """Generate embeddings with a timeout to avoid hanging requests."""
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_embed_call, text)
            result = fut.result(timeout=timeout_sec)
            return result.get("embedding") if isinstance(result, dict) else None
    except concurrent.futures.TimeoutError:
        print("Embedding timeout after", timeout_sec, "seconds")
        return None
    except Exception as e:
        print("Embedding error:", e)
        return None

# ====== ENDPOINTS ======

# ---- HEALTHCHECK ----
@app.route("/healthz", methods=["GET"]) 
def healthz():
    return jsonify({"status": "ok"})

# ---- SPELLCHECK (Flask fallback) ----
@app.route("/api/spellcheck", methods=["GET"])
def spellcheck_single():
    word = (request.args.get("word") or "").strip()
    if not word or not re.match(r"^[A-Za-z'\-]{2,}$", word):
        return jsonify({"correct": True, "suggestions": []})
    sp = get_spellchecker()
    if not sp:
        return jsonify({"correct": True, "suggestions": []})
    low = word.lower()
    is_correct = low not in sp.unknown([low])
    if is_correct:
        return jsonify({"correct": True, "suggestions": []})
    try:
        # best guess
        best = sp.correction(low)
        # a few candidates including best
        cands = list(sp.candidates(low))
        # move best to front and limit
        if best in cands:
            cands.remove(best)
        suggestions = [best] + cands[:4]
    except Exception:
        suggestions = []
    return jsonify({"correct": False, "suggestions": suggestions})

@app.route("/api/spellcheck/batch", methods=["POST"])
def spellcheck_batch():
    body = request.get_json(silent=True) or {}
    words = body.get("words") or []
    if not isinstance(words, list):
        words = []
    cleaned = []
    for w in words:
        try:
            s = str(w or "").strip()
            if s and re.match(r"^[A-Za-z'\-]{2,}$", s):
                cleaned.append(s.lower())
        except Exception:
            continue
    cleaned = list(dict.fromkeys(cleaned))  # dedupe, preserve order
    if not cleaned:
        return jsonify({"results": {}})
    sp = get_spellchecker()
    if not sp:
        return jsonify({"results": {}})
    unknown = sp.unknown(cleaned)
    results = {}
    for w in cleaned:
        if w in unknown:
            try:
                best = sp.correction(w)
            except Exception:
                best = None
            results[w] = {"correct": False}
            if best:
                results[w]["suggestion"] = best
        else:
            results[w] = {"correct": True}
    return jsonify({"results": results})

# ---- ROOT ----
@app.route("/", methods=["GET", "HEAD"]) 
def root():
    return jsonify({"service": "SmartDocQ Flask", "status": "ok"})

# ---- INDEX FROM ATLAS (optional manual trigger) ----
@app.route("/api/index-from-atlas", methods=["POST"])
def index_from_atlas():
    body = request.get_json(silent=True) or {}
    doc_id = (body.get("documentId") or body.get("doc_id") or "").strip()
    if not doc_id:
        return jsonify({"error": "Missing documentId"}), 400
    try:
        ok, filename, mimetype, data = fetch_doc_from_node(doc_id)
        if not ok:
            return jsonify({"error": filename}), 404
        # Scan first and defer indexing if sensitive and not confirmed
        text = extract_text_for_mimetype(filename, mimetype, data)
        if not text:
            return jsonify({"error": "Unsupported or empty document"}), 400
        scan = detect_sensitive(text)
        prev = consent_state.get(doc_id) or {}
        consent_state[doc_id] = {
            "sensitive": bool(scan.get("found")),
            "confirmed": bool(prev.get("confirmed", False)),
            "awaiting": False,
            "last_scan": "ok",
            "summary": scan,
        }
        if scan.get("found") and not prev.get("confirmed", False):
            return jsonify({
                "message": "Sensitive data detected; indexing deferred until consent.",
                "requireConfirmation": True,
                "sensitiveSummary": scan,
                "doc_id": doc_id,
            }), 200

        # No sensitive data or already confirmed: proceed to index
        indexed, added = index_bytes(doc_id, filename, mimetype, data)
        if not indexed:
            return jsonify({"error": "Unsupported or empty document"}), 400
        return jsonify({"message": f"Indexed {added} chunks", "doc_id": doc_id, "requireConfirmation": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---- Word to PDF Conversion Endpoint ----
@app.route("/api/convert/word-to-pdf", methods=["POST"])
def convert_word_to_pdf():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        if not file or file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Read file data
        data = file.read()
        filename = file.filename or "document"
        
        # Check if it's a Word document
        ext = (filename.rsplit('.',1)[-1].lower() if '.' in filename else '')
        content_type = file.content_type or ''
        
        if content_type not in ("application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document") and ext not in ("doc", "docx"):
            return jsonify({"error": "Not a Word document"}), 415
        
        # Lazy import docx2pdf
        try:
            docx2pdf = importlib.import_module("docx2pdf")
        except Exception:
            return jsonify({"error": "docx2pdf not installed on server"}), 501
        
        # Convert to PDF
        with tempfile.TemporaryDirectory() as td:
            in_path = os.path.join(td, filename)
            # Ensure extension
            if not in_path.lower().endswith((".docx", ".doc")):
                in_path += ".docx"
            
            # Write input file
            with open(in_path, 'wb') as f:
                f.write(data)
            
            temp_pdf = os.path.join(td, "converted.pdf")
            
            # Convert using docx2pdf
            docx2pdf.convert(in_path, temp_pdf)
            
            # Read converted PDF
            with open(temp_pdf, 'rb') as f:
                pdf_data = f.read()
            
            # Return PDF as response
            response = app.response_class(
                pdf_data,
                mimetype='application/pdf',
                headers={'Content-Disposition': f'attachment; filename="{filename.rsplit(".", 1)[0]}.pdf"'}
            )
            return response
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---- Word Preview as PDF ----
@app.route("/api/document/preview/<doc_id>.pdf", methods=["GET"])
def preview_word_as_pdf(doc_id):
    try:
        # Check cache first
        cache_key = f"pdf_preview_{doc_id}"
        if cache_key in pdf_cache:
            cached_path = pdf_cache[cache_key]
            if os.path.exists(cached_path):
                return send_file(cached_path, mimetype="application/pdf", as_attachment=False, download_name="preview.pdf")
            else:
                # Remove stale cache entry
                del pdf_cache[cache_key]
        
        ok, filename, mimetype, data = fetch_doc_from_node(doc_id)
        if not ok:
            return jsonify({"error": filename}), 404
        # Only support Word types here
        ext = (filename.rsplit('.',1)[-1].lower() if '.' in filename else '')
        if mimetype not in ("application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document") and ext not in ("doc", "docx"):
            return jsonify({"error": "Not a Word document"}), 415
        
        # Lazy import docx2pdf
        try:
            docx2pdf = importlib.import_module("docx2pdf")
        except Exception:
            return jsonify({"error": "docx2pdf not installed on server"}), 501
        
        # Create persistent cache directory
        cache_dir = os.path.join(os.getcwd(), "pdf_cache")
        os.makedirs(cache_dir, exist_ok=True)
        
        # Generate cache file path based on doc_id and content hash
        content_hash = hashlib.md5(data).hexdigest()[:8]
        cached_pdf = os.path.join(cache_dir, f"{doc_id}_{content_hash}.pdf")
        
        # If cached version exists, serve it
        if os.path.exists(cached_pdf):
            pdf_cache[cache_key] = cached_pdf
            return send_file(cached_pdf, mimetype="application/pdf", as_attachment=False, download_name="preview.pdf")
        
        # Convert and cache
        with tempfile.TemporaryDirectory() as td:
            in_path = os.path.join(td, filename)
            # Ensure extension
            if not in_path.lower().endswith((".docx", ".doc")):
                in_path += ".docx"
            with open(in_path, 'wb') as f:
                f.write(data)
            temp_pdf = os.path.join(td, "preview.pdf")
            # Convert using Word (Windows) or LibreOffice if configured by docx2pdf
            docx2pdf.convert(in_path, temp_pdf)
            
            # Copy to persistent cache
            import shutil
            shutil.copy2(temp_pdf, cached_pdf)
            pdf_cache[cache_key] = cached_pdf
            
            return send_file(cached_pdf, mimetype="application/pdf", as_attachment=False, download_name="preview.pdf")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---- MY DOCS ----
@app.route("/api/document/my", methods=["GET"])
def list_docs():
    # This endpoint is optional if frontend uses Node for listing
    result = collection.get()
    metas = result.get("metadatas", []) or []
    docs = {}
    for m in metas:
        if not m:
            continue
        doc_id = m.get("doc_id")
        if not doc_id:
            continue
        name = m.get("filename", "unknown")
        if doc_id not in docs:
            ext = (name.rsplit(".", 1)[-1].lower() if "." in name else "text")
            docs[doc_id] = {"_id": doc_id, "name": name, "type": ext, "size": 0}
    return jsonify(list(docs.values()))

# ---- RENAME ----
@app.route("/api/document/<doc_id>", methods=["PUT"])
def rename_doc(doc_id):
    data = request.get_json(silent=True) or {}
    new_name = data.get("name", "").strip()
    if not new_name:
        return jsonify({"error": "Missing new name"}), 400
    all_meta = collection.get()["metadatas"]
    for m in all_meta:
        if m and m.get("doc_id") == doc_id:
            m["filename"] = new_name
    return jsonify({"message": "Renamed successfully"})

# ---- DELETE ----
@app.route("/api/document/<doc_id>", methods=["DELETE"])
def delete_doc(doc_id):
    all_ids = collection.get()["ids"]
    to_delete = [i for i in all_ids if i.startswith(doc_id)]
    if to_delete:
        collection.delete(ids=to_delete)
    return jsonify({"message": "Deleted successfully"})

# ---- ASK ----
# Specific HTTP 404 as JSON (avoid 500s on unknown paths)
@app.errorhandler(404)
def handle_404(e):
    return jsonify({"error": "Not found"}), 404

# Global error handler to ensure JSON always (non-HTTP exceptions)
@app.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e, HTTPException):
        return jsonify({"error": e.description}), getattr(e, "code", 500)
    print("Unhandled Exception:", e)
    return jsonify({"error": str(e)}), 500

# Return JSON when file is too large
@app.errorhandler(413)
def handle_request_entity_too_large(e):
    return jsonify({"error": "File too large. Max 25 MB."}), 413

# ---- ASK (Chat-ready) ----
@app.route("/api/document/ask", methods=["POST"])
def ask_doc():
    data = request.get_json(silent=True) or {}
    question = data.get("question", "").strip()
    doc_id = data.get("doc_id", "").strip()

    if not question:
        return jsonify({"error": "Missing question"}), 400
    # Intercept greetings/small talk and guide the user with topic suggestions
    if is_greeting_or_smalltalk(question):
        topics = suggest_topics_for_doc(doc_id) if doc_id else GENERIC_TOPICS[:6]
        # Build a concise, friendly guidance message
        bullet = "\n".join(f"- {t}" for t in topics)
        msg = (
            "Hello! 👋 I’m here to help you with your document. You can ask questions about the following sections/topics in your document:\n"
            f"{bullet}\n\n"
            "Please type a question related to one of these topics."
        )
        return jsonify({"answer": msg, "requireConfirmation": False})
    
    if URL_REGEX.search(question):
        return jsonify({"answer": "⚠️ No links allowed. Please ask using text only."}), 422
    if profanity.contains_profanity(question):
        return jsonify({"answer": "⚠️ Please avoid using offensive words."}), 422
    
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    try:
        # Consent gate: if sensitive and not confirmed, interpret y/n, otherwise warn
        state = consent_state.get(doc_id) or {"sensitive": False, "confirmed": False, "awaiting": False}
        if state.get("sensitive") and not state.get("confirmed"):
            q_lower = question.lower().strip()
            if q_lower in ("y", "yes"):
                state["confirmed"] = True
                state["awaiting"] = False
                consent_state[doc_id] = state
                return jsonify({
                    "answer": "Proceeding. You can now ask questions about this document.",
                    "requireConfirmation": False
                })
            if q_lower in ("n", "no"):
                state["awaiting"] = False
                consent_state[doc_id] = state
                return jsonify({
                    "answer": "Chat cancelled. Please re-upload a cleaned version of the document without sensitive data.",
                    "requireConfirmation": False
                })
            # Prompt for confirmation
            state["awaiting"] = True
            consent_state[doc_id] = state
            return jsonify({
                "answer": "⚠️ Sensitive or private information detected in this document (e.g., personal IDs, contact info, or financial data).\nDo you still want to proceed with chatting about it? (y/n)",
                "requireConfirmation": True,
                "sensitiveSummary": state.get("summary", {})
            })

        # General knowledge fallback consent: if awaiting, interpret current input as y/n
        gf = general_fallback.get(doc_id) or {"awaiting": False}
        if gf.get("awaiting"):
            q_lower = question.lower().strip()
            if q_lower in ("y", "yes"):
                # Generate a general (non-document) answer for the original pending question
                orig_q = gf.get("pending_question") or ""
                # Clear state
                general_fallback[doc_id] = {"awaiting": False}

                if not orig_q:
                    return jsonify({
                        "answer": "Okay, please ask your question again.",
                    })
                # Use the LLM without document context
                prompt = f"""
You are a helpful assistant. Provide a clear, accurate answer to the user's question below.

Question: {orig_q}
"""
                model = genai.GenerativeModel(TEXT_MODEL)
                try:
                    response = model.generate_content(prompt)
                    if response and response.text:
                        return jsonify({"answer": format_response(response.text.strip())})
                    else:
                        return jsonify({"answer": "⚠️ Could not generate a general answer."})
                except Exception as e:
                    print("General fallback error:", e)
                    return jsonify({"answer": "⚠️ Error generating a general answer. Please try again."})

            if q_lower in ("n", "no"):
                # Clear state and decline
                general_fallback[doc_id] = {"awaiting": False}
                return jsonify({
                    "answer": "Okay, I won't answer that. Please ask a question based on the uploaded document.",
                })

            # Still awaiting an explicit y/n
            return jsonify({
                "answer": "⚠️ I couldn't find relevant information about your question in the uploaded document.\nDo you want me to answer using general knowledge instead? Reply \"y\" for yes or \"n\" for no.",
            })

        # Ensure the document is indexed in Chroma for this doc_id. If not, start background indexing and return fast.
        if not has_index(doc_id):
            # Kick off background indexing once per doc_id to avoid blocking
            _start_background_indexing(doc_id)
            return jsonify({
                "answer": "Indexing this document in the background. Please try your question again in ~30–60 seconds.",
                "requireConfirmation": False
            })

        # Generate embedding for the question
        q_emb = generate_embeddings(question)
        if not q_emb:
            return jsonify({"error": "Failed to generate embedding"}), 500

        # Query Chroma for top-N relevant chunks (wider net)
        results = collection.query(
            query_embeddings=[q_emb],
            n_results=12,
            where={"doc_id": doc_id},
            include=["documents", "distances"]
        )

        docs = results.get("documents", [[]])[0] or []
        dists = results.get("distances", [[]])[0] or []
        # Lexical re-ranking to boost true positives inside the document
        def _keywords(s: str):
            stop = {"the","a","an","and","or","of","in","on","to","for","is","are","was","were","be","with","by","at","from","as","that","this","it","its","if","then","than","into","about","over","under","within","between"}
            toks = re.split(r"[^A-Za-z0-9]+", (s or "").lower())
            return {t for t in toks if len(t) >= 3 and t not in stop and not t.isdigit()}

        q_terms = _keywords(question)
        candidates = []
        for doc_txt, dist in zip(docs, dists):
            if not doc_txt:
                continue
            terms = _keywords(doc_txt)
            overlap = len(q_terms & terms)
            if dist is None:
                dist = 0.5
            # Combine distance (lower is better) and lexical overlap (higher is better)
            sim = 1.0 - max(0.0, min(1.0, dist))
            score = 0.7 * sim + 0.3 * (overlap / (len(q_terms) or 1))
            candidates.append((score, dist, overlap, doc_txt))

        # Keep top k by score; also respect a noise ceiling to cut extreme outliers
        candidates.sort(key=lambda x: x[0], reverse=True)
        topk = [c[-1] for c in candidates[:5] if c[1] is None or c[1] < 0.9]
        filtered = [doc for doc, dist in zip(docs, dists) if (dist is None) or (dist < 0.6)]
        if not topk and not filtered:
            # No relevant chunks found: offer user a choice to use general knowledge (y/n)
            general_fallback[doc_id] = {
                "awaiting": True,
                "pending_question": question,
            }
            return jsonify({
                "answer": (
                    "I couldn't find relevant information about your question in the uploaded document.\n"
                    "Do you want me to answer using general knowledge instead? Reply \"y\" for yes or \"n\" for no."
                )
            })

        # Combine chunks into context: prefer reranked results, fall back to strict filtered
        context = "\n\n".join(topk or filtered)

        # Build prompt for LLM with formatting instructions
        prompt = f"""
You are a document assistant. Use ONLY the context below to answer the question.
Do NOT include anything that is not in the context.

Please format your response clearly with:
- Proper line breaks between paragraphs
- Use bullet points or numbered lists when appropriate
- Break up long text into readable paragraphs
- Add spacing for better readability

Context:
{context}

Question: {question}

Answer strictly from the context with proper formatting:
"""
        model = genai.GenerativeModel(TEXT_MODEL)
        # Avoid hanging: cap model call to ~30s
        response = model.generate_content(prompt, request_options={"timeout": 30})

        # Return AI answer with improved formatting
        if response and response.text:
            raw_text = (response.text or "").strip()
            # If the model indicates the answer isn't in context, offer general knowledge y/n choice
            if is_out_of_doc_answer(raw_text):
                general_fallback[doc_id] = {
                    "awaiting": True,
                    "pending_question": question,
                }
                appended = (
                    raw_text
                    + "\n\nDo you want me to answer using general knowledge instead? Reply \"y\" for yes or \"n\" for no."
                )
                return jsonify({"answer": format_response(appended), "requireConfirmation": False})

            # Otherwise, format and return normally
            answer_text = format_response(raw_text)
            return jsonify({"answer": answer_text, "requireConfirmation": False})
        else:
            return jsonify({"answer": "⚠️ Could not generate answer."})

    except Exception as e:
        print("Ask error:", e)
        return jsonify({"error": str(e)}), 500

def format_response(text):
    """
    Improve the formatting of AI responses for better readability
    """
    import re
    
    # Remove extra whitespace while preserving intentional line breaks
    text = re.sub(r'\n\s*\n\s*\n+', '\n\n', text)  # Remove excessive line breaks
    text = re.sub(r'[ \t]+', ' ', text)  # Normalize spaces
    
    # Add line breaks after periods that end sentences (not abbreviations)
    text = re.sub(r'(\w)\. ([A-Z])', r'\1.\n\n\2', text)
    
    # Add proper spacing around bullet points and numbers
    text = re.sub(r'^\s*[-•*]\s*', '• ', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*(\d+)\.\s*', r'\1. ', text, flags=re.MULTILINE)
    
    # Add line breaks before bullet points and numbered lists
    text = re.sub(r'([.!?])\s*(•|\d+\.)', r'\1\n\n\2', text)
    
    # Ensure there's spacing after colons when introducing lists
    text = re.sub(r':(\s*)(•|\d+\.)', r':\n\n\1\2', text)
    
    # Add spacing around section headers (text that ends with colon)
    text = re.sub(r'([^:\n]):\s*\n', r'\1:\n\n', text)
    
    # Clean up and return
    text = text.strip()
    return text

def is_out_of_doc_answer(text: str) -> bool:
    """Heuristically detect when the LLM indicates the answer isn't in the provided context/document.
    This helps us surface the y/n general-knowledge prompt even when reranked context existed but lacked the answer.
    """
    low = (text or "").strip().lower()
    if not low:
        return False
    patterns = [
        "not in the context",
        "context provided does not contain",
        "provided context does not contain",
        "does not contain information",
        "doesn't contain information",
        "i couldn't find",
        "i could not find",
        "couldn't find in your document",
        "could not find in your document",
        "not found in your document",
        "not found in the document",
        "no relevant information",
        "not available in the document",
        "outside the document",
        "outside of the document",
        "not present in the document",
    ]
    return any(p in low for p in patterns)

def fetch_doc_from_node(doc_id: str):
    """Fetch binary document from Node API /api/document/:id/download (requires user token in frontend).
    For server-side, assume Node allows local trusted call without auth or you can add a service token.
    """
    try:
        url = f"{NODE_BASE_URL}/api/document/{doc_id}/download"
        # Use service token for server-to-server auth
        headers = {"x-service-token": SERVICE_TOKEN}
        r = requests.get(url, headers=headers, timeout=NODE_FETCH_TIMEOUT)
        if r.status_code != 200:
            return False, f"Node returned {r.status_code}", None, None
        # Try to parse filename from headers; fallback
        disp = r.headers.get("Content-Disposition", "")
        filename = "document"
        if "filename=" in disp:
            filename = disp.split("filename=")[-1].strip('"')
        mimetype = r.headers.get("Content-Type", "application/octet-stream")
        return True, filename, mimetype, r.content
    except Exception as e:
        return False, str(e), None, None

# --- Background indexing support ---
_indexing_in_progress = set()
_indexing_lock = threading.Lock()

def _background_index(doc_id: str):
    try:
        ok, filename, mimetype, data_bytes = fetch_doc_from_node(doc_id)
        if not ok:
            return
        # Scan and respect consent before indexing
        text_for_scan = extract_text_for_mimetype(filename, mimetype, data_bytes)
        if not text_for_scan:
            return
        scan = detect_sensitive(text_for_scan)
        prev = consent_state.get(doc_id) or {}
        consent_state[doc_id] = {
            "sensitive": bool(scan.get("found")),
            "confirmed": bool(prev.get("confirmed", False)),
            "awaiting": False,
            "last_scan": "ok",
            "summary": scan,
        }
        if scan.get("found") and not prev.get("confirmed", False):
            # Do not index until consent
            return
        index_bytes(doc_id, filename, mimetype, data_bytes)
    finally:
        with _indexing_lock:
            _indexing_in_progress.discard(doc_id)

def _start_background_indexing(doc_id: str):
    with _indexing_lock:
        if doc_id in _indexing_in_progress:
            return
        _indexing_in_progress.add(doc_id)
    th = threading.Thread(target=_background_index, args=(doc_id,), daemon=True)
    th.start()

def has_index(doc_id: str) -> bool:
    res = collection.get(where={"doc_id": doc_id})
    ids = res.get("ids", [])
    return bool(ids)

def index_bytes(doc_id: str, filename: str, mimetype: str, data: bytes):
    text = ""
    ext = (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")
    if mimetype == "application/pdf" or ext == "pdf":
        text = extract_text_from_pdf_bytes(data)
    elif mimetype in ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword") or ext in ("docx", "doc"):
        text = extract_text_from_docx_bytes(data)
    elif mimetype == "text/plain" or ext == "txt":
        text = extract_text_from_txt_bytes(data)
    else:
        return False, 0

    text = (text or "").strip()
    if not text:
        return False, 0

    # Safer re-indexing: remove any existing chunks for this document to avoid duplicate IDs
    try:
        existing = collection.get(where={"doc_id": doc_id}) or {}
        existing_ids = existing.get("ids", []) or []
        if existing_ids:
            collection.delete(ids=existing_ids)
    except Exception as _:
        pass

    sections = split_sheet_sections(text)
    added = 0
    chunk_records = []

    # Batch add to Chroma to reduce DB overhead
    BATCH_SIZE = 64
    batch_embeddings = []
    batch_documents = []
    batch_metadatas = []
    batch_ids = []

    def flush_batch():
        nonlocal added, batch_embeddings, batch_documents, batch_metadatas, batch_ids
        if not batch_ids:
            return
        collection.add(
            embeddings=batch_embeddings,
            documents=batch_documents,
            metadatas=batch_metadatas,
            ids=batch_ids,
        )
        added += len(batch_ids)
        batch_embeddings = []
        batch_documents = []
        batch_metadatas = []
        batch_ids = []

    chunk_index = 0
    for (sheet_name, body) in sections:
        chunks = chunk_text(body)
        for i, chunk in enumerate(chunks):
            c = (chunk or "").strip()
            if not c:
                continue
            emb = generate_embeddings(c)
            if not emb:
                continue
            batch_embeddings.append(emb)
            batch_documents.append(c)
            meta = {"doc_id": doc_id, "chunk": chunk_index, "filename": filename}
            if sheet_name:
                meta["sheet"] = sheet_name
            batch_metadatas.append(meta)
            batch_ids.append(f"{doc_id}_{chunk_index}")
            # capture for keyword index
            try:
                chunk_records.append({"chunk": chunk_index, "sheet": sheet_name or None, "text": c})
            except Exception:
                pass
            chunk_index += 1

            if len(batch_ids) >= BATCH_SIZE:
                flush_batch()

    # Flush remaining items
    flush_batch()
    _push_chunks_to_node(doc_id, filename, chunk_records)
    return True, added

def index_text(doc_id: str, filename: str, text: str):
    """
    Index plain text content for a given document id by replacing existing chunks.
    Returns (indexed: bool, added_count: int).
    """
    text = (text or "").strip()
    if not text:
        return False, 0

    # Remove any existing chunks for this document to avoid duplicate IDs
    try:
        existing = collection.get(where={"doc_id": doc_id}) or {}
        existing_ids = existing.get("ids", []) or []
        if existing_ids:
            collection.delete(ids=existing_ids)
    except Exception:
        pass

    sections = split_sheet_sections(text)
    added = 0
    chunk_records = []

    # Batch add to Chroma to reduce DB overhead
    BATCH_SIZE = 64
    batch_embeddings = []
    batch_documents = []
    batch_metadatas = []
    batch_ids = []

    def flush_batch():
        nonlocal added, batch_embeddings, batch_documents, batch_metadatas, batch_ids
        if not batch_ids:
            return
        collection.add(
            embeddings=batch_embeddings,
            documents=batch_documents,
            metadatas=batch_metadatas,
            ids=batch_ids,
        )
        added += len(batch_ids)
        batch_embeddings = []
        batch_documents = []
        batch_metadatas = []
        batch_ids = []

    chunk_index = 0
    for (sheet_name, body) in sections:
        chunks = chunk_text(body)
        for i, chunk in enumerate(chunks):
            c = (chunk or "").strip()
            if not c:
                continue
            emb = generate_embeddings(c)
            if not emb:
                continue
            batch_embeddings.append(emb)
            batch_documents.append(c)
            meta = {"doc_id": doc_id, "chunk": chunk_index, "filename": filename or "document.txt"}
            if sheet_name:
                meta["sheet"] = sheet_name
            batch_metadatas.append(meta)
            batch_ids.append(f"{doc_id}_{chunk_index}")
            try:
                chunk_records.append({"chunk": chunk_index, "sheet": sheet_name or None, "text": c})
            except Exception:
                pass
            chunk_index += 1

            if len(batch_ids) >= BATCH_SIZE:
                flush_batch()

    # Flush remaining items
    flush_batch()
    _push_chunks_to_node(doc_id, filename or "document.txt", chunk_records)
    return True, added

def _push_chunks_to_node(doc_id: str, filename: str, chunk_records: list):
    """Best-effort push of chunk texts to Node for keyword/metadata search. Non-fatal on error."""
    try:
        if not chunk_records:
            return
        payload = {
            "doc_id": doc_id,
            "filename": filename,
            "chunks": chunk_records,
        }
        headers = {"Content-Type": "application/json", "x-service-token": SERVICE_TOKEN}
        r = requests.post(CHUNK_UPSERT_URL, json=payload, headers=headers, timeout=NODE_FETCH_TIMEOUT)
        if r.status_code >= 300:
            print("[Chunks Upsert] Node returned", r.status_code, r.text[:200])
    except Exception as e:
        print("[Chunks Upsert] Error:", e)

# Endpoint to record user consent and optionally trigger indexing
@app.route("/api/document/consent", methods=["POST"])
def set_consent():
    body = request.get_json(silent=True) or {}
    doc_id = (body.get("doc_id") or body.get("documentId") or "").strip()
    consent = bool(body.get("consent", False))
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400
    st = consent_state.get(doc_id) or {"sensitive": False, "confirmed": False}
    st["confirmed"] = consent
    st["awaiting"] = False
    consent_state[doc_id] = st

    # If user consents and document is not indexed, index now
    if consent and not has_index(doc_id):
        ok, filename, mimetype, data_bytes = fetch_doc_from_node(doc_id)
        if not ok:
            return jsonify({"error": filename}), 404
        indexed, added = index_bytes(doc_id, filename, mimetype, data_bytes)
        if not indexed:
            return jsonify({"error": "Unsupported or empty document"}), 400
        return jsonify({"message": f"Consent recorded. Indexed {added} chunks.", "requireConfirmation": False})

    if not consent:
        return jsonify({"message": "Consent declined. Please upload a cleaned document.", "requireConfirmation": False})

    return jsonify({"message": "Consent recorded.", "requireConfirmation": False})

@app.route("/api/index/replace-text", methods=["POST"])
def replace_text_index():
    """
    Replace the indexed content for a document with the provided plain text, without re-uploading the file.
    Request JSON:
      { "doc_id"|"documentId": str, "text": str, "filename"?: str }
    Response JSON mirrors /api/index-from-atlas with requireConfirmation handling.
    """
    body = request.get_json(silent=True) or {}
    doc_id = (body.get("documentId") or body.get("doc_id") or "").strip()
    text = body.get("text")
    filename = (body.get("filename") or "document.txt").strip()

    if not doc_id:
        return jsonify({"error": "Missing documentId"}), 400
    if text is None:
        return jsonify({"error": "Missing text"}), 400

    try:
        # Scan and respect consent before indexing
        scan = detect_sensitive(text or "")
        prev = consent_state.get(doc_id) or {}
        consent_state[doc_id] = {
            "sensitive": bool(scan.get("found")),
            "confirmed": bool(prev.get("confirmed", False)),
            "awaiting": False,
            "last_scan": "ok",
            "summary": scan,
        }
        if scan.get("found") and not prev.get("confirmed", False):
            return jsonify({
                "message": "Sensitive data detected; indexing deferred until consent.",
                "requireConfirmation": True,
                "sensitiveSummary": scan,
                "doc_id": doc_id,
            }), 200

        indexed, added = index_text(doc_id, filename, text)
        if not indexed:
            return jsonify({"error": "Empty text or indexing failed"}), 400
        return jsonify({"message": f"Indexed {added} chunks", "doc_id": doc_id, "requireConfirmation": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Register blueprints and initialize modules
try:
    init_quiz(
        collection,
        has_index,
        fetch_doc_from_node,
        extract_text_for_mimetype,
        TEXT_MODEL,
        genai,
    )
    app.register_blueprint(quiz_bp)
except Exception as _e:
    # Avoid crashing on import in environments without genai; endpoints remain available if init succeeds later
    pass

try:
    init_flashcards(
        collection,
        has_index,
        fetch_doc_from_node,
        extract_text_for_mimetype,
        TEXT_MODEL,
        genai,
    )
    app.register_blueprint(flashcard_bp)
except Exception as _e:
    pass

# ====== RUN SERVER ======
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)