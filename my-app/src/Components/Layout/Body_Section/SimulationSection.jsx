import { useRef, useEffect, useState } from 'react';
import logo from "../Navbar/assets/logo.png";
import avatarIcon from "../Navbar/assets/icon1.png";
import "./SimulationSection.css";

const SIMULATION_STEPS = [
  { id: 0, label: "Upload", description: "Document Upload" },
  { id: 1, label: "Ask AI", description: "AI Question & Answer" },
  { id: 2, label: "Citation", description: "Document Source Matching" },
  { id: 3, label: "Flashcards", description: "Auto-Generated Flashcards" },
  { id: 4, label: "Quiz", description: "Knowledge Test Quiz" }
];

/* ============================================================================
 * INTERACTIVE PLATFORM SIMULATION SECTION
 * ============================================================================ */
const SimulationSection = ({ activeStep, setActiveStep }) => {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [dragPhase, setDragPhase] = useState("idle");
  const [dragPosition, setDragPosition] = useState({ x: 80, y: 80 });
  const [chatTypedText, setChatTypedText] = useState("");
  const [cardFlipped, setCardFlipped] = useState(false);
  const [quizSelected, setQuizSelected] = useState(null);

  const timerRef = useRef(null);
  const chatHistoryRef = useRef(null);

  // Auto-scroll chat history to the bottom when text is being typed
  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatTypedText]);

  // Auto-advance loop for the simulation steps
  useEffect(() => {
    if (activeStep === 0) {
      setUploadProgress(0);
      setUploadComplete(false);
      setDragPhase("idle");
      setDragPosition({ x: 80, y: 80 });

      // Start drag animation after a small delay
      const dragStartTimer = setTimeout(() => {
        setDragPhase("dragging");
        setDragPosition({ x: 50, y: 40 }); // Target center of dropzone
      }, 300);

      // Transition to progress bar after cursor arrives
      const dropTimer = setTimeout(() => {
        setDragPhase("dropped");
        
        let p = 0;
        const interval = setInterval(() => {
          p += 5;
          setUploadProgress(p);
          if (p >= 100) {
            clearInterval(interval);
            setUploadComplete(true);
            
            // Auto go to next section 'Ask AI' after upload completes (1.2s delay to show file insertion)
            timerRef.current = setTimeout(() => {
              setActiveStep(1);
            }, 1200);
          }
        }, 50);

        return () => clearInterval(interval);
      }, 1600); // 1.2s transition + 0.4s buffer

      return () => {
        clearTimeout(dragStartTimer);
        clearTimeout(dropTimer);
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }

    if (activeStep === 1) {
      // Replicating the exact Q&A response from the screenshot
      const fullText = "The introduction highlights several key points regarding diabetic foot ulcers (DFUs) and the study's approach:\n\n• Prevalence of Diabetes: More than 550 million people are currently diagnosed with Type 2 Diabetes Mellitus (T2DM) globally, with projections indicating an increase to 700 million by 2045.\n\n• DFUs as a Critical Complication: DFUs are a severe and prevalent issue among diabetic complications, characterized by a high mortality rate and contributing to approximately 85% of nontraumatic lower-extremity amputations (LEA) worldwide.";
      setChatTypedText("");
      let idx = 0;
      const interval = setInterval(() => {
        setChatTypedText((prev) => prev + fullText.charAt(idx));
        idx++;
        if (idx >= fullText.length) {
          clearInterval(interval);
          
          // Typing finished! Wait 2.2 seconds for readability, then advance to step 2 (Citation)
          timerRef.current = setTimeout(() => {
            setActiveStep(2);
          }, 2200);
        }
      }, 15);
      
      return () => {
        clearInterval(interval);
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }

    if (activeStep === 3) {
      setCardFlipped(false);
      const flipTimer = setTimeout(() => {
        setCardFlipped(true);
      }, 1500);
      return () => clearTimeout(flipTimer);
    }

    if (activeStep === 4) {
      setQuizSelected(null);
      const selectTimer = setTimeout(() => {
        setQuizSelected('B');
      }, 1800);
      return () => clearTimeout(selectTimer);
    }
  }, [activeStep, setActiveStep, setUploadComplete, setUploadProgress, setDragPhase, setDragPosition, setChatTypedText, setCardFlipped, setQuizSelected]);

  // Autoplay progression timer for slides 2-4 (0 and 1 have custom progression triggers)
  useEffect(() => {
    if (activeStep === 0 || activeStep === 1) return;

    timerRef.current = setTimeout(() => {
      setActiveStep((prev) => (prev + 1) % 5);
    }, 7500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeStep, setActiveStep]);

  return (
    <div className="simulation-section">
      {/* Simulation Stepper Header (Static display only, no click events) */}
      <div className="sim-stepper">
        {SIMULATION_STEPS.map((step) => {
          const isActive = activeStep === step.id;
          return (
            <div
              key={step.id}
              className={`sim-step-btn ${isActive ? "active" : ""}`}
            >
              <span className="sim-step-label">{step.label}</span>
              {isActive && <div className="sim-step-progress-line" />}
            </div>
          );
        })}
      </div>

      {/* Mockup Browser Window */}
      <div className="sim-browser-window">
        {/* Replicated App Navbar Header */}
        <div className="sim-browser-header">
          {/* Left: Logo */}
          <div className="sim-navbar-logo">
            <img src={logo} alt="SmartDocQ Logo" className="sim-navbar-logo-img" />
          </div>

          {/* Center: Nav Pill Bar */}
          <div className="sim-navbar-pill">
            <div className="sim-nav-item active">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="nav-icon">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span>Home</span>
            </div>
            <div className="sim-nav-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="nav-icon">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>Features</span>
            </div>
            <div className="sim-nav-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="nav-icon">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>Contact Us</span>
            </div>
          </div>

          {/* Right: Profile Avatar */}
          <div className="sim-navbar-avatar-wrap">
            <img src={avatarIcon} alt="Profile Avatar" className="sim-navbar-avatar-img" />
          </div>
        </div>

        {/* Dashboard Frame */}
        <div className="sim-browser-content">
          {/* Left Sidebar (Exact replica of Documents sidebar from screenshot) */}
          <aside className="sim-sidebar">
            <div className="sim-sidebar-header">
              <h2>Documents</h2>
              <button className="sim-folder-btn" aria-label="Add Folder">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
            </div>
            
            <div className="sim-search-bar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="text" placeholder="Search files..." disabled />
            </div>

            <div className="sim-sort-row">
              <div className="sim-sort-dropdown">
                <span>Sort by Name</span>
                <span className="dropdown-arrow">▼</span>
              </div>
              <button className="sim-sort-dir">↑</button>
            </div>

            <div className="sim-file-list">
              {/* File item 1: Replicating DFU Study from the screenshot */}
              {/* Initially not in sidebar (during upload progress), added upon uploadComplete or next slides */}
              {((activeStep === 0 && uploadComplete) || activeStep > 0) && (
                <div className="sim-file-card new-upload-anim">
                  <div className="sim-file-left-col">
                    <div className="file-icon-wrap red-theme">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444' }}>
                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6z" />
                        <path d="M14 2v6h6" />
                      </svg>
                    </div>
                    <span className="file-card-badge-lbl">3.1 MB</span>
                  </div>
                  <div className="file-details">
                    <div className="file-name">FOOT AMPUTATION_DFU_Study.pdf</div>
                    <span className="file-type-badge type-pdf">PDF</span>
                  </div>
                  <div className="file-actions">
                    <button className="act-btn-mock" aria-label="Bookmark">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                    <button className="act-btn-mock" aria-label="Rename">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button className="act-btn-mock" aria-label="Delete">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* File item 2: test.xlsx */}
              <div className="sim-file-card">
                <div className="sim-file-left-col">
                  <div className="file-icon-wrap green-theme">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#22c55e' }}>
                      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6z" />
                      <path d="M14 2v6h6" />
                      <rect x="7" y="11" width="10" height="7" rx="1" strokeWidth="1.5" />
                      <line x1="12" y1="11" x2="12" y2="18" strokeWidth="1" />
                      <line x1="7" y1="14" x2="17" y2="14" strokeWidth="1" />
                    </svg>
                  </div>
                  <span className="file-card-badge-lbl">13.4 KB</span>
                </div>
                <div className="file-details">
                  <div className="file-name">test.xlsx</div>
                  <span className="file-type-badge type-xlsx">XLSX</span>
                </div>
                <div className="file-actions">
                  <button className="act-btn-mock" aria-label="Bookmark">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                  <button className="act-btn-mock" aria-label="Rename">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button className="act-btn-mock" aria-label="Delete">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Visualizer Content */}
          <main className="sim-main-panel">
            
            {/* Slide 0: Upload Document (Matches the screenshot layout) */}
            {activeStep === 0 && (
              <div className="sim-panel-upload fade-in-sim">
                {/* Drag Cursor Animation */}
                {dragPhase !== "dropped" && (
                  <div 
                    className="sim-mock-cursor" 
                    style={{ 
                      top: `${dragPosition.y}%`, 
                      left: `${dragPosition.x}%` 
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="cursor-arrow-icon">
                      <path d="M3 3l7.07 16.97 2.51-6.85 6.85-2.51L3 3z" fill="#ffffff" />
                      <path d="M13 13l6 6" stroke="#ffffff" />
                    </svg>
                    {dragPhase === "dragging" && (
                      <div className="sim-drag-card-preview">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444', marginRight: '4px' }}>
                          <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6z" />
                          <path d="M14 2v6h6" />
                        </svg>
                        <span>FOOT_DFU_Study.pdf</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="upload-header-text">
                  UPLOAD YOUR <span className="cyan-text-accent">DOCUMENT</span>
                </div>

                <div className={`sim-dropzone-card ${dragPhase === "dragging" ? "drag-hover" : ""}`}>
                  <div className="sim-dropzone-icon-wrap">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="12" y1="18" x2="12" y2="12"/>
                      <polyline points="9 15 12 12 15 15"/>
                    </svg>
                  </div>
                  
                  <div className="sim-dropzone-title">
                    Click or drag files to this area to upload
                  </div>
                  
                  <div className="sim-dropzone-desc">
                    Support for single or bulk upload of document files. Sensitive data is scanned and flagged automatically.
                  </div>
                  
                  <div className="sim-dropzone-badges">
                    <span className="sim-badge">PDF</span>
                    <span className="sim-badge">DOCX</span>
                    <span className="sim-badge">TXT</span>
                    <span className="sim-badge">CSV</span>
                    <span className="sim-badge">XLSX</span>
                  </div>

                  {uploadProgress > 0 && uploadProgress < 100 ? (
                    <div className="sim-upload-progress-container">
                      <div className="sim-upload-progressbar">
                        <div className="sim-upload-progress-fill" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                      <div className="sim-upload-progress-text">Uploading FOOT_DFU_Study.pdf ({uploadProgress}%)</div>
                    </div>
                  ) : (
                    <button className="sim-choose-btn">
                      <span className="plus-sign">+</span> CHOOSE FILES
                    </button>
                  )}

                  <div className="sim-max-size-txt">
                    MAXIMUM FILE SIZE: 15MB
                  </div>
                </div>

                {/* Footer Feature Cards inside the Upload slide */}
                <div className="sim-upload-footer-cards">
                  <div className="sim-footer-feature-card border-pink">
                    <div className="sim-footer-icon-circle pink-bg">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <div className="sim-footer-card-txt">
                      <h4>AI STUDY ASSISTANT</h4>
                      <p>Ask questions, generate quizzes, create flashcards, and summarize any document instantly.</p>
                    </div>
                  </div>
                  <div className="sim-footer-feature-card border-gold">
                    <div className="sim-footer-icon-circle gold-bg">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <div className="sim-footer-card-txt">
                      <h4>SECURE PROCESSING</h4>
                      <p>Your documents are processed securely and handled with privacy in mind.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Slide 1: Chat Q&A (Matches Chat interface from screenshot) */}
            {activeStep === 1 && (
              <div className="sim-panel-chat fade-in-sim">
                <div className="sim-chat-header">
                  <span className="chat-title-text">Chat</span>
                  <div className="chat-actions-group">
                    <button className="chat-action-pill-btn">Quiz</button>
                    <button className="chat-action-pill-btn">Flashcards</button>
                    <span className="chat-action-icon">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </span>
                    <span className="chat-action-icon">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    </span>
                    <span className="chat-action-icon">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </span>
                  </div>
                </div>

                <div className="chat-history" ref={chatHistoryRef}>
                  {/* Replicating screenshot Q&A with message actions */}
                  <div className="chat-msg user-msg">
                    <div className="msg-bubble-wrap">
                      <div className="msg-bubble">explain complete introduction</div>
                      <div className="message-actions user-actions">
                        <button className="copy-button" disabled aria-label="Copy message">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="chat-msg ai-msg">
                    <div className="ai-avatar">AI</div>
                    <div className="msg-bubble-wrap">
                      <div className="msg-bubble text-left-aligned">
                        {chatTypedText}
                        {chatTypedText.length < 320 && <span className="caret">▮</span>}
                      </div>
                      <div className="message-actions">
                        <button className="copy-button" disabled aria-label="Copy message">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        </button>
                        <button className="thumb-button up" disabled aria-label="Helpful response">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                          </svg>
                        </button>
                        <button className="thumb-button down" disabled aria-label="Unhelpful response">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="chat-input-row">
                  <div className="chat-input-wrapper-mock">
                    <span className="chat-input-action-icons">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                    </span>
                    <div className="chat-input-placeholder-lbl">Ask anything about this document...</div>
                    <button className="chat-input-send-circle" aria-label="Send message">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Slide 2: Citations (Matches Chat + PDF Preview side-by-side) */}
            {activeStep === 2 && (
              <div className="sim-panel-citations fade-in-sim">
                <div className="citations-split-view">
                  {/* Middle Column: Document Preview */}
                  <div className="doc-side">
                    <div className="doc-page-header">
                      <span className="doc-header-title">Document Preview</span>
                      <div className="pdf-toolbar">
                        <span>☰</span>
                        <span>···</span>
                        <span>−</span>
                        <span>+</span>
                        <span className="page-counter-lbl">1 of 14</span>
                        <span>···</span>
                        <span>🔍</span>
                      </div>
                    </div>
                    <div className="doc-page-body font-serif-pdf">
                      <h4 className="pdf-doc-title">
                        An interpreting machine learning models to predict amputation risk in patients with diabetic foot ulcers: a multi-center study
                      </h4>
                      <p className="pdf-authors">Haoran Tao, Lili You, Yuhan Huang, Yunxiang Chen...</p>
                      <p className="pdf-text-content">
                        <strong>Background:</strong> Diabetic foot ulcers (DFUs) constitute a significant complication... We developed five ML models...
                      </p>
                      <p className="pdf-text-content">
                        <strong>Introduction:</strong> ...characterized by a high mortality rate and{" "}
                        <mark className="pdf-highlight-mark">
                          contributing to approximately 85% of nontraumatic lower-extremity amputations (LEA) worldwide
                        </mark>
                        . Patients often perceive the risk of LEA as a more significant concern than mortality due to its profound impact...
                      </p>
                    </div>
                  </div>

                  {/* Right Column: Chat view with citation highlight badge */}
                  <div className="chat-side-split">
                    <div className="chat-msg ai-msg">
                      <div className="ai-avatar">AI</div>
                      <div className="msg-bubble-wrap">
                        <div className="msg-bubble">
                          The study notes that DFUs are a severe and prevalent complication,{" "}
                          <span className="highlight-text-cyan">
                            contributing to approximately 85% of nontraumatic lower-extremity amputations (LEA) worldwide
                            <span className="cit-badge">Page 1</span>
                          </span>
                          .
                        </div>
                        <div className="message-actions">
                          <button className="copy-button" disabled aria-label="Copy message">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                          </button>
                          <button className="thumb-button up" disabled aria-label="Helpful response">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                            </svg>
                          </button>
                          <button className="thumb-button down" disabled aria-label="Unhelpful response">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Slide 3: Flashcards - UI improved to match actual Flashcard.css design */}
            {activeStep === 3 && (
              <div className="sim-panel-flashcards fade-in-sim">
                <div className="flashcard-container sim-flashcard-box">
                  <div className="flashcard-header">
                    <h2>Flashcards</h2>
                  </div>
                  <div className="flashcard-progress">
                    <span>Card 1 of 4</span>
                  </div>
                  <div className="flashcard-study">
                    <div className="flashcard">
                      <div className={`flashcard-3d ${cardFlipped ? "flipped" : ""}`}>
                        <div className="card-face card-front">
                          <span className="card-badge">QUESTION</span>
                          <div className="card-content">
                            What percentage of nontraumatic lower-extremity amputations (LEA) globally are caused by DFUs?
                          </div>
                          <span className="flip-hint">Click to flip</span>
                        </div>
                        <div className="card-face card-back">
                          <span className="card-badge">ANSWER</span>
                          <div className="card-content">
                            Approximately 85% of nontraumatic LEAs worldwide are attributed to DFUs.
                          </div>
                          <span className="flip-hint">Auto-generated from Page 1</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Slide 4: Quiz - UI improved to match actual Quiz.css design */}
            {activeStep === 4 && (
              <div className="sim-panel-quiz fade-in-sim">
                <div className="quiz-container sim-quiz-box">
                  <div className="quiz-header">
                    <h2>Practice Quiz</h2>
                  </div>
                  <div className="quiz-progress">
                    <div className="progress-text">Question 1 of 5</div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: "20%" }}></div>
                    </div>
                  </div>
                  <div className="quiz-content">
                    <div className="question-card">
                      <div className="question-type-badge">Multiple Choice</div>
                      <h3 className="question-text">
                        According to the study, DFUs contribute to approximately what percentage of nontraumatic lower-extremity amputations (LEA) globally?
                      </h3>
                      
                      <div className="mcq-options">
                        <div className="mcq-option">
                          <span>A. 50% of nontraumatic amputations</span>
                        </div>
                        <div className={`mcq-option ${quizSelected === 'B' ? "correct" : ""}`}>
                          <span>B. 85% of nontraumatic amputations</span>
                          {quizSelected === 'B' && <span className="check-badge">✓ Correct</span>}
                        </div>
                        <div className="mcq-option">
                          <span>C. 70% of nontraumatic amputations</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </main>
        </div>
      </div>
    </div>
  );
};

export default SimulationSection;
