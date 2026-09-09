import { useRef, useState, useEffect } from "react";
import Lottie from "lottie-react";

const FeatureCard = ({ index, tag, title, desc, anim, reduceMotion }) => {
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

  const defaultTags = [
    "01 // UPLOAD",
    "02 // ASK",
    "03 // SUMMARIZE",
    "04 // STUDY",
    "05 // REMEMBER",
    "06 // IMPROVE",
    "07 // ORGANIZE",
    "08 // PROTECT"
  ];
  const cardTag = tag || defaultTags[index] || `0${index + 1} // MODULE`;

  return (
    <article 
      className="box" 
      ref={cardRef} 
      role="listitem"
      onMouseMove={handleMouseMove}
    >
      <div className="glass">
        {/* Spotlight background glow */}
        <div className="spotlight" aria-hidden="true" />
        
        {/* Monospace Metadata Tag */}
        <div className="card-tag">{cardTag}</div>

        {/* Product UI visual container for Lottie graphic */}
        <div className="feature-console-window" aria-hidden="true">
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