import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "./Navbar.css";
import logo from "./assets/logo.png";
import icon from "./assets/icon1.png";
import { useToast } from "../../Toast/ToastContext";
import { useAuth } from "./useAuth";
import ProfileMenu from "./ProfileMenu";
import NavDialogs from "./NavDialogs";
import MobileSheet from "./MobileSheet";
import { useMobileMenu } from "./useMobileMenu";

const getActiveTab = (pathname) => {
  if (pathname === "/") return "Home";
  return null;
};

const MENU_DELAY = 300;
const SCROLL_DURATION = 800;
const ROUTE_SCROLL_DELAY = 100;

export default function Navbar() {
  const navigate   = useNavigate();
  const location   = useLocation();

  const [popup, setPopup]                     = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [activeTab, setActiveTab]             = useState(() => getActiveTab(location.pathname));
  const [hoveredTab, setHoveredTab]           = useState(null);
  const [scrolled, setScrolled]               = useState(false);
  const [sliderStyle, setSliderStyle]         = useState({ left: 0, width: 0, opacity: 0 });

  const navContainerRef  = useRef(null);
  const itemsRef         = useRef({});
  const pendingScrollRef = useRef(false);
  const profileRef       = useRef();
  const menuTimeoutRef   = useRef(null);

  // Clean up scheduled menu timeouts when component unmounts
  useEffect(() => {
    return () => {
      if (menuTimeoutRef.current) {
        clearTimeout(menuTimeoutRef.current);
      }
    };
  }, []);

  const clearMenuTimeout = useCallback(() => {
    if (menuTimeoutRef.current) {
      clearTimeout(menuTimeoutRef.current);
      menuTimeoutRef.current = null;
    }
  }, []);

  const { showToast }                              = useToast();
  const { user, loading, persistUser, logout }     = useAuth();
  const { isMobileMenuOpen, close: closeMobileMenu, toggle: toggleMobileMenu } = useMobileMenu();

  const closePopup   = useCallback(() => setPopup(null), []);
  const isUploadPage = location.pathname === "/upload";

  // Keep activeTab in sync with the current URL
  useEffect(() => {
    const tab = getActiveTab(location.pathname);
    if (tab) setActiveTab(tab);
  }, [location.pathname]);

  // Handle Escape key for dialogs and profile menu (mobile menu ESC is handled inside useMobileMenu)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") { setPopup(null); setShowProfileMenu(false); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Lock page scroll while a popup is open
  useEffect(() => {
    const lock = !!popup;
    document.documentElement.style.overflow = lock ? "hidden" : "";
    document.body.style.overflow            = lock ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow            = "";
    };
  }, [popup]);

  // Lock scroll states and morph background on scroll
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 15);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Update desktop navigation slider position based on active or hovered tab
  const updateSlider = useCallback(() => {
    const targetTab = hoveredTab || activeTab;
    const activeEl    = itemsRef.current[targetTab];
    const containerEl = navContainerRef.current;
    if (activeEl && containerEl) {
      const navRect = containerEl.getBoundingClientRect();
      const elRect  = activeEl.getBoundingClientRect();
      setSliderStyle({ left: elRect.left - navRect.left, width: elRect.width, opacity: 1 });
    } else {
      setSliderStyle(prev => ({ ...prev, opacity: 0 }));
    }
  }, [activeTab, hoveredTab]);

  useEffect(() => {
    const raf = requestAnimationFrame(updateSlider);
    window.addEventListener("resize", updateSlider);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", updateSlider); };
  }, [updateSlider]);

  // Smoothly scroll the page to a target element
  const smoothScroll = useCallback((target, duration = SCROLL_DURATION) => {
    if (!target) return;
    const targetPos = target.getBoundingClientRect().top + window.pageYOffset;
    const startPos  = window.pageYOffset;
    const distance  = targetPos - startPos;
    let startTime   = null;
    const animate = (currentTime) => {
      if (!startTime) startTime = currentTime;
      const elapsed  = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = progress < 0.5
        ? 4 * progress ** 3
        : 1 - (-2 * progress + 2) ** 3 / 2;
      window.scrollTo(0, startPos + distance * ease);
      if (elapsed < duration) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, []);

  const scrollToFeatures = useCallback(() => {
    const el = document.getElementById("feat");
    if (el) { smoothScroll(el, SCROLL_DURATION); }
    else    { pendingScrollRef.current = true; navigate("/"); }
  }, [navigate, smoothScroll]);

  useEffect(() => {
    if (pendingScrollRef.current && location.pathname === "/") {
      pendingScrollRef.current = false;
      const el = document.getElementById("feat");
      if (el) setTimeout(() => smoothScroll(el), ROUTE_SCROLL_DELAY);
    }
  }, [location.pathname, smoothScroll]);

  const openContact = useCallback(() => {
    if (!user) {
      showToast("Please log in to use Contact Us", { type: "error" });
      return;
    }
    setPopup("contact");
  }, [user, showToast]);

  // Central handler for mobile sheet navigation items
  const handleSheetItemClick = useCallback((itemId) => {
    setActiveTab(itemId);
    closeMobileMenu();
    clearMenuTimeout();
    if (itemId === "Home") {
      navigate("/");
    } else if (itemId === "Features") {
      menuTimeoutRef.current = setTimeout(() => {
        menuTimeoutRef.current = null;
        scrollToFeatures();
      }, MENU_DELAY);
    } else if (itemId === "Contact") {
      menuTimeoutRef.current = setTimeout(() => {
        menuTimeoutRef.current = null;
        openContact();
      }, MENU_DELAY);
    }
  }, [navigate, scrollToFeatures, openContact, closeMobileMenu, clearMenuTimeout]);

  return (
    <>
      <nav
          className={`navbar ${scrolled ? "scrolled" : ""} ${isUploadPage ? "upload-navbar" : ""}`}
          role="navigation"
          aria-label="Main navigation"
          id="navbar">

          {/* Logo section */}
          <div className="a">
            <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} aria-label="SmartDocQ Home">
              <img className="logo" src={logo} alt="SmartDocQ Logo" />
            </a>
          </div>

          {/* Desktop navigation (pill-style menu) */}
          <div
            id="nav-links"
            className="nav-links-container"
            ref={navContainerRef}
            onMouseLeave={() => setHoveredTab(null)}>
            <div className="nav-slider" style={sliderStyle} />

            <button
              type="button"
              className={`nav-item ${activeTab === "Home" ? "active" : ""}`}
              aria-current={activeTab === "Home" ? "page" : undefined}
              onMouseEnter={() => setHoveredTab("Home")}
              onClick={() => {
                navigate("/");
                setActiveTab("Home");
                clearMenuTimeout();
              }}
              ref={(el) => (itemsRef.current["Home"] = el)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2 6.5L8 2l6 4.5V13a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5z"/>
              </svg>
              Home
            </button>

            <div className="nav-divider" aria-hidden="true" />

            <button
              type="button"
              className={`nav-item ${activeTab === "Features" ? "active" : ""}`}
              aria-current={activeTab === "Features" ? "page" : undefined}
              onMouseEnter={() => setHoveredTab("Features")}
              onClick={() => {
                setActiveTab("Features");
                clearMenuTimeout();
                menuTimeoutRef.current = setTimeout(() => {
                  menuTimeoutRef.current = null;
                  scrollToFeatures();
                }, MENU_DELAY);
              }}
              ref={(el) => (itemsRef.current["Features"] = el)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="2" y="2" width="5" height="5" rx="1"/>
                <rect x="9" y="2" width="5" height="5" rx="1"/>
                <rect x="2" y="9" width="5" height="5" rx="1"/>
                <rect x="9" y="9" width="5" height="5" rx="1"/>
              </svg>
              Features
            </button>

            <div className="nav-divider" aria-hidden="true" />

            <button
              type="button"
              className={`nav-item ${activeTab === "Contact" ? "active" : ""}`}
              aria-current={activeTab === "Contact" ? "page" : undefined}
              onMouseEnter={() => setHoveredTab("Contact")}
              onClick={() => {
                setActiveTab("Contact");
                clearMenuTimeout();
                menuTimeoutRef.current = setTimeout(() => {
                  menuTimeoutRef.current = null;
                  openContact();
                }, MENU_DELAY);
              }}
              ref={(el) => (itemsRef.current["Contact"] = el)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2 4h12M2 8h8M2 12h5"/>
                <circle cx="13" cy="11" r="2.5"/>
                <path d="M15 13.5l1.5 1.5"/>
              </svg>
              Contact Us
            </button>
          </div>

          {/* Authentication actions (login button or profile avatar) */}
          <div className="login">
            {!loading && (
              user ? (
                <div className="profile-section">
                  <button
                    ref={profileRef}
                    type="button"
                    className="profile-btn"
                    onClick={() => setShowProfileMenu((prev) => !prev)}
                    aria-label="User Profile Menu"
                    aria-haspopup="menu"
                    aria-expanded={showProfileMenu}
                  >
                    <img
                      src={user.avatar || icon}
                      alt=""
                      className="avatar"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                  {showProfileMenu && (
                    <ProfileMenu
                      triggerRef={profileRef}
                      user={user}
                      onProfile={() => { setPopup("account"); setShowProfileMenu(false); }}
                      onLogout={() => { setShowProfileMenu(false); logout(); }}
                      onClose={() => setShowProfileMenu(false)}
                    />
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="user-profile"
                  onClick={() => setPopup("login")}
                >
                  <span className="user-profile-inner">
                    <svg
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                    >
                      <g data-name="Layer 2" id="Layer_2">
                        <path
                          d="m15.626 11.769a6 6 0 1 0 -7.252 0 9.008 9.008 0 0 0 -5.374 8.231 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 9.008 9.008 0 0 0 -5.374-8.231zm-7.626-4.769a4 4 0 1 1 4 4 4 4 0 0 1 -4-4zm10 14h-12a1 1 0 0 1 -1-1 7 7 0 0 1 14 0 1 1 0 0 1 -1 1z"
                        ></path>
                      </g>
                    </svg>
                    <span>Log In</span>
                    <svg className="login-arrow-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </span>
                </button>
              )
            )}
          </div>

          {/* Mobile menu toggle button (hamburger) */}
          <button
            className={`menu-toggle ${isMobileMenuOpen ? "open" : ""}`}
            aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-controls="mobile-sheet"
            aria-expanded={isMobileMenuOpen}
            onClick={toggleMobileMenu}
            type="button">
            <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
          </button>
        </nav>

      {/* Mobile navigation bottom sheet */}
      <MobileSheet
        isOpen={isMobileMenuOpen}
        onClose={closeMobileMenu}
        activeTab={activeTab}
        onItemClick={handleSheetItemClick}
        user={user}
        onLogin={()   => { closeMobileMenu(); setPopup("login");    }}
        onSignUp={()  => { closeMobileMenu(); setPopup("signup");   }}
        onAccount={() => { closeMobileMenu(); setPopup("account");  }}
        onLogout={()  => { closeMobileMenu(); logout();             }}
      />


      <NavDialogs
        popup={popup}
        user={user}
        onClose={closePopup}
        onAuthSuccess={(userData) => { persistUser(userData); setPopup(null); }}
        onUserUpdate={persistUser}
      />
    </>
  );
}