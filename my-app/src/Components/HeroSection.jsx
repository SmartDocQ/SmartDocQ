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
import f8 from "../Animations/f8.json";
import f9 from "../Animations/f9.json";
import f10 from "../Animations/f10.json";
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
    const disableAnim =
      reduceMotion ||
      window.innerWidth <= 768 ||
      container.scrollWidth <= section.clientWidth;
    if (disableAnim) return;

    // Match scroll distance to the actual horizontal overflow to avoid "stuck" at the end
    const getDistance = () => Math.max(0, container.scrollWidth - section.clientWidth);
    let distance = getDistance();
    if (distance === 0) return; // nothing to scroll

    const tween = gsap.to(container, {
      x: () => -getDistance() + "px",
      ease: "none",
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: () => "+=" + getDistance(),
        scrub: true,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });

    const handleResize = () => {
      distance = getDistance();
      ScrollTrigger.refresh();
    };
    window.addEventListener("resize", handleResize);

    // Observe container/content size changes (e.g., when adding more feature cards)
    const ro = new ResizeObserver(() => {
      distance = getDistance();
      ScrollTrigger.refresh();
    });
    ro.observe(container);

    return () => {
      if (tween) {
        tween.scrollTrigger?.kill();
        tween.kill();
      }
      window.removeEventListener("resize", handleResize);
      ro.disconnect();
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
  {
    title: "Seamless Document Upload",
    desc: "Upload files directly from your device or through secure URLs. SmartDocQ supports PDF, DOCX, and TXT formats with real-time document preview, quick processing, and smooth organization for instant access.",
    anim: f1
  },
  {
    title: "Smart Question Answering",
    desc: "Simply ask your questions in plain language and get precise, context-aware answers drawn from your documents. SmartDocQ delivers accurate, meaningful responses in seconds using advanced AI understanding.",
    anim: f2
  },
  {
    title: "Auto Question & Quiz Generation",
    desc: "Turn your documents into interactive learning experiences. SmartDocQ automatically generates MCQs, True/False, and short-answer questions with progress tracking, instant feedback, and detailed scoring.",
    anim: f3
  },
  {
    title: "Context-Aware Personalization",
    desc: "Every session becomes smarter. SmartDocQ remembers your previous chats, understands context, and provides personalized follow-up answers for a natural, connected conversation flow.",
    anim: f4
  },
  {
    title: "Interactive Feedback System",
    desc: "Your opinions matter. Instantly rate answers, provide feedback, and help SmartDocQ evolve with more accurate and refined responses over time.",
    anim: f5
  },
  {
    title: "Session & Document History",
    desc: "Stay organized with complete access to your uploaded files and chat sessions. View, rename, delete, or export data anytime — everything neatly tracked with timestamps and file details.",
    anim: f6
  },
  {
    title: "Multi-Format & Web Support",
    desc: "SmartDocQ adapts to your workflow by supporting multiple file types — PDF, DOCX, TXT, and web pages — ensuring flexibility for any use case or document source.",
    anim: f7
  },
  {
    title: "Advanced Security & Protection",
    desc: "Your privacy is our priority. SmartDocQ validates every upload and chat, blocks harmful input, filters profanity, and detects spam — keeping your workspace safe and professional.",
    anim: f8
  },
  {
    title: "Admin Dashboard & Monitoring",
    desc: "A powerful admin panel lets you manage users, track document processing, monitor system activity, and review usage statistics — all in one intuitive interface.",
    anim:f9
  },
  {
    title: "Smart Document Management",
    desc: "Manage multiple documents effortlessly. Rename, delete, or clear chats with confirmation, and export conversations or summaries in just a few clicks.",
    anim:f10
  }];

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
