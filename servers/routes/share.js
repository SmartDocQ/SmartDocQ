const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { verifyToken, ensureActive } = require("./auth");
const Chat = require("../models/Chat");
const Document = require("../models/Document");
const SharedChat = require("../models/SharedChat");

function genShareId() {
  // 12-char URL-safe id
  return crypto.randomBytes(9).toString("base64url");
}

// Create a share snapshot from current user's chat for a document
router.post("/chat/:documentId", verifyToken, ensureActive, async (req, res) => {
  try {
    const { documentId } = req.params;
    const doc = await Document.findOne({ _id: documentId, user: req.userId });
    if (!doc) return res.status(404).json({ message: "Document not found" });

    const chat = await Chat.findOne({ user: req.userId, document: documentId });
    if (!chat || chat.messages.length === 0) {
      return res.status(400).json({ message: "No messages to share" });
    }

    // Create unique id, retry on collision (very unlikely)
    let shareId = genShareId();
    for (let i = 0; i < 3; i++) {
      const exists = await SharedChat.findOne({ shareId });
      if (!exists) break;
      shareId = genShareId();
    }

    const snapshot = await SharedChat.create({
      shareId,
      createdBy: req.userId,
      document: doc._id,
      title: doc.name,
      visibility: "unlisted",
      messages: chat.messages.map(m => ({
        role: m.role,
        text: m.text,
        at: m.at,
        rating: m.rating || "none",
      })),
    });

    res.json({ shareId: snapshot.shareId });
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to create share" });
  }
});

// Public: resolve a shareId and return snapshot
router.get("/:shareId", async (req, res) => {
  try {
    const { shareId } = req.params;
    const snap = await SharedChat.findOne({ shareId }).populate("document", "name");
    if (!snap) return res.status(404).json({ message: "Share not found" });

    // Minimal payload; do not expose user id
    res.json({
      shareId: snap.shareId,
      createdAt: snap.createdAt,
      title: snap.title || (snap.document && snap.document.name) || "Shared chat",
      messages: snap.messages || [],
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to load share" });
  }
});

module.exports = router;
