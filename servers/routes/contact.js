const express = require("express");
const router = express.Router();
const ContactReport = require("../models/ContactReport");
const User = require("../models/User");
const { verifyToken, ensureActive } = require("./auth");

// Auth-only endpoint to submit contact report
router.post("/submit", verifyToken, ensureActive, async (req, res) => {
  try {
    const { subject = "", message = "" } = req.body || {};
    if (!subject.trim() || !message.trim()) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    const dbUser = await User.findById(req.userId).select("name email");
    if (!dbUser) return res.status(401).json({ message: "User not found" });

    const report = await ContactReport.create({
      name: (dbUser.name || "").trim(),
      email: String(dbUser.email || "").toLowerCase().trim(),
      subject: subject.trim(),
      message: message.trim(),
      user: dbUser._id,
    });

    return res.status(201).json({ message: "Your message has been received", id: report._id });
  } catch (err) {
    console.error("Contact submit error:", err);
    return res.status(500).json({ message: "Failed to submit message" });
  }
});

module.exports = router;
