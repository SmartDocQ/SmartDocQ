import { BrowserRouter, Route, Routes, useLocation, Link } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import useSeo from './hooks/useSeo';
import Lottie from 'lottie-react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ToastProvider } from './Components/Toast/ToastContext';
import Navbar from './Components/Layout/Navbar';
import Hero from './Components/Layout/Hero_Section/HeroSection';
import Body from './Components/Layout/Body_Section/BodySection';
import Footer from './Components/Layout/Footer/Footer';
import RequireAuth from './Components/Auth/RequireAuth';
import IntroScene from './Components/IntroScene/IntroScene';
import errorAnimation from './Animations/404-Page-Error.json';
import "./App.css";

//Lazy-load non-critical sub-pages to optimize bundle size and first-load speed (LCP)
const Upload = lazy(() => import('./Components/Pages/Upload_Page/UploadPage'));
const Login = lazy(() => import('./Components/Auth/Login'));
const ResetPasswordPage = lazy(() => import('./Components/Auth/ResetPasswordPage'));
const HelpCenter = lazy(() => import('./Components/HelpCenter'));
const PrivacyPolicy = lazy(() => import('./Components/Pages/Legal/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./Components/Pages/Legal/TermsOfService'));
const ShareChat = lazy(() => import('./Components/ShareChat'));
const AdminRoute = lazy(() => import('./Components/Admin/AdminRoute'));


const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

if (!googleClientId) {
  console.warn("Google Client ID is not configured. Please define REACT_APP_GOOGLE_CLIENT_ID in your environment variables.");
}

function PageLayout({ children }) {
  return (
    <div className="page-layout">
      <Navbar />
      <main className="page-layout-content">
        {children}
      </main>
      <Footer />
    </div>
  );
}

const LoadingFallback = () => (
  <div style={{
    minHeight: "60vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent"
  }}>
    <div style={{
      width: "24px",
      height: "24px",
      border: "2px solid rgba(255, 255, 255, 0.1)",
      borderTopColor: "#00f2fe",
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite"
    }} />
    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

function Main() {
  useEffect(() => {
    if (!sessionStorage.getItem('smartdocqAlert')) {
      sessionStorage.setItem('smartdocqAlert', 'shown');
      setTimeout(() => {
        window.alert(
          '⚠️ TEMPORARY SERVICE LIMITATION\n\n' +
          'Only the backend AI services of SmartDocQ are currently paused due to cloud infrastructure cost constraints.\n\n' +
          'Frontend Status: Fully Operational\n\n' +
          'You can still explore the platform\'s interface, features, and design.\n\n' +
          'For full system architecture, AI pipeline details, and complete implementation:\n' +
          'Please visit the GitHub repository linked in the footer.'
        );
      }, 600);
    }
  }, []);

  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/"            element={<PageLayout><Hero /><Body /></PageLayout>} />
        <Route path="/reset-password" element={<PageLayout><ResetPasswordPage /></PageLayout>} />
        <Route path="/help"        element={<PageLayout><HelpCenter /></PageLayout>} />
        <Route path="/privacy"     element={<PageLayout><PrivacyPolicy /></PageLayout>} />
        <Route path="/terms"       element={<PageLayout><TermsOfService /></PageLayout>} />
        <Route path="/share/:shareId" element={<PageLayout><ShareChat /></PageLayout>} />
        <Route path="/upload"      element={<RequireAuth><PageLayout><Upload /></PageLayout></RequireAuth>} />
        <Route path="/admin"       element={<AdminRoute />} />
        <Route
          path="*"
          element={(
            <PageLayout>
              <div
                style={{
                  minHeight: "60vh",
                  padding: "40px 16px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                }}
              >
                <Lottie
                  animationData={errorAnimation}
                  loop
                  autoplay
                  style={{ width: 220, maxWidth: '80%', marginBottom: 24 }}
                />
                <h1 style={{ fontSize: "2rem", marginBottom: "12px" }}>Page not found</h1>
                <p style={{ opacity: 0.7, marginBottom: "20px" }}>
                  The page you&apos;re looking for doesn&apos;t exist or has moved.
                </p>
                <Link
                  to="/"
                  style={{
                    padding: "10px 20px",
                    background: "linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)",
                    color: "#0b0f19",
                    fontWeight: "600",
                    borderRadius: "8px",
                    textDecoration: "none",
                    display: "inline-block"
                  }}
                >
                  Go Back to Home
                </Link>
              </div>
            </PageLayout>
          )}
        />
      </Routes>
    </Suspense>
  );
}

function AppContent() {
  const [hasShownLanding, setHasShownLanding] = useState(() => {
    try {
      return !!sessionStorage.getItem('smartdocqLandingShown');
    } catch (e) {
      return false;
    }
  });
  const [revealStarted, setRevealStarted] = useState(hasShownLanding);
  const [showLogin, setShowLogin] = useState(false);
  const location = useLocation();
  useSeo();

  const isResetRoute = location.pathname === '/reset-password';
  const shouldShowLanding = !isResetRoute && !hasShownLanding;
  const isHomePage = location.pathname === '/';

  // Apply background only after opening animation completes on home page
  useEffect(() => {
    if (isHomePage && revealStarted) {
      document.body.style.backgroundImage = 'url(/bg.png)';
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
      document.body.style.backgroundRepeat = 'no-repeat';
    } else {
      document.body.style.backgroundImage = '';
    }
  }, [isHomePage, revealStarted]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setShowLogin(prev => prev || true);
    };

    window.addEventListener("unauthorized", handleUnauthorized);

    return () => {
      window.removeEventListener("unauthorized", handleUnauthorized);
    };
  }, []);

  // Prevent page scrolling while intro animation is active or login popup is open
  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const html = document.documentElement;
    const { body } = document;

    const needsScrollLock = shouldShowLanding || showLogin;

    if (needsScrollLock) {
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      body.style.height = "100vh";
    } else {
      html.style.overflow = "";
      body.style.overflow = "";
      body.style.height = "";
    }

    return () => {
      html.style.overflow = "";
      body.style.overflow = "";
      body.style.height = "";
    };
  }, [shouldShowLanding, showLogin]);

  return (
    <>
      {shouldShowLanding && (
        <IntroScene onRevealStart={() => {
          try {
            sessionStorage.setItem('smartdocqLandingShown', 'true');
          } catch (e) {
            console.error('SessionStorage error:', e);
          }
          setHasShownLanding(true);
          setRevealStarted(true);
        }} />
      )}
      {showLogin && (
        <div className="overlay" onClick={() => setShowLogin(false)} role="presentation">
          <div
            className="popup login-popup"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="auth-popup-close"
              onClick={() => setShowLogin(false)}
              aria-label="Close authentication dialog"
              type="button"
            >
              ✕
            </button>
            <Suspense fallback={<div style={{ minHeight: "200px", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.5)" }}>Loading...</div>}>
              <Login onClose={() => setShowLogin(false)} />
            </Suspense>
          </div>
        </div>
      )}
      <div style={{
        opacity: 1,
        position: 'relative',
        zIndex: 1,
        pointerEvents: 'auto',
      }}>
        <Main />
      </div>
    </>
  );
}

function App() {
  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <BrowserRouter>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}

export default App;