const mongoose = require("mongoose");

const documentTableSchema = new mongoose.Schema({
  doc_id: { type: String, required: true },
  indexVersion: { type: String, required: true },
  tableId: { type: String, required: true },
  sheet: { type: String, default: null },
  headers: {
    type: [String],
    default: []
  },
  rows: {
    type: [[String]],
    default: []
  },
  rowCount: { type: Number, required: true },
  columnCount: { type: Number, required: true },
}, {
  timestamps: true
});

// Unique compound index preventing collisions across rebuilds
documentTableSchema.index({ doc_id: 1, indexVersion: 1, tableId: 1 }, { unique: true });
// Single field index for fast lookups and cleanups by doc_id
documentTableSchema.index({ doc_id: 1 });

// Enforce reasonable constraints on document size to prevent database overload
documentTableSchema.path("rows").validate(function(value) {
  if (!Array.isArray(value)) return false;
  if (value.length > 2000) return false; // limit rows
  for (const r of value) {
    if (!Array.isArray(r)) return false;
    if (r.length > 300) return false; // limit columns
    for (const cell of r) {
      if (typeof cell === "string" && cell.length > 8000) return false; // limit cell content
    }
  }
  return true;
}, "Table rows/columns count or cell content length exceeds maximum limits.");

module.exports = mongoose.model("DocumentTable", documentTableSchema);
