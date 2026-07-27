const express = require("express");
const router = express.Router();
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const Document = require("../models/Document");
const DocChunk = require("../models/DocChunk");
const { verifyToken, ensureActive } = require("../middlewares/auth");
const { verifyCsrf } = require("../middlewares/csrf");
const fetch = require("node-fetch");
const logger = require("../lib/logger");
const rateLimit = require("express-rate-limit");

const quizLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "Too many quiz generation requests. Please try again after a minute." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId
});

const flashcardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "Too many flashcard generation requests. Please try again after a minute." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId
});

const summarizeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { message: "Too many summarization requests. Please try again after a minute." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // Limit each user to 50 uploads per hour (generous for batch uploads of small files, but protects from automated spam)
  message: { message: "Too many document uploads. Please try again after an hour." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId
});


// Generate content hash for deduplication
function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeMimetype(mimetype, filename) {
  const type = String(mimetype || "").toLowerCase();
  const ext = path.extname(String(filename || "")).toLowerCase();

  // If the client/browser provides a specific type we trust it.
  if (
    type &&
    type !== "application/octet-stream" &&
    type !== "binary/octet-stream" &&
    type !== "" 
  ) {
    return type;
  }

  // Otherwise, infer from extension for known types.
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain";
  if (ext === ".csv") return "text/csv";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".doc") return "application/msword";
  return type || "application/octet-stream";
}

// Centralize Flask/Python backend base URL for deployments
function deriveBaseFrom(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin; // e.g., https://smartdocq-flask-xxxx.run.app
  } catch (_) {
    // Try a simple prefix up to /api/
    if (typeof urlStr === 'string') {
      const i = urlStr.indexOf('/api/');
      if (i > 0) return urlStr.slice(0, i);
    }
    return null;
  }
}

let FLASK_BASE = (process.env.FLASK_BASE_URL || process.env.PY_API_URL || process.env.PY_API_BASE || process.env.FLASK_URL || "").replace(/\/$/, "");
if (!FLASK_BASE && process.env.FLASK_INDEX_URL) {
  const derived = deriveBaseFrom(process.env.FLASK_INDEX_URL);
  if (derived) FLASK_BASE = derived.replace(/\/$/, "");
}
if (!FLASK_BASE) FLASK_BASE = "http://localhost:5001"; // dev fallback only

const FLASK_INDEX_URL = process.env.FLASK_INDEX_URL || `${FLASK_BASE}/api/index-from-atlas`;
const FLASK_REPLACE_TEXT_URL = process.env.FLASK_REPLACE_TEXT_URL || `${FLASK_BASE}/api/index/replace-text`;
const FLASK_CONVERT_URL = process.env.FLASK_CONVERT_URL || `${FLASK_BASE}/api/convert/word-to-pdf`;
const FLASK_FETCH_TIMEOUT = Number(process.env.FLASK_FETCH_TIMEOUT || "45") * 1000;

const rawMb = Number(process.env.MAX_UPLOAD_SIZE_MB);
const MAX_UPLOAD_SIZE_MB = Number.isFinite(rawMb) && rawMb > 0 ? rawMb : 15;
const MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain"
    ];
    const allowedExts = [".pdf", ".doc", ".docx", ".txt", ".csv", ".xlsx"];
    const ext = path.extname(String(file.originalname || "")).toLowerCase();
    const mime = normalizeMimetype(file.mimetype, file.originalname);

    if (!allowedMimes.includes(mime) && !allowedExts.includes(ext)) {
      return cb(new Error("Unsupported file type!"));
    }
    cb(null, true);
  }
});

