const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const UserSession = require("../models/UserSession");
const multer = require("multer");
const path = require("path");
const streamifier = require("streamifier");
const cloudinary = require('cloudinary').v2;
const Chat = require("../models/Chat");
const Document = require("../models/Document");
const ContactReport = require("../models/ContactReport");
const { sendPasswordResetEmail, sendPasswordChangedEmail } = require("../services/mailService");
const { createSession } = require("../services/sessionService");
const { verifyGoogleLogin } = require("../services/googleAuthService");
const logger = require("../lib/logger");
const { verifyToken, clearAuthCookie } = require("../middlewares/auth");
const { extractCloudinaryPublicId } = require("../utils/cloudinary");
const { verifyCsrf } = require("../middlewares/csrf");
const { csrfRefreshesCounter } = require("../lib/metrics");
const { validate } = require("../middlewares/validate");
const { sendError, sendSuccess } = require("../middlewares/apiResponse");
const { signupSchema, loginSchema, updateMeSchema, forgotPasswordSchema, resetPasswordSchema, googleSchema } = require("../validators/authSchemas");
const rateLimit = require("express-rate-limit");

// Rate limiter for sensitive authentication endpoints to prevent brute-force attacks and spamming
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication requests, please try again after 15 minutes." },
});

// Dedicated rate limiter for CSRF refresh endpoint
const csrfLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15 minutes (generous but prevents brute-force / DDoS)
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many CSRF refresh requests, please try again later." },
});

// Cookie configuration for httpOnly auth
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

// Helper to set auth cookie
const setAuthCookie = (res, token, csrfToken) => {
  res.cookie("auth_token", token, COOKIE_OPTIONS);
  if (csrfToken) {
    res.cookie("csrf_token", csrfToken, CSRF_COOKIE_OPTIONS);
  }
};


// Signup
router.post("/signup", authLimiter, validate(signupSchema), async (req, res) => {
  const { name, email, password, googleId } = req.validated.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return sendError(res, 400, "User already exists");

    // Password is optional for Google OAuth users
    if (!password && !googleId) {
      return sendError(res, 400, "Password is required for local signup");
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
    const user = new User({ 
      name, 
      email, 
      password: hashedPassword,
      authProvider: "local"
    });
    await user.save();

    return sendSuccess(res, 201, {}, "User registered successfully");
  } catch (err) {
    logger.error({ err }, "Signup failed");
    return sendError(res, 500, "Signup failed");
  }
});

// Login
router.post("/login", authLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.validated.body;
  try {
    const user = await User.findOne({ email });
    
    // Generic error message to prevent user enumeration
    if (!user) return sendError(res, 400, "Invalid email or password");

    // Block immediately if deactivated
    if (user.isActive === false) {
      return sendError(res, 403, "Account is deactivated. Contact support.");
    }

    // Google-only users won't have a local password set, prevent bcrypt compare crash
    if (!user.password) {
      return sendError(res, 400, "Invalid email or password");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return sendError(res, 400, "Invalid email or password");

    // Update lastLogin
    user.lastLogin = new Date();
    await user.save();

    // Create session and token using centralized sessionService
    const { token, csrfToken } = await createSession(user, req);

    setAuthCookie(res, token, csrfToken);
    return sendSuccess(res, 200, {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isAdmin: user.isAdmin || false,
        role: user.role || "user",
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      csrfToken,
      isAdmin: user.isAdmin || false,
    });
  } catch (err) {
    logger.error({ err }, "Login failed");
    return sendError(res, 500, "Login failed");
  }
});

// Forgot password - request reset link
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), async (req, res) => {
  try {
    logger.info("Starting forgot-password");
    const { email: normalizedEmail } = req.validated.body;
    const user = await User.findOne({ email: normalizedEmail });

    // Always respond the same to avoid leaking which emails exist
    if (!user) {
      return sendSuccess(res, 200, {}, "If an account exists, a reset link has been sent.");
    }

    // Google-only accounts don't have a local password to reset
    if (user.authProvider === "google" && !user.password) {
      return sendSuccess(
        res,
        200,
        { provider: "google" },
        "This account uses Google Sign-In. Please continue with Google."
      );
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    await user.save();

    const frontendBase = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetLink = `${frontendBase.replace(/\/$/, "")}/reset-password?token=${rawToken}`;
    try {
      logger.info("Sending reset email...");
      await sendPasswordResetEmail(user.email, resetLink);
      logger.info("Reset email sent.");
    } catch (mailErr) {
      logger.error({ err: mailErr }, "Failed to send reset link email (background)");
    }

    return sendSuccess(res, 200, {}, "If an account exists, a reset link has been sent.");
  } catch (err) {
    logger.error({ err }, "Failed to send reset link");
    return sendError(res, 500, "Failed to send reset link");
  }
});

