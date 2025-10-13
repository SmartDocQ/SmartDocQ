import React, { useEffect, useRef, useState } from "react";
import "./Contact.css";
import { useToast } from "./ToastContext";
import { apiUrl } from "../config";

const SUBJECT_OPTIONS = ["Bug", "Feedback", "Feature Request", "Other"];
const MAX_MESSAGE_LENGTH = 1000;

function Contact({ onSuccess, defaultName = "", defaultEmail = "" }) {
  const [formData, setFormData] = useState({
    name: defaultName || "",
    email: defaultEmail || "",
    subject: "",
    message: ""
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem("token"));
  const abortRef = useRef(null);

  // Keep name/email in sync if defaults change (e.g., after login)
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      name: defaultName || "",
      email: defaultEmail || "",
    }));
  }, [defaultName, defaultEmail]);

  // React to token changes across tabs/components
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "token") {
        setIsLoggedIn(!!e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ""
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!isLoggedIn) {
      if (!formData.name.trim()) newErrors.name = "Name is required";
      if (!formData.email.trim()) newErrors.email = "Email is required";
      else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = "Please enter a valid email";
    }
    if (!formData.subject.trim()) {
      newErrors.subject = "Subject is required";
    } else if (!SUBJECT_OPTIONS.includes(formData.subject)) {
      newErrors.subject = "Invalid subject selected";
    }
    if (!formData.message.trim()) {
      newErrors.message = "Message is required";
    } else if (formData.message.length < 10) {
      newErrors.message = "Message must be at least 10 characters";
    } else if (formData.message.length > MAX_MESSAGE_LENGTH) {
      newErrors.message = `Message must be at most ${MAX_MESSAGE_LENGTH} characters`;
    }
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return; // double-click guard
    const newErrors = validateForm();
    
    if (Object.keys(newErrors).length === 0) {
      setIsSubmitting(true);
      try {
        const token = localStorage.getItem("token");
        // Abort previous request if any
        if (abortRef.current) {
          try { abortRef.current.abort(); } catch (_) {}
        }
        const controller = new AbortController();
        abortRef.current = controller;
  const res = await fetch(apiUrl("/api/contact/submit"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            // backend uses auth user; send only subject/message
            subject: formData.subject.trim(),
            message: formData.message.trim(),
          }),
          signal: controller.signal
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) {}
        if (!res.ok) {
          const msg = data?.message || (res.status === 401 ? "Session expired. Please log in again." : "Failed to send message");
          throw new Error(msg);
        }

        showToast("Message sent. We'll get back to you soon.", { type: "success" });
        setFormData({ name: defaultName || "", email: defaultEmail || "", subject: "", message: "" });
        if (typeof onSuccess === "function") onSuccess();
      } catch (err) {
        if (err?.name === "AbortError") return;
        showToast(err.message || "Failed to send message", { type: "error" });
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setErrors(newErrors);
    }
  };

  return (
    <div className="contact-container">
      <div className="contact-header">
        <div className="contact-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <h2 className="contact-title">Get in Touch</h2>
        <p className="contact-subtitle">We'd love to hear from you. Send us a message!</p>
      </div>
      {!isLoggedIn && (
        <div className="info-item" style={{ marginBottom: 12 }}>
          <div className="info-content">
            <p style={{ color: "#e67e22", fontWeight: 600 }}>Please log in to send us a message.</p>
          </div>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="contact-form">
        {!isLoggedIn && (
          <div className="form-row">
            <div className="input-group">
              <label htmlFor="contact-name">Full Name</label>
              <input
                type="text"
                id="contact-name"
                name="name"
                placeholder="Enter your full name"
                value={formData.name}
                onChange={handleInputChange}
                className={errors.name ? "input-error" : ""}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "contact-name-error" : undefined}
                autoComplete="name"
              />
              {errors.name && <span id="contact-name-error" className="error-message">{errors.name}</span>}
            </div>

            <div className="input-group">
              <label htmlFor="contact-email">Email Address</label>
              <input
                type="email"
                id="contact-email"
                name="email"
                placeholder="Enter your email"
                value={formData.email}
                onChange={handleInputChange}
                className={errors.email ? "input-error" : ""}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "contact-email-error" : undefined}
                autoComplete="email"
              />
              {errors.email && <span id="contact-email-error" className="error-message">{errors.email}</span>}
            </div>
          </div>
        )}

        <div className="input-group">
          <label htmlFor="contact-subject">Subject</label>
          <select
            id="contact-subject"
            name="subject"
            value={formData.subject}
            onChange={handleInputChange}
            className={errors.subject ? "input-error" : ""}
            aria-invalid={!!errors.subject}
            aria-describedby={errors.subject ? "contact-subject-error" : undefined}
            required
          >
            <option value="" disabled>
              Select a subject
            </option>
            {SUBJECT_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {errors.subject && <span id="contact-subject-error" className="error-message">{errors.subject}</span>}
        </div>

        <div className="input-group">
          <label htmlFor="contact-message">Message</label>
          <textarea
            id="contact-message"
            name="message"
            placeholder="Tell us more about your inquiry..."
            value={formData.message}
            onChange={handleInputChange}
            className={errors.message ? "input-error" : ""}
            rows={4}
            maxLength={MAX_MESSAGE_LENGTH}
            aria-invalid={!!errors.message}
            aria-describedby={errors.message ? "contact-message-error" : "contact-message-help"}
            required
          />
          {errors.message ? (
            <span id="contact-message-error" className="error-message">{errors.message}</span>
          ) : (
            <span id="contact-message-help" className="error-message" style={{ color: "#6b7280" }}>
              {formData.message.length}/{MAX_MESSAGE_LENGTH}
            </span>
          )}
        </div>

        <button 
          type="submit" 
          className={`submit-btn ${isSubmitting ? 'submitting' : ''}`}
          disabled={isSubmitting || !isLoggedIn}
        >
          {isSubmitting ? (
            <>
              <span className="spinner"></span>
              Sending Message...
            </>
          ) : (
            (isLoggedIn ? 'Send Message' : 'Login Required')
          )}
        </button>
      </form>

      <div className="contact-info">

        <div className="info-item">
          <div className="info-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
          </div>
          <div className="info-content">
            <h4>Email Us</h4>
            <p>support@smartdoc.com</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Contact;

