const mongoose = require("mongoose");

const contactReportSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: ["open", "in_progress", "resolved"], default: "open" },
    assignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    internalNotes: { type: String, default: "" },
  },
  { timestamps: true }
);

contactReportSchema.index({ createdAt: -1 });
contactReportSchema.index({ email: 1 });
contactReportSchema.index({ assignedAdmin: 1 });

module.exports = mongoose.model("ContactReport", contactReportSchema);
