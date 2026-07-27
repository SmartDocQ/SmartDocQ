const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const UserSession = require("../models/UserSession");

// Helper to extract device name from user-agent
const getDeviceName = (req) => {
  const ua = req.headers["user-agent"] || "";
  let browser = "Browser";
  if (/chrome|crios/i.test(ua) && !/edge|edg/i.test(ua) && !/opr/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = "Safari";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/edge|edg/i.test(ua)) browser = "Edge";
  else if (/opr/i.test(ua)) browser = "Opera";

  let os = "Unknown OS";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
  else if (/iphone/i.test(ua)) os = "iPhone";
  else if (/ipad/i.test(ua)) os = "iPad";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  return `${browser} on ${os}`;
};

// Helper to extract IP address safely
const getIpAddress = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "Unknown IP";
};

/**
 * Creates a new database session and signs a corresponding JWT.
 * Returns { token, csrfToken }
 * Conforms to secure session rotation: generates a fresh CSRF token and hash on every call.
 */
async function createSession(user, req) {
  // Rotate: Always generate a brand new random token on session/login creation
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const csrfHash = crypto.createHash("sha256").update(csrfToken).digest("hex");

  const session = new UserSession({
    userId: user._id,
    deviceName: getDeviceName(req),
    ipAddress: getIpAddress(req),
    isActive: true,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour session TTL (matches JWT)
    csrfHash: csrfHash
  });
  await session.save();

  const token = jwt.sign(
    { id: user._id, sessionId: session._id },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  return { token, csrfToken };
}

module.exports = {
  createSession,
  getDeviceName,
  getIpAddress
};
