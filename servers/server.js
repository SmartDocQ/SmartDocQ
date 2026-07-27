if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: __dirname + "/.env" });
}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const expressPino = require("express-pino-logger");
const client = require("prom-client");
const logger = require("./lib/logger");
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

// ---- Required server-to-server secret ----
// Used to authorize internal requests from the Flask service.
if (!process.env.SERVICE_TOKEN) {
  throw new Error("SERVICE_TOKEN environment variable is required");
}

const authRoutes = require("./routes/auth");
const documentRoutes = require("./routes/document");
const chatRoutes = require("./routes/chat");
const adminRoutes = require("./routes/admin");
const contactRoutes = require("./routes/contact");
const searchRoutes = require("./routes/search");
const shareRoutes = require("./routes/share");

const app = express();
app.disable("x-powered-by");

let cleanupInterval = null;
let watchdogInterval = null;

// Fail fast instead of buffering queries when MongoDB isn't connected.
// We'll only start listening after a successful connection.
mongoose.set("bufferCommands", false);

// In production, we may be behind a reverse proxy (Render/Vercel/etc.).
// This ensures req.ip is derived correctly from X-Forwarded-For.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Cloudinary config (reads from environment)
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// ===== Logging (Pino) =====
const isProduction = process.env.NODE_ENV === "production";
const pinoLogger = expressPino({
  logger,
  autoLogging: {
    ignore: (req) => req.method === "OPTIONS"
  },
  serializers: {
    req: (req) => {
      return {
        method: req.method,
        url: req.url,
        headers: isProduction ? undefined : {
          host: req.headers.host,
          "user-agent": req.headers["user-agent"]
        }
      };
    },
    res: (res) => {
      return {
        statusCode: res.statusCode
      };
    },
    err: (err) => {
      if (!err) return undefined;
      return {
        type: err.constructor.name,
        message: err.message,
        stack: isProduction ? undefined : err.stack
      };
    }
  }
});

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
  allowedHeaders: ["Content-Type", "Authorization", "x-service-token", "x-csrf-token"],
  credentials: true,
};
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression({ threshold: 1024 }));
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.use(pinoLogger);

const rawMb = Number(process.env.MAX_UPLOAD_SIZE_MB);
const MAX_UPLOAD_SIZE_MB = Number.isFinite(rawMb) && rawMb > 0 ? rawMb : 15;

logger.info({ env: process.env.NODE_ENV || "", port: process.env.PORT || 5000 }, "Server environment");

mongoose.connection.on("connected", () => logger.info("MongoDB connected"));
mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
mongoose.connection.on("error", (err) => logger.error({ err }, "MongoDB connection error"));

// Global IP-based rate limiter to protect the server from volume DoS attacks
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 450, // Limit each IP to 450 requests per 15 minutes (generous for standard client-side page assets loading)
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests from this IP, please try again later." }
});

app.use("/api", globalLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/document", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/share", shareRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: `Maximum document size is ${MAX_UPLOAD_SIZE_MB} MB.` });
  }
  logger.error({ err }, "Unhandled request error");
  res.status(err?.status || 500).json({ message: err?.message || "Internal server error" });
});

// Health and metrics
app.get("/healthz", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.json({ status: "ok" });
  }
  res.json({
    status: "ok",
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    version: process.env.npm_package_version || "1.0.0"
  });
});
app.get("/", (req, res) => res.send("SmartDoc API is running"));

if (process.env.NODE_ENV !== "production") {
  app.get("/metrics", async (req, res) => {
    try {
      res.set("Content-Type", register.contentType);
      res.end(await register.metrics());
    } catch (e) {
      res.status(500).end(e?.message || "metrics error");
    }
  });
}

