import { useNavigate } from "react-router-dom";
import "./HeroSection.css";

const MobileHero = () => {
  const navigate = useNavigate();

  const handleGetStarted = () => {
    const user = localStorage.getItem("user");
    if (user) {
      navigate("/upload");
    } else {
      window.dispatchEvent(new Event("unauthorized"));
    }
  };

  return (
    <div className="mobile-only-hero">
      <div className="mobile-hero-container">

        {/* Badge */}
        <div className="mobile-badge">
          <span className="spark-icon">✦</span> AI Document Assistant
        </div>

        {/* Heading */}
        <h1 className="mobile-hero-heading">
          Your documents.<br />
          <span className="gradient-text">Now you can talk to them.</span>
        </h1>

        {/* Description */}
        <p className="mobile-hero-description">
          Upload PDFs, Word files, spreadsheets, and text. Ask questions, get grounded answers with citations, and generate instant study tools.
        </p>

        {/* CTA */}
        <button type="button" className="get-started-btn" onClick={handleGetStarted}>
          Get Started <span className="btn-arrow">→</span>
        </button>

        {/* Feature Grid */}
        <div className="mobile-features-grid">

          {/* AI Chat — sky blue */}
          <div className="mobile-feature-item">
            <div className="feature-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
            <span className="feature-title-sm">AI Chat</span>
            <span className="feature-desc-sm">Ask your document</span>
          </div>

          {/* Summaries — amber */}
          <div className="mobile-feature-item">
            <div className="feature-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <span className="feature-title-sm">Summaries</span>
            <span className="feature-desc-sm">Instant insights</span>
          </div>

          {/* Quizzes — emerald */}
          <div className="mobile-feature-item">
            <div className="feature-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="12" cy="16" r="1" />
                <path d="M12 8v2a2 2 0 0 0 2 2h0a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2" />
              </svg>
            </div>
            <span className="feature-title-sm">Quizzes</span>
            <span className="feature-desc-sm">Practice smarter</span>
          </div>

          {/* Flashcards — rose */}
          <div className="mobile-feature-item">
            <div className="feature-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fb7185" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                <rect x="8" y="8" width="16" height="16" rx="2" ry="2" />
              </svg>
            </div>
            <span className="feature-title-sm">Flashcards</span>
            <span className="feature-desc-sm">Remember faster</span>
          </div>

        </div>

        {/* Document Mockup */}
        <div className="mobile-mockup-wrapper">
          <div className="mockup-sparkles" />
          <div className="mobile-mockup">
            <div className="mockup-floating-tag tag-pdf">PDF</div>
            <div className="mockup-floating-tag tag-docx">DOCX</div>
            <div className="mockup-floating-tag tag-txt">TXT</div>
            <div className="mockup-floating-tag tag-csv">CSV</div>
            <div className="mockup-floating-tag tag-xlsx">XLSX</div>
            <div className="mockup-screen">
              <div className="mockup-pdf-header">
                <span className="mockup-pdf-badge">Research Paper</span>
              </div>
              <div className="mockup-lines">
                <div className="mockup-line w-80 glow" />
                <div className="mockup-line w-full" />
                <div className="mockup-line w-60" />
                <div className="mockup-line w-90" />
                <div className="mockup-line w-50" />
              </div>
              <div className="mockup-chat-box">
                <p>Explain this paper in simple terms.</p>
                <button className="mockup-send-btn" type="button" aria-label="Send">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Privacy Notice */}
        <div className="mobile-privacy-notice">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p>Private by design.<br />Your documents stay secure.</p>
        </div>

      </div>
    </div>
  );
};

export default MobileHero;