// Reset password - consume token and set new password
router.post("/reset-password", authLimiter, validate(resetPasswordSchema), async (req, res) => {
  try {
    const { token, password } = req.validated.body;

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return sendError(
        res,
        400,
        "This password reset link is no longer valid. Please request a new reset link."
      );
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.lastPasswordChange = new Date();
    user.passwordChangeCount = 0;
    user.passwordChangeWindowStart = new Date();

    await user.save();

    // Invalidate all active sessions (force logout on all devices)
    await UserSession.updateMany(
      { userId: user._id },
      { $set: { isActive: false } }
    );

    // Send password-changed confirmation email (fire-and-forget — don't block the response)
    const changeTime = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " IST";

    sendPasswordChangedEmail(user.email, changeTime).catch((mailErr) => {
      logger.error({ err: mailErr }, "Password-changed confirmation email failed");
    });

    return sendSuccess(res, 200, {}, "Password reset successful");
  } catch (err) {
    logger.error({ err }, "Reset-password handler failed");
    return sendError(res, 500, "Failed to reset password");
  }
});

// Logout - clears httpOnly cookie and marks current session inactive
router.post("/logout", verifyToken, verifyCsrf, async (req, res) => {
  try {
    if (req.userSession) {
      req.userSession.isActive = false;
      await req.userSession.save();
    }
  } catch (err) {
    logger.info("Session deactivation skipped on logout: " + err.message);
  }

  clearAuthCookie(res);
  return sendSuccess(res, 200, {}, "Logged out successfully");
});

// Logout all - deactivates all sessions for the user
router.post("/logout-all", verifyToken, verifyCsrf, async (req, res) => {
  try {
    await UserSession.updateMany(
      { userId: req.userId },
      { $set: { isActive: false } }
    );
    clearAuthCookie(res);
    return sendSuccess(res, 200, {}, "Logged out from all devices successfully");
  } catch (err) {
    logger.error({ err }, "Failed to log out from all devices");
    return sendError(res, 500, "Failed to log out from all devices");
  }
});

// Verify session - checks if cookie is valid
router.get("/verify", verifyToken, (req, res) => {
  return sendSuccess(res, 200, { 
    valid: true, 
    userId: req.userId,
    csrfToken: req.csrfToken
  });
});

// GET /api/auth/csrf - returns a fresh CSRF token (automatically synchronized via verifyToken middleware)
router.get("/csrf", verifyToken, csrfLimiter, (req, res) => {
  csrfRefreshesCounter.inc();
  return sendSuccess(res, 200, { csrfToken: req.csrfToken });
});


// Delete current user
router.delete("/me", verifyToken, verifyCsrf, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.userId);
    if (!user) return sendError(res, 404, "User not found");

    // Invalidate all user sessions in DB
    await UserSession.deleteMany({ userId: user._id });

    // Clear client-side cookies
    clearAuthCookie(res);

    // Best-effort: remove avatar from Cloudinary to free storage
    try {
      const pubId = extractCloudinaryPublicId(user.avatar);
      if (pubId) {
        await cloudinary.uploader.destroy(pubId, { invalidate: true, resource_type: 'image' });
      }
    } catch (_) { /* ignore */ }

    // Cascade delete user-related data (MongoDB Atlas)
    try {
      const [docsRes, chatsRes, contactsRes] = await Promise.allSettled([
        Document.deleteMany({ user: user._id }),
        Chat.deleteMany({ user: user._id }),
        ContactReport.deleteMany({ user: user._id })
      ]);
      const counts = {
        documents: docsRes.status === 'fulfilled' ? (docsRes.value?.deletedCount || 0) : 0,
        chats: chatsRes.status === 'fulfilled' ? (chatsRes.value?.deletedCount || 0) : 0,
        contactReports: contactsRes.status === 'fulfilled' ? (contactsRes.value?.deletedCount || 0) : 0,
      };
      return sendSuccess(res, 200, { deleted: counts }, "Account deleted successfully");
    } catch (_) {
      // Even if cascade fails, the account was removed; report generic success
      return sendSuccess(res, 200, {}, "Account deleted successfully");
    }
  } catch (err) {
    logger.error({ err }, "Failed to delete account");
    return sendError(res, 500, "Failed to delete account");
  }
});


