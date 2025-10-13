const express = require("express");
const router = express.Router();
const multer = require("multer");
const Document = require("../models/Document");
const { verifyToken, ensureActive } = require("./auth");
const fetch = require("node-fetch");

const FLASK_INDEX_URL = process.env.FLASK_INDEX_URL || "http://localhost:5001/api/index-from-atlas";

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain"
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Unsupported file type!"));
    }
    cb(null, true);
  }
});

router.post("/upload", verifyToken, ensureActive, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const { originalname, mimetype, size, buffer } = req.file;
    
    // Check if this is a Word document that should be converted to PDF
    const isWordDocument = mimetype === "application/msword" || 
                          mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    
    let finalBuffer = buffer;
    let finalMimetype = mimetype;
    let finalName = originalname;
    
    if (isWordDocument) {
      try {
        // Convert Word to PDF using Flask backend
        const flaskConvertUrl = process.env.FLASK_CONVERT_URL || "http://localhost:5001/api/convert/word-to-pdf";
        
        const formData = new (require('form-data'))();
        formData.append('file', buffer, {
          filename: originalname,
          contentType: mimetype
        });
        
        const convertResponse = await fetch(flaskConvertUrl, {
          method: 'POST',
          body: formData,
          headers: formData.getHeaders()
        });
        
        if (convertResponse.ok) {
          const pdfBuffer = await convertResponse.buffer();
          finalBuffer = pdfBuffer;
          finalMimetype = "application/pdf";
          finalName = originalname.replace(/\.(docx?|DOCX?)$/, ".pdf");
          console.log(`Successfully converted ${originalname} to PDF`);
        } else {
          console.log(`Conversion failed for ${originalname}, storing original Word document`);
        }
      } catch (conversionError) {
        console.error("Word to PDF conversion error:", conversionError);
        console.log(`Storing original Word document: ${originalname}`);
      }
    }

    const doc = new Document({
      user: req.userId,
      name: finalName,
      type: finalMimetype,
      size: finalBuffer.length,
      data: finalBuffer,
      processingStatus: "queued",
      originalName: originalname, // Store original name for reference
      originalType: mimetype // Store original type for reference
    });
    await doc.save();

    // Trigger background indexing, do not await
    triggerIndexing(doc._id).catch(() => {});

    res.status(201).json({ 
      message: "File uploaded", 
      documentId: doc._id, 
      doc_id: doc.doc_id, 
      processingStatus: doc.processingStatus,
      converted: isWordDocument && finalMimetype === "application/pdf"
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Multi-file upload (up to 10 files)
router.post("/upload/batch", verifyToken, ensureActive, upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ message: "No files uploaded" });
    const created = [];
    const FormData = require('form-data');
    
    for (const f of req.files) {
      let finalBuffer = f.buffer;
      let finalMimetype = f.mimetype;
      let finalName = f.originalname;
      
      // Check if this is a Word document that should be converted to PDF
      const isWordDocument = f.mimetype === "application/msword" || 
                            f.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      
      if (isWordDocument) {
        try {
          // Convert Word to PDF using Flask backend
          const flaskConvertUrl = process.env.FLASK_CONVERT_URL || "http://localhost:5001/api/convert/word-to-pdf";
          
          const formData = new FormData();
          formData.append('file', f.buffer, {
            filename: f.originalname,
            contentType: f.mimetype
          });
          
          const convertResponse = await fetch(flaskConvertUrl, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
          });
          
          if (convertResponse.ok) {
            const pdfBuffer = await convertResponse.buffer();
            finalBuffer = pdfBuffer;
            finalMimetype = "application/pdf";
            finalName = f.originalname.replace(/\.(docx?|DOCX?)$/, ".pdf");
            console.log(`Successfully converted ${f.originalname} to PDF in batch`);
          } else {
            console.log(`Conversion failed for ${f.originalname} in batch, storing original`);
          }
        } catch (conversionError) {
          console.error("Word to PDF conversion error in batch:", conversionError);
          console.log(`Storing original Word document in batch: ${f.originalname}`);
        }
      }
      
      const doc = new Document({
        user: req.userId,
        name: finalName,
        type: finalMimetype,
        size: finalBuffer.length,
        data: finalBuffer,
        processingStatus: "queued",
        originalName: f.originalname,
        originalType: f.mimetype
      });
      await doc.save();
      triggerIndexing(doc._id).catch(() => {});
      created.push({ 
        documentId: doc._id, 
        doc_id: doc.doc_id, 
        name: doc.name, 
        processingStatus: doc.processingStatus,
        converted: isWordDocument && finalMimetype === "application/pdf"
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
router.post("/:id/pin", verifyToken, ensureActive, async (req, res) => {
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
router.post("/:id/unpin", verifyToken, ensureActive, async (req, res) => {
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
  const svc = process.env.SERVICE_TOKEN || "smartdoc-service-token";
  const provided = req.header("x-service-token");
    let userId = null;
    if (provided && svc && provided === svc) {
      // Service access: accept any doc, no user scoping
    } else {
      // Fallback to normal user token
      const auth = require("./auth");
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

router.delete("/:id", verifyToken, ensureActive, async (req, res) => {
  try {
    const documentId = req.params.id;
    const userId = req.userId;
    
    console.log(`Deleting document ${documentId} for user ${userId}`);
    
    const doc = await Document.findOneAndDelete({ _id: documentId, user: userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });
    
    console.log(`Document ${documentId} deleted successfully`);
    
    // Also delete associated chat if it exists
    try {
      const Chat = require("../models/Chat");
      const mongoose = require("mongoose");
      
      console.log(`Looking for chat with user: ${userId}, document: ${documentId}`);
      
      // Try both string and ObjectId formats for document ID
      const query = { 
        user: mongoose.Types.ObjectId(userId),
        $or: [
          { document: documentId },
          { document: mongoose.Types.ObjectId(documentId) }
        ]
      };
      
      console.log(`Query being used:`, JSON.stringify(query, null, 2));
      
      const deletedChat = await Chat.findOneAndDelete(query);
      
      if (deletedChat) {
        console.log(`Successfully deleted chat for document ${documentId}. Chat had ${deletedChat.messages.length} messages.`);
      } else {
        console.log(`No chat found for document ${documentId}`);
        
        // Debug: check if there are any chats for this user
        const userChats = await Chat.find({ user: mongoose.Types.ObjectId(userId) });
        console.log(`User has ${userChats.length} total chats:`, userChats.map(c => ({ id: c._id, doc: c.document })));
      }
    } catch (chatErr) {
      console.error("Error deleting associated chat:", chatErr);
      // Don't fail the document deletion if chat deletion fails
    }
    
    res.json({ message: "Document deleted" });
  } catch (err) {
    console.error("Error in document deletion:", err);
    res.status(500).json({ message: err.message });
  }
});

router.put("/:id", verifyToken, ensureActive, async (req, res) => {
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

router.post("/ask", verifyToken, async (req, res) => {
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

module.exports = router;
module.exports.verifyToken = verifyToken;

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
    await fetch(FLASK_INDEX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: doc.doc_id })
    });

    doc.processingStatus = "done";
    doc.processedAt = new Date();
    await doc.save();
  } catch (err) {
    try {
      await Document.findByIdAndUpdate(documentId, { processingStatus: "failed", processingError: err?.message || String(err) });
    } catch (_) {}
  }
}