import React, { useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import "./TermsOfService.css";

export default function TermsOfService() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = "Terms of Service - SmartDocQ";
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
    <main className="terms-page" aria-label="Terms of Service Page">
      <div className="leg-glow-bg" aria-hidden="true" />
      <div className="terms-container">
        <header id="top" className="terms-hero">
          <nav className="legal-breadcrumb" style={{ marginBottom: "16px", fontSize: "0.9rem", color: "rgba(255,255,255,0.7)" }}>
            <Link to="/" style={{ color: "#00f2fe", textDecoration: "none" }}>← Home</Link>
            <span style={{ margin: "0 8px", opacity: 0.5 }}>|</span>
            <Link to="/help" style={{ color: "#00f2fe", textDecoration: "none" }}>Help Center</Link>
          </nav>
          <h1>Terms of Service</h1>
          <p className="terms-subtitle">Effective Date: June 14, 2026</p>
          <div className="terms-hero-divider"></div>
        </header>

        <div className="terms-layout">
          {/* Policy Document Content */}
          <div className="terms-content">
            <section id="section-1" className="terms-section" aria-labelledby="title-section-1">
              <h2 id="title-section-1">1. Acceptance of Terms</h2>
              <p>
                Welcome to SmartDocQ. These Terms of Service ("Terms") constitute a legally binding 
                agreement between you ("User," "you," or "your") and SmartDocQ ("we," "us," or "our"). 
                By accessing or using SmartDocQ, you acknowledge that you have read, understood, and 
                agree to be bound by these Terms and our Privacy Policy.
              </p>
              <p>
                If you are using SmartDocQ on behalf of an organization, you represent and warrant 
                that you have authority to bind that organization to these Terms.
              </p>
            </section>

            <section id="section-2" className="terms-section" aria-labelledby="title-section-2">
              <h2 id="title-section-2">2. Description of Service</h2>
              <p>
                SmartDocQ is an AI-powered document assistant that allows you to:
              </p>
              <ul>
                <li>Upload and store documents (PDF, DOCX, TXT formats)</li>
                <li>Search document content using natural language queries</li>
                <li>Ask questions and receive AI-generated answers based on your documents</li>
                <li>Generate study materials including quizzes, flashcards, and summaries</li>
                <li>Share document conversations via secure, expiring links</li>
              </ul>
            </section>

            <section id="section-3" className="terms-section" aria-labelledby="title-section-3">
              <h2 id="title-section-3">3. User Content and License Grant</h2>
              <ul>
                <li>
                  <strong>Ownership:</strong> You retain full ownership of all documents, text, and 
                  other content you upload to SmartDocQ ("User Content").
                </li>
                <li>
                  <strong>License to Us:</strong> By uploading User Content, you grant SmartDocQ a 
                  limited, non-exclusive, worldwide license to store, process, analyze, and transform 
                  your content solely for the purpose of providing the service features you request.
                </li>
                <li>
                  <strong>Derived Data:</strong> This license includes the right to create necessary 
                  derived data such as text extractions, vector embeddings, and cached previews required 
                  for search, Q&A, and study tool functionality.
                </li>
                <li>
                  <strong>No Training:</strong> We do not use your User Content to train AI models. 
                  Your documents are processed only to deliver the services you request.
                </li>
              </ul>
            </section>

            <section id="section-4" className="terms-section" aria-labelledby="title-section-4">
              <h2 id="title-section-4">4. Account Registration and Security</h2>
              <ul>
                <li>
                  <strong>Account Creation:</strong> You must provide accurate and complete information 
                  when creating an account. You may register using email/password or Google Sign-In.
                </li>
                <li>
                  <strong>Account Security:</strong> You are responsible for maintaining the confidentiality 
                  of your account credentials and for all activities that occur under your account.
                </li>
                <li>
                  <strong>Unauthorized Access:</strong> You must notify us immediately of any unauthorized 
                  access to or use of your account.
                </li>
                <li>
                  <strong>Age Requirement:</strong> You must be at least 13 years old to create an account 
                  and use SmartDocQ.
                </li>
              </ul>
            </section>

            <section id="section-5" className="terms-section" aria-labelledby="title-section-5">
              <h2 id="title-section-5">5. Acceptable Use Policy</h2>
              <p>You agree NOT to use SmartDocQ to:</p>
              <ul>
                <li>Upload, store, or transmit any content that is illegal, harmful, threatening, abusive, 
                  defamatory, or otherwise objectionable</li>
                <li>Upload content that infringes upon intellectual property rights, privacy rights, or 
                  other rights of any third party</li>
                <li>Upload malware, viruses, or any code designed to disrupt or damage the service</li>
                <li>Attempt to gain unauthorized access to other users' accounts or data</li>
                <li>Circumvent, disable, or interfere with security features or rate limits</li>
                <li>Use automated means (bots, scrapers) to access the service without permission</li>
                <li>Generate content that promotes violence, discrimination, or illegal activities</li>
                <li>Impersonate any person or entity or misrepresent your affiliation</li>
              </ul>
              <p className="highlight-box">
                Violation of this policy may result in immediate account suspension or termination.
              </p>
            </section>

            <section id="section-6" className="terms-section" aria-labelledby="title-section-6">
              <h2 id="title-section-6">6. AI-Generated Content</h2>
              <p>
                SmartDocQ uses artificial intelligence to generate responses, summaries, quizzes, 
                and flashcards. AI-generated content may contain errors or inaccuracies. You should 
                independently verify information before relying on it. AI outputs do not constitute 
                professional advice.
              </p>
            </section>

            <section id="section-7" className="terms-section" aria-labelledby="title-section-7">
              <h2 id="title-section-7">7. Service Availability</h2>
              <ul>
                <li>We strive to maintain reliable service but do not guarantee uninterrupted access.</li>
                <li>We reserve the right to modify or discontinue features with reasonable notice.</li>
                <li><strong>Beta / Experimental Features:</strong> Certain features may be experimental and may change, be suspended, or be discontinued without notice.</li>
              </ul>
            </section>

            <section id="section-8" className="terms-section" aria-labelledby="title-section-8">
              <h2 id="title-section-8">8. Data and Termination</h2>
              <ul>
                <li>You may delete documents, chat histories, and your account at any time.</li>
                <li>We may suspend or terminate accounts that violate these Terms.</li>
                <li>Upon termination, your data will be deleted per our Privacy Policy.</li>
                <li><strong>No Guarantee of Data Preservation:</strong> Users are responsible for maintaining backups of important documents. SmartDocQ does not guarantee permanent storage or recovery of uploaded content.</li>
              </ul>
            </section>

            <section id="section-9" className="terms-section" aria-labelledby="title-section-9">
              <h2 id="title-section-9">9. Intellectual Property</h2>
              <ul>
                <li>
                  The SmartDocQ platform, including its code, design, branding, and documentation, 
                  is owned by SmartDocQ and its licensors. These Terms do not transfer any 
                  intellectual property rights to you.
                </li>
                <li>
                  You retain ownership of your User Content. We claim no ownership over 
                  documents you upload.
                </li>
              </ul>
            </section>

            <section id="section-10" className="terms-section" aria-labelledby="title-section-10">
              <h2 id="title-section-10">10. Disclaimers and Limitation of Liability</h2>
              <ul>
                <li>
                  THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY 
                  KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF 
                  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
                </li>
                <li>
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW, SMARTDOCQ SHALL NOT BE LIABLE FOR ANY 
                  INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING 
                  LOSS OF DATA, PROFITS, OR BUSINESS OPPORTUNITIES.
                </li>
                <li>
                  Our total liability for any claims arising from your use of the service shall 
                  not exceed the amount you paid us, if any, in the twelve months preceding the claim.
                </li>
              </ul>
            </section>

            <section id="section-11" className="terms-section" aria-labelledby="title-section-11">
              <h2 id="title-section-11">11. Changes to These Terms</h2>
              <p>
                We may update these Terms periodically. We will notify you of material changes 
                by posting a notice on the service or sending you an email. Your continued use 
                of SmartDocQ after changes become effective constitutes acceptance of the revised Terms.
              </p>
            </section>

            <section id="section-12" className="terms-section" aria-labelledby="title-section-12">
              <h2 id="title-section-12">12. General Provisions</h2>
              <ul>
                <li>
                  <strong>Entire Agreement:</strong> These Terms, together with our <Link to="/privacy">Privacy Policy</Link>, 
                  constitute the entire agreement between you and SmartDocQ.
                </li>
                <li>
                  <strong>Governing Law:</strong> These Terms shall be governed by and construed in
                  accordance with the laws applicable in the jurisdiction where SmartDocQ operates,
                  without regard to conflict of law principles.
                </li>
                <li>
                  <strong>Severability:</strong> If any provision is found unenforceable, the 
                  remaining provisions will continue in effect.
                </li>
                <li>
                  <strong>No Waiver:</strong> Our failure to enforce any right or provision does 
                  not constitute a waiver of such right or provision.
                </li>
              </ul>
            </section>

            <section id="section-13" className="terms-section" aria-labelledby="title-section-13">
              <h2 id="title-section-13">13. Contact Us</h2>
              <p>
                If you have questions about these Terms of Service, please contact us through 
                the Contact form in your dashboard or visit the <Link to="/help">Help Center</Link>.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
