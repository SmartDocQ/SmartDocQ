 import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./Login.css";
import { useToast } from "./ToastContext";
import { apiUrl } from "../config";

function Login({ onAuthSuccess = () => {} }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [signupData, setSignupData] = useState({ email: "", username: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const firstErrorRef = useRef(null);

  // Universal input handler
  const handleChange = (e, type) => {
    const { name, value } = e.target;
    const setter = type === "login" ? setLoginData : setSignupData;
    setter(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: "" }));
  };

  // Focus on first error
  useEffect(() => {
    if (firstErrorRef.current) {
      firstErrorRef.current.focus();
      firstErrorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [errors]);

  // Validation schemas
  const validateForm = (type) => {
    const newErrors = {};
    const data = type === "login" ? loginData : signupData;

    if (!data.email.trim()) newErrors.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(data.email)) newErrors.email = "Invalid email";

    if (!data.password.trim()) newErrors.password = "Password is required";
    else if (data.password.length < 6 || data.password.length > 30) newErrors.password = "Password must be 6–30 characters long";
    else if (/\s/.test(data.password)) newErrors.password = "Password cannot contain spaces";

    if (type === "signup") {
      if (!data.username.trim()) newErrors.username = "Username is required";
      else if (!/^[a-zA-Z0-9 _\-@#$]{3,15}$/.test(data.username))
        newErrors.username = "Username must be 3–15 characters; letters, numbers, spaces, _, -, @, #, $ allowed";

      if (!data.confirmPassword.trim()) newErrors.confirmPassword = "Please confirm your password";
      else if (data.password !== data.confirmPassword) newErrors.confirmPassword = "Passwords do not match";
    }

    return newErrors;
  };

  // Submit handlers
  const handleSubmit = async (e, type) => {
    e.preventDefault();
    const newErrors = validateForm(type);

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const payload = type === "login"
      ? loginData
      : { name: signupData.username, email: signupData.email, password: signupData.password };

    const url = type === "login"
      ? apiUrl("/api/auth/login")
      : apiUrl("/api/auth/signup");

    setLoading(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await res.json();

  if (res.ok) {
        if (type === "login") {
          const { token, user } = result;
          if (token) localStorage.setItem("token", token);
          if (user) localStorage.setItem("user", JSON.stringify(user));
          
          // Check if user is admin and redirect accordingly
          if (user && user.isAdmin) {
            showToast("Welcome Admin! Redirecting to admin panel...", { type: "success" });
            setLoginData({ email: "", password: "" });
            // Use setTimeout to allow toast to show before redirect
            setTimeout(() => {
              navigate("/admin");
            }, 1000);
          } else {
            showToast("Login successful", { type: "success" });
            onAuthSuccess(user || {});
            setLoginData({ email: "", password: "" });
          }
        } else {
          showToast("Signup successful! Please login.", { type: "success" });
          setSignupData({ email: "", username: "", password: "", confirmPassword: "" });
          setIsLogin(true);
        }
      } else {
        if (type === "login" && res.status === 403) {
          // Specific toast for deactivated accounts
          showToast("Your account is deactivated. Please contact support.", { type: "error" });
        } else {
          showToast(result.message || (type === "login" ? "Login failed" : "Signup failed"), { type: "error" });
        }
      }
    } catch (err) {
      console.error(`${type} error:`, err);
      showToast("Server error", { type: "error" });
    } finally {
      setTimeout(() => setLoading(false), 150);
    }
  }; 

  // Get ref for first error dynamically
  const getRef = (field) => errors[field] ? firstErrorRef : null;

  return (
    <div className="auth-container">
      <div className="form-toggle">
        <button className={`toggle-btn ${isLogin ? "active" : ""}`} onClick={() => setIsLogin(true)}>Sign In</button>
        <button className={`toggle-btn ${!isLogin ? "active" : ""}`} onClick={() => setIsLogin(false)}>Sign Up</button>
        <div className={`toggle-slider ${isLogin ? "login" : "signup"}`}></div>
      </div>

      {/* Login Form */}
      <div className={`form-wrapper ${isLogin ? "active" : ""}`}>
        <div className="form-content">
          <h2 className="form-title">Welcome Back</h2>
          <p className="form-subtitle">Sign in to your account</p>
          <form onSubmit={(e) => handleSubmit(e, "login")}>
            <div className="input-group">
              <label>Email</label>
              <input ref={getRef("email")} type="email" name="email" placeholder="Enter your email" value={loginData.email} onChange={(e) => handleChange(e, "login")} className={errors.email ? "input-error" : ""} />
              {errors.email && <span className="error-message">{errors.email}</span>}
            </div>
            <div className="input-group">
              <label>Password</label>
              <input ref={getRef("password")} type="password" name="password" placeholder="Enter your password" value={loginData.password} onChange={(e) => handleChange(e, "login")} className={errors.password ? "input-error" : ""} />
              {errors.password && <span className="error-message">{errors.password}</span>}
            </div><br/>
            <button type="submit" className="submit-btn" disabled={loading}>{loading ? "Processing..." : "Sign In"}</button>
          </form>
        </div>
      </div>

      {/* Signup Form */}
      <div className={`form-wrapper ${!isLogin ? "active" : ""}`}>
        <div className="form-content">
          <h2 className="form-title">Create Account</h2>
          <p className="form-subtitle">Join us today</p>
          <form onSubmit={(e) => handleSubmit(e, "signup")}>
            <div className="input-group">
              <label>Username</label>
              <input ref={getRef("username")} type="text" name="username" placeholder="Choose a username" value={signupData.username} onChange={(e) => handleChange(e, "signup")} className={errors.username ? "input-error" : ""} />
              {errors.username && <span className="error-message">{errors.username}</span>}
            </div>
            <div className="input-group">
              <label>Email</label>
              <input ref={getRef("email")} type="email" name="email" placeholder="Enter your email" value={signupData.email} onChange={(e) => handleChange(e, "signup")} className={errors.email ? "input-error" : ""} />
              {errors.email && <span className="error-message">{errors.email}</span>}
            </div>
            <div className="input-group">
              <label>Password</label>
              <input ref={getRef("password")} type="password" name="password" placeholder="Create a password" value={signupData.password} onChange={(e) => handleChange(e, "signup")} className={errors.password ? "input-error" : ""} />
              {errors.password && <span className="error-message">{errors.password}</span>}
            </div>
            <div className="input-group">
              <label>Confirm Password</label>
              <input ref={getRef("confirmPassword")} type="password" name="confirmPassword" placeholder="Confirm your password" value={signupData.confirmPassword} onChange={(e) => handleChange(e, "signup")} className={errors.confirmPassword ? "input-error" : ""} />
              {errors.confirmPassword && <span className="error-message">{errors.confirmPassword}</span>}
            </div><br/>
            <button type="submit" className="submit-btn" disabled={loading}>{loading ? "Processing..." : "Create Account"}</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Login;
