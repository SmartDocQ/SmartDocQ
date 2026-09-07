import React, { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import "./HelpCenter.css";

const HELP_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    ),
    items: [
      "Sign up or sign in securely using email/password credentials or Google Sign-In.",
      "Go to the Upload page to add your learning materials or corporate documents.",
      "Navigate to your document dashboard and start a Chat session to query, summarize, and revise your content."
    ]
  },
  {
    id: "uploads",
    title: "Uploading & Supported Formats",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
      </svg>
    ),
    items: [
      "Supported Formats: PDF, DOCX, DOC, TXT, CSV, and XLSX (Excel) files.",
      "Spreadsheet Analysis: Tables inside CSV and Excel documents are automatically parsed and structured for highly accurate cell-level Q&A.",
      "Processing Pipeline: Document status updates from queued → indexing → done. Please allow extra time for heavy spreadsheets or long PDFs."
    ]
  },
  {
    id: "security",
    title: "Sensitive Data Scanner & Consent",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    content: "To protect your privacy and ensure compliance, SmartDocQ scans documents for sensitive personal data (PII) before performing vector indexing.",
    items: [
      "Scanned Patterns: Email addresses, Phone numbers (Indian mobile formats), Credit cards (validated using the Luhn checksum), Indian PAN cards, Aadhaar cards (validated via Verhoeff checksums), and SSN-like patterns.",
      "Consent Step: If sensitive information is detected, indexing is deferred. You must confirm your consent on the dashboard to proceed with indexing the document.",
      "Your document contents are never used to train global AI models."
    ]
  },
  {
    id: "qa",
    title: "Conversational Chat & Q/A",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    items: [
      "Grounded Answers: SmartDocQ utilizes Retrieval-Augmented Generation (RAG) to ensure responses are grounded in your uploaded documents, minimizing AI hallucinations.",
      "Hybrid Retrieval: We combine Dense Vector Search (semantic meaning matching) with BM25 Keyword Search (lexical keyword matching) and Reciprocal Rank Fusion (RRF) to retrieve the most relevant passages.",
      "Gemini AI: Integrated with Google Gemini models to generate fluid, context-aware answers."
    ]
  },
  {
    id: "study",
    title: "Study Tools: Flashcards & Quizzes",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5v-15z" />
      </svg>
    ),
    items: [
      "Interactive Flashcards: Instantly generate interactive study cards based on the key concepts of your documents.",
      "Smart Quizzes: Auto-generate customized multiple-choice tests from your documents to test your recall, complete with score tracking and rationales."
    ]
  },
  {
    id: "account",
    title: "Account & Admin Roles",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    items: [
      "Profile Settings: Update your name, password, or change your profile avatar (stored securely on Cloudinary).",
      "Admin Features: Admins can access the Admin panel to manage users, delete documents, reset statuses, and monitor system metrics.",
      "Deactivation: If your account is deactivated by an admin, sign-in access is restricted until reactivated."
    ]
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
    items: [
      "File Indexing Stuck: If a file stays in the queued or indexing state, refresh the page. Large files (50+ pages or heavy spreadsheets) may take 1-2 minutes to finish vectorizing.",
      "Inaccurate AI Responses: Ensure your question is related to the document content. Try referencing specific terms or narrowing down your query.",
      "Admin Dashboard Access Denied: Only accounts flagged as admin in the database are allowed to view the admin controls."
    ]
  },
  {
    id: "contact",
    title: "Contact Support",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
    content: "If you run into issues or have feature requests, please submit a message using the Contact form in your dashboard or email support."
  }
];

const FAQS = [
  { q: "Which file formats can I upload?", a: "You can upload PDF, DOCX, DOC, TXT, CSV, and XLSX files. Document tables are extracted and prepared for structured retrieval." },
  { q: "Why does my upload say 'require confirmation' or 'sensitive data detected'?", a: "Our automatic compliance scanner detected possible sensitive details (like Aadhaar, PAN, emails, phones, or credit cards). You simply need to click \"Confirm Consent\" on the document list to proceed with indexing." },
  { q: "Why does indexing take longer for Excel/CSV sheets?", a: "Spreadsheet files contain structured tables. We extract and parse row/column relationships to enable correct table Q&A, which requires deeper preprocessing than regular plain text." },
  { q: "Are my documents private?", a: "Yes, all documents are private to your user account and are not shared. They are processed using secure APIs and are never used to train public AI models." },
  { q: "Can I share my chat sessions?", a: "Yes! You can generate a shareable link for any document chat. Anyone with the link can view the conversation history in read-only mode." },
  { q: "How do I delete my documents and data?", a: "Deleting a document from your dashboard permanently deletes the source file, its text chunks, its vector embeddings, and all associated chat logs. Deleting your account purges all profile data." },
  { q: "Google Sign-In is failing, what should I do?", a: "Ensure that pop-up blockers are disabled in your browser settings and you are logged into your Google account. If issues persist, try signing up via email/password." }
];

