if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: __dirname + "/.env" });
}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const pino = require("pino");
const expressPino = require("express-pino-logger");
const client = require("prom-client");

const authRoutes = require("./routes/auth");
const documentRoutes = require("./routes/document");
const chatRoutes = require("./routes/chat");
const adminRoutes = require("./routes/admin");
const contactRoutes = require("./routes/contact");
const searchRoutes = require("./routes/search");
const shareRoutes = require("./routes/share");

const app = express();

// Cloudinary config (reads from environment)
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// ===== Logging (Pino) =====
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: undefined,
  redact: { paths: ["req.headers.authorization", "req.headers.cookie", "password", "token"], remove: true },
});
app.use(expressPino({ logger }));

// ===== Metrics (prom-client) =====
// Use the default/global registry so other modules (e.g., admin routes) can read metrics
const register = client.register;
client.collectDefaultMetrics({ register });
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});
register.registerMetric(httpRequestDuration);

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = req.route ? req.route.path : req.path;
    end({ method: req.method, route, status_code: String(res.statusCode) });
  });
  next();
});

// CORS configuration: allowlist via FRONTEND_ORIGINS (comma-separated)
// In non-production, default to allowing localhost:3000 for convenience
const rawOrigins = process.env.FRONTEND_ORIGINS;
const allowList = (rawOrigins ? rawOrigins.split(",") : ["http://localhost:3000"]).map((o) => o.trim()).filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowList.includes(origin)) return callback(null, true);
    const ok = allowList.some((entry) => entry.startsWith("*.") && origin.endsWith(entry.slice(1)));
    return ok ? callback(null, true) : callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-service-token"],
  credentials: false,
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(bodyParser.json({ limit: "5mb" }));

logger.info({ env: process.env.NODE_ENV || "", port: process.env.PORT || 5000 }, "Server environment");

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => logger.info("MongoDB Atlas connected"))
  .catch((err) => logger.error({ err }, "MongoDB connection error"));

app.use("/api/auth", authRoutes);
app.use("/api/document", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/share", shareRoutes);

// Health and metrics
app.get("/healthz", (req, res) => res.json({ status: "ok" }));
app.get("/", (req, res) => res.send("SmartDoc API is running"));
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (e) {
    res.status(500).end(e?.message || "metrics error");
  }
});

// Ensure indexes are set once connected
mongoose.connection.once("open", async () => {
  try {
    const Document = require("./models/Document");
    const DocChunk = require("./models/DocChunk");
    const SharedChat = require("./models/SharedChat");

    await Document.updateMany({ doc_id: { $in: [null, ""] } }, [{ $set: { doc_id: { $toString: "$_id" } } }]).catch(() => {});
    await Document.collection.createIndex({ doc_id: 1 }, { unique: true });
    logger.info("Ensured unique index on documents.doc_id");

    try {
      await DocChunk.collection.createIndex({ doc: 1, chunk: 1 }, { unique: true });
    } catch (_) {}
    try {
      await DocChunk.collection.createIndex({ user: 1, doc: 1 });
    } catch (_) {}
    try {
      await DocChunk.collection.createIndex({ text: "text" });
    } catch (_) {}
    logger.info("Ensured indexes on docchunks");

    try {
      await SharedChat.collection.createIndex({ shareId: 1 }, { unique: true });
    } catch (_) {}
    try {
      await SharedChat.collection.createIndex({ createdAt: -1 });
    } catch (_) {}
    try {
      await SharedChat.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    } catch (_) {}
    logger.info("Ensured indexes on sharedchats (TTL enabled)");
  } catch (e) {
    logger.warn({ err: e }, "Index setup warning");
  }

  // Fallback cleaner: remove expired shares hourly
  setInterval(async () => {
    try {
      const SharedChat = require("./models/SharedChat");
      const result = await SharedChat.deleteMany({ expiresAt: { $lte: new Date() } });
      if (result.deletedCount) {
        logger.info({ count: result.deletedCount }, "[cleanup] removed expired shared chats");
      }
    } catch (err) {
      logger.warn({ err }, "[cleanup] SharedChat cleanup error");
    }
  }, 60 * 60 * 1000);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));

module.exports = { app, logger };