router.post("/upload", verifyToken, ensureActive, verifyCsrf, uploadLimiter, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const { originalname, mimetype, size, buffer } = req.file;
    const normalizedMimetype = normalizeMimetype(mimetype, originalname);
    
    // === Database-Level Deduplication Check ===
    const contentHash = hashBuffer(buffer);
    const existingInProgress = await Document.findOne({
      user: req.userId,
      contentHash,
      processingStatus: { $in: ["queued", "indexing"] }
    }).select('_id doc_id name processingStatus processingStartedAt uploadedAt');
    
    if (existingInProgress) {
      // Calculate how long it's been processing
      const startedAt = existingInProgress.processingStartedAt || existingInProgress.uploadedAt;
      const processingTimeMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0;
      const processingTimeMins = Math.floor(processingTimeMs / 60000);
      
      return res.status(409).json({
        message: `This file is already being processed (${processingTimeMins} min). Please wait for it to complete.`,
        duplicate: true,
        existingDocumentId: existingInProgress._id,
        existingDocId: existingInProgress.doc_id,
        existingName: existingInProgress.name,
        status: existingInProgress.processingStatus,
        processingStartedAt: startedAt,
        processingTimeMinutes: processingTimeMins
      });
    }
    
    // Word conversion policy:
    // - Keep DOCX as DOCX by default so the Python service can extract structured tables.
    // - Allow opt-in conversion via CONVERT_DOCX_TO_PDF=1.
    const isDoc = normalizedMimetype === "application/msword";
    const isDocx = normalizedMimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const convertDocxToPdf = String(process.env.CONVERT_DOCX_TO_PDF || "").trim() === "1";
    const shouldConvertWordToPdf = isDoc || (isDocx && convertDocxToPdf);
    
    let finalBuffer = buffer;
    let finalMimetype = normalizedMimetype;
    let finalName = originalname;
    
    if (shouldConvertWordToPdf) {
      try {
        // Convert Word to PDF using Flask backend
        const formData = new (require('form-data'))();
        formData.append('file', buffer, {
          filename: originalname,
          contentType: normalizedMimetype
        });
        
        const convertResponse = await fetch(FLASK_CONVERT_URL, {
          method: 'POST',
          body: formData,
          headers: {
            ...formData.getHeaders(),
            'x-service-token': process.env.SERVICE_TOKEN,
            'x-user-id': req.userId ? req.userId.toString() : ''
          }
        });
        
        if (convertResponse.ok) {
          const pdfBuffer = await convertResponse.buffer();
          finalBuffer = pdfBuffer;
          finalMimetype = "application/pdf";
          finalName = originalname.replace(/\.(docx?|DOCX?)$/, ".pdf");
          logger.info({ file: originalname }, "Successfully converted to PDF");
        } else {
          logger.warn({ file: originalname }, "Conversion failed, storing original Word document");
        }
      } catch (conversionError) {
        logger.error({ err: conversionError, file: originalname }, "Word to PDF conversion error");
      }
    }

    // Compute hash of final buffer (may differ if converted)
    const finalContentHash = hashBuffer(finalBuffer);
    
    const doc = new Document({
      user: req.userId,
      name: finalName,
      type: finalMimetype,
      size: finalBuffer.length,
      data: finalBuffer,
      contentHash: finalContentHash,
      processingStatus: "queued",
      processingStartedAt: new Date(), // Track when processing started
      originalName: originalname, // Store original name for reference
      originalType: mimetype // Store original type for reference
    });
    
    // Atomic save with duplicate key handling (race condition safety net)
    try {
      await doc.save();
    } catch (saveErr) {
      if (saveErr.code === 11000) { // Duplicate key error
        return res.status(409).json({
          message: "This file is already being processed. Please wait for it to complete.",
          duplicate: true
        });
      }
      throw saveErr;
    }

    // Trigger Flask scan+index for supported document types.
    try {
      const type = (finalMimetype || '').toLowerCase();
      let textSample = '';
      if (
        type.includes('pdf') ||
        type === 'text/plain' ||
        type === 'text/csv' ||
        type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        type === 'application/msword'
      ) {
        // Ask Flask to scan-and-index; it will gate on consent and set statuses accordingly
        await fetch(FLASK_INDEX_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-service-token': process.env.SERVICE_TOKEN,
            'x-user-id': req.userId ? req.userId.toString() : ''
          },
          body: JSON.stringify({ documentId: doc.doc_id })
        });
        // Flask will set consent_state and skip indexing if sensitive & not confirmed
      } else {
        // Non-text binaries: fall back to async indexing trigger
        triggerIndexing(doc._id).catch(() => {});
      }
    } catch (_) {
      // If pre-scan fails, fall back to background trigger (do not block upload)
      triggerIndexing(doc._id).catch(() => {});
    }

    res.status(201).json({ 
      message: "File uploaded", 
      documentId: doc._id, 
      doc_id: doc.doc_id, 
      processingStatus: doc.processingStatus,
      converted: shouldConvertWordToPdf && finalMimetype === "application/pdf"
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Multi-file upload (up to 10 files)
router.post("/upload/batch", verifyToken, ensureActive, verifyCsrf, upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ message: "No files uploaded" });
    
    // === Pre-check for duplicates in batch ===
    const duplicateFiles = [];
    for (const f of req.files) {
      const hash = hashBuffer(f.buffer);
      const existing = await Document.findOne({
        user: req.userId,
        contentHash: hash,
        processingStatus: { $in: ["queued", "indexing"] }
      }).select('name');
      if (existing) {
        duplicateFiles.push(f.originalname);
      }
    }
    
    if (duplicateFiles.length > 0) {
      return res.status(409).json({
        message: `These files are already being processed: ${duplicateFiles.join(', ')}`,
        duplicate: true,
        duplicateFiles
      });
    }
    
    const created = [];
    const FormData = require('form-data');
    
    for (const f of req.files) {
      let finalBuffer = f.buffer;
      let finalMimetype = normalizeMimetype(f.mimetype, f.originalname);
      let finalName = f.originalname;
      
      // Word conversion policy (batch): keep DOCX as DOCX by default.
      const isDoc = finalMimetype === "application/msword";
      const isDocx = finalMimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const convertDocxToPdf = String(process.env.CONVERT_DOCX_TO_PDF || "").trim() === "1";
      const shouldConvertWordToPdf = isDoc || (isDocx && convertDocxToPdf);
      
      if (shouldConvertWordToPdf) {
        try {
          // Convert Word to PDF using Flask backend
          const formData = new FormData();
          formData.append('file', f.buffer, {
            filename: f.originalname,
            contentType: finalMimetype
          });
          
          const convertResponse = await fetch(FLASK_CONVERT_URL, {
            method: 'POST',
            body: formData,
            headers: {
              ...formData.getHeaders(),
              'x-service-token': process.env.SERVICE_TOKEN,
              'x-user-id': req.userId ? req.userId.toString() : ''
            }
          });
          
          if (convertResponse.ok) {
            const pdfBuffer = await convertResponse.buffer();
            finalBuffer = pdfBuffer;
            finalMimetype = "application/pdf";
            finalName = f.originalname.replace(/\.(docx?|DOCX?)$/, ".pdf");
            logger.info({ file: f.originalname }, "Successfully converted to PDF in batch");
          } else {
            logger.warn({ file: f.originalname }, "Conversion failed in batch, storing original");
          }
        } catch (conversionError) {
          logger.error({ err: conversionError, file: f.originalname }, "Word to PDF conversion error in batch");
        }
      }
      
      const finalContentHash = hashBuffer(finalBuffer);
      
      const doc = new Document({
        user: req.userId,
        name: finalName,
        type: finalMimetype,
        size: finalBuffer.length,
        data: finalBuffer,
        contentHash: finalContentHash,
        processingStatus: "queued",
        processingStartedAt: new Date(), // Track when processing started
        originalName: f.originalname,
        originalType: f.mimetype
      });
      
      // Atomic save with race condition handling
      try {
        await doc.save();
      } catch (saveErr) {
        if (saveErr.code === 11000) {
          // Skip this file, it's being processed by another request
          continue;
        }
        throw saveErr;
      }
      try {
        const type = (finalMimetype || '').toLowerCase();
        if (
          type.includes('pdf') ||
          type === 'text/plain' ||
          type === 'text/csv' ||
          type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          type === 'application/msword'
        ) {
          await fetch(FLASK_INDEX_URL, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-service-token': process.env.SERVICE_TOKEN,
              'x-user-id': req.userId ? req.userId.toString() : ''
            },
            body: JSON.stringify({ documentId: doc.doc_id })
          });
        } else {
          triggerIndexing(doc._id).catch(() => {});
        }
      } catch (_) {
        triggerIndexing(doc._id).catch(() => {});
      }
      created.push({ 
        documentId: doc._id, 
        doc_id: doc.doc_id, 
        name: doc.name, 
        processingStatus: doc.processingStatus,
        converted: shouldConvertWordToPdf && finalMimetype === "application/pdf"
      });
    }
    res.status(201).json({ message: `Uploaded ${created.length} files`, items: created });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/my", verifyToken, ensureActive, async (req, res) => {
  try {
    const docs = await Document.find({ user: req.userId })
      .select("-data")
      .sort({ pinned: -1, pinnedAt: -1, uploadedAt: -1 });
    // Ensure every doc has doc_id projected
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Pin a document
router.post("/:id/pin", verifyToken, ensureActive, verifyCsrf, async (req, res) => {
  try {
    const doc = await Document.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { pinned: true, pinnedAt: new Date() },
      { new: true }
    ).select("-data");
    if (!doc) return res.status(404).json({ message: "Document not found" });
    res.json({ message: "Pinned", document: doc });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Unpin a document
router.post("/:id/unpin", verifyToken, ensureActive, verifyCsrf, async (req, res) => {
  try {
    const doc = await Document.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { pinned: false, pinnedAt: null },
      { new: true }
    ).select("-data");
    if (!doc) return res.status(404).json({ message: "Document not found" });
    res.json({ message: "Unpinned", document: doc });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/:id/download", async (req, res) => {
  try {
    // Allow service token for server-to-server access
  const svc = process.env.SERVICE_TOKEN;
  const provided = req.header("x-service-token");
    let userId = null;
    if (provided && svc && provided === svc) {
      // Service access: accept any doc, no user scoping
    } else {
      // Fallback to normal user token
      const auth = require("../middlewares/auth");
      await new Promise((resolve, reject) => {
        auth.verifyToken(req, res, (err) => (err ? reject(err) : resolve()));
      }).catch(() => {});
      userId = req.userId;
    }
  const query = userId ? { _id: req.params.id, user: userId } : { _id: req.params.id };
  const doc = await Document.findOne(query);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    res.set({
      "Content-Type": doc.type,
      "Content-Disposition": `attachment; filename="${doc.name}"`
    });
    res.send(doc.data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Processing status for a single document
router.get("/:id/status", verifyToken, ensureActive, async (req, res) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, user: req.userId }).select("processingStatus processedAt processingError");
    if (!doc) return res.status(404).json({ message: "Document not found" });
    res.json({ processingStatus: doc.processingStatus, processedAt: doc.processedAt, processingError: doc.processingError || "" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/:id", verifyToken, ensureActive, verifyCsrf, async (req, res) => {
  try {
    const documentId = req.params.id;
    const userId = req.userId;
    
    logger.info({ documentId, userId }, "Deleting document");
    
    const doc = await Document.findOneAndDelete({ _id: documentId, user: userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });
    
    logger.info({ documentId }, "Document deleted successfully");
    
    // Also delete associated chat if it exists
    try {
      const Chat = require("../models/Chat");
      const deletedChat = await Chat.findOneAndDelete({
        user: userId,
        document: documentId
      });
      if (deletedChat) {
        logger.info({ documentId, messageCount: deletedChat.messages.length }, "Deleted associated chat");
      }
    } catch (chatErr) {
      logger.error({ err: chatErr, documentId }, "Error deleting associated chat");
      throw chatErr;
    }
    
    // Also delete associated DocChunks
    try {
      const DocChunk = require("../models/DocChunk");
      await DocChunk.deleteMany({ doc: documentId });
      logger.info({ documentId }, "Deleted associated DocChunks");
    } catch (chunkErr) {
      logger.error({ err: chunkErr, documentId }, "Error deleting associated DocChunks");
      throw chunkErr;
    }
    
    res.json({ message: "Document deleted" });
  } catch (err) {
    logger.error({ err }, "Error in document deletion");
    res.status(500).json({ message: err.message });
  }
});

router.put("/:id", verifyToken, ensureActive, verifyCsrf, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      return res.status(400).json({ message: "Invalid name" });
    }
    const doc = await Document.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { name },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Document not found" });
    res.json({ message: "Document renamed", document: doc });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/ask", verifyToken, verifyCsrf, async (req, res) => {
  try {
    const { doc_id, question } = req.body;

    if (!doc_id) return res.status(400).json({ error: "No document selected" });
    if (!question) return res.status(400).json({ error: "No question provided" });

    const doc = await Document.findOne({ _id: doc_id, user: req.userId });
    if (!doc) return res.status(404).json({ error: "Document not found" });

    // Here you would integrate your SmartDocQ AI / NLP logic
    // For now, just return a dummy answer:
    res.json({ answer: `Received your question: "${question}" about document "${doc.name}"` });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /preview/:docId.pdf
router.get("/preview/:docId.pdf", verifyToken, ensureActive, async (req, res) => {
  try {
    const { docId } = req.params;
    const mongoose = require("mongoose");

    const query = {
      user: req.userId,
      $or: [
        { doc_id: docId }
      ]
    };
    if (mongoose.Types.ObjectId.isValid(docId)) {
      query.$or.push({ _id: docId });
    }
    const doc = await Document.findOne(query);
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    const flaskUrl = `${FLASK_BASE}/api/document/preview/${doc.doc_id}.pdf`;
    const flaskRes = await fetch(flaskUrl, {
      method: "GET",
      headers: {
        "x-service-token": process.env.SERVICE_TOKEN,
        "x-user-id": req.userId.toString()
      }
    });

    if (!flaskRes.ok) {
      const errPayload = await flaskRes.json().catch(() => ({}));
      return res.status(flaskRes.status).json({ 
        message: errPayload.error || "Failed to generate preview from Python service" 
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    flaskRes.body.pipe(res);
  } catch (err) {
    logger.error({ err }, "Error fetching document preview");
    res.status(500).json({ message: err.message });
  }
});

// GET /api/document/:id/preview/spreadsheet
router.get("/:id/preview/spreadsheet", verifyToken, ensureActive, async (req, res) => {
  try {
    const { id } = req.params;
    const mongoose = require("mongoose");

    const query = {
      user: req.userId,
      $or: [
        { doc_id: id }
      ]
    };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query.$or.push({ _id: id });
    }
    const doc = await Document.findOne(query);
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    const flaskUrl = `${FLASK_BASE}/api/document/preview/${doc.doc_id}/spreadsheet`;
    const flaskRes = await fetch(flaskUrl, {
      method: "GET",
      headers: {
        "x-service-token": process.env.SERVICE_TOKEN,
        "x-user-id": req.userId.toString()
      },
      timeout: FLASK_FETCH_TIMEOUT
    });

    if (!flaskRes.ok) {
      const errPayload = await flaskRes.json().catch(() => ({}));
      return res.status(flaskRes.status).json({ 
        message: errPayload.error || "Failed to retrieve spreadsheet preview from Python service" 
      });
    }

    const data = await flaskRes.json();
    return res.json(data);
  } catch (err) {
    logger.error({ err }, "Error fetching spreadsheet preview");
    res.status(500).json({ message: err.message });
  }
});

// POST /generate-quiz
router.post("/generate-quiz", verifyToken, ensureActive, verifyCsrf, quizLimiter, async (req, res) => {
  try {
    const { doc_id, documentId, num_questions, difficulty, question_types } = req.body;
    const targetDocId = doc_id || documentId;
    if (!targetDocId) {
      return res.status(400).json({ message: "doc_id is required" });
    }

    const mongoose = require("mongoose");
    const query = {
      user: req.userId,
      $or: [
        { doc_id: targetDocId }
      ]
    };
    if (mongoose.Types.ObjectId.isValid(targetDocId)) {
      query.$or.push({ _id: targetDocId });
    }
    const doc = await Document.findOne(query);
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    const flaskUrl = `${FLASK_BASE}/api/document/generate-quiz`;
    const flaskRes = await fetch(flaskUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-token": process.env.SERVICE_TOKEN,
        "x-user-id": req.userId.toString()
      },
      body: JSON.stringify({
        doc_id: doc.doc_id,
        num_questions,
        difficulty,
        question_types
      })
    });

    const data = await flaskRes.json().catch(() => ({}));
    if (!flaskRes.ok) {
      return res.status(flaskRes.status).json({
        success: false,
        error: data.error || data.message || "Failed to generate quiz from Python service"
      });
    }

    res.status(flaskRes.status).json(data);
  } catch (err) {
    logger.error({ err }, "Error generating quiz");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /generate-flashcards
router.post("/generate-flashcards", verifyToken, ensureActive, verifyCsrf, flashcardLimiter, async (req, res) => {
  try {
    const { doc_id, documentId, num_cards } = req.body;
    const targetDocId = doc_id || documentId;
    if (!targetDocId) {
      return res.status(400).json({ message: "doc_id is required" });
    }

    const mongoose = require("mongoose");
    const query = {
      user: req.userId,
      $or: [
        { doc_id: targetDocId }
      ]
    };
    if (mongoose.Types.ObjectId.isValid(targetDocId)) {
      query.$or.push({ _id: targetDocId });
    }
    const doc = await Document.findOne(query);
    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    const flaskUrl = `${FLASK_BASE}/api/document/generate-flashcards`;
    const flaskRes = await fetch(flaskUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-token": process.env.SERVICE_TOKEN,
        "x-user-id": req.userId.toString()
      },
      body: JSON.stringify({
        doc_id: doc.doc_id,
        num_cards
      })
    });

    const data = await flaskRes.json().catch(() => ({}));
    if (!flaskRes.ok) {
      return res.status(flaskRes.status).json({
        success: false,
        error: data.error || data.message || "Failed to generate flashcards from Python service"
      });
    }

    res.status(flaskRes.status).json(data);
  } catch (err) {
    logger.error({ err }, "Error generating flashcards");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /summarize
router.post("/summarize", verifyToken, ensureActive, verifyCsrf, summarizeLimiter, async (req, res) => {
  try {
    const { selectionText, text, docId, doc_id, pages, style, bullets } = req.body;
    const targetText = selectionText || text;
    const targetDocId = docId || doc_id;

    if (!targetText || !targetText.trim()) {
      return res.status(400).json({ error: "Missing selectionText" });
    }

    let verifiedDocId = null;
    if (targetDocId) {
      const mongoose = require("mongoose");
      const query = {
        user: req.userId,
        $or: [
          { doc_id: targetDocId }
        ]
      };
      if (mongoose.Types.ObjectId.isValid(targetDocId)) {
        query.$or.push({ _id: targetDocId });
      }
      const doc = await Document.findOne(query);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      verifiedDocId = doc.doc_id;
    }

    const flaskUrl = `${FLASK_BASE}/api/summarize`;
    const flaskRes = await fetch(flaskUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-token": process.env.SERVICE_TOKEN,
        "x-user-id": req.userId.toString()
      },
      body: JSON.stringify({
        selectionText: targetText,
        docId: verifiedDocId,
        pages,
        style,
        bullets
      })
    });

    const data = await flaskRes.json().catch(() => ({}));
    if (!flaskRes.ok) {
      return res.status(flaskRes.status).json({
        error: data.error || data.message || "Failed to summarize text from Python service"
      });
    }

    res.status(flaskRes.status).json(data);
  } catch (err) {
    logger.error({ err }, "Error in summarization");
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ---- Background Indexing Helper ----
async function triggerIndexing(documentId) {
  try {
    const doc = await Document.findById(documentId);
    if (!doc) return;

    // Mark indexing
    doc.processingStatus = "indexing";
    doc.processingError = "";
    await doc.save();

    // Ask Flask to index by Atlas doc_id
    const resp = await fetch(FLASK_INDEX_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-service-token": process.env.SERVICE_TOKEN,
        "x-user-id": doc.user ? doc.user.toString() : ""
      },
      body: JSON.stringify({ documentId: doc.doc_id })
    });
    const payload = await resp.json().catch(()=>({}));
    if (resp.ok) {
      if (payload.requireConfirmation) {
        doc.processingStatus = "awaiting-consent";
        doc.sensitiveFound = true;
        doc.sensitiveSummary = payload.sensitiveSummary || {};
        doc.lastScanAt = new Date();
      } else {
        doc.processingStatus = "done";
        doc.processedAt = new Date();
      }
      doc.processingVersion = (doc.processingVersion || 0) + 1; // Increment version on completion
    } else {
      doc.processingStatus = "failed";
      doc.processingError = payload.error || `Indexing failed (${resp.status})`;
      doc.processingVersion = (doc.processingVersion || 0) + 1; // Increment version on failure too
    }
    await doc.save();
  } catch (err) {
    try {
      await Document.findByIdAndUpdate(documentId, { processingStatus: "failed", processingError: err?.message || String(err) });
    } catch (_) {}
  }
}

// ---- Persist consent (user action) ----
router.post('/:id/consent', verifyToken, ensureActive, verifyCsrf, async (req, res) => {
  try {
    const { consent } = req.body || {};
    const doc = await Document.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    if (!doc.sensitiveFound) {
      return res.json({ message: 'No sensitive data detected; indexing already complete or not required.', requireConfirmation: false });
    }
    if (!consent) {
      doc.consentConfirmed = false;
      doc.processingStatus = 'awaiting-consent';
      await doc.save();
      return res.json({ message: 'Consent declined. Please upload a cleaned document.', requireConfirmation: false });
    }
    // Mark consent and trigger indexing again
    doc.consentConfirmed = true;
    doc.processingStatus = 'indexing';
    doc.processingError = '';
    await doc.save();
    triggerIndexing(doc._id).catch(()=>{});
    return res.json({ message: 'Consent recorded. Indexing will complete shortly.', requireConfirmation: false });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Consent update failed' });
  }
});

// ---- Internal metadata (Flask) ----
router.get('/:id/_meta', async (req, res) => {
  try {
    const svc = process.env.SERVICE_TOKEN;
    const provided = req.header('x-service-token');
    if (!provided || provided !== svc) return res.status(403).json({ message: 'Forbidden' });
    const doc = await Document.findById(req.params.id).select('contentHash sensitiveFound consentConfirmed sensitiveSummary processingStatus');
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json({
      contentHash: doc.contentHash || null,
      sensitiveFound: !!doc.sensitiveFound,
      consentConfirmed: !!doc.consentConfirmed,
      sensitiveSummary: doc.sensitiveSummary || {},
      processingStatus: doc.processingStatus
    });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'Meta fetch failed' });
  }
});

// ---- Index State Lifecycle Endpoints (Flask) ----
router.get('/:id/index-state', async (req, res) => {
  try {
    const svc = process.env.SERVICE_TOKEN;
    const provided = req.header('x-service-token');
    if (!provided || provided !== svc) return res.status(403).json({ message: 'Forbidden' });

    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });

    const state = doc.indexState || {};
    res.json({
      activeVersion: state.activeVersion || null,
      previousVersion: state.previousVersion || null,
      activeMetadata: state.activeMetadata || {
        fileHash: null,
        pipelineVersion: null,
        chunkingVersion: null,
        embeddingModel: null
      },
      build: {
        version: state.build?.version || null,
        status: state.build?.status || "idle",
        fileHash: state.build?.fileHash || null,
        pipelineVersion: state.build?.pipelineVersion || null,
        chunkingVersion: state.build?.chunkingVersion || null,
        embeddingModel: state.build?.embeddingModel || null,
        reason: state.build?.reason || null
      }
    });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'State fetch failed' });
  }
});

router.post('/:id/index-state/building', async (req, res) => {
  try {
    const svc = process.env.SERVICE_TOKEN;
    const provided = req.header('x-service-token');
    if (!provided || provided !== svc) return res.status(403).json({ message: 'Forbidden' });

    const { indexVersion, fileHash, pipelineVersion, chunkingVersion, embeddingModel } = req.body || {};
    if (!indexVersion) return res.status(400).json({ message: "Missing indexVersion" });

    const doc = await Document.findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [
          { "indexState.build.status": { $ne: "building" } },
          { "indexState.build.status": { $exists: false } },
          { "indexState.build": null },
          { "indexState.build.version": indexVersion }
        ]
      },
      {
        $set: {
          "indexState.build": {
            version: indexVersion,
            status: "building",
            fileHash: fileHash || null,
            pipelineVersion: pipelineVersion || null,
            chunkingVersion: chunkingVersion || null,
            embeddingModel: embeddingModel || null,
            reason: null,
          },
          "indexState.updatedAt": new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!doc) {
      const exists = await Document.findById(req.params.id);
      if (!exists) {
        return res.status(404).json({ message: "Document not found" });
      }
      return res.status(409).json({ message: "Another index build is already in progress" });
    }

    res.json({ message: "Index state set to building", indexState: doc.indexState });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'State update building failed' });
  }
});

router.post('/:id/index-state/activate', async (req, res) => {
  try {
    const svc = process.env.SERVICE_TOKEN;
    const provided = req.header('x-service-token');
    if (!provided || provided !== svc) return res.status(403).json({ message: 'Forbidden' });

    const { indexVersion } = req.body || {};
    if (!indexVersion) return res.status(400).json({ message: "Missing indexVersion" });

    // Atomically activate index version using CAS check: build.version == indexVersion AND build.status == "building"
    // Also shift activeVersion to previousVersion and clear build object.
    const doc = await Document.findOneAndUpdate(
      {
        _id: req.params.id,
        "indexState.build.version": indexVersion,
        "indexState.build.status": "building"
      },
      [
        {
          $set: {
            "indexState.previousVersion": { $ifNull: ["$indexState.activeVersion", null] },
            "indexState.activeVersion": indexVersion,
            "indexState.activeMetadata": {
              fileHash: "$indexState.build.fileHash",
              pipelineVersion: "$indexState.build.pipelineVersion",
              chunkingVersion: "$indexState.build.chunkingVersion",
              embeddingModel: "$indexState.build.embeddingModel"
            },
            "indexState.build": {
              version: null,
              status: "idle",
              fileHash: null,
              pipelineVersion: null,
              chunkingVersion: null,
              embeddingModel: null,
              reason: null
            },
            "indexState.updatedAt": new Date()
          }
        }
      ],
      { new: true }
    );

    if (!doc) {
      return res.status(409).json({ message: "Conflict: Version mismatch or build not in building status" });
    }

    res.json({ message: "Index version activated", indexState: doc.indexState });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'State update activate failed' });
  }
});

