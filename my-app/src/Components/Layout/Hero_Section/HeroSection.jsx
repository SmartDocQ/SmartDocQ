import { useRef, useLayoutEffect, useState, useEffect } from "react";
import "./HeroSection.css";
import "./HeroCard3D.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useNavigate } from "react-router-dom";
import FeatureCard from "./FeatureCard";
import { FEATURES } from "./featuresData";
import MobileHero from "./MobileHero";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { motion } from "framer-motion";

gsap.registerPlugin(ScrollTrigger);

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.03,
    }
  }
};

const charVariants = {
  hidden: { y: "100%", opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 140,
      damping: 12
    }
  }
};

const featureWords = [
  { text: "Why", isAccent: false },
  { text: "SmartDocQ", isAccent: true },
  { text: "Stands", isAccent: false },
  { text: "Out", isAccent: false }
];

const clarityWords = [
  { text: "From", isAccent: false },
  { text: "Chaos", isAccent: false },
  { text: "To", isAccent: false },
  { text: "Clarity", isAccent: true }
];

const HeroSection = () => {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const sectionRef = useRef(null);
  const containerRef = useRef(null);
  const navigate = useNavigate();
  const [reduceMotion, setReduceMotion] = useState(false);

  // Respect prefers-reduced-motion
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  // Horizontal scroll animation for desktop feature cards using gsap.context
  useLayoutEffect(() => {
    if (reduceMotion || isMobile) return;

    let ctx = gsap.context(() => {
      const container = containerRef.current;
      const section = sectionRef.current;
      if (!container || !section) return;

      const totalScroll = container.scrollWidth - section.clientWidth;
      if (totalScroll <= 0) return;

      gsap.fromTo(
        container,
        { x: 0 },
        {
          x: -totalScroll,
          ease: "none",
          scrollTrigger: {
            trigger: section,
            pin: true,
            scrub: 1.2, // Inertial lag for buttery smooth scrolling feel
            start: "top top",
            end: () => `+=${totalScroll}`,
            invalidateOnRefresh: true,
            anticipatePin: 1
          }
        }
      );
    });

    return () => {
      ctx.revert(); // Wipes and cleans up only this specific trigger and resets container positioning
    };
  }, [reduceMotion, isMobile]);

  const handleGetStarted = () => {
    const user = localStorage.getItem("user");
    if (user) {
      navigate("/upload");
    } else {
      window.dispatchEvent(new Event("unauthorized"));
    }
  };

  // On mobile — only MobileHero mounts
  if (isMobile) return <MobileHero />;

  return (
    /* ── Desktop only — GSAP + Exploded 3D Document Stack ── */
    <div className="desktop-only-hero">
      <section className="hero-section" aria-labelledby="hero-heading">
        <div className="hero-container">
          
          <div className="hero-left">
            <div className="badge">
              <span className="badge-spark">✦</span>
              <span>AI Document Assistant</span>
            </div>
            <h1 id="hero-heading" className="hero-heading">
              Your documents.<br />
              <span className="gradient-text">Now you can talk to them.</span>
            </h1>
            <p className="hero-description">
              Upload PDFs, Word files, spreadsheets, and text. Ask questions, get grounded answers with instant citations, and turn complex documents into summaries, quizzes, and flashcards.
            </p>
            <button type="button" className="get-started-btn" onClick={handleGetStarted}>
              Get Started <span className="btn-arrow">→</span>
            </button>
          </div>

          <div className="hero-right" aria-hidden="true">
            <div className="hero-3d-scene">
              <div className="hero-3d-stack">

                {/* Layer 3: Grounded Answer & Source Citations (Top Layer) */}
                <div className="stack-layer layer-top">
                  <div className="layer-glass-card border-cyan">
                    <div className="card-header">
                      <div className="file-header-meta">
                        <span className="file-icon-badge pdf-type">PDF</span>
                        <span className="header-filename">Q3_Financial_Analysis.pdf</span>
                      </div>
                      <div className="header-status">
                        <span className="status-dot cyan-pulse" />
                        <span className="status-label">Active Document</span>
                      </div>
                    </div>
                    <div className="card-body">
                      <div className="insight-bubble">
                        <div className="bubble-header">
                          <span className="bubble-category">AI Chat Answer</span>
                          <span className="citation-pill">Source: p. 14 · Sec 3.2</span>
                        </div>
                        <div className="chat-query">Q: What are the primary growth drivers?</div>
                        <div className="chat-answer">➔ Enterprise ARR grew +38% YoY, led by cloud migrations and automation.</div>
                      </div>
                    </div>
                    <div className="card-footer">
                      <span className="footer-metric">✦ 100% Grounded Answer</span>
                      <div className="card-quick-actions">
                        <span className="action-pill">Summary</span>
                        <span className="action-pill">Quiz</span>
                        <span className="action-pill">Flashcards</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Layer 2: Source Context Selection (Middle Layer) */}
                <div className="stack-layer layer-middle">
                  <div className="layer-glass-card border-purple">
                    <div className="card-header">
                      <div className="file-header-meta">
                        <span className="file-icon-badge docx-type">DOCX</span>
                        <span className="header-filename">Research_Paper_v2.docx</span>
                      </div>
                      <div className="header-status">
                        <span className="status-dot purple-pulse" />
                        <span className="status-label">Citation Context</span>
                      </div>
                    </div>
                    <div className="card-body source-context-zone">
                      <div className="highlighted-excerpt">
                        <span className="highlight-tag">Cited Excerpt</span>
                        <p className="excerpt-text">
                          "...revenue expansion was primarily accelerated by enterprise contract renewals and cross-segment adoption..."
                        </p>
                      </div>
                    </div>
                    <div className="card-footer">
                      <span className="footer-metric">Verified Source Excerpt</span>
                      <span className="footer-metric">Exact Match</span>
                    </div>
                  </div>
                </div>

                {/* Layer 1: Workspace Ingest Surface (Base Layer) */}
                <div className="stack-layer layer-base">
                  <div className="layer-glass-card border-grey">
                    <div className="card-header">
                      <span className="header-filename">Supported Workspace Formats</span>
                      <div className="header-status">
                        <span className="status-dot grey-pulse" />
                        <span className="status-label">Secure Ingest</span>
                      </div>
                    </div>
                    <div className="card-body format-badges-zone">
                      <div className="format-tokens">
                        <span className="fmt-token pdf">PDF</span>
                        <span className="fmt-token docx">DOCX</span>
                        <span className="fmt-token xlsx">XLSX</span>
                        <span className="fmt-token csv">CSV</span>
                        <span className="fmt-token txt">TXT</span>
                      </div>
                    </div>
                    <div className="card-footer">
                      <span className="footer-metric">Private & Encrypted</span>
                      <span className="footer-metric">Zero Model Training</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="premium-header-wrap" style={{ marginTop: "-16px" }}>
        <span className="section-meta-badge">01 // CAPABILITIES</span>
        <h2 id="feat" className="premium-section-header">
          Make Every Document <span className="premium-accent-word">More Useful.</span>
        </h2>
        <div className="premium-header-line-container">
          <div className="premium-header-line" />
          <span className="sparkle-dot">✦</span>
          <div className="premium-header-line" />
        </div>
      </div>

      <section className="features-section" ref={sectionRef} aria-label="Product features">
        <div className="features-container" ref={containerRef} role="list">
          {FEATURES.map((f, idx) => (
            <FeatureCard
              key={f.title}
              index={idx}
              tag={f.tag}
              title={f.title}
              desc={f.desc}
              anim={f.anim}
              reduceMotion={reduceMotion}
            />
          ))}
        </div>
        <div className="premium-header-wrap" style={{ marginTop: "-60px", marginBottom: "20px" }}>
          <span className="section-meta-badge">02 // TRANSFORMATION</span>
          <h2 className="premium-section-header">
            From Chaos To <span className="standard-accent-word">Clarity</span>
          </h2>
          <div className="premium-header-line-container">
            <div className="premium-header-line" />
            <span className="sparkle-dot">✦</span>
            <div className="premium-header-line" />
          </div>
        </div>
      </section>
    </div>
  );
};

export default HeroSection;