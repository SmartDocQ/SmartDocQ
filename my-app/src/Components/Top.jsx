import React, { useState, useEffect } from "react";
// Integrate with GSAP ScrollTrigger to avoid getting stuck on pinned sections
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { gsap } from "gsap";
gsap.registerPlugin(ScrollTrigger);
import "./Top.css";

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
      // Jump to the top (auto avoids conflicts with pinned scrub)
      window.scrollTo({ top: 0, behavior: "auto" });
      // Re-enable after a tick and refresh measurements
      setTimeout(() => {
        pins.forEach(st => st.enable());
        ScrollTrigger.refresh();
      }, 40);
    } catch (_) {
      // Fallback
      window.scrollTo({ top: 0, behavior: "auto" });
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
