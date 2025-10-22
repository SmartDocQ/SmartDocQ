const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const User = require("../models/User");
const multer = require("multer");
const path = require("path");
const streamifier = require("streamifier");
const cloudinary = require('cloudinary').v2;
const Chat = require("../models/Chat");
const Document = require("../models/Document");
const ContactReport = require("../models/ContactReport");
const { OAuth2Client } = require('google-auth-library');

// Email sending: build multiple transporters and fallback if one path fails
console.log('🔍 Email Configuration Check:');
console.log('EMAIL_USER:', process.env.EMAIL_USER ? '✓ Set' : '✗ Missing');
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? '✓ Set' : '✗ Missing');

function buildTransporters() {
  const user = process.env.EMAIL_USER;
  const pass = (process.env.EMAIL_PASS || '').replace(/\s/g, '');
  if (!user || !pass) return [];

  const auth = { user, pass };
  const configs = [
    // 1) Simple Gmail service
    { service: 'gmail', auth },
    // 2) Explicit SSL (465)
    { host: 'smtp.gmail.com', port: 465, secure: true, auth, connectionTimeout: 10000, socketTimeout: 10000 },
    // 3) STARTTLS (587)
    { host: 'smtp.gmail.com', port: 587, secure: false, auth, connectionTimeout: 10000, socketTimeout: 10000 }
  ];
  return configs.map(cfg => nodemailer.createTransport(cfg));
}

const transporters = buildTransporters();

async function sendMailWithFallback(mailOptions) {
  if (!transporters.length) throw new Error('Email credentials not configured');
  let lastErr;
  for (let i = 0; i < transporters.length; i++) {
    try {
      const info = await transporters[i].sendMail(mailOptions);
      console.log(`📧 Email sent via transporter #${i + 1}`, info?.messageId ? `id=${info.messageId}` : '');
      return info;
    } catch (e) {
      lastErr = e;
      console.warn(`⚠️  Send attempt #${i + 1} failed:`, e?.code || e?.message || e);
    }
  }
  throw lastErr || new Error('All email transports failed');
}

// Derive the frontend base URL without using FRONTEND_URL.
// Preference order: request Origin header -> first exact entry from FRONTEND_ORIGINS -> localhost
function getFrontendBase(req) {
  try {
    const originHeader = (req.headers?.origin || '').replace(/\/$/, '');
    if (originHeader) return originHeader;

    const raw = process.env.FRONTEND_ORIGINS || '';
    const entries = raw.split(',').map(s => s.trim()).filter(Boolean);
    const exact = entries.find(e => !e.startsWith('*.'));
    if (exact) return exact.replace(/\/$/, '');
  } catch (_) { /* ignore */ }
  return 'http://localhost:3000';
}

