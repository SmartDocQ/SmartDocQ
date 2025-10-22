import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from './ToastContext';
import { apiUrl } from '../config';
import './ResetPassword.css';

function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [requirementsMet, setRequirementsMet] = useState({
    length: false,
    uppercase: false,
    lowercase: false,
    number: false
  });

  useEffect(() => {
    if (!token) {
      showToast('Invalid reset link', 'error');
      navigate('/');
    }
  }, [token, navigate, showToast]);

  const calculatePasswordStrength = (pass) => {
    const requirements = {
      length: pass.length >= 8,
      uppercase: /[A-Z]/.test(pass),
      lowercase: /[a-z]/.test(pass),
      number: /[0-9]/.test(pass)
    };

    setRequirementsMet(requirements);

    const metCount = Object.values(requirements).filter(Boolean).length;
    setPasswordStrength(metCount);
  };

  const handlePasswordChange = (e) => {
    const newPassword = e.target.value;
    setPassword(newPassword);
    calculatePasswordStrength(newPassword);
  };

  const getStrengthLabel = () => {
    switch (passwordStrength) {
      case 0:
      case 1:
        return 'Weak';
      case 2:
        return 'Fair';
      case 3:
        return 'Good';
      case 4:
        return 'Strong';
      default:
        return '';
    }
  };

  const getStrengthColor = () => {
    switch (passwordStrength) {
      case 0:
      case 1:
        return '#ff4444';
      case 2:
        return '#ffa500';
      case 3:
        return '#00bfff';
      case 4:
        return '#00ff00';
      default:
        return '#ddd';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (password.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    if (password !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(apiUrl(`/api/auth/reset-password/${token}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (response.ok) {
        showToast('Password reset successful!', 'success');
        setTimeout(() => {
          navigate('/');
        }, 2000);
      } else {
        showToast(data.message || 'Failed to reset password', 'error');
      }
    } catch (error) {
      console.error('Reset password error:', error);
      showToast('Network error. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="reset-password-container">
      <div className="reset-password-card">
        <div className="reset-header">
          <h2>Reset Password</h2>
          <p>Enter your new password below</p>
        </div>

        <form onSubmit={handleSubmit} className="reset-form">
          <div className="pass-group-container">
            <div className="input-group">
              <label htmlFor="password">New Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={handlePasswordChange}
                  placeholder="Enter new password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  className="emoji-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  className="emoji-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  disabled={loading}
                >
                  {showConfirmPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
          </div>

          {password && (
            <div className="password-strength-container">
              <div className="strength-bar-wrapper">
                <div
                  className="strength-bar"
                  style={{
                    width: `${(passwordStrength / 4) * 100}%`,
                    backgroundColor: getStrengthColor()
                  }}
                />
              </div>
              <p className="strength-label" style={{ color: getStrengthColor() }}>
                {getStrengthLabel()}
              </p>
              <div className="password-requirements">
                <div className={requirementsMet.length ? 'req-met' : 'req-unmet'}>
                  {requirementsMet.length ? '✓' : '○'} At least 8 characters
                </div>
                <div className={requirementsMet.uppercase ? 'req-met' : 'req-unmet'}>
                  {requirementsMet.uppercase ? '✓' : '○'} Uppercase letter
                </div>
                <div className={requirementsMet.lowercase ? 'req-met' : 'req-unmet'}>
                  {requirementsMet.lowercase ? '✓' : '○'} Lowercase letter
                </div>
                <div className={requirementsMet.number ? 'req-met' : 'req-unmet'}>
                  {requirementsMet.number ? '✓' : '○'} Number
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="reset-submit-btn"
            disabled={loading || !password || !confirmPassword}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>

        <button
          type="button"
          className="back-to-login"
          onClick={() => navigate('/')}
          disabled={loading}
        >
          Back to Login
        </button>
      </div>
    </div>
  );
}

export default ResetPassword;