export default function HelpCenter() {
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!location.hash) {
      window.scrollTo(0, 0);
    }
    document.title = "Help Center - SmartDocQ";
  }, [location]);

  // Smoothly scroll to section when hash is present
  useEffect(() => {
    if (!location.hash) return;
    const el = document.querySelector(location.hash);
    if (el) {
      setTimeout(() => {
        const y = el.getBoundingClientRect().top + window.pageYOffset - 160;
        window.scrollTo({ top: y, behavior: "smooth" });
      }, 100);
    }
  }, [location]);

  // Filter content based on search query
  const query = searchQuery.toLowerCase().trim();

  const filteredSections = HELP_SECTIONS.filter(section => {
    if (!query) return true;
    const matchTitle = section.title.toLowerCase().includes(query);
    const matchContent = section.content && section.content.toLowerCase().includes(query);
    const matchItems = section.items && section.items.some(item => item.toLowerCase().includes(query));
    return matchTitle || matchContent || matchItems;
  });

  const filteredFaqs = FAQS.filter(faq => {
    if (!query) return true;
    return faq.q.toLowerCase().includes(query) || faq.a.toLowerCase().includes(query);
  });

  return (
    <div className="help-center-page">
      <div className="hc-glow-bg" aria-hidden="true" />
      <div className="help-center-container">
        
        {/* Hero Area */}
        <header className="hc-hero-section">
          <nav className="breadcrumb-nav" style={{ marginBottom: "16px", fontSize: "0.9rem", color: "rgba(255,255,255,0.7)" }}>
            <Link to="/" style={{ color: "#00f2fe", textDecoration: "none" }}>← Back to Home</Link>
          </nav>
          <h1 className="hc-hero-title">Help Center</h1>
          <p className="hc-hero-subtitle">Search documentation, quick-start guides, security compliance details, and FAQs.</p>
          
          {/* Glowing Search Bar */}
          <div className="hc-search-wrapper">
            <div className="hc-search-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <input 
              type="text" 
              placeholder="Search guides, compliance rules, FAQs..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="hc-search-input"
            />
            {searchQuery && (
              <button className="hc-search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search">
                ✕
              </button>
            )}
          </div>
        </header>

        <div className="hc-layout-grid">
          {/* Left Column: Sidebar Sticky Nav */}
          <aside className="hc-sidebar">
            <nav className="hc-nav-vertical" aria-label="Help categories">
              <span className="hc-nav-header">CATEGORIES</span>
              {HELP_SECTIONS.map((section) => (
                <a 
                  key={section.id} 
                  href={`#${section.id}`}
                  className="hc-nav-link"
                >
                  <span className="hc-nav-link-icon">{section.icon}</span>
                  <span className="hc-nav-link-label">{section.title}</span>
                </a>
              ))}
              <a href="#faq" className="hc-nav-link">
                <span className="hc-nav-link-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <span className="hc-nav-link-label">FAQ</span>
              </a>
            </nav>
          </aside>

          {/* Right Column: Content Area */}
          <main className="hc-content-area">
            {filteredSections.map((section) => (
              <section key={section.id} id={section.id} className="hc-card-section">
                <div className="hc-card-backing-glow" aria-hidden="true" />
                <div className="hc-card-border-glow" aria-hidden="true" />
                
                <div className="hc-card-header">
                  <div className="hc-card-icon">{section.icon}</div>
                  <h2 className="hc-card-title">{section.title}</h2>
                </div>
                <div className="hc-card-body">
                  {section.content && <p className="hc-card-text">{section.content}</p>}
                  {section.items && (
                    <ul className="hc-card-list">
                      {section.items.map((item, idx) => (
                        <li key={idx} className="hc-card-list-item">
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            ))}

            {/* FAQs Section */}
            {filteredFaqs.length > 0 && (
              <section id="faq" className="hc-card-section hc-faq-section">
                <div className="hc-card-backing-glow" aria-hidden="true" />
                <div className="hc-card-border-glow" aria-hidden="true" />

                <div className="hc-card-header">
                  <div className="hc-card-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <h2 className="hc-card-title">Frequently Asked Questions (FAQ)</h2>
                </div>
                <div className="hc-card-body hc-faq-list">
                  {filteredFaqs.map((faq, idx) => (
                    <details key={idx} className="hc-qa-accordion">
                      <summary className="hc-qa-summary">
                        <span>{faq.q}</span>
                        <span className="hc-qa-chevron">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </span>
                      </summary>
                      <div className="hc-qa-answer">
                        <p>{faq.a}</p>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            )}

            {/* Legal Links Card */}
            <section className="hc-card-section hc-legal-links-card">
              <div className="hc-card-backing-glow" aria-hidden="true" />
              <div className="hc-card-border-glow" aria-hidden="true" />
              
              <div className="hc-card-header">
                <div className="hc-card-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </div>
                <h2 className="hc-card-title">Legal & Privacy Reference</h2>
              </div>
              <div className="hc-card-body hc-legal-grid">
                <div className="hc-legal-item">
                  <h3>Privacy Policy</h3>
                  <p>Read our full statement on how we scan, secure, and index your private documents.</p>
                  <Link to="/privacy" className="hc-legal-link-btn">
                    Read Privacy Policy &rarr;
                  </Link>
                </div>
                <div className="hc-legal-item">
                  <h3>Terms of Service</h3>
                  <p>Understand the usage guidelines, system limitations, and service policies of SmartDocQ.</p>
                  <Link to="/terms" className="hc-legal-link-btn">
                    Read Terms of Service &rarr;
                  </Link>
                </div>
              </div>
            </section>

            {filteredSections.length === 0 && filteredFaqs.length === 0 && (
              <div className="hc-no-results">
                <h3>No results found</h3>
                <p>We couldn't find any articles matching "{searchQuery}". Try using different terms or keywords.</p>
                <button className="hc-reset-btn" onClick={() => setSearchQuery("")}>
                  Reset Search
                </button>
              </div>
            )}
          </main>
        </div>

      </div>
    </div>
  );
}
