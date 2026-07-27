const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const UserSession = require("../models/UserSession");
const logger = require("../lib/logger");
const { sendError } = require("./apiResponse");
const { sessionAutoUpgradesCounter } = require("../lib/metrics");

// Cookie configuration for httpOnly auth (identical to route config to clear properly)
const isProduction = process.env.NODE_ENV === "production";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 60 * 60 * 1000, // 1 hour
  path: "/"
};

const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 60 * 60 * 1000, // 1 hour
  path: "/"
};

// Helper to clear auth cookie
const clearAuthCookie = (res) => {
  res.clearCookie("auth_token", { ...COOKIE_OPTIONS, maxAge: 0 });
  res.clearCookie("csrf_token", { ...CSRF_COOKIE_OPTIONS, maxAge: 0 });
};

/**
 * Auth middleware: reads token from cookie first, then Authorization header,
 * verifies session and attaches user to the request context.
 */
async function verifyToken(req, res, next) {
  try {
    const token =
      req.cookies?.auth_token ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);

    if (!token) return sendError(res, 401, "Missing token");

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.sessionId) {
      return sendError(res, 401, "Session verification required");
    }

    const session = await UserSession.findOne({
      _id: decoded.sessionId,
      userId: decoded.id,
      isActive: true
    });

    if (!session) {
      clearAuthCookie(res);
      return sendError(res, 401, "Session expired or logged out");
    }

    // Auto-upgrade check: Dynamically upgrade/sync CSRF token bindings
    const currentCsrfToken = req.cookies?.csrf_token;
    let needsNewCsrf = false;

    if (!session.csrfHash) {
      needsNewCsrf = true;
    } else if (!currentCsrfToken) {
      needsNewCsrf = true;
    } else {
      const cookieHash = crypto.createHash("sha256").update(currentCsrfToken).digest("hex");
      if (cookieHash !== session.csrfHash) {
        needsNewCsrf = true;
      }
    }

    if (needsNewCsrf) {
      const newCsrfToken = crypto.randomBytes(32).toString("hex");
      const newCsrfHash = crypto.createHash("sha256").update(newCsrfToken).digest("hex");

      await UserSession.updateOne({ _id: session._id }, { $set: { csrfHash: newCsrfHash } });
      session.csrfHash = newCsrfHash;

      res.cookie("csrf_token", newCsrfToken, CSRF_COOKIE_OPTIONS);
      req.csrfToken = newCsrfToken;
      sessionAutoUpgradesCounter.inc();
      logger.info({ sessionId: session._id }, "Session auto-upgraded/synchronized with new CSRF token");
    } else {
      req.csrfToken = currentCsrfToken;
    }

    req.userSession = session;

    const user = await User.findById(decoded.id);
    if (!user) return sendError(res, 401, "User not found");

    // Throttle lastSeen updates to database to once every 15 minutes
    const now = Date.now();
    const lastSeenTime = session.lastSeen ? new Date(session.lastSeen).getTime() : 0;
    if (now - lastSeenTime > 15 * 60 * 1000) {
      UserSession.updateOne({ _id: session._id }, { $set: { lastSeen: new Date() } }).catch((err) => {
        logger.error({ err }, "Failed to update lastSeen in background");
      });
    }

    req.user = user;
    req.userId = user._id;
    req.sessionId = session._id;
    return next();
  } catch (err) {
    return sendError(res, 401, "Invalid or expired token");
  }
}

/**
 * Middleware to ensure the authenticated user is active.
 */
async function ensureActive(req, res, next) {
  try {
    const user = req.user;
    if (!user) return sendError(res, 401, 'User not found');
    if (user.isActive === false) {
      return sendError(res, 403, 'Account is deactivated');
    }
    next();
  } catch (err) {
    logger.error({ err }, "ensureActive middleware failed");
    return sendError(res, 500, 'Internal server error');
  }
}

/**
 * Middleware to ensure the authenticated user is an admin.
 */
function isAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return sendError(res, 403, "Admin access required");
  }
  next();
}

module.exports = {
  verifyToken,
  ensureActive,
  isAdmin,
  clearAuthCookie
};
