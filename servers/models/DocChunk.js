const mongoose = require("mongoose");

const docChunkSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  doc: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true },
  doc_id: { type: String, required: true }, // stable string id used across services
  filename: { type: String, required: true },
  sheet: { type: String, default: null },
  chunk: { type: Number, required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Helpful indexes
// Unique per document chunk index to allow idempotent upserts
docChunkSchema.index({ doc: 1, chunk: 1 }, { unique: true });
// For scoping queries
docChunkSchema.index({ user: 1, doc: 1 });
// Optional text index for fallback search when Atlas Search is not available
try {
  docChunkSchema.index({ text: "text" });
} catch (_) {}

module.exports = mongoose.model("DocChunk", docChunkSchema);
