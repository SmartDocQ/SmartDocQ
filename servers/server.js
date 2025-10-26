if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: __dirname + "/.env" });
}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const authRoutes = require("./routes/auth");
const documentRoutes = require("./routes/document"); 
const chatRoutes = require("./routes/chat");
const adminRoutes = require("./routes/admin");
const contactRoutes = require("./routes/contact");
const searchRoutes = require("./routes/search");
const shareRoutes = require("./routes/share");

const app = express();
// Cloudinary config (reads from environment)
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// CORS configuration: allowlist via FRONTEND_ORIGINS (comma-separated)
// In non-production, default to allowing localhost:3000 for convenience
const rawOrigins = process.env.FRONTEND_ORIGINS;
const allowList = (rawOrigins ? rawOrigins.split(",") : ["http://localhost:3000"]) 
  .map(o => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server or same-origin requests with no Origin header
    if (!origin) return callback(null, true);

    // Exact match
    if (allowList.includes(origin)) return callback(null, true);

    // Support simple wildcard subdomains like *.vercel.app in FRONTEND_ORIGINS
    const ok = allowList.some(entry => {
      if (entry.startsWith("*.") && origin.endsWith(entry.slice(1))) return true;
      return false;
    });
    return ok ? callback(null, true) : callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-service-token"],
  credentials: false,
};
app.use(cors(corsOptions));
// Preflight
// Express 5 no longer accepts '*' string paths; use a regex to match all for preflight
app.options(/.*/, cors(corsOptions));

app.use(bodyParser.json({ limit: "5mb" }));

// Avoid logging secrets
console.log("Server environment:", {
  NODE_ENV: process.env.NODE_ENV || "",
  PORT: process.env.PORT || 5000,
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Atlas connected"))
  .catch(err => console.error("MongoDB connection error:", err));
app.use("/api/auth", authRoutes);
app.use("/api/document", documentRoutes); // <-- use this before listen
app.use("/api/chat", chatRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/share", shareRoutes);

// Health check
app.get("/healthz", (req, res) => res.json({ status: "ok" }));
app.get("/", (req, res) => res.send("SmartDoc API is running"));

// Ensure indexes are set once connected
mongoose.connection.once("open", async () => {
  try {
    const Document = require("./models/Document");
    const DocChunk = require("./models/DocChunk");
    const SharedChat = require("./models/SharedChat");
    // Backfill missing doc_id values
    await Document.updateMany({ doc_id: { $in: [null, ""] } }, [ { $set: { doc_id: { $toString: "$_id" } } } ]).catch(()=>{});
    // Create unique index on doc_id
    await Document.collection.createIndex({ doc_id: 1 }, { unique: true });
    console.log("Ensured unique index on documents.doc_id");

    // Ensure indexes for DocChunk
    try { await DocChunk.collection.createIndex({ doc: 1, chunk: 1 }, { unique: true }); } catch(_){}
    try { await DocChunk.collection.createIndex({ user: 1, doc: 1 }); } catch(_){}
    // Text index for fallback search (Atlas Search recommended for production)
    try { await DocChunk.collection.createIndex({ text: "text" }); } catch(_){}
    console.log("Ensured indexes on docchunks");

    // Ensure indexes for SharedChat, including TTL cleanup on expiresAt
    try { await SharedChat.collection.createIndex({ shareId: 1 }, { unique: true }); } catch(_){}
    try { await SharedChat.collection.createIndex({ createdAt: -1 }); } catch(_){ }
    try { await SharedChat.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); } catch(_){ }
    console.log("Ensured indexes on sharedchats (TTL enabled)");
  } catch (e) {
    console.warn("Index setup warning:", e?.message || e);
  }

  // Fallback cleaner: in case TTL monitor lags, remove expired shares hourly
  setInterval(async () => {
    try {
      const SharedChat = require("./models/SharedChat");
      const result = await SharedChat.deleteMany({ expiresAt: { $lte: new Date() } });
      if (result.deletedCount) {
        console.log(`[cleanup] Removed ${result.deletedCount} expired shared chats`);
      }
    } catch (err) {
      console.warn("[cleanup] SharedChat cleanup error:", err?.message || err);
    }
  }, 60 * 60 * 1000); // every hour
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));