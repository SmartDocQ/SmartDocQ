const express = require("express");
const router = express.Router();
const Chat = require("../models/Chat");
const Document = require("../models/Document");
const { verifyToken, ensureActive } = require("./auth");
const fetch = require("node-fetch");
const PDFDocument = require("pdfkit");

// Config: Flask endpoint for ask
const FLASK_ASK_URL = process.env.FLASK_ASK_URL || "http://localhost:5001/api/document/ask";

// Debug endpoint: List all chats for current user (for testing)
router.get("/", verifyToken, ensureActive, async (req, res) => {
  try {
    const chats = await Chat.find({ user: req.userId }).populate('document', 'name');
    res.json({ chats: chats.map(chat => ({
      _id: chat._id,
      document: chat.document,
      messageCount: chat.messages.length,
      lastMessage: chat.messages[chat.messages.length - 1]
    }))});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get or create chat for a document
router.get("/:documentId", verifyToken, ensureActive, async (req, res) => {
  try {
    const { documentId } = req.params;
    const doc = await Document.findOne({ _id: documentId, user: req.userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });

    let chat = await Chat.findOne({ user: req.userId, document: documentId });
    if (!chat) chat = await Chat.create({ user: req.userId, document: documentId, messages: [] });
    res.json({ messages: chat.messages, doc_id: doc.doc_id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Append a message (user) and ask Flask for assistant reply, then save both
router.post("/:documentId/message", verifyToken, ensureActive, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { text } = req.body;
    if (!text || typeof text !== "string") return res.status(400).json({ message: "Invalid text" });

    const doc = await Document.findOne({ _id: documentId, user: req.userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });

    const now = new Date();
    const userMsg = { role: "user", text, at: now };

    // Call Flask to get assistant answer using doc.doc_id
    let assistantText = "";
    try {
      const resp = await fetch(FLASK_ASK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, doc_id: doc.doc_id })
      });
      const json = await resp.json().catch(() => ({}));
      assistantText = json.answer || json.error || "⚠️ Query failed";
    } catch (e) {
      assistantText = "⚠️ Error contacting assistant";
    }
  const asstMsg = { role: "assistant", text: assistantText, at: new Date(), rating: "none" };

    const chat = await Chat.findOneAndUpdate(
      { user: req.userId, document: documentId },
      { $push: { messages: { $each: [userMsg, asstMsg] } } },
      { upsert: true, new: true }
    );

    res.json({ messages: chat.messages, appended: [userMsg, asstMsg] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Append provided messages to chat (used for summarize flow where assistant text is already computed)
router.post("/:documentId/append", verifyToken, ensureActive, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ message: "messages must be a non-empty array" });
    }

    // Basic validation for roles and text
    const allowedRoles = new Set(["user", "assistant", "system"]);
    for (const m of messages) {
      if (!m || typeof m.text !== 'string' || !allowedRoles.has(m.role)) {
        return res.status(400).json({ message: "Invalid message in array" });
      }
    }

    const doc = await Document.findOne({ _id: documentId, user: req.userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });

    // Normalize messages: ensure 'at' and default rating for assistant
    const now = new Date();
    const toAppend = messages.map(m => ({
      role: m.role,
      text: m.text,
      at: m.at ? new Date(m.at) : now,
      rating: m.role === 'assistant' ? (m.rating || 'none') : undefined,
    }));

    const chat = await Chat.findOneAndUpdate(
      { user: req.userId, document: documentId },
      { $push: { messages: { $each: toAppend } } },
      { upsert: true, new: true }
    );

    res.json({ messages: chat.messages, appended: toAppend });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Overwrite entire chat (optional)
router.put("/:documentId", verifyToken, ensureActive, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { messages } = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ message: "messages must be array" });
    const doc = await Document.findOne({ _id: documentId, user: req.userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });
    const chat = await Chat.findOneAndUpdate(
      { user: req.userId, document: documentId },
      { $set: { messages } },
      { upsert: true, new: true }
    );
    res.json({ messages: chat.messages });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete chat
router.delete("/:documentId", verifyToken, ensureActive, async (req, res) => {
  try {
    const { documentId } = req.params;
    await Chat.findOneAndDelete({ user: req.userId, document: documentId });
    res.json({ message: "Chat deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete all chats for current user (across all documents)
router.delete("/", verifyToken, ensureActive, async (req, res) => {
  try {
    const result = await Chat.deleteMany({ user: req.userId });
    res.json({ message: "All chats deleted", deletedCount: result.deletedCount || 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Set rating for a specific message (by array index) in a chat
router.patch("/:documentId/message/:index/rating", verifyToken, ensureActive, async (req, res) => {
  try {
    const { documentId, index } = req.params;
    const { rating } = req.body;
    const allowed = ["positive", "negative", "none"]; 
    if (!allowed.includes(rating)) {
      return res.status(400).json({ message: "Invalid rating" });
    }

    const doc = await Document.findOne({ _id: documentId, user: req.userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });

    const chat = await Chat.findOne({ user: req.userId, document: documentId });
    if (!chat) return res.status(404).json({ message: "Chat not found" });

    const idx = parseInt(index, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= chat.messages.length) {
      return res.status(400).json({ message: "Index out of range" });
    }

    // Allow rating only for assistant messages
    if (chat.messages[idx].role !== 'assistant') {
      return res.status(400).json({ message: "Can only rate assistant messages" });
    }

    chat.messages[idx].rating = rating;
    await chat.save();
    res.json({ message: "Rating saved", index: idx, rating });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Export chat as PDF
router.get("/:documentId/export.pdf", verifyToken, ensureActive, async (req, res) => {
  try {
    const { documentId } = req.params;
    const docRec = await Document.findOne({ _id: documentId, user: req.userId });
    if (!docRec) return res.status(404).json({ message: "Document not found" });

    const chat = await Chat.findOne({ user: req.userId, document: documentId });
    const messages = chat ? chat.messages : [];

    const safeName = (docRec.name || "document").replace(/[^A-Za-z0-9._-]+/g, "_");
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}`;
    const filename = `Chat_${safeName}_${stamp}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const pdf = new PDFDocument({ size: "A4", margin: 50 });
    pdf.on("error", () => { try { res.end(); } catch (_) {} });
    pdf.pipe(res);

    // Header
    pdf.fontSize(18).text("Chat Export", { align: "left" });
    pdf.moveDown(0.5);
    pdf.fontSize(12).text(`Document: ${docRec.name}`, { continued: false });
    pdf.text(`Generated at: ${ts.toLocaleString()}`);
    pdf.moveDown();
    pdf.moveTo(50, pdf.y).lineTo(545, pdf.y).stroke();
    pdf.moveDown();

    if (!messages.length) {
      pdf.fontSize(12).text("No messages yet.");
      pdf.end();
      return;
    }

    // Messages
    messages.forEach((m, idx) => {
      const at = m.at ? new Date(m.at) : null;
      const when = at ? at.toLocaleString() : "";
      const role = m.role === "assistant" ? "Assistant" : m.role === "user" ? "User" : "System";

      pdf.fontSize(11).fillColor("#555").text(`${role} • ${when}`);
      pdf.moveDown(0.2);
      pdf.fontSize(12).fillColor("#000").text(m.text || "", { width: 495, align: "left" });
      pdf.moveDown();

      if ((idx + 1) % 6 === 0) {
        pdf.addPage();
      }
    });

    pdf.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
