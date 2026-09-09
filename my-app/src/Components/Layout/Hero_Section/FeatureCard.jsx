import { useRef, useState, useEffect } from "react";
import Lottie from "lottie-react";

const FeatureCard = ({ index, title, desc, anim, reduceMotion }) => {
  const cardRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(element);
        }
      },
      { threshold: 0.1, rootMargin: "50px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleMouseMove = (e) => {
    if (reduceMotion) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty("--mouse-x", `${x}px`);
    card.style.setProperty("--mouse-y", `${y}px`);
  };

  const tags = [
    "01 // Ingestion Engine",
    "02 // Context Synthesis",
    "03 // Document Summaries",
    "04 // Practice Sandbox",
    "05 // Chat Session Memory",
    "06 // Alignment Loop",
    "07 // File Workspace",
    "08 // Data Security"
  ];
  const currentTag = tags[index] || `0${index + 1} // Module`;

  return (
    <article 
      className="box" 
      ref={cardRef} 
      onMouseMove={handleMouseMove}
    >
      <div className="glass">
        {/* Spotlight background glow */}
        <div className="spotlight" aria-hidden="true" />
        
        {/* Monospace Metadata Tag */}
        <div className="card-tag">{currentTag}</div>

        {/* Premium console wrapper for the Lottie graphic */}
        <div className="feature-console-window" aria-hidden="true">
          <div className="console-titlebar">
            <div className="console-dots">
              <span className="console-dot active" />
              <span className="console-dot" />
              <span className="console-dot" />
            </div>
            <span className="console-label">diagnostics.log</span>
          </div>
          <div className="console-body">
            {isVisible && (
              <Lottie
                animationData={anim}
                loop={!reduceMotion}
                autoplay={!reduceMotion}
                className="feature-lottie"
              />
            )}
          </div>
        </div>

        <div className="content">
          <h3>{title}</h3>
          <p>{desc}</p>
        </div>
      </div>
    </article>
  );
};

export default FeatureCard;