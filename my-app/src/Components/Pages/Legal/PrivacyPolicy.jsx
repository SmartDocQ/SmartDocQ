import React, { useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import "./PrivacyPolicy.css";

export default function PrivacyPolicy() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = "Privacy Policy - SmartDocQ";
  }, []);

  useEffect(() => {
    if (location.hash) {
      const el = document.querySelector(location.hash);
      if (el) {
        setTimeout(() => {
          const y = el.getBoundingClientRect().top + window.pageYOffset - 100;
          window.scrollTo({ top: y, behavior: "smooth" });
        }, 100);
      }
    }
  }, [location]);

  return (
    <main className="privacy-page" aria-label="Privacy Policy Page">
      <div className="leg-glow-bg" aria-hidden="true" />
      <div className="privacy-container">
        <header id="top" className="privacy-hero">
          <nav className="legal-breadcrumb" style={{ marginBottom: "16px", fontSize: "0.9rem", color: "rgba(255,255,255,0.7)" }}>
            <Link to="/" style={{ color: "#00f2fe", textDecoration: "none" }}>← Home</Link>
            <span style={{ margin: "0 8px", opacity: 0.5 }}>|</span>
            <Link to="/help" style={{ color: "#00f2fe", textDecoration: "none" }}>Help Center</Link>
          </nav>
          <h1>Privacy Policy</h1>
          <p className="privacy-subtitle">Effective Date: June 14, 2026</p>
          <div className="privacy-hero-divider"></div>
        </header>

        <div className="privacy-layout">
          {/* Policy Document Content */}
          <div className="privacy-content">
            <section id="section-1" className="privacy-section" aria-labelledby="title-section-1">
              <h2 id="title-section-1">1. Introduction</h2>
              <p>
                SmartDocQ ("we," "us," or "our") is an AI-powered document assistant that enables 
                users to upload documents and interact with them through intelligent search, 
                question-answering, and study tool generation. This Privacy Policy explains how 
                we collect, use, disclose, and safeguard your information when you use our service.
              </p>
              <p>
                By accessing or using SmartDocQ, you consent to the practices described in this 
                policy. If you do not agree, please discontinue use immediately.
              </p>
            </section>

            <section id="section-2" className="privacy-section" aria-labelledby="title-section-2">
              <h2 id="title-section-2">2. Information We Collect</h2>
              
              <h3 id="subtitle-2-1">2.1 Account Information</h3>
              <ul>
                <li>Name, email address, and encrypted password (for local authentication)</li>
                <li>Google account identifier (if using Google Sign-In)</li>
                <li>Profile avatar (stored via Cloudinary)</li>
                <li>Account creation date and last login timestamp</li>
              </ul>

              <h3 id="subtitle-2-2">2.2 Document Data</h3>
              <ul>
                <li>Files you upload (PDF, DOC, DOCX, TXT, CSV, and XLSX formats)</li>
                <li>Extracted text content for AI processing</li>
                <li>Vector embeddings generated for semantic search</li>
                <li>Document metadata (filename, size, upload date, processing status)</li>
              </ul>

              <h3 id="subtitle-2-3">2.3 Usage Data</h3>
              <ul>
                <li>Chat conversations and Q&A history associated with documents</li>
                <li>Generated content (quizzes, flashcards, summaries)</li>
                <li>Feature usage patterns and interaction timestamps</li>
                <li>Technical logs for system reliability and error diagnostics</li>
              </ul>
            </section>

            <section id="section-3" className="privacy-section" aria-labelledby="title-section-3">
              <h2 id="title-section-3">3. How We Use Your Information</h2>
              <ul>
                <li><strong>Service Delivery:</strong> Process documents, generate AI responses, create study materials, and enable document search functionality</li>
                <li><strong>Account Management:</strong> Authenticate users, manage sessions, and personalize your experience</li>
                <li><strong>Service Improvement:</strong> Analyze usage patterns, diagnose technical issues, and enhance features</li>
                <li><strong>Security:</strong> Detect fraud, prevent abuse, enforce rate limits, and protect against unauthorized access</li>
                <li><strong>Legal Compliance:</strong> Comply with applicable laws, regulations, and legal processes</li>
              </ul>
              <p className="highlight-box">
                <strong>We do not sell your personal data.</strong> We do not use your documents 
                to train AI models. Your content is processed solely to provide the requested service features.
              </p>
            </section>

            <section id="section-4" className="privacy-section" aria-labelledby="title-section-4">
              <h2 id="title-section-4">4. Data Storage and Security</h2>
              
              <h3 id="subtitle-4-1">4.1 Storage Infrastructure</h3>
              <ul>
                <li><strong>Primary Database:</strong> MongoDB Atlas (cloud-hosted) for user accounts, documents, and chat history</li>
                <li><strong>Vector Database:</strong> ChromaDB for document embeddings enabling semantic search</li>
                <li><strong>Media Storage:</strong> Cloudinary for user avatars</li>
                <li><strong>Session Management:</strong> JWT tokens stored in secure httpOnly cookies</li>
              </ul>

              <h3 id="subtitle-4-2">4.2 Security Measures</h3>
              <ul>
                <li>HTTPS/TLS encryption for all data in transit</li>
                <li>Password hashing using bcrypt with secure salt rounds</li>
                <li>JWT-based authentication with token expiration</li>
                <li>Rate limiting to prevent brute-force attacks</li>
                <li>Input validation and file type verification</li>
              </ul>
            </section>

            <section id="section-5" className="privacy-section" aria-labelledby="title-section-5">
              <h2 id="title-section-5">5. Third-Party Services</h2>
              <p>We integrate with the following third-party services to provide functionality:</p>
              <ul>
                <li><strong>Google Gemini API:</strong> Processes document content to provide AI-powered responses, summaries, quizzes, flashcards, and related features.</li>
                <li><strong>Google Workspace (Gmail SMTP):</strong> Sends transactional emails such as password reset requests, verification messages, and account-related notifications.</li>
                <li><strong>Google OAuth:</strong> Provides optional single sign-on authentication</li>
                <li><strong>Cloudinary:</strong> Hosts user profile images</li>
                <li><strong>MongoDB Atlas:</strong> Cloud database infrastructure</li>
              </ul>
              <p>
                We configure third-party AI services to minimize data retention and disable training 
                on user content where such controls are available.
              </p>
            </section>

            <section id="section-6" className="privacy-section" aria-labelledby="title-section-6">
              <h2 id="title-section-6">6. Data Retention and Deletion</h2>
              <ul>
                <li><strong>Active Accounts:</strong> Data is retained while your account remains active</li>
                <li><strong>Document Deletion:</strong> When you delete a document, the file, extracted text, embeddings, and associated chat history are permanently removed</li>
                <li><strong>Account Deletion:</strong> You may request account deletion through the <Link to="/help">Help Center</Link> or available account management tools.</li>
                <li><strong>System Logs:</strong> Technical logs are retained for up to 90 days for debugging and security purposes, then automatically purged</li>
              </ul>
            </section>

            <section id="section-7" className="privacy-section" aria-labelledby="title-section-7">
              <h2 id="title-section-7">7. Your Rights and Choices</h2>
              <p>You have the following rights regarding your personal data:</p>
              <ul>
                <li><strong>Access:</strong> View your documents, chat history, and account information at any time</li>
                <li><strong>Correction:</strong> Update your profile information through Account settings</li>
                <li><strong>Deletion:</strong> Delete individual documents, chat histories, or request full account deletion</li>
                <li><strong>Export:</strong> Download your uploaded documents from the History panel</li>
                <li><strong>Withdraw Consent:</strong> Stop using the service at any time; delete your account to remove stored data</li>
              </ul>
            </section>

            <section id="section-8" className="privacy-section" aria-labelledby="title-section-8">
              <h2 id="title-section-8">8. Children's Privacy</h2>
              <p>
                SmartDocQ is not intended for children under the age required by applicable laws in their jurisdiction, including 13 years in the United States. We do not knowingly collect personal information from children under this age limit. If we discover that a child under the required age has provided personal information, we will promptly delete such data.
              </p>
            </section>

            <section id="section-9" className="privacy-section" aria-labelledby="title-section-9">
              <h2 id="title-section-9">9. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy periodically to reflect changes in our practices, 
                technologies, legal requirements, or other factors. We will notify you of material 
                changes by posting a prominent notice on our service. Your continued use after such 
                changes constitutes acceptance of the updated policy.
              </p>
            </section>

            <section id="section-10" className="privacy-section" aria-labelledby="title-section-10">
              <h2 id="title-section-10">10. International Data Transfers</h2>
              <p>
                Your information may be processed and stored on cloud infrastructure
                operated by our service providers. By using SmartDocQ, you acknowledge
                that your data may be transferred to and processed in jurisdictions
                outside your country of residence.
              </p>
            </section>

            <section id="section-11" className="privacy-section" aria-labelledby="title-section-11">
              <h2 id="title-section-11">11. AI-Generated Content Disclaimer</h2>
              <p>
                Responses, summaries, quizzes, flashcards, and other AI-generated
                outputs may contain inaccuracies. Users should independently verify
                important information before relying on it for academic, professional,
                legal, medical, financial, or other critical decisions.
              </p>
            </section>

            <section id="section-12" className="privacy-section" aria-labelledby="title-section-12">
              <h2 id="title-section-12">12. Cookies and Authentication</h2>
              <p>
                SmartDocQ uses essential cookies to maintain authenticated user
                sessions and provide core functionality. These cookies are required
                for the service to operate and cannot be disabled while using the
                platform.
              </p>
            </section>

            <section id="section-13" className="privacy-section" aria-labelledby="title-section-13">
              <h2 id="title-section-13">13. Contact Us</h2>
              <p>
                For questions, concerns, or requests regarding this Privacy Policy or your personal 
                data, please contact us through the Contact form accessible from your dashboard or 
                visit the <Link to="/help">Help Center</Link>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