router.post('/:id/index-state/failed', async (req, res) => {
  try {
    const svc = process.env.SERVICE_TOKEN;
    const provided = req.header('x-service-token');
    if (!provided || provided !== svc) return res.status(403).json({ message: 'Forbidden' });

    const { indexVersion, reason } = req.body || {};
    if (!indexVersion) return res.status(400).json({ message: "Missing indexVersion" });

    // Compare-and-set: update to failed only if version and status="building" match
    const doc = await Document.findOneAndUpdate(
      {
        _id: req.params.id,
        "indexState.build.version": indexVersion,
        "indexState.build.status": "building"
      },
      {
        $set: {
          "indexState.build.status": "failed",
          "indexState.build.reason": reason || null,
          "indexState.updatedAt": new Date()
        }
      },
      { new: true }
    );

    if (!doc) {
      return res.status(409).json({ message: "Conflict: Version mismatch or build not in building status" });
    }

    res.json({ message: "Index state set to failed", indexState: doc.indexState });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'State update failed failed' });
  }
});

router.get('/:id/chunks/count', async (req, res) => {
  try {
    const svc = process.env.SERVICE_TOKEN;
    const provided = req.header('x-service-token');
    if (!provided || provided !== svc) return res.status(403).json({ message: 'Forbidden' });

    const { indexVersion } = req.query || {};
    const versionVal = indexVersion || null;

    const count = await DocChunk.countDocuments({ doc: req.params.id, indexVersion: versionVal });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'Chunk count failed' });
  }
});


