import { useRef, useLayoutEffect, useState, useEffect } from "react";
import "./HeroSection.css";
import Lottie from "lottie-react";
import aiAnimation from "../Animations/2.json";
import gemini from "../Animations/Gemini.json";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import f1 from "../Animations/f1.json";
import f2 from "../Animations/f2.json";
import f3 from "../Animations/f3.json";
import f4 from "../Animations/f4.json";
import f5 from "../Animations/f5.json";
import f6 from "../Animations/f6.json";
import f7 from "../Animations/f7.json";
import { useNavigate } from "react-router-dom";
import { useToast } from "./ToastContext";

gsap.registerPlugin(ScrollTrigger);

const HeroSection = () => {
  const sectionRef = useRef(null);
  const containerRef = useRef(null);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [isMounted, setIsMounted] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Wait until component is mounted to prevent refresh errors
  useEffect(() => setIsMounted(true), []);

  // Respect reduced motion preference
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(!!media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  // GSAP horizontal scroll
  useLayoutEffect(() => {
    if (!isMounted || !sectionRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const section = sectionRef.current;

    // Disable GSAP horizontal scroll on small screens or when reduced motion is preferred
    const disableAnim = reduceMotion || window.innerWidth <= 768 || container.scrollWidth <= window.innerWidth;
    if (disableAnim) return;

    const tween = gsap.to(container, {
      x: () => -(container.scrollWidth - window.innerWidth) + "px",
      ease: "none",
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: () => "+=" + container.scrollWidth,
        scrub: true,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });

    const handleResize = () => ScrollTrigger.refresh();
    window.addEventListener("resize", handleResize);

    return () => {
      if (tween) {
        tween.scrollTrigger?.kill();
        tween.kill();
      }
      window.removeEventListener("resize", handleResize);
    };
  }, [isMounted, reduceMotion]);

  const handleGetStarted = () => {
    const token = localStorage.getItem("token"); // check if logged in
    if (token) {
      navigate("/upload");
    } else {
      showToast("Please log in to get started!", { type: "error" });
    }
  };

  const features = [
    { title: "Seamless Document Upload", desc: "Upload your PDFs, Word files, or text documents in seconds. SmartDocQ automatically reads, organizes, and prepares them for AI processing — so you can search and analyze instantly without any manual effort.", anim: f1 },
    { title: "Smart Question Answering", desc: "Ask any question in plain language, and SmartDocQ quickly finds relevant document sections. Advanced AI generates accurate, context-aware answers instantly.", anim: f2 },
    { title: "Context-Aware Personalization", desc: "SmartDocQ remembers your previous interactions to provide follow-up answers that are tailored and relevant. Enjoy a smarter, more personalized AI experience every time.", anim: f3 },
    { title: "Interactive Feedback", desc: "Rate answers instantly and help SmartDocQ improve over time. Your feedback ensures more accurate and reliable responses in future sessions.", anim: f4 },
    { title: "Session History", desc: "SmartDocQ keeps a record of all your past questions and answers. Easily revisit previous sessions to review or continue your work seamlessly.", anim: f5 },
    { title: "Robust Security", desc: "All uploads and queries are validated and sanitized to keep your data safe. SmartDocQ protects against attacks and ensures a secure, worry-free experience.", anim: f6 },
    { title: "Export & Share Results", desc: "Quickly save answers, summaries, or insights as PDF or DOCX. Share your findings effortlessly with just a few clicks.", anim: f7 }
  ];

  return (
    <>
      <section className="hero-section">
        <div className="hero-container">
          <div className="hero-left">
            <div className="badge">
              <span>Powered by</span>
              <Lottie animationData={gemini} loop autoplay className="gemini-icon" />
            </div>
            <h1 className="hero-heading">
              Transform Your <br />
              <span className="gradient-text">Documents</span> with AI
            </h1>
            <p className="hero-description">
              SmartDocQ is an AI-powered assistant that helps you intelligently search, analyze, and extract insights from your documents — instantly and effortlessly.
              <br />Powered by Gemini AI, SmartDocQ brings the future of document automation to your fingertips — smart, secure, and easy to use.
            </p>
            <button className="get-started-btn" onClick={handleGetStarted}>
              Get Started →
            </button>
          </div>
          <div className="hero-right">
            <Lottie animationData={aiAnimation} loop className="hero-lottie" />
          </div>
        </div>
      </section>

      <h2 id="feat" className="feature-title">Features That Set Us Apart</h2>

      <section className="features-section" ref={sectionRef}>
        <div className="features-container" ref={containerRef}>
          {features.map((f) => (
            <div className="box" key={f.title}>
              <div className="glass">
                {isMounted && <Lottie animationData={f.anim} loop style={{ height: 150, width: 150, margin: "0 auto" }} />}
                <div className="content">
                  <h2>{f.title}</h2>
                  <p>{f.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <h2 className="use-title">How SmartDocQ Transforms Your Docs</h2>
      </section>
    </>
  );
};

export default HeroSection;
