const mongoose = require("mongoose");

const sharedMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    text: { type: String, required: true },
    at: { type: Date, default: Date.now },
    rating: { type: String, enum: ["positive", "negative", "none"], default: "none" },
  },
  { _id: false }
);

const sharedChatSchema = new mongoose.Schema(
  {
    shareId: { type: String, required: true, unique: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    document: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    title: { type: String },
    visibility: { type: String, enum: ["unlisted"], default: "unlisted" },
    messages: { type: [sharedMessageSchema], default: [] },
    // Expiration: default 24 hours from creation
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
  },
  { timestamps: true }
);

sharedChatSchema.index({ shareId: 1 }, { unique: true });
sharedChatSchema.index({ createdAt: -1 });
// TTL index: when expiresAt passes, MongoDB will delete the doc (background process)
sharedChatSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("SharedChat", sharedChatSchema);
