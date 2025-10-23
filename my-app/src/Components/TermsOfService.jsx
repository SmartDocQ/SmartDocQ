import React from "react";
import "./TermsOfService.css";

export default function TermsOfService() {
  return (
    <div className="terms-page">
      <div className="terms-container">
        <header className="terms-hero">
          <h1>SmartDocQ Terms of Service</h1>
          <p>Last updated: October 2025</p>
        </header>

        <section className="terms-section">
          <h2>1. Overview</h2>
          <p>
            SmartDocQ helps you upload documents and use AI to search, ask questions,
            and generate study aids like flashcards and quizzes. By using SmartDocQ,
            you agree to these Terms. If you’re using SmartDocQ for an organization,
            you represent that you have authority to accept these Terms on its behalf.
          </p>
        </section>

        <section className="terms-section">
          <h2>2. Your Content & License to Us</h2>
          <ul>
            <li>
              You retain ownership of documents and content you upload ("Content").
            </li>
            <li>
              You grant SmartDocQ a limited, worldwide, non-exclusive license to
              store, process, and transform your Content as needed to provide core
              features: upload/preview, semantic search, Q&A, flashcards, and quizzes.
            </li>
            <li>
              This includes creation and storage of derived data (e.g., text extracts
              and vector embeddings in Chroma DB) and temporary caches (e.g., previews
              under pdf_cache/ via the Flask service).
            </li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>3. Accounts, Access & Security</h2>
          <ul>
            <li>
              You’re responsible for maintaining the confidentiality of your account
              and for all activities under it.
            </li>
            <li>
              Authentication uses JWTs stored in your browser. Don’t share tokens or
              credentials. Notify us of any unauthorized access.
            </li>
            <li>
              Admin-only routes and actions require administrator privileges.
            </li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>4. Acceptable Use</h2>
          <ul>
            <li>No illegal content, malware, or attempts to interfere with the service.</li>
            <li>No infringement of others’ rights, including copyrights or privacy.</li>
            <li>No attempts to bypass security, rate limits, or access other users’ data.</li>
            <li>No misuse of AI features (e.g., generating harmful or abusive content).</li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>5. AI & Accuracy</h2>
          <p>
            SmartDocQ uses LLMs to generate answers (e.g., via Retrieval-Augmented
            Generation). AI outputs may be inaccurate or incomplete. Use judgment
            and verify critical information. We configure providers to avoid training
            on your data where controls are available; see our Privacy Policy for details.
          </p>
        </section>

        <section className="terms-section">
          <h2>6. Service Availability & Changes</h2>
          <ul>
            <li>
              We aim for reliable service but do not guarantee uninterrupted uptime.
            </li>
            <li>
              Features may change, be added, or be removed. We’ll try to minimize
              disruption and communicate material changes when possible.
            </li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>7. Data Handling & Deletion</h2>
          <ul>
            <li>
              Deleting a document in History removes it and queues associated embeddings
              and caches for cleanup. You can delete per-document chats from the Chat UI.
            </li>
            <li>
              Admins may deactivate accounts for violations. For account deletion requests,
              contact support; we’ll remove associated data where reasonably possible.
            </li>
            <li>
              See our Privacy Policy for how we collect, store, and protect data.
            </li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>8. Intellectual Property</h2>
          <ul>
            <li>
              The SmartDocQ platform (code, UI, branding) and its components are owned
              by the SmartDocQ project and its licensors. These Terms don’t transfer
              ownership of our IP to you.
            </li>
            <li>
              You may provide feedback or suggestions; you grant us a royalty-free
              license to use that feedback to improve the service.
            </li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>9. Disclaimers & Liability</h2>
          <ul>
            <li>
              THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. We disclaim
              implied warranties of merchantability, fitness for a particular purpose,
              and non-infringement to the extent permitted by law.
            </li>
            <li>
              To the maximum extent permitted by law, we’re not liable for indirect or
              consequential damages, loss of data, profits, or business.
            </li>
          </ul>
        </section>

        <section className="terms-section">
          <h2>10. Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. If changes are material, we’ll
            provide notice (e.g., in-app notice or email). Continued use after changes
            means you accept the updated Terms.
          </p>
        </section>

        <section className="terms-section">
          <h2>11. Contact</h2>
          <p>
            Questions about these Terms? Visit the Help Center or contact support via
            the footer links.
          </p>
        </section>
      </div>
    </div>
  );
}
