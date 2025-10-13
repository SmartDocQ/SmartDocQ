import React, { useState, useRef } from "react";
import "./Account.css";
import ppic from "./p-pic.png";
import { useToast } from "./ToastContext";
import { apiUrl } from "../config";

function Account({ user, onClose, onUpdated }) {
  const { showToast } = useToast();
  const [avatarPreview, setAvatarPreview] = useState(user.avatar || ppic);
  const [avatarFile, setAvatarFile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({ name: user.name, email: user.email });
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [activeTab, setActiveTab] = useState("account");
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const passwordRef = useRef();
  const confirmPasswordRef = useRef();

  const compressImage = (file, { maxSize = 512, quality = 0.8, mime = 'image/jpeg' } = {}) => {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;
          const scale = Math.min(1, maxSize / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('Failed to compress image'));
            const ext = mime.endsWith('png') ? 'png' : mime.endsWith('webp') ? 'webp' : 'jpg';
            const out = new File([blob], `avatar.${ext}`, { type: blob.type || mime, lastModified: Date.now() });
            resolve(out);
          }, mime, quality);
        };
        img.onerror = () => reject(new Error('Invalid image'));
        const url = URL.createObjectURL(file);
        img.src = url;
      } catch (e) {
        reject(e);
      }
    });
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Enforce <1MB limit for profile pictures
    const MAX_BYTES = 1024 * 1024; // 1MB
    if (file.size >= MAX_BYTES) {
      showToast("Image must be smaller than 1MB", { type: "error" });
      // Reset input so the same file change can be re-triggered if user resizes
      e.target.value = "";
      return;
    }
    try {
      // Only preview and store the file; actual upload happens on Save
      const newUrl = URL.createObjectURL(file);
      setAvatarPreview((prev) => {
        // Revoke previous object URL if it was one we created
        if (prev && prev.startsWith("blob:")) {
          try { URL.revokeObjectURL(prev); } catch (_) {}
        }
        return newUrl;
      });
      setAvatarFile(file);
    } catch (err) {
      showToast(err.message || "Failed to prepare avatar", { type: "error" });
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === "name") {
      let formatted = value.charAt(0).toUpperCase() + value.slice(1);
      if (formatted.length > 15) formatted = formatted.slice(0, 15);
      setFormData((prev) => ({ ...prev, [name]: formatted }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const renderPasswordInput = (label, ref, showState, setShowState) => (
    <div className="edit-field">
      <label>{label}</label>
      <div className="password-field">
        <input
          type={showState ? "text" : "password"}
          ref={ref}
          className="edit-input"
          placeholder={label}
        />
        <button
          type="button"
          className="toggle-visibility"
          aria-label={showState ? "Hide password" : "Show password"}
          onClick={() => setShowState((v) => !v)}
        >
          {showState ? "🙈" : "👁️"}
        </button>
      </div>
    </div>
  );

  const handleSave = async () => {
    setIsSaving(true);
    const newPassword = passwordRef.current?.value;
    const confirmPassword = confirmPasswordRef.current?.value;

    if (formData.name.length < 3) {
      showToast("Name must be at least 3 characters", { type: "error" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      showToast("Invalid email format", { type: "error" });
      return;
    }

    if (newPassword && newPassword !== confirmPassword) {
      showToast("Passwords do not match", { type: "error" });
      return;
    }

    const token = localStorage.getItem("token") || user.token;
    if (!token) return showToast("Session not found. Please log in again.", { type: "error" });

    const payload = {};
    if (formData.name && formData.name !== user.name) payload.name = formData.name;
    if (formData.email && formData.email !== user.email) payload.email = formData.email;
    if (newPassword) payload.password = newPassword;

    if (Object.keys(payload).length === 0 && !avatarFile) {
      showToast("No changes to save", { type: "info" });
      setIsEditing(false);
      return;
    }

    try {
      let updatedUser = { ...user };

      // Build tasks to run in parallel
      const putTask = (Object.keys(payload).length > 0)
        ? (async () => {
            const res = await fetch(apiUrl("/api/auth/me"), {
              method: "PUT",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Failed to update profile");
            return data.user;
          })()
        : null;

      const avatarTask = avatarFile
        ? (async () => {
            let uploadFile = avatarFile;
            // Compress to speed up upload
            try {
              uploadFile = await compressImage(avatarFile, { maxSize: 512, quality: 0.82, mime: 'image/jpeg' });
            } catch (_) { /* fallback to original file */ }
            const form = new FormData();
            form.append("avatar", uploadFile, uploadFile.name || 'avatar.jpg');
            const resAvatar = await fetch(apiUrl("/api/auth/me/avatar"), {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              body: form,
            });
            const dataAvatar = await resAvatar.json();
            if (!resAvatar.ok) throw new Error(dataAvatar?.message || "Failed to upload avatar");
            return { avatar: dataAvatar.avatar };
          })()
        : null;

      const results = await Promise.all([putTask, avatarTask].filter(Boolean));
      results.forEach((r) => { if (r) updatedUser = { ...updatedUser, ...r }; });

      // Persist and reset edit state
      localStorage.setItem("user", JSON.stringify(updatedUser));
      onUpdated && onUpdated(updatedUser);
      showToast("Profile updated successfully", { type: "success" });
      setIsEditing(false);

      // Cleanup password fields and pending avatar file
      if (passwordRef.current) passwordRef.current.value = "";
      if (confirmPasswordRef.current) confirmPasswordRef.current.value = "";
      setAvatarFile(null);
      // Update preview to the final saved avatar URL and revoke any previous blob
      setAvatarPreview((prev) => {
        if (prev && prev.startsWith("blob:")) {
          try { URL.revokeObjectURL(prev); } catch (_) {}
        }
        return updatedUser.avatar || ppic;
      });
    } catch (err) {
      showToast(err.message, { type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const joinedDate = new Date(user.createdAt).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const lastLogin = user.lastLogin
    ? new Date(user.lastLogin).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";

  return (
    <>
      <div className="account-overlay" onClick={onClose}>
        <div className="account-container" onClick={(e) => e.stopPropagation()}>
          <div className="sidebar-account-container">
            <div className="sidebar">
              <div className="sidebar-profile">
                <div className="avatar-wrapper">
                  <img src={avatarPreview || user.avatar || ppic} alt="User Avatar" className="account-avatar" />
                  {isEditing && (
                    <label className="avatar-edit-btn">
                      ✎
                      <input type="file" accept="image/*" onChange={handleAvatarChange} />
                    </label>
                  )}
                </div>
                <h2 className="account-name">{user.name}</h2>
              </div>

              <div className="sidebar-menu">
                <button
                  className={`menu-btn ${activeTab === "account" ? "active" : ""}`}
                  onClick={() => setActiveTab("account")}
                >
                  Account
                </button>
                <button
                  className={`menu-btn ${activeTab === "settings" ? "active" : ""}`}
                  onClick={() => setActiveTab("settings")}
                >
                  Settings
                </button>
              </div>
            </div>

            <div className="account-content">
              {activeTab === "account" && (
                <>
                  <div className="account-header">
                    <div className="account-header-info">
                      {isEditing ? (
                        <>
                          <div className="edit-fields-row">
                            <div className="edit-field">
                              <label htmlFor="acc-name">Name</label>
                              <input
                                id="acc-name"
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                className="edit-input"
                                placeholder="Username"
                              />
                            </div>
                            <div className="edit-field">
                              <label htmlFor="acc-email">Email</label>
                              <input
                                id="acc-email"
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                className="edit-input"
                                placeholder="Email"
                              />
                            </div>
                          </div>

                          <div className="edit-fields-row">
                            {renderPasswordInput(
                              "New Password",
                              passwordRef,
                              showNewPassword,
                              setShowNewPassword
                            )}
                            {renderPasswordInput(
                              "Confirm Password",
                              confirmPasswordRef,
                              showConfirmPassword,
                              setShowConfirmPassword
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <h2 className="account-name">{user.name}</h2>
                          <p className="account-email">{user.email}</p>
                        </>
                      )}
                    </div>
                  </div>

                  {!isEditing && (
                    <div className="account-details">
                      <div className="detail-row">
                        <span className="detail-label">Joined:</span>
                        <span className="detail-value">{joinedDate}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Last Login:</span>
                        <span className="detail-value">{lastLogin}</span>
                      </div>
                    </div>
                  )}

                  <div className="account-actions">
                    {isEditing ? (
                      <>
                        <button className="account-btn primary" onClick={handleSave} disabled={isSaving}>
                          {isSaving ? "Saving..." : "Save Changes"}
                        </button>
                        <button
                          className="account-btn secondary"
                          onClick={() => {
                            setFormData({ name: user.name, email: user.email });
                            setShowNewPassword(false);
                            setShowConfirmPassword(false);
                            setIsEditing(false);
                            if (passwordRef.current) passwordRef.current.value = "";
                            if (confirmPasswordRef.current) confirmPasswordRef.current.value = "";
                            // Reset avatar preview to current saved avatar and clear pending file
                            setAvatarPreview(user.avatar || ppic);
                            setAvatarFile(null);
                          }}
                          disabled={isSaving}
                        >
                          {isSaving ? "Please wait" : "Cancel"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="account-btn primary"
                          onClick={() => {
                            setFormData({ name: user.name, email: user.email });
                            setIsEditing(true);
                          }}
                        >
                          Edit Profile
                        </button>
                        <button className="account-btn secondary" onClick={onClose}>
                          Close
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              {activeTab === "settings" && (
                <div className="settings-content">
                  <div className="settings-options">
                    <div className="settings-card warning">
                      <h3>Clear Chat History</h3>
                      <p>Delete all your saved conversations across all documents. This action cannot be undone.</p>
                      <button
                        className="settings-btn danger"
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem("token") || user.token;
                            if (!token) {
                              showToast("Please login again.", { type: "error" });
                              return;
                            }
                            const res = await fetch(apiUrl("/api/chat"), {
                              method: "DELETE",
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data.message || "Failed to clear chat history");
                            showToast("Chat history cleared!", { type: "success" });
                            // Refresh to ensure all views reflect the cleared chats
                            setTimeout(() => { window.location.reload(); }, 600);
                          } catch (err) {
                            showToast(err.message || "Failed to clear chat history", { type: "error" });
                          }
                        }}
                      >
                        Clear History
                      </button>
                    </div>

                    <div className="settings-card">
                      <h3>Logout from All Devices</h3>
                      <p>Secure your account by signing out everywhere you’re logged in.</p>
                      <button
                        className="settings-btn"
                        onClick={() => showToast("Logged out from all devices!", { type: "info" })}
                      >
                        Logout All
                      </button>
                    </div>

                    <div className="settings-card danger-zone">
                      <h3>Delete Account</h3>
                      <p>Once you delete your account, all your data will be permanently removed.</p>
                      <button
                        className="settings-btn danger"
                        onClick={() => {
                          showToast("⚠️ Careful! Deletion is permanent.", { type: "warning" });
                          setShowDeleteModal(true);
                        }}
                      >
                        Delete Account
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm Account Deletion</h3>
            <p>
              Are you sure you want to permanently delete your account? <br />
              This action <strong>cannot</strong> be undone.
            </p>
            <div className="modal-actions">
              <button
                className="modal-btn danger"
                onClick={async () => {
                  try {
                    const token = localStorage.getItem("token") || user.token;
                    const res = await fetch(apiUrl("/api/auth/me"), {
                      method: "DELETE",
                      headers: { Authorization: `Bearer ${token}` },
                    });

                    const data = await res.json();
                    if (!res.ok) throw new Error(data.message || "Failed to delete account");

                    localStorage.removeItem("user");
                    localStorage.removeItem("token");
                    showToast("Account deleted permanently!", { type: "success" });

                    setShowDeleteModal(false);
                    onClose();
                    window.location.reload();
                  } catch (err) {
                    showToast(err.message, { type: "error" });
                  }
                }}
              >
                Yes, Delete
              </button>
              <button className="modal-btn secondary" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Account;
