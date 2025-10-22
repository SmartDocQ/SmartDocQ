const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Document = require("../models/Document");
const Chat = require("../models/Chat");
const ContactReport = require("../models/ContactReport");
const { verifyToken } = require("./auth");
const mongoose = require("mongoose");
const cloudinary = require('cloudinary').v2;

// Middleware to check if user is admin
const isAdmin = async (req, res, next) => {
  try {
    // Check for special admin token
    if (req.userId === "admin_special") {
      req.adminUser = {
        _id: "admin_special",
        name: "System Administrator",
        email: "admin123@gmail.com",
        isAdmin: true,
        role: "admin"
      };
      return next();
    }

    // Regular user admin check
    const user = await User.findById(req.userId);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }
    req.adminUser = user;
    next();
  } catch (error) {
    return res.status(500).json({ message: "Error checking admin status" });
  }
};

// Dashboard overview
router.get("/dashboard", verifyToken, isAdmin, async (req, res) => {
  try {
    // Get counts
    const totalUsers = await User.countDocuments();
    const totalDocuments = await Document.countDocuments();
    const totalChats = await Chat.countDocuments();
    const totalReports = await ContactReport.countDocuments();
    
    // Get storage usage from MongoDB database stats (Atlas-backed)
    let storageUsed = 0;
    try {
      const dbStats = await mongoose.connection.db.stats();
      // Prefer storageSize; fallback to dataSize
      storageUsed = Number(dbStats?.storageSize || dbStats?.dataSize || 0);
    } catch (e) {
      console.warn("Failed to fetch db stats; storageUsed set to 0", e?.message);
    }
    
    // Get conversion rate
    const totalWordDocs = await Document.countDocuments({
      $or: [
        { originalType: "application/msword" },
        { originalType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
      ]
    });
    const convertedDocs = await Document.countDocuments({
      type: "application/pdf",
      $or: [
        { originalType: "application/msword" },
        { originalType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
      ]
    });
    const conversionRate = totalWordDocs > 0 ? Math.round((convertedDocs / totalWordDocs) * 100) : 0;
    
    // Online users window (in minutes); default 10 minutes
    const onlineWindowMin = Math.max(1, parseInt(process.env.ONLINE_WINDOW_MINUTES || '10', 10));
    const since = new Date(Date.now() - onlineWindowMin * 60 * 1000);

    // Compute online users by union of recent lastLogin, recent chats, and recent document activity
    const [recentLoginUsers, recentChatUsers, recentDocUsers] = await Promise.all([
      // Users who logged in recently and are active
      User.distinct('_id', { lastLogin: { $gte: since }, isActive: true }).catch(() => []),
      // Users who chatted recently
      Chat.distinct('user', { updatedAt: { $gte: since } }).catch(() => []),
      // Users who uploaded recently
      Document.distinct('user', { uploadedAt: { $gte: since } }).catch(() => []),
    ]);

    const onlineSet = new Set();
    // Union all sources of recent activity
    recentLoginUsers.forEach(u => onlineSet.add(String(u)));
    recentChatUsers.forEach(u => onlineSet.add(String(u)));
    recentDocUsers.forEach(u => onlineSet.add(String(u)));
    const onlineUsers = onlineSet.size;
    
    // Get document types distribution from Atlas
    const documents = await Document.find({}, { type: 1, name: 1 });
    
    // Process document types into the format expected by frontend
    const documentTypes = {
      pdf: 0,
      word: 0,
      powerpoint: 0,
      excel: 0,
      text: 0,
      others: 0
    };
    
    documents.forEach((doc) => {
      const mimeType = doc.type;
      const fileName = doc.name || '';
      const extension = fileName.split('.').pop()?.toLowerCase();
      
      // Check by MIME type first, then fallback to file extension
      if (mimeType === "application/pdf" || extension === 'pdf') {
        documentTypes.pdf++;
      } else if (mimeType === "application/msword" || 
                 mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                 ['doc', 'docx'].includes(extension)) {
        documentTypes.word++;
      } else if (mimeType === "application/vnd.ms-powerpoint" || 
                 mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
                 ['ppt', 'pptx'].includes(extension)) {
        documentTypes.powerpoint++;
      } else if (mimeType === "application/vnd.ms-excel" || 
                 mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
                 ['xls', 'xlsx'].includes(extension)) {
        documentTypes.excel++;
      } else if (mimeType === "text/plain" || 
                 mimeType === "text/markdown" ||
                 ['txt', 'md', 'text'].includes(extension)) {
        documentTypes.text++;
      } else {
        documentTypes.others++;
      }
    });
    
    // Aggregate feedback from chats (assistant messages with ratings)
    const feedbackAgg = await Chat.aggregate([
      { $unwind: "$messages" },
      { $match: { "messages.role": "assistant", "messages.rating": { $in: ["positive", "negative"] } } },
      { $group: { _id: "$messages.rating", count: { $sum: 1 } } }
    ]);
    // Report types distribution by content (feedback, bug, feature_request, other)
    const reportTypeAgg = await ContactReport.aggregate([
      {
        $project: {
          text: {
            $concat: [
              { $ifNull: ["$subject", ""] },
              " ",
              { $ifNull: ["$message", ""] }
            ]
          }
        }
      },
      {
        $project: {
          type: {
            $switch: {
              branches: [
                { case: { $regexMatch: { input: "$text", regex: /bug|error|issue|fail|crash/i } }, then: "bug" },
                { case: { $regexMatch: { input: "$text", regex: /feature|request|enhancement|improvement/i } }, then: "feature_request" },
                { case: { $regexMatch: { input: "$text", regex: /feedback|suggestion|opinion|comment/i } }, then: "feedback" }
              ],
              default: "other"
            }
          }
        }
      },
      { $group: { _id: "$type", count: { $sum: 1 } } }
    ]);
    const reportTypes = { feedback: 0, bug: 0, feature_request: 0, other: 0 };
    reportTypeAgg.forEach(r => {
      if (r && typeof r._id === "string" && reportTypes.hasOwnProperty(r._id)) {
        reportTypes[r._id] = r.count || 0;
      }
    });

    const feedbackSummary = { positive: 0, negative: 0 };
    feedbackAgg.forEach(row => {
      if (row && (row._id === "positive" || row._id === "negative")) {
        feedbackSummary[row._id] = row.count || 0;
      }
    });

    // Get recent activities
    const recentDocuments = await Document.find()
      .populate("user", "username email")
      .sort({ uploadedAt: -1 })
      .limit(20);
    
    const recentActivities = recentDocuments.map(doc => ({
      type: doc.originalType ? "document_convert" : "document_upload",
      description: `${doc.user?.username || "Unknown"} ${doc.originalType ? "converted" : "uploaded"} "${doc.name}"`,
      timestamp: doc.uploadedAt,
      status: "success",
      userId: doc.user?._id,
      documentId: doc._id
    }));
    
    // Mock system health (in production, get real metrics)
    const systemHealth = {
      cpuUsage: Math.floor(Math.random() * 60) + 20, // 20-80%
      memoryUsage: Math.floor(Math.random() * 50) + 30, // 30-80%
      diskUsage: Math.floor(Math.random() * 40) + 20 // 20-60%
    };
    
    const stats = {
      totalUsers,
      totalDocuments,
      totalChats,
      totalReports,
      storageUsed,
      conversionRate,
      onlineUsers,
  documentTypes, // Real document types from Atlas
  reportTypes,   // Report status distribution from Atlas
      feedbackSummary, // Positive/Negative feedback counts from Atlas
      userGrowth: "+12%", // Mock data - implement real calculation
      documentGrowth: "+8%",
      chatGrowth: "+15%",
      storageGrowth: storageUsed * 0.1,
      conversionTrend: 95,
      recentActivities,
      systemHealth
    };
    
    res.json({ stats });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    res.status(500).json({ message: "Failed to load dashboard data" });
  }
});

// Get all users
router.get("/users", verifyToken, isAdmin, async (req, res) => {
  try {
    // Parse and clamp inputs
    const pageRaw = parseInt(req.query.page);
    const limitRaw = parseInt(req.query.limit);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 20;
    const search = req.query.search || "";
    const allowedSortFields = new Set(["createdAt", "name", "email", "isActive", "isAdmin"]);
    const sortByParam = req.query.sortBy || "createdAt";
    const sortBy = allowedSortFields.has(sortByParam) ? sortByParam : "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    
    const query = search ? {
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ]
    } : {};

    // Total first for pagination
    const totalUsers = await User.countDocuments(query);

    // Compute totals for active and admin users across the entire filtered set
    const totalsAgg = await User.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalActiveUsers: { $sum: { $cond: ["$isActive", 1, 0] } },
          totalAdminUsers: { $sum: { $cond: ["$isAdmin", 1, 0] } }
        }
      }
    ]);
    const totals = {
      totalUsers,
      totalActiveUsers: totalsAgg[0]?.totalActiveUsers || 0,
      totalAdminUsers: totalsAgg[0]?.totalAdminUsers || 0
    };

    const users = await User.find(query)
      .select("-password")
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const userIds = users.map(u => u._id);

    // Aggregate document counts and total storage per user
    const docsAgg = await Document.aggregate([
      { $match: { user: { $in: userIds } } },
      { $group: { _id: "$user", documentCount: { $sum: 1 }, totalStorage: { $sum: "$size" } } }
    ]);
    const chatsAgg = await Chat.aggregate([
      { $match: { user: { $in: userIds } } },
      { $group: { _id: "$user", chatCount: { $sum: 1 } } }
    ]);

    const docsMap = new Map(docsAgg.map(d => [String(d._id), d]));
    const chatsMap = new Map(chatsAgg.map(c => [String(c._id), c]));

    const usersWithStats = users.map(u => {
      const did = String(u._id);
      const d = docsMap.get(did);
      const c = chatsMap.get(did);
      return {
        ...u,
        stats: {
          documentCount: d?.documentCount || 0,
          chatCount: c?.chatCount || 0,
          totalStorage: d?.totalStorage || 0
        }
      };
    });

    res.json({
      users: usersWithStats,
      pagination: {
        page,
        limit,
        total: totalUsers,
        pages: Math.max(1, Math.ceil(totalUsers / limit))
      },
      totals
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// Get all documents
router.get("/documents", verifyToken, isAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || "";
    const type = req.query.type || "";
    const sortBy = req.query.sortBy || "uploadedAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    
    let query = {};
    
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }
    
    if (type) {
      query.type = type;
    }
    
    const documents = await Document.find(query)
      .populate("user", "username email")
      .select("-data") // Exclude binary data
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit);
    
    const totalDocuments = await Document.countDocuments(query);
    
    res.json({
      documents,
      pagination: {
        page,
        limit,
        total: totalDocuments,
        pages: Math.ceil(totalDocuments / limit)
      }
    });
  } catch (error) {
    console.error("Get documents error:", error);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

// Delete user (admin only)
router.delete("/users/:id", verifyToken, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Don't allow admin to delete themselves
    if (userId === req.userId) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }

    // Find user first to attempt avatar cleanup
    const user = await User.findById(userId).select("avatar");
    if (!user) return res.status(404).json({ message: "User not found" });

    // Cascade delete user's data
    const [docsRes, chatsRes, contactsRes, userRes] = await Promise.allSettled([
      Document.deleteMany({ user: userId }),
      Chat.deleteMany({ user: userId }),
      ContactReport.deleteMany({ user: userId }),
      User.findByIdAndDelete(userId)
    ]);

    // Best-effort: remove avatar from Cloudinary
    try {
      if (user.avatar) {
        // Attempt to derive public_id: if full URL, strip version and extension
        const url = user.avatar;
        const m = /upload\/v\d+\/([^\.]+)\./.exec(url) || /upload\/([^\.]+)\./.exec(url);
        const publicId = m ? m[1] : null;
        if (publicId) await cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: 'image' });
      }
    } catch (_) { /* ignore avatar cleanup failure */ }

    const deleted = {
      documents: docsRes.status === 'fulfilled' ? (docsRes.value?.deletedCount || 0) : 0,
      chats: chatsRes.status === 'fulfilled' ? (chatsRes.value?.deletedCount || 0) : 0,
      contactReports: contactsRes.status === 'fulfilled' ? (contactsRes.value?.deletedCount || 0) : 0,
      users: userRes.status === 'fulfilled' ? (userRes.value ? 1 : 0) : 0
    };

    res.json({ message: "User and associated data deleted successfully", deleted });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ message: "Failed to delete user" });
  }
});

