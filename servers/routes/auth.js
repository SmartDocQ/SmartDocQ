const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const multer = require("multer");
const path = require("path");
const streamifier = require("streamifier");
const cloudinary = require('cloudinary').v2;
const Chat = require("../models/Chat");
const Document = require("../models/Document");
const ContactReport = require("../models/ContactReport");
const { OAuth2Client } = require('google-auth-library');

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
      return next();
    }
    // Lightweight presence update (fire-and-forget)
    try {
      // Avoid awaiting; do not block request
      User.updateOne({ _id: req.userId }, { $set: { lastSeenAt: new Date(), isOnline: true } }).catch(() => {});
    } catch (_) { /* ignore */ }

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


module.exports = router;
module.exports.verifyToken = verifyToken;

// Middleware to ensure current user is active (skip for special admin)
module.exports.ensureActive = async function ensureActive(req, res, next) {
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

// Presence: mark user offline on logout (client should call this before clearing token)
router.post('/logout', verifyToken, async (req, res) => {
  try {
    if (req.isSpecialAdmin) {
      // Nothing to persist for special admin
      return res.json({ message: 'Logged out' });
    }
    await User.updateOne({ _id: req.userId }, { $set: { isOnline: false, lastSeenAt: new Date(0) } });
    return res.json({ message: 'Logged out' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Logout failed' });
  }
});

// Presence: optional heartbeat to keep user online without heavy polling
router.post('/heartbeat', verifyToken, async (req, res) => {
  try {
    if (req.isSpecialAdmin) {
      return res.json({ ok: true });
    }
    await User.updateOne({ _id: req.userId }, { $set: { isOnline: true, lastSeenAt: new Date() } });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Heartbeat failed' });
  }
});
