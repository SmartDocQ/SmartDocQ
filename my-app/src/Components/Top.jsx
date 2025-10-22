import React, { useState, useEffect } from "react";
import "./Top.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

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
      // Smoothly scroll through all sections; keep pins enabled so horizontal section scrubs back
      gsap.to(window, {
        duration: 1.4,
        scrollTo: { y: 0, autoKill: true },
        ease: "power2.out",
      });
    } catch (_) {
      // Fallback to native smooth scroll
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
