from dotenv import load_dotenv
load_dotenv()

import os
import logging
from services.gemini_client import genai, TEXT_MODEL
from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from config import ALLOWED_ORIGINS, MAX_CONTENT_LENGTH, FLASK_DEBUG, MAX_UPLOAD_SIZE_MB
from routes.document_routes import document_bp
from routes.ask_routes import ask_bp

# ====== LOGGING ======
logging.basicConfig(
    level=getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


# ====== APP FACTORY ======
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}}, supports_credentials=True)

# ====== BLUEPRINTS ======
app.register_blueprint(document_bp)
app.register_blueprint(ask_bp)
from features.table_edit import table_edit_bp
app.register_blueprint(table_edit_bp)

# ====== EXTERNAL BLUEPRINTS (quiz, flashcard, summarize) ======
try:
    from features.quiz import quiz_bp, init_quiz
    from db.chroma import collection
    from indexing.indexer import has_index
    from services.retrieval_service import fetch_doc_from_node
    from utils.extraction import extract_text_for_mimetype

    init_quiz(collection, has_index, fetch_doc_from_node, extract_text_for_mimetype, TEXT_MODEL, genai)
    app.register_blueprint(quiz_bp)
except Exception as e:
    print("Quiz blueprint not loaded:", e)

try:
    from features.flashcard import flashcard_bp, init_flashcards
    from db.chroma import collection
    from indexing.indexer import has_index
    from services.retrieval_service import fetch_doc_from_node
    from utils.extraction import extract_text_for_mimetype

    init_flashcards(collection, has_index, fetch_doc_from_node, extract_text_for_mimetype, TEXT_MODEL, genai)
    app.register_blueprint(flashcard_bp)
except Exception as e:
    print("Flashcard blueprint not loaded:", e)

try:
    from features.summarize import init_summarizer, summarize_bp
    app.register_blueprint(init_summarizer(TEXT_MODEL, genai))
except Exception:
    pass

# ====== ERROR HANDLERS ======
@app.errorhandler(404)
def handle_404(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(413)
def handle_request_entity_too_large(e):
    return jsonify({"error": f"File too large. Max {MAX_UPLOAD_SIZE_MB} MB."}), 413


@app.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e, HTTPException):
        return jsonify({"error": e.description}), getattr(e, "code", 500)
    logger.exception("Unhandled exception")
    message = str(e) if FLASK_DEBUG else "An internal server error occurred."
    return jsonify({"error": message}), 500


from utils.security import public_route, verify_service_token_default

# ====== BEFORE REQUEST HOOK ======
app.before_request(verify_service_token_default)


# ====== HEALTHCHECK / ROOT ======
@app.route("/healthz", methods=["GET"])
@public_route
def healthz():
    return jsonify({"status": "ok"})


@app.route("/", methods=["GET", "HEAD"])
@public_route
def root():
    return jsonify({"service": "SmartDocQ Flask", "status": "ok"})


# ====== RUN SERVER ======
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=FLASK_DEBUG)