// Simple auth middleware to verify JWT and attach userId
function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Missing token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    
    // Handle special admin token
    if (decoded.id === "admin_special" && decoded.isAdmin) {
      req.isSpecialAdmin = true;
    }
    
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Signup
router.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    // Password is optional for Google OAuth users
    if (!password && !req.body.googleId) {
      return res.status(400).json({ message: "Password is required for local signup" });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
    const user = new User({ 
      name, 
      email, 
      password: hashedPassword,
      authProvider: "local"
    });
    await user.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Login
router.post("/login", async (req, res) => {
  const emailRaw = req.body.email || "";
  const password = req.body.password || "";
  const email = emailRaw.toLowerCase().trim();
  try {
    // Special admin login - hardcoded credentials (fast path, no DB check)
    if (email === "admin123@gmail.com" && password === "adminhere") {
      // Create a special admin token immediately
      const adminToken = jwt.sign({ 
        id: "admin_special", 
        isAdmin: true, 
        email: "admin123@gmail.com" 
      }, process.env.JWT_SECRET, { expiresIn: "1h" });

      return res.json({ 
        token: adminToken, 
        user: {
          id: "admin_special",
          name: "System Administrator",
          email: "admin123@gmail.com",
          isAdmin: true,
          role: "admin",
          createdAt: new Date(),
          lastLogin: new Date()
        },
        isAdmin: true
      });
    }

    // Regular user login
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    // Block immediately if deactivated
    if (user.isActive === false) {
      return res.status(403).json({ message: "Account is deactivated. Contact support." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid password" });

    // ✅ Update lastLogin
    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.json({ 
      token, 
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
      isAdmin: user.isAdmin || false
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Utility: derive Cloudinary public_id from a secure URL
function extractCloudinaryPublicId(url) {
  try {
    if (!url || typeof url !== 'string') return null;
    const u = new URL(url);
    // Expect path like: /<cloud_name?>/image/upload/v<ver>/<folder>/<name>.<ext>
    const p = u.pathname; // e.g., /image/upload/v1721234567/smartdoc/avatars/USER-ts.jpg
    const idx = p.indexOf('/upload/');
    if (idx === -1) return null;
    let rest = p.substring(idx + '/upload/'.length); // v172.../smartdoc/avatars/USER-ts.jpg
    // Drop version prefix if present
    if (rest.startsWith('v') && rest.includes('/')) {
      rest = rest.substring(rest.indexOf('/') + 1);
    }
    // Remove leading slash if any
    if (rest.startsWith('/')) rest = rest.slice(1);
    // Remove extension (last .ext)
    const lastDot = rest.lastIndexOf('.');
    if (lastDot > -1) rest = rest.substring(0, lastDot);
    return rest || null; // e.g., smartdoc/avatars/USER-ts
  } catch (_) {
    return null;
  }
}

// Delete current user
router.delete("/me", verifyToken, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

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
      return res.json({ message: "Account deleted successfully", deleted: counts });
    } catch (_) {
      // Even if cascade fails, the account was removed; report generic success
      return res.json({ message: "Account deleted successfully" });
    }
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});


// Update current user (name, email, password)
router.put("/me", verifyToken, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Validate provided name isn't same as current
    if (typeof name === "string" && name.trim()) {
      if (name.trim() === user.name) {
        return res.status(400).json({ message: "New name must be different from current name" });
      }
      user.name = name.trim();
    }

    // Update email with uniqueness and same-value checks
    if (typeof email === "string" && email.trim()) {
      const nextEmail = email.toLowerCase().trim();
      if (nextEmail === user.email) {
        return res.status(400).json({ message: "New email must be different from current email" });
      }
      const existing = await User.findOne({ email: nextEmail });
      if (existing && existing._id.toString() !== user._id.toString()) {
        return res.status(400).json({ message: "Email already in use" });
      }
      user.email = nextEmail;
    }

    // Update password with 3 changes allowed per 24h, then cooldown until window resets
    if (typeof password === "string" && password.length > 0) {
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      // Prevent setting the same password again
      const isSame = await bcrypt.compare(password, user.password);
      if (isSame) {
        return res.status(400).json({ message: "New password must be different from current password" });
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
        return res.status(429).json({ message: `Password change limit reached. Try again in ${remainingHours}h` });
      }

      user.password = await bcrypt.hash(password, 10);
      user.lastPasswordChange = new Date(now);
      user.passwordChangeCount += 1;
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

    return res.json({ user: sanitized });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// Middleware to ensure current user is active (skip for special admin)
const ensureActive = async function ensureActive(req, res, next) {
  try {
    if (req.isSpecialAdmin) return next();
    const user = await User.findById(req.userId).select('isActive');
    if (!user) return res.status(401).json({ message: 'User not found' });
    if (user.isActive === false) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// Configure Multer memory storage for avatars (no local files)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".webp"];
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error("Only PNG, JPG, JPEG, WEBP allowed"));
    cb(null, true);
  }
});

// Upload/update current user's avatar
router.post("/me/avatar", verifyToken, avatarUpload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const previousAvatarUrl = user.avatar; // keep for deletion after successful upload

    // Upload to Cloudinary using a stream
    const folder = process.env.CLOUDINARY_AVATAR_FOLDER || "smartdoc/avatars";
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, public_id: `${req.userId}-${Date.now()}`, resource_type: "image", overwrite: true },
      async (error, result) => {
        try {
          if (error) return res.status(500).json({ message: error.message || "Upload failed" });
          user.avatar = result.secure_url;
          await user.save();
          // After saving new avatar, delete previous one to avoid wasting storage
          try {
            const pubId = extractCloudinaryPublicId(previousAvatarUrl);
            if (pubId) {
              await cloudinary.uploader.destroy(pubId, { invalidate: true, resource_type: 'image' });
            }
          } catch (_) { /* ignore deletion errors */ }
          return res.json({ avatar: user.avatar });
        } catch (e) {
          return res.status(500).json({ message: e.message || "Failed to save avatar" });
        }
      }
    );
    streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Failed to upload avatar" });
  }
});

// ===== FORGOT PASSWORD & RESET =====
// Request password reset (generates token and stores in DB)
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.trim()) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    
    // For security, always return success even if user doesn't exist
    if (!user) {
      return res.json({ message: "If an account exists with this email, a reset link will be sent" });
    }

    // Check if user signed up with Google (no password to reset)
    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({ message: "This account uses Google Sign-In. Please sign in with Google." });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    
    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpire = Date.now() + 3600000; // 1 hour
    await user.save();

  // Create reset URL from FRONTEND_ORIGINS or request Origin (no FRONTEND_URL usage)
  const baseUrl = getFrontendBase(req);
  const resetUrl = `${baseUrl}/reset-password/${resetToken}`;

    // Respond immediately so UI isn't blocked by SMTP connectivity
    res.json({ message: "If an account exists with this email, a reset link has been sent" });

    // Fire-and-forget email send (won't block HTTP response)
    setImmediate(async () => {
      try {
        const mailOptions = {
          from: `"SmartDocQ" <${process.env.EMAIL_USER}>`,
          to: user.email,
          subject: 'Password Reset Request - SmartDocQ',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                .button { display: inline-block; padding: 14px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
                .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>🔐 Password Reset Request</h1>
                </div>
                <div class="content">
                  <p>Hello <strong>${user.name}</strong>,</p>
                  <p>You requested to reset your password for your SmartDoc account. Click the button below to reset it:</p>
                  <div style="text-align: center;">
                    <a href="${resetUrl}" class="button">Reset Password</a>
                  </div>
                  <p>Or copy and paste this link into your browser:</p>
                  <p style="background: white; padding: 12px; border-radius: 6px; word-break: break-all; font-size: 12px; color: #667eea;">
                    ${resetUrl}
                  </p>
                  <div class="warning">
                    <strong>⚠️ Important:</strong> This link will expire in <strong>1 hour</strong>.
                  </div>
                  <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
                  <p>Best regards,<br><strong>SmartDoc Team</strong></p>
                </div>
                <div class="footer">
                  <p>This is an automated message, please do not reply to this email.</p>
                  <p>&copy; 2025 SmartDoc. All rights reserved.</p>
                </div>
              </div>
            </body>
            </html>
          `
        };

        const info = await sendMailWithFallback(mailOptions);
        console.log(`✅ Password reset email attempted to: ${user.email}`, info?.messageId ? `id=${info.messageId}` : '');
      } catch (emailError) {
        console.warn('⚠️ Password reset email failed:', emailError?.code || emailError?.message || emailError);
      }
    });
    return; // ensure we don't continue in this handler after responding

  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ message: "Failed to process password reset request" });
  }
});

// Reset password (using token from email)
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Hash the token to compare with DB
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid token that hasn't expired
    const user = await User.findOne({
      resetPasswordToken: resetTokenHash,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    // Update password
    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    // Send confirmation email
    try {
      const mailOptions = {
        from: `"SmartDocQ" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: 'Password Reset Successful - SmartDocQ',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #00c851 0%, #007e33 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .success-badge { background: #d4edda; border-left: 4px solid #28a745; padding: 12px; margin: 20px 0; border-radius: 4px; }
              .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; }
              .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>✅ Password Reset Successful</h1>
              </div>
              <div class="content">
                <p>Hello <strong>${user.name}</strong>,</p>
                <div class="success-badge">
                  <strong>✓ Success!</strong> Your password has been successfully reset.
                </div>
                <p>You can now log in to your SmartDoc account using your new password.</p>
                <p><strong>Reset Details:</strong></p>
                <ul>
                  <li>Time: ${new Date().toLocaleString()}</li>
                  <li>Account: ${user.email}</li>
                </ul>
                <div class="warning">
                  <strong>⚠️ Didn't make this change?</strong><br>
                  If you didn't reset your password, please contact our support team immediately.
                </div>
                <p>Best regards,<br><strong>SmartDoc Team</strong></p>
              </div>
              <div class="footer">
                <p>This is an automated message, please do not reply to this email.</p>
                <p>&copy; 2025 SmartDoc. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

  await sendMailWithFallback(mailOptions);
  console.log(`Password reset confirmation sent to: ${user.email}`);
    } catch (emailError) {
      console.error('Confirmation email error:', emailError);
      // Don't fail the request if confirmation email fails
    }

    res.json({ message: "Password reset successful. You can now log in with your new password." });

  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ message: "Failed to reset password" });
  }
});

