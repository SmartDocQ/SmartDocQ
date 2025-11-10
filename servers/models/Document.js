const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  type: { type: String, required: true },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true }, // File as binary data
  // Ensure a stable per-document id string used by downstream services (Flask/Qdrant vector store)
  doc_id: { type: String, default: null },
  processingStatus: { type: String, enum: ["queued", "indexing", "awaiting-consent", "done", "failed"], default: "queued" },
  processedAt: { type: Date },
  processingError: { type: String, default: "" },
  uploadedAt: { type: Date, default: Date.now },
  // Fields to track original document for converted files
  originalName: { type: String }, // Original filename if converted
  originalType: { type: String }, // Original mimetype if converted
  // Persistent pin state per user/document
  pinned: { type: Boolean, default: false },
  pinnedAt: { type: Date }
});

// Populate doc_id with this._id if not set, to avoid null values
documentSchema.pre("save", function (next) {
  if (!this.doc_id) {
    this.doc_id = this._id.toString();
  }
  next();
});

// Helpful indexes for admin aggregations and queries
documentSchema.index({ user: 1 });
documentSchema.index({ uploadedAt: -1 });
documentSchema.index({ size: -1 });

module.exports = mongoose.model("Document", documentSchema);