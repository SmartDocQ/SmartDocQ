import { useRef, useState, useEffect } from "react";
import { useReducedMotion } from "../../../hooks/useReducedMotion";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import "./BodySection.css";
import MobileBodySection from "./MobileBodySection";
import HowItWorksSection from "./HowItWorksSection";

/* ============================================================================
 * DATA DEFINITIONS
 * ============================================================================ */
const COMPARISON_ROWS = [
  { old: "Read hundreds of pages", new: "Ask one question" },
  { old: "Search manually", new: "Instant AI answers" },
  { old: "Write summaries", new: "One-click summaries" },
  { old: "Create study notes", new: "Instant Flashcards" },
  { old: "Design quizzes", new: "AI-generated quizzes" },
  { old: "Jump between documents", new: "One Searchable Workspace" }
];

const OUTCOME_CARDS = [
  {
    title: "Save Hours",
    desc: "Stop digging through documents. Find answers in seconds.",
    color: "#f59e0b",
    titleGradient: "linear-gradient(135deg, #ffffff 50%, #fcd34d 100%)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    )
  },
  {
    title: "Learn Faster",
    desc: "Understand complex reports, papers, and notes instantly.",
    color: "#a855f7",
    titleGradient: "linear-gradient(135deg, #ffffff 50%, #d8b4fe 100%)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    )
  },
  {
    title: "Stay Organized",
    desc: "Everything becomes searchable from one workspace.",
    color: "#0ea5e9",
    titleGradient: "linear-gradient(135deg, #ffffff 50%, #7dd3fc 100%)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    )
  },
  {
    title: "Citation-Backed Answers",
    desc: "Every response is grounded in your uploaded documents.",
    color: "#10b981",
    titleGradient: "linear-gradient(135deg, #ffffff 50%, #6ee7b7 100%)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    )
  },
  {
    title: "Works With Your Files",
    type: "files",
    pills: ["PDF", "DOCX", "TXT", "CSV", "XLSX"],
    color: "#6366f1",
    titleGradient: "linear-gradient(135deg, #ffffff 50%, #a5b4fc 100%)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    )
  },
  {
    title: "Built for Every Workflow",
    type: "audience",
    pills: ["Students", "Researchers", "Professionals", "Teams"],
    color: "#f43f5e",
    titleGradient: "linear-gradient(135deg, #ffffff 50%, #fda4af 100%)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    )
  }
];

/* ============================================================================
 * DESKTOP BODY SECTION COMPONENT
 * ============================================================================ */
function DesktopBodySection() {
  const sectionRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const element = sectionRef.current;
    if (!element) return;

    if (reduceMotion) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(element);
        }
      },
      { threshold: 0.05, rootMargin: "0px 0px -50px 0px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [reduceMotion]);

  return (
    <>
      <section className="why-choose-section" ref={sectionRef} aria-label="Why Choose SmartDocQ">
        {/* Responsive Grid Layout */}
        <div className={`why-choose-container ${isVisible ? "animate-in" : ""}`}>
          
          {/* Left Column: Workflow Comparison Panel */}
          <div className="workflow-comparison-panel">
            <div className="workflow-header">
              <span className="workflow-title traditional">Traditional Workflow</span>
              <span className="workflow-separator-line" />
              <span className="workflow-title smartdocq">SmartDocQ</span>
            </div>
            
            <div className="workflow-rows">
              {COMPARISON_ROWS.map((row, idx) => (
                <div 
                  key={idx} 
                  className="workflow-row" 
                  style={{ animationDelay: `${idx * 0.05}s` }}
                >
                  <div className="workflow-col traditional-col">
                    <span className="workflow-status-icon traditional-status">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </span>
                    <span className="workflow-text">{row.old}</span>
                  </div>
                  
                  <div className="workflow-connector" aria-hidden="true">
                    <svg width="20" height="12" viewBox="0 0 24 12" fill="none" className="workflow-connector-svg">
                      <path d="M2 6H22M22 6L16 1M22 6L16 11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  
                  <div className="workflow-col smartdocq-col">
                    <span className="workflow-status-icon smartdocq-status">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    <span className="workflow-text">{row.new}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Outcome Bento Grid */}
          <div className="outcome-grid">
            {OUTCOME_CARDS.map((card, idx) => (
              <div 
                key={idx} 
                className={`outcome-card ${card.type ? `card-type-${card.type}` : ""}`}
                style={{ 
                  '--theme-color': card.color,
                  '--theme-glow': `${card.color}06`,
                  '--theme-border-glow': `${card.color}18`,
                  '--title-gradient': card.titleGradient,
                  animationDelay: `${idx * 0.04}s`
                }}
              >
                {/* Micro Spotlight border glow */}
                <div className="card-backing-glow" aria-hidden="true" />
                <div className="card-border-glow" aria-hidden="true" />
                
                <div className="outcome-card-header">
                  <div className="outcome-icon" aria-hidden="true" style={{ color: card.color }}>
                    {card.icon}
                  </div>
                  <h3 className="outcome-title">{card.title}</h3>
                </div>
                
                {card.type === "files" ? (
                  <div className="outcome-badge-container">
                    {card.pills.map((pill) => (
                      <span key={pill} className="outcome-badge monospace-badge">
                        {pill}
                      </span>
                    ))}
                  </div>
                ) : card.type === "audience" ? (
                  <div className="outcome-badge-container">
                    {card.pills.map((pill) => (
                      <span key={pill} className="outcome-badge text-badge">
                        {pill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="outcome-desc">{card.desc}</p>
                )}
              </div>
            ))}
          </div>

        </div>
      </section>

      <HowItWorksSection />
    </>
  );
}

/* ============================================================================
 * BODY SECTION COMPONENT
 * ============================================================================ */
function BodySection() {
  const isMobile = useMediaQuery("(max-width: 768px)");

  return isMobile ? <MobileBodySection /> : <DesktopBodySection />;
}

export default BodySection;
