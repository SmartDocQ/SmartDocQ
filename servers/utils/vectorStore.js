const fetch = require("node-fetch");
const logger = require("../lib/logger");

const FLASK_BASE = (
  process.env.FLASK_BASE_URL ||
  process.env.PY_API_URL ||
  process.env.PY_API_BASE ||
  process.env.FLASK_URL ||
  "http://localhost:5001"
).replace(/\/$/, "");

const FLASK_FETCH_TIMEOUT = Number(process.env.FLASK_FETCH_TIMEOUT || "45") * 1000;

async function deleteDocumentVectors(docId) {
  if (!docId) {
    throw new Error("Missing doc_id for vector deletion");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLASK_FETCH_TIMEOUT);

  try {
    const response = await fetch(
      `${FLASK_BASE}/api/document/${encodeURIComponent(docId)}`,
      {
        method: "DELETE",
        headers: {
          "x-service-token": process.env.SERVICE_TOKEN,
        },
        signal: controller.signal,
      }
    );

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `Flask vector deletion failed (${response.status}): ${body}`
      );
    }

    logger.info(
      { doc_id: docId },
      "Document vectors deleted successfully"
    );

    return true;
  } catch (err) {
    logger.error(
      { err, doc_id: docId },
      "Failed to delete document vectors"
    );

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteDocumentsVectors(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return;
  }
  for (const doc of documents) {
    if (doc && doc.doc_id) {
      await deleteDocumentVectors(doc.doc_id);
    }
  }
}

module.exports = {
  deleteDocumentVectors,
  deleteDocumentsVectors,
};
