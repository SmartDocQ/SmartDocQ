import React, { useState, useEffect } from "react";
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