// Delete document (admin only)
router.delete("/documents/:id", verifyToken, isAdmin, async (req, res) => {
  try {
    const documentId = req.params.id;
    
    // Delete associated chats
    await Chat.deleteMany({ document: documentId });
    
    // Delete document
    await Document.findByIdAndDelete(documentId);
    
    res.json({ message: "Document and associated chats deleted successfully" });
  } catch (error) {
    console.error("Delete document error:", error);
    res.status(500).json({ message: "Failed to delete document" });
  }
});

// Toggle user status (activate/deactivate)
router.patch("/users/:id/toggle-status", verifyToken, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Don't allow admin to deactivate themselves
    if (userId === req.userId) {
      return res.status(400).json({ message: "Cannot modify your own account status" });
    }
    
    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    user.isActive = !user.isActive;
    await user.save();
    
    res.json({ 
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      user
    });
  } catch (error) {
    console.error("Toggle user status error:", error);
    res.status(500).json({ message: "Failed to update user status" });
  }
});

// System logs (mock implementation)
router.get("/logs", verifyToken, isAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const level = req.query.level || "";
    
    // In a real application, you would fetch from actual log files or logging service
    // For now, we'll generate mock logs based on recent database activity
    
    const recentDocs = await Document.find()
      .populate("user", "username")
      .sort({ uploadedAt: -1 })
      .limit(100);
    
    const logs = recentDocs.map((doc, index) => ({
      id: `log_${doc._id}_${index}`,
      timestamp: doc.uploadedAt,
      level: Math.random() > 0.9 ? "error" : Math.random() > 0.7 ? "warning" : "info",
      message: `Document "${doc.name}" processed for user ${doc.user?.username || "unknown"}`,
      source: "document_service",
      details: {
        documentId: doc._id,
        userId: doc.user?._id,
        fileType: doc.type,
        fileSize: doc.size
      }
    }));
    
    // Filter by level if specified
    const filteredLogs = level ? logs.filter(log => log.level === level) : logs;
    
    // Paginate
    const startIndex = (page - 1) * limit;
    const paginatedLogs = filteredLogs.slice(startIndex, startIndex + limit);
    
    res.json({
      logs: paginatedLogs,
      pagination: {
        page,
        limit,
        total: filteredLogs.length,
        pages: Math.ceil(filteredLogs.length / limit)
      }
    });
  } catch (error) {
    console.error("Get logs error:", error);
    res.status(500).json({ message: "Failed to fetch logs" });
  }
});

