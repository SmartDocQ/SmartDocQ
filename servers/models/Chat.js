const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    text: { type: String, required: true },
    at: { type: Date, default: Date.now },
    // User feedback on assistant response; 'none' for no feedback
    rating: { type: String, enum: ["positive", "negative", "none"], default: "none" },
  },
  { _id: false }
);

const chatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    document: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
)

chatSchema.index({ user: 1, document: 1 }, { unique: true });
chatSchema.index({ user: 1 });
chatSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Chat", chatSchema);
