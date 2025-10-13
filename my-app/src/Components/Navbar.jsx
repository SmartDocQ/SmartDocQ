import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./navbar.css";
import logo from "./logo.png";
import Login from "./Login";
import Contact from "./Contact";
import icon from "./icon1.png";
import lg from "./lg.png";
import lg1 from "./lg1.png";
import Account from "./Account";
import { useToast } from "./ToastContext";

function Navbar() {
  const [popup, setPopup] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const profileRef = useRef();
  const { showToast } = useToast(); 

  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) setUser(JSON.parse(savedUser));
    setLoading(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Proper scroll locking for popups and mobile menu + ESC-to-close
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        if (popup) setPopup(null);
        if (isMobileMenuOpen) setIsMobileMenuOpen(false);
        if (showProfileMenu) setShowProfileMenu(false);
      }
    };

    const shouldLock = !!popup || isMobileMenuOpen;
    // Lock scroll on both html and body for robustness across browsers
    document.documentElement.style.overflow = shouldLock ? "hidden" : "";
    document.body.style.overflow = shouldLock ? "hidden" : "";
    document.body.style.overscrollBehavior = shouldLock ? "contain" : "";

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.overscrollBehavior = "";
    };
  }, [popup, isMobileMenuOpen, showProfileMenu]);

  // Storage sync across tabs for auth changes
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "user") {
        setUser(e.newValue ? JSON.parse(e.newValue) : null);
      }
      if (e.key === "token" && !e.newValue) {
        // Token removed in another tab; ensure local user is cleared
        setUser(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Close mobile menu on route change or when window resizes to desktop
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 768) setIsMobileMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const scrollToFeatures = () => {
    if (location.pathname !== "/") {
      navigate("/");
      setTimeout(() => {
        const el = document.getElementById("feat");
        if (el) el.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } else {
      const el = document.getElementById("feat");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleLogout = () => {
    setUser(null);
    setShowProfileMenu(false);
    localStorage.removeItem("user");
    localStorage.removeItem("token");

    showToast("Logout successful", { type: "success" }); 
    navigate("/"); 
  };
  const isUploadPage = location.pathname === "/upload";

  return (
    <>
      <div className={`navbar ${isUploadPage ? "upload-navbar" : ""} ${isMobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="a"><img className="logo" src={logo} alt="Logo" /></div>

        <button
          className={`menu-toggle ${isMobileMenuOpen ? "open" : ""}`}
          aria-label="Toggle navigation menu"
          aria-controls="nav-links"
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen((v) => !v)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <div id="nav-links" className="mid">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Home</a>
          <a href="#feat" onClick={(e) => { e.preventDefault(); scrollToFeatures(); setIsMobileMenuOpen(false); }}>Features</a>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              if (!user) {
                showToast("Please log in to use Contact Us", { type: "error" });
                return;
              }
              setPopup("contact");
              setIsMobileMenuOpen(false);
            }}
          >
            Contact Us
          </a>
        </div>

        <div className="login">
          {!loading && (
            user ? (
              <div className="profile-section" ref={profileRef}>
                <img
                  src={user?.avatar ? user.avatar : icon}
                  alt="Profile"
                  className="avatar"
                  style={{ cursor: "pointer", userSelect: "none" }}
                  onClick={() => setShowProfileMenu((prev) => !prev)}
                />
                {showProfileMenu && (
                  <div className="profile-dropdown">
                    <a className="dd" href="/" onClick={(e) => { e.preventDefault(); setPopup("account"); setShowProfileMenu(false); }}>
                      <img src={lg1} alt="/" className="dpi" />Profile
                    </a>
                    <a className="dd" href="/" onClick={(e) => { e.preventDefault(); handleLogout(); }}>
                      <img src={lg} alt="/" className="dpi" />Logout
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => { setPopup("login"); setIsMobileMenuOpen(false); }}>Login</button>
            )
          )}
        </div>
      </div>

      {popup === "login" && (
        <div className="overlay" onClick={() => setPopup(null)}>
          <div className="popup" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setPopup(null)}>✕</button>
            <Login
              onAuthSuccess={(userData) => {
                setUser(userData);
                localStorage.setItem("user", JSON.stringify(userData));
                // Only set token if explicitly provided to avoid overwriting a valid one
                if (userData && userData.token) {
                  localStorage.setItem("token", userData.token);
                }
                setPopup(null);
              }}
            />
          </div>
        </div>
      )}

      {popup === "contact" && (
        <div className="overlay" onClick={() => setPopup(null)}>
          <div className="popup contact-popup" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setPopup(null)}>✕</button>
            <Contact
              onSuccess={() => setPopup(null)}
              defaultName={user?.name}
              defaultEmail={user?.email}
            />
          </div>
        </div>
      )}

      {popup === "account" && (
        <Account
          user={user}
          onClose={() => setPopup(null)}
          onUpdated={(u) => setUser(u)}
        />
      )}
    </>
  );
}

export default Navbar;