// Ensure indexes are set once connected
async function onDbOpen() {
  try {
    const Document = require("./models/Document");
    const DocChunk = require("./models/DocChunk");
    const SharedChat = require("./models/SharedChat");

    await Document.updateMany({ doc_id: { $in: [null, ""] } }, [{ $set: { doc_id: { $toString: "$_id" } } }]).catch(() => {});
    await Document.collection.createIndex({ doc_id: 1 }, { unique: true });
    logger.info("Ensured unique index on documents.doc_id");

    try {
      const indexes = await DocChunk.collection.indexes();
      const oldIndex = indexes.find(idx => {
        const keys = Object.keys(idx.key || {});
        return keys.length === 2 && idx.key.doc === 1 && idx.key.chunk === 1;
      });
      if (oldIndex) {
        logger.info(`Dropping old unique index on docchunks: ${oldIndex.name}`);
        await DocChunk.collection.dropIndex(oldIndex.name);
      }
      await DocChunk.collection.createIndex({ doc: 1, chunk: 1, indexVersion: 1 }, { unique: true });
    } catch (e) {
      logger.error({ err: e }, "CRITICAL: Database index migration for docchunks failed");
      process.exit(1);
    }
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
  cleanupInterval = setInterval(async () => {
    if (mongoose.connection.readyState !== 1) return;
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

  // ===== WATCHDOG: Reset stale processing documents =====
  // Documents stuck in "queued" or "indexing" for >10 minutes are likely crashed
  // Reset them to "failed" to unblock the deduplication index
  // Uses optimistic locking (processingVersion) to prevent race with active workers
  const STALE_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  watchdogInterval = setInterval(async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const Document = require("./models/Document");
      const staleThreshold = new Date(Date.now() - STALE_PROCESSING_TIMEOUT_MS);
      
      // Find stale documents first
      const staleDocs = await Document.find({
        processingStatus: { $in: ["queued", "indexing"] },
        $or: [
          { processingStartedAt: { $lt: staleThreshold } },
          // Fallback for docs without processingStartedAt (legacy)
          { processingStartedAt: { $exists: false }, uploadedAt: { $lt: staleThreshold } }
        ]
      }).select('_id processingVersion processingStatus').lean();
      
      let resetCount = 0;
      for (const doc of staleDocs) {
        // Atomic update: only succeeds if version hasn't changed (no active worker finished)
        const result = await Document.findOneAndUpdate(
          {
            _id: doc._id,
            processingVersion: doc.processingVersion, // Optimistic lock
            processingStatus: { $in: ["queued", "indexing"] } // Still in processing state
          },
          {
            $set: {
              processingStatus: "failed",
              processingError: "Processing timed out after 10 minutes. Please re-upload.",
              processedAt: new Date()
            },
            $inc: { processingVersion: 1 } // Increment version
          },
          { new: false } // Return old doc to check if update happened
        );
        if (result) resetCount++;
      }
      
      if (resetCount > 0) {
        logger.info({ count: resetCount }, "[watchdog] Reset stale processing documents to failed");
      }
    } catch (err) {
      logger.warn({ err }, "[watchdog] Stale document cleanup error");
    }
  }, 2 * 60 * 1000); // Run every 2 minutes
}

async function start() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    logger.error("Missing required env var: MONGO_URI");
    process.exit(1);
    return;
  }

  // Optional: allow overriding DNS servers used by Node's resolver.
  // This is helpful on networks where the default DNS server refuses or blocks queries.
  // Example: DNS_SERVERS=1.1.1.1,8.8.8.8
  const rawDnsServers = process.env.DNS_SERVERS;
  if (rawDnsServers) {
    const servers = rawDnsServers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (servers.length) {
      try {
        dns.setServers(servers);
        logger.info({ servers }, "Configured Node DNS servers");
      } catch (err) {
        logger.warn({ err }, "Failed to configure Node DNS servers");
      }
    }
  }

  try {
    await mongoose.connect(mongoUri, {
      // Keep timeouts explicit so failures surface quickly and predictably.
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });

    // Run post-connect tasks (indexes, cleanups, watchdog)
    await onDbOpen();

    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));

    // Graceful shutdown handler
    const gracefulShutdown = (signal) => {
      logger.info(`Received ${signal}. Gracefully shutting down...`);

      // Clear cleanup and watchdog intervals
      if (cleanupInterval) clearInterval(cleanupInterval);
      if (watchdogInterval) clearInterval(watchdogInterval);

      // Force exit after 10 seconds if connections hang
      const forceShutdownTimeout = setTimeout(() => {
        logger.warn("Graceful shutdown timed out. Forcing exit.");
        process.exit(1);
      }, 10000);

      // Unref the timeout so it doesn't keep the process alive
      forceShutdownTimeout.unref();

      server.close(async () => {
        logger.info("HTTP server closed.");
        try {
          await mongoose.connection.close();
          logger.info("MongoDB connection closed.");
          clearTimeout(forceShutdownTimeout);
          process.exit(0);
        } catch (dbErr) {
          logger.error({ err: dbErr }, "Error during database disconnection");
          clearTimeout(forceShutdownTimeout);
          process.exit(1);
        }
      });
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  } catch (err) {
    logger.error({ err }, "Failed to start server (MongoDB connection failed)");
    process.exit(1);
  }
}

start();

module.exports = { app, logger };