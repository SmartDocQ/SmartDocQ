const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Document = require("../models/Document");
const DocChunk = require("../models/DocChunk");
const { verifyToken, ensureActive } = require("./auth");
// Lazy-loaded spellchecker (nspell + dictionary-en)
let _spell = null;
async function getSpell() {
  if (_spell) return _spell;
  const nspell = require("nspell");
  const dictionary = require("dictionary-en");
  return new Promise((resolve, reject) => {
    dictionary((err, dict) => {
      if (err) return reject(err);
      try {
        _spell = nspell(dict);
        resolve(_spell);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Internal upsert endpoint for Flask to persist chunk texts for keyword/metadata search
router.post("/internal/chunks/upsert", async (req, res) => {
  try {
    const svc = process.env.SERVICE_TOKEN || "smartdoc-service-token";
    const provided = req.header("x-service-token");
    if (!provided || provided !== svc) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { documentId, doc_id, filename, chunks } = req.body || {};
    if ((!documentId && !doc_id) || !Array.isArray(chunks)) {
      return res.status(400).json({ message: "Missing documentId/doc_id or chunks" });
    }

    let doc = null;
    if (documentId && mongoose.Types.ObjectId.isValid(documentId)) {
      doc = await Document.findById(documentId);
    }
    if (!doc && doc_id) {
      doc = await Document.findOne({ doc_id: doc_id });
    }
    if (!doc) return res.status(404).json({ message: "Document not found" });

    // Replace strategy: remove existing chunks then insert new ones
    await DocChunk.deleteMany({ doc: doc._id });

    const bulk = DocChunk.collection.initializeUnorderedBulkOp();
    const now = new Date();
    const fname = filename || doc.name;
    for (const c of chunks) {
      if (!c || typeof c.chunk !== "number" || typeof c.text !== "string") continue;
      bulk.find({ doc: doc._id, chunk: c.chunk }).upsert().replaceOne({
        user: doc.user,
        doc: doc._id,
        doc_id: doc.doc_id,
        filename: fname,
        sheet: c.sheet || null,
        chunk: c.chunk,
        text: c.text,
        createdAt: now,
      });
    }
    let result = { nUpserted: 0, nModified: 0 };
    if (bulk.length > 0) {
      const r = await bulk.execute();
      result = { nUpserted: r?.nUpserted || 0, nModified: r?.nModified || 0 };
    }

    return res.json({ message: "Chunks upserted", result });
  } catch (err) {
    return res.status(500).json({ message: err?.message || String(err) });
  }
});

// Public search endpoint (keyword-first). Falls back to $text or regex if Atlas Search is not configured.
router.get("/", verifyToken, ensureActive, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ message: "Missing q" });

    const limit = Math.min(parseInt(req.query.limit || "20", 10) || 20, 50);

    // Fallback using $text if index exists; otherwise regex (case-insensitive)
    let items = [];
    try {
      // Try $text
      items = await DocChunk.find(
        { user: req.userId, $text: { $search: q } },
        { score: { $meta: "textScore" }, text: 1, filename: 1, sheet: 1, doc: 1, doc_id: 1, chunk: 1 }
      ).sort({ score: { $meta: "textScore" } }).limit(limit).lean();
    } catch (_) {
      // Regex fallback (less performant)
      items = await DocChunk.find(
        { user: req.userId, text: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
        { text: 1, filename: 1, sheet: 1, doc: 1, doc_id: 1, chunk: 1 }
      ).limit(limit).lean();
    }

    // Simple snippet building
    const results = items.map(it => {
      const t = it.text || "";
      const idx = t.toLowerCase().indexOf(q.toLowerCase());
      let snippet = t.slice(0, 180);
      if (idx >= 0) {
        const start = Math.max(0, idx - 60);
        snippet = t.slice(start, start + 180);
      }
      return {
        documentId: it.doc,
        doc_id: it.doc_id,
        filename: it.filename,
        sheet: it.sheet || null,
        chunk: it.chunk,
        snippet,
        score: it.score || undefined,
      };
    });

    return res.json({ items: results, total: results.length });
  } catch (err) {
    return res.status(500).json({ message: err?.message || String(err) });
  }
});

module.exports = router;

// Simple spellcheck endpoint: returns whether a word is correct and a few suggestions
router.get("/spellcheck", verifyToken, ensureActive, async (req, res) => {
  try {
    const word = String(req.query.word || "").trim();
    if (!word || /[^A-Za-z'-]/.test(word) || word.length < 2) {
      return res.json({ correct: true, suggestions: [] });
    }
    const spell = await getSpell();
    const correct = spell.correct(word);
    const suggestions = correct ? [] : spell.suggestions(word).slice(0, 5);
    return res.json({ correct, suggestions });
  } catch (err) {
    return res.status(500).json({ message: err?.message || String(err) });
  }
});

// Batch spellcheck: { words: string[] } -> { results: { [word]: { correct: boolean, suggestion?: string } } }
router.post("/spellcheck/batch", verifyToken, ensureActive, async (req, res) => {
  try {
    const words = Array.isArray(req.body?.words) ? req.body.words : [];
    const cleaned = words
      .map(w => String(w || '').trim())
      .filter(w => !!w && /^[A-Za-z'\-]{2,}$/.test(w));
    if (!cleaned.length) return res.json({ results: {} });
    const unique = Array.from(new Set(cleaned.map(w => w.toLowerCase())));
    const spell = await getSpell();
    const results = {};
    for (const w of unique) {
      const correct = spell.correct(w);
      results[w] = correct ? { correct } : { correct, suggestion: (spell.suggestions(w) || [])[0] };
    }
    return res.json({ results });
  } catch (err) {
    return res.status(500).json({ message: err?.message || String(err) });
  }
});
