import React, { useState, useEffect } from "react";
import "./Top.css";
// Integrate with GSAP ScrollTrigger to avoid getting stuck on pinned sections
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { gsap } from "gsap";
gsap.registerPlugin(ScrollTrigger);

export default function Top() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      setVisible(window.scrollY > 200);
    };
    window.addEventListener("scroll", toggleVisibility);
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  const scrollToTop = () => {
    try {
      // Temporarily disable pinned ScrollTriggers (e.g., Features horizontal section)
      const pins = ScrollTrigger.getAll().filter(st => !!st.pin);
      pins.forEach(st => st.disable());

      // After layout recalculates, perform a smooth scroll to the very top
      const cleanup = () => {
        window.removeEventListener("scroll", handleScroll);
        pins.forEach(st => st.enable());
        ScrollTrigger.refresh();
        clearTimeout(fallbackTimer);
      };

      const handleScroll = () => {
        if (window.scrollY <= 0) {
          cleanup();
        }
      };

      window.addEventListener("scroll", handleScroll, { passive: true });

      // Fallback: ensure we re-enable pins even if the browser interrupts smooth scroll
      const fallbackTimer = setTimeout(() => cleanup(), 1800);

      // Use rAF to ensure DOM has applied pin disable before starting smooth scroll
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    } catch (_) {
      // Fallback
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <button
      type="button"
      aria-label="Back to top"
      title="Back to Top"
      className={`scroll-to-top ${visible ? "show" : ""}`}
      onClick={scrollToTop}
    >
      ⇧
      <span className="tooltip">Back to Top</span>
    </button>
  );
}