// ===== GOOGLE OAUTH =====
// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Google Sign-In (verify token from frontend)
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body; // Google JWT token from @react-oauth/google
    
    if (!credential) {
      return res.status(400).json({ message: 'No credential provided' });
    }

    // Verify the Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    if (!email) {
      return res.status(400).json({ message: 'Email not provided by Google' });
    }

    // Check if user exists
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      // Existing user - link Google account if not already linked
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = 'google';
        if (picture && !user.avatar) user.avatar = picture;
        await user.save();
      }
      
      // Update last login
      user.lastLogin = new Date();
      await user.save();
    } else {
      // Create new user with Google auth
      user = new User({
        name: name || email.split('@')[0],
        email,
        googleId,
        authProvider: 'google',
        avatar: picture || null,
        lastLogin: new Date(),
        isActive: true,
      });
      await user.save();
    }

    // Block if deactivated
    if (user.isActive === false) {
      return res.status(403).json({ message: 'Account is deactivated. Contact support.' });
    }

    // Generate JWT
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.json({
      token,
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
      isAdmin: user.isAdmin || false,
    });
  } catch (err) {
    console.error('Google auth error:', err);
    return res.status(500).json({ message: 'Google authentication failed', error: err.message });
  }
});

// Export router and utilities at the end
module.exports = router;
module.exports.verifyToken = verifyToken;
module.exports.ensureActive = ensureActive;