// ---- Replace text content and reindex (incremental update for text documents) ----
router.patch("/:id/text", verifyToken, ensureActive, verifyCsrf, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== "string") {
      return res.status(400).json({ message: "Invalid or missing text" });
    }

    // Ensure the document belongs to the user
    const doc = await Document.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });

    // To keep `contentHash` a SHA-256 of the stored file bytes (single source of truth),
    // only allow this endpoint for text documents.
    if ((doc.type || "").toLowerCase() !== "text/plain") {
      return res.status(400).json({
        message: "Text editing is only supported for text/plain documents. Please re-upload the updated file instead.",
      });
    }

    // If the original document is a text file, update stored binary for single source of truth
    if ((doc.type || "").toLowerCase() === "text/plain") {
      const buf = Buffer.from(text, "utf8");
      doc.data = buf;
      doc.size = buf.length;
      // Keep contentHash consistent with stored bytes.
      doc.contentHash = hashBuffer(buf);
      doc.processingStatus = "indexing";
      doc.processingError = "";
      await doc.save();
    }

    // Ask Flask to reindex from provided text without full file round-trip
    const resp = await fetch(FLASK_REPLACE_TEXT_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-service-token": process.env.SERVICE_TOKEN,
        "x-user-id": req.userId ? req.userId.toString() : ""
      },
      body: JSON.stringify({ documentId: doc.doc_id, text, filename: doc.name })
    });

    const payload = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      // Persist failure state if we previously set indexing state
      try {
        if ((doc.type || "").toLowerCase() === "text/plain") {
          await Document.findByIdAndUpdate(doc._id, {
            $set: { 
              processingStatus: "failed", 
              processingError: payload?.error || "Indexing failed"
            },
            $inc: { processingVersion: 1 } // Increment version
          });
        }
      } catch (_) {}
      return res.status(resp.status).json(payload);
    }

    // Update status on success for text docs
    try {
      if ((doc.type || "").toLowerCase() === "text/plain") {
        await Document.findByIdAndUpdate(doc._id, {
          $set: { 
            processingStatus: "done", 
            processedAt: new Date(), 
            processingError: ""
          },
          $inc: { processingVersion: 1 } // Increment version
        });
      }
    } catch (_) {}

    return res.json({ message: payload?.message || "Reindexed", doc_id: doc.doc_id, requireConfirmation: !!payload?.requireConfirmation, sensitiveSummary: payload?.sensitiveSummary || null });
  } catch (err) {
    const msg = err?.message || "Upstream request failed";
    const hint = (process.env.NODE_ENV === 'production' && /localhost:5001/.test(msg))
      ? "Misconfigured Flask URL in production. Set FLASK_BASE_URL to your deployed Python backend."
      : undefined;
    return res.status(502).json({ message: msg, hint, target: FLASK_REPLACE_TEXT_URL });
  }
});