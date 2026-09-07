import React, { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { resetPassword } from "../../Services/AuthService";
import { useToast } from "../Toast/ToastContext";
import PasswordStrength from "./PasswordStrength";
import "./Login.css";

const INITIAL_STRENGTH = { score: 0, label: "", requirements: {} };

const calculatePasswordStrength = (password) => {
  if (!password) return INITIAL_STRENGTH;

  const requirements = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };

  const score =
    (requirements.length ? 25 : 0) +
    (requirements.uppercase ? 20 : 0) +
    (requirements.lowercase ? 15 : 0) +
    (requirements.number ? 20 : 0) +
    (requirements.special ? 20 : 0);

  const label = score < 40 ? "Weak" : score < 70 ? "Medium" : "Strong";
  return { score, label, requirements };
};

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState(INITIAL_STRENGTH);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nextPwd = password;
    const nextConfirm = confirmPassword;

    if (!nextPwd || !nextConfirm) {
      showToast("Please fill in both password fields", { type: "error" });
      return;
    }

    if (nextPwd !== nextConfirm) {
      showToast("Passwords do not match", { type: "error" });
      return;
    }

    setLoading(true);

    try {
      const { ok, data } = await resetPassword(token, nextPwd);

      if (ok) {
        showToast(data.message || "Password reset successful", { type: "success" });
        setTimeout(() => navigate("/"), 1500);
      } else {
        showToast(data.message || "Failed to reset password", { type: "error" });
      }
    } catch {
      showToast("Reset failed", { type: "error" });
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="reset-page">
        <div className="leg-glow-bg" aria-hidden="true" />
        <div className="reset-card">
          <h2 className="form-title">Invalid reset link</h2>
          <p className="form-subtitle">
            This password reset link is missing or invalid.
          </p>
          <div style={{ marginTop: "20px", display: "flex", gap: "12px", justifyContent: "center" }}>
            <Link to="/" style={{ color: "#00f2fe", textDecoration: "none" }}>Go to Home</Link>
            <span style={{ opacity: 0.5 }}>|</span>
            <Link to="/help" style={{ color: "#00f2fe", textDecoration: "none" }}>Help Center</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-page">
      <div className="leg-glow-bg" aria-hidden="true" />
      <div className="reset-card">
        <h2 className="form-title">Reset password</h2>
        <p className="form-subtitle">Choose a new password for your account</p>

        <form onSubmit={handleSubmit} className="reset-form">
          <div className="input-group">
            <label htmlFor="reset-password-input">New password</label>
            <div className="password-input-wrapper">
              <input
                id="reset-password-input"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  const next = e.target.value;
                  setPassword(next);
                  setPasswordStrength(calculatePasswordStrength(next));
                }}
                disabled={loading}
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                disabled={loading}
                aria-label="Toggle password visibility"
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          <PasswordStrength password={password} strength={passwordStrength} />

          <div className="input-group" style={{ marginTop: "12px" }}>
            <label htmlFor="reset-password-confirm">Confirm password</label>
            <div className="password-input-wrapper">
              <input
                id="reset-password-confirm"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                disabled={loading}
                aria-label="Toggle confirm password visibility"
              >
                {showConfirmPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          <div className="auth-submit-wrapper" style={{ marginTop: "20px" }}>
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? "Updating..." : "Reset password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