module.exports = router;

// Below: Contact reports management (admin only)
router.get("/contact-reports", verifyToken, isAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    const status = req.query.status;
    const search = (req.query.search || "").trim();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

    const query = {};
    if (status && ["open", "in_progress", "resolved"].includes(status)) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
        { message: { $regex: search, $options: "i" } }
      ];
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) {
        // include whole end day
        const e = new Date(endDate);
        e.setHours(23,59,59,999);
        query.createdAt.$lte = e;
      }
    }
    const total = await ContactReport.countDocuments(query);
    const items = await ContactReport.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("user", "name email");

    res.json({
      items,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    console.error("List contact-reports error:", err);
    res.status(500).json({ message: "Failed to load contact reports" });
  }
});

router.patch("/contact-reports/:id", verifyToken, isAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status || !["open", "in_progress", "resolved"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const updated = await ContactReport.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Contact report not found" });
    res.json({ item: updated });
  } catch (err) {
    console.error("Update contact-report error:", err);
    res.status(500).json({ message: "Failed to update contact report" });
  }
});

// Delete a contact report
router.delete("/contact-reports/:id", verifyToken, isAdmin, async (req, res) => {
  try {
    const result = await ContactReport.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ message: "Contact report not found" });
    res.json({ message: "Contact report deleted" });
  } catch (err) {
    console.error("Delete contact-report error:", err);
    res.status(500).json({ message: "Failed to delete contact report" });
  }
});

// Reports analytics (summary cards)
router.get("/contact-reports/analytics/summary", verifyToken, isAdmin, async (req, res) => {
  try {
    const total = await ContactReport.countDocuments();
    const resolved = await ContactReport.countDocuments({ status: "resolved" });
    const newCount = await ContactReport.countDocuments({ status: "open" });
    // Unread concept: treat 'open' as new/unread; could be refined if you add a 'read' flag
    const unread = newCount;

    // Category via heuristic classification
    const catAgg = await ContactReport.aggregate([
      {
        $project: {
          text: { $concat: [ { $ifNull: ["$subject", ""] }, " ", { $ifNull: ["$message", ""] } ] }
        }
      },
      {
        $project: {
          category: {
            $switch: {
              branches: [
                { case: { $regexMatch: { input: "$text", regex: /bug|error|issue|fail|crash/i } }, then: "bug" },
                { case: { $regexMatch: { input: "$text", regex: /feature|request|enhancement|improvement/i } }, then: "feature" },
                { case: { $regexMatch: { input: "$text", regex: /feedback|suggestion|opinion|comment/i } }, then: "feedback" }
              ],
              default: "other"
            }
          }
        }
      },
      { $group: { _id: "$category", count: { $sum: 1 } } }
    ]);
    const byCategory = { feedback: 0, bug: 0, feature: 0, other: 0 };
    catAgg.forEach(r => { if (byCategory[r._id] !== undefined) byCategory[r._id] = r.count; });

    res.json({ total, resolved, new: newCount, unread, byCategory });
  } catch (err) {
    console.error("Reports summary error:", err);
    res.status(500).json({ message: "Failed to load summary" });
  }
});

// Reports analytics: time series (day granularity by default)
router.get("/contact-reports/analytics/timeseries", verifyToken, isAdmin, async (req, res) => {
  try {
    const granularity = (req.query.granularity || "day").toLowerCase(); // day|week|month
    const dateFormat = granularity === 'month' ? "%Y-%m" : granularity === 'week' ? "%G-%V" : "%Y-%m-%d";
    const start = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 6*24*3600*1000);
    const end = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const e = new Date(end); e.setHours(23,59,59,999);

    const series = await ContactReport.aggregate([
      { $match: { createdAt: { $gte: start, $lte: e } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    res.json({ series });
  } catch (err) {
    console.error("Reports timeseries error:", err);
    res.status(500).json({ message: "Failed to load time series" });
  }
});