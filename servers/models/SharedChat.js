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
  },
  { timestamps: true }
);

sharedChatSchema.index({ shareId: 1 }, { unique: true });
sharedChatSchema.index({ createdAt: -1 });

module.exports = mongoose.model("SharedChat", sharedChatSchema);
