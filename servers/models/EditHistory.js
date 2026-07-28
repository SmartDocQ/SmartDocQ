const mongoose = require("mongoose");

const editHistorySchema = new mongoose.Schema({
  document_id: { type: String, required: true, index: true },
  sheet: { type: String, default: null },
  row: { type: Number, required: true },
  column: { type: Number, required: true },
  oldValue: { type: String },
  newValue: { type: String },
  mutationType: { type: String, enum: ["cell", "rowInsert", "rowDelete"], default: "cell" },
  previousContentHash: { type: String },
  newContentHash: { type: String },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  editedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("EditHistory", editHistorySchema);