// Update current user (name, email, password)
router.put("/me", verifyToken, verifyCsrf, validate(updateMeSchema), async (req, res) => {
  try {
    const { name, email, password } = req.validated.body || {};
    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 404, "User not found");

    // Validate provided name isn't same as current
    if (typeof name === "string" && name.trim()) {
      if (name.trim() === user.name) {
        return sendError(res, 400, "New name must be different from current name");
      }
      user.name = name.trim();
    }

    // Update email with uniqueness and same-value checks
    if (typeof email === "string" && email.trim()) {
      const nextEmail = email.toLowerCase().trim();
      if (nextEmail === user.email) {
        return sendError(res, 400, "New email must be different from current email");
      }
      const existing = await User.findOne({ email: nextEmail });
      if (existing && existing._id.toString() !== user._id.toString()) {
        return sendError(res, 400, "Email already in use");
      }
      user.email = nextEmail;
    }

    // Update password with 3 changes allowed per 24h, then cooldown until window resets
    if (typeof password === "string" && password.length > 0) {
      // Prevent setting the same password again, safely handle Google OAuth users with null passwords
      const isSame = user.password ? await bcrypt.compare(password, user.password) : false;
      if (isSame) {
        return sendError(res, 400, "New password must be different from current password");
      }

      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;

      // Initialize or reset window if expired
      const windowStart = user.passwordChangeWindowStart ? user.passwordChangeWindowStart.getTime() : null;
      if (!windowStart || now - windowStart >= twentyFourHours) {
        user.passwordChangeWindowStart = new Date(now);
        user.passwordChangeCount = 0;
      }

      // Enforce 3 changes per 24-hour window
      if (user.passwordChangeCount >= 3) {
        const remainingMs = twentyFourHours - (now - user.passwordChangeWindowStart.getTime());
        const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
        return sendError(res, 429, `Password change limit reached. Try again in ${remainingHours}h`);
      }

      user.password = await bcrypt.hash(password, 10);
      user.lastPasswordChange = new Date(now);
      user.passwordChangeCount += 1;

      // Invalidate all other user sessions when password is changed via profile update
      await UserSession.updateMany(
        { userId: user._id, _id: { $ne: req.sessionId } },
        { $set: { isActive: false } }
      );
    }

    await user.save();

    // Optionally rotate token. Keeping existing token by default.
    const sanitized = {
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
    };

    return sendSuccess(res, 200, { user: sanitized });
  } catch (err) {
    logger.error({ err }, "Failed to update profile");
    return sendError(res, 500, "Failed to update profile");
  }
});


module.exports = router;

// Configure Multer memory storage for avatars (no local files)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedExts = [".png", ".jpg", ".jpeg", ".webp"];
    const allowedMimes = ["image/png", "image/jpeg", "image/webp"];
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!allowedExts.includes(ext) || !allowedMimes.includes(file.mimetype)) {
      return cb(new Error("Only PNG, JPG, JPEG, WEBP allowed"));
    }
    cb(null, true);
  }
});

// Upload/update current user's avatar
router.post("/me/avatar", verifyToken, verifyCsrf, avatarUpload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return sendError(res, 400, "No file uploaded");
    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 404, "User not found");
    const previousAvatarUrl = user.avatar; // keep for deletion after successful upload

    // Upload to Cloudinary using a stream (wrapped in a promise)
    const folder = process.env.CLOUDINARY_AVATAR_FOLDER || "smartdoc/avatars";
    let uploadResult;
    try {
      uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder, public_id: `${req.userId}-${Date.now()}`, resource_type: "image", overwrite: true },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
      });
    } catch (error) {
      logger.error({ err: error }, "Cloudinary upload failed");
      return sendError(res, 500, "Upload failed");
    }

    user.avatar = uploadResult.secure_url;
    await user.save();

    // After saving new avatar, delete previous one to avoid wasting storage
    try {
      const pubId = extractCloudinaryPublicId(previousAvatarUrl);
      if (pubId) {
        await cloudinary.uploader.destroy(pubId, { invalidate: true, resource_type: 'image' });
      }
    } catch (_) { /* ignore deletion errors */ }

    return sendSuccess(res, 200, { avatar: user.avatar });
  } catch (err) {
    logger.error({ err }, "Failed to upload avatar");
    return sendError(res, 500, "Failed to upload avatar");
  }
});
// ===== GOOGLE OAUTH =====
// Google Sign-In (verify token from frontend)
router.post('/google', authLimiter, validate(googleSchema), async (req, res) => {
  try {
    const { credential } = req.validated.body; // Google JWT token from @react-oauth/google
    
    // Verify Google login and find or create the user in the database
    const user = await verifyGoogleLogin(credential);

    // Block if deactivated
    if (user.isActive === false) {
      return sendError(res, 403, 'Account is deactivated. Contact support.');
    }

    // Create session and token using centralized sessionService
    const { token, csrfToken } = await createSession(user, req);

    setAuthCookie(res, token, csrfToken);
    return sendSuccess(res, 200, {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isAdmin: user.isAdmin || false,
        role: user.role || 'user',
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
      },
      csrfToken,
      isAdmin: user.isAdmin || false,
    });
  } catch (err) {
    logger.error({ err }, "Google auth error");
    return sendError(res, 500, 'Google authentication failed');
  }
});