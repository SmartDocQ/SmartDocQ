const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  avatar: { type: String,default:null },
  lastLogin: { type: Date, default: null },
  lastPasswordChange: { type: Date, default: null },
  passwordChangeCount: { type: Number, default: 0 },
  passwordChangeWindowStart: { type: Date, default: null },
  isAdmin: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  role: { type: String, enum: ["user", "admin", "moderator"], default: "user" }
}, {
  timestamps: true // createdAt = joined date
});

// Helpful indexes for faster admin queries
userSchema.index({ email: 1 });
userSchema.index({ name: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model("User", userSchema);

