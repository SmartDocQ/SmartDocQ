import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./Account.css";
import userIcon from "./assets/user.svg";
import { useToast } from "../../Toast/ToastContext";
import AccountProfileTab from "./AccountProfileTab";
import AccountSettingsTab from "./AccountSettingsTab";
import DeleteAccountModal from "./DeleteAccountModal";
import {
  updateProfile,
  uploadAvatar,
  clearChatHistory,
  deleteAccount,
  logoutAllDevices,
} from "../../../Services/AccountService";
import {
  compressImage,
  formatJoinedDate,
  formatLastLogin,
  formatName,
  isValidEmail,
  MAX_AVATAR_BYTES,
} from "./accountUtils";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function Account({ user, onClose, onUpdated, onHistoryCleared }) {
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [avatarPreview, setAvatarPreview] = useState(user.avatar || userIcon);
  const [avatarFile, setAvatarFile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: user.name,
    email: user.email,
  });
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [activeTab, setActiveTab] = useState("account");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const passwordRef = useRef();
  const confirmPasswordRef = useRef();
  const avatarInputRef = useRef();
  const containerRef = useRef();
  const triggerRef = useRef(null);

  const revokeIfBlob = (url) => {
    if (url && typeof url === "string" && url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    return () => {
      revokeIfBlob(avatarPreview);
    };
  }, [avatarPreview]);

  useEffect(() => {
    setFormData({
      name: user.name,
      email: user.email,
    });

    setAvatarPreview((prev) => {
      revokeIfBlob(prev);
      return user.avatar || userIcon;
    });
  }, [user]);

  useEffect(() => {
    // Save trigger element
    triggerRef.current = document.activeElement;

    // Focus first focusable item
    const focusable = containerRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [];
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (showDeleteModal) {
          setShowDeleteModal(false);
        } else {
          onClose?.();
        }
        return;
      }

      if (e.key === "Tab") {
        const list = containerRef.current ? Array.from(containerRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) : [];
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (triggerRef.current && document.body.contains(triggerRef.current)) {
        triggerRef.current.focus();
      }
    };
  }, [onClose, showDeleteModal]);

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size >= MAX_AVATAR_BYTES) {
      showToast("Image must be smaller than 1MB", { type: "error" });
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      return;
    }

    try {
      const newUrl = URL.createObjectURL(file);

      setAvatarPreview((prev) => {
        revokeIfBlob(prev);
        return newUrl;
      });

      setAvatarFile(file);
    } catch (err) {
      console.warn("Avatar preview failed", err);
      showToast(err?.message || "Failed to prepare avatar", { type: "error" });
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === "name") {
      setFormData((prev) => ({ ...prev, [name]: formatName(value) }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const resetEditState = () => {
    setFormData({ name: user.name, email: user.email });
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setIsEditing(false);

    if (passwordRef.current) passwordRef.current.value = "";
    if (confirmPasswordRef.current) confirmPasswordRef.current.value = "";

    revokeIfBlob(avatarPreview);
    setAvatarPreview(user.avatar || userIcon);
    setAvatarFile(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const handleSave = async () => {
    const newPassword = passwordRef.current?.value;
    const confirmPassword = confirmPasswordRef.current?.value;

    if (formData.name.length < 3) {
      showToast("Name must be at least 3 characters", { type: "error" });
      return;
    }

    if (!isValidEmail(formData.email)) {
      showToast("Invalid email format", { type: "error" });
      return;
    }

    if (newPassword && newPassword !== confirmPassword) {
      showToast("Passwords do not match", { type: "error" });
      return;
    }

    const payload = {};
    if (formData.name && formData.name !== user.name) payload.name = formData.name;
    if (formData.email && formData.email !== user.email) payload.email = formData.email;
    if (newPassword) payload.password = newPassword;

    if (Object.keys(payload).length === 0 && !avatarFile) {
      showToast("No changes to save", { type: "info" });
      setIsEditing(false);
      return;
    }

    setIsSaving(true);

    try {
      let updatedUser = { ...user };

      const putTask =
        Object.keys(payload).length > 0 ? updateProfile(payload) : null;

      const avatarTask = avatarFile
        ? (async () => {
            let uploadFile = avatarFile;
            try {
              uploadFile = await compressImage(avatarFile, {
                maxSize: 512,
                quality: 0.82,
                mime: "image/jpeg",
              });
            } catch (err) {
              console.warn("Avatar compression failed, using original image", err);
            }
            return uploadAvatar(uploadFile);
          })()
        : null;

      const results = await Promise.all([putTask, avatarTask].filter(Boolean));
      results.forEach((r) => {
        if (r) updatedUser = { ...updatedUser, ...r };
      });

      localStorage.setItem("user", JSON.stringify(updatedUser));
      onUpdated?.(updatedUser);

      showToast("Profile updated successfully", { type: "success" });
      setIsEditing(false);

      if (passwordRef.current) passwordRef.current.value = "";
      if (confirmPasswordRef.current) confirmPasswordRef.current.value = "";
      setAvatarFile(null);

      setAvatarPreview((prev) => {
        revokeIfBlob(prev);
        return updatedUser.avatar || userIcon;
      });
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    } catch (err) {
      showToast(err?.message || "Failed to update profile", { type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearHistory = async () => {
    setIsClearingHistory(true);
    try {
      await clearChatHistory();
      showToast("Chat history cleared!", { type: "success" });
      onHistoryCleared?.();
      onClose?.();
    } catch (err) {
      showToast(err?.message || "Failed to clear chat history", { type: "error" });
    } finally {
      setIsClearingHistory(false);
    }
  };

  const handleLogoutAll = async () => {
    try {
      await logoutAllDevices();
      showToast("Logged out from all devices!", { type: "success" });
      localStorage.removeItem("user");
      window.dispatchEvent(new Event("userChanged"));
      onClose?.();
      navigate("/");
    } catch (err) {
      showToast(err?.message || "Failed to log out from all devices", { type: "error" });
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await deleteAccount();
      localStorage.removeItem("user");
      showToast("Account deleted permanently!", { type: "success" });

      setShowDeleteModal(false);
      onClose?.();
      navigate("/");
    } catch (err) {
      showToast(err?.message || "Failed to delete account", { type: "error" });
    } finally {
      setIsDeleting(false);
    }
  };

  const joinedDate = formatJoinedDate(user.createdAt);
  const lastLogin = formatLastLogin(user.lastLogin);

  const effectiveAvatar = avatarPreview || user.avatar || userIcon;
  const isDefaultAvatarIcon = !user.avatar && (avatarPreview === userIcon || (!avatarPreview && !user.avatar));

  return (
    <>
      <div className="account-overlay" onClick={onClose} role="presentation">
        <div
          ref={containerRef}
          className="account-container"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Account Settings"
        >
          <div className="sidebar-account-container">
            <div className="sidebar">
              <div className="sidebar-profile">
                <div className="avatar-wrapper">
                  <img
                    src={effectiveAvatar}
                    alt={`${user.name}'s Avatar`}
                    width="85"
                    height="85"
                    className={`account-avatar${isDefaultAvatarIcon ? " account-avatar--icon" : ""}`}
                    referrerPolicy="no-referrer"
                  />
                  {isEditing && (
                    <label className="avatar-edit-btn" htmlFor="avatar-upload" aria-label="Edit avatar">
                      ✎
                      <input
                        id="avatar-upload"
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarChange}
                        disabled={isSaving}
                      />
                    </label>
                  )}
                </div>
                <h2 className="account-name">{user.name}</h2>
              </div>

              <div className="sidebar-menu" role="tablist" aria-label="Account navigation tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "account"}
                  id="tab-account"
                  aria-controls="panel-account"
                  className={`menu-btn ${activeTab === "account" ? "active" : ""}`}
                  onClick={() => setActiveTab("account")}
                  disabled={isSaving}
                >
                  Account
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "settings"}
                  id="tab-settings"
                  aria-controls="panel-settings"
                  className={`menu-btn ${activeTab === "settings" ? "active" : ""}`}
                  onClick={() => setActiveTab("settings")}
                  disabled={isSaving}
                >
                  Settings
                </button>
              </div>
            </div>

            <div className="account-content">
              {activeTab === "account" ? (
                <div id="panel-account" role="tabpanel" aria-labelledby="tab-account">
                  <AccountProfileTab
                    user={user}
                    isEditing={isEditing}
                    isSaving={isSaving}
                    formData={formData}
                    handleChange={handleChange}
                    handleSave={handleSave}
                    onCancel={resetEditState}
                    onEdit={() => {
                      setFormData({ name: user.name, email: user.email });
                      setIsEditing(true);
                    }}
                    onClose={onClose}
                    joinedDate={joinedDate}
                    lastLogin={lastLogin}
                    passwordRef={passwordRef}
                    confirmPasswordRef={confirmPasswordRef}
                    showNewPassword={showNewPassword}
                    setShowNewPassword={setShowNewPassword}
                    showConfirmPassword={showConfirmPassword}
                    setShowConfirmPassword={setShowConfirmPassword}
                  />
                </div>
              ) : (
                <div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
                  <AccountSettingsTab
                    onClearHistory={handleClearHistory}
                    onLogoutAll={handleLogoutAll}
                    onDeleteClick={() => {
                      showToast("⚠️ Careful! Deletion is permanent.", {
                        type: "warning",
                      });
                      setShowDeleteModal(true);
                    }}
                    isClearingHistory={isClearingHistory}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <DeleteAccountModal
        isOpen={showDeleteModal}
        isDeleting={isDeleting}
        onConfirm={handleDeleteAccount}
        onCancel={() => setShowDeleteModal(false)}
      />
    </>
  );
}

export default Account;