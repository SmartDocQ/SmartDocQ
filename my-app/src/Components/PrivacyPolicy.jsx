import React from "react";
import "./PrivacyPolicy.css";

export default function PrivacyPolicy() {
  return (
    <div className="privacy-page">
      <div className="privacy-container">
        <header className="privacy-hero">
          <h1>SmartDocQ Privacy Policy</h1>
          <p>Last updated: October 2025</p>
        </header>

        <section className="privacy-section">
          <h2>Overview</h2>
          <p>
            SmartDocQ lets you upload documents and use AI to search, ask questions,
            and generate study aids (flashcards and quizzes). To provide these features,
            we store your content and create derived data (like vector embeddings and
            previews). This policy explains what we collect, how we use it, and your choices.
          </p>
        </section>

        <section className="privacy-section">
          <h2>What We Collect</h2>
          <ul>
            <li>
              Account data: name, email, authentication method (email/password or Google
              Sign‑In). Avatars are hosted on Cloudinary.
            </li>
            <li>
              Documents you upload and derived data needed for AI features:
              embeddings (for search/Q&A), text extracts, and lightweight preview files.
            </li>
            <li>
              Usage metadata: timestamps (e.g., last login, recent activity), feature usage,
              and basic system logs for reliability, abuse prevention, and admin analytics.
            </li>
            <li>
              Chat history tied to a document (so you can continue conversations later).
            </li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>Where We Store Data</h2>
          <ul>
            <li>
              Primary data (users, documents, chats) is stored in MongoDB Atlas as configured
              by your deployment.
            </li>
            <li>
              Vector embeddings for search/Q&A are stored in a managed Qdrant Cloud collection,
              enabling fast semantic retrieval without reprocessing and resilient persistence.
            </li>
            <li>
              Preview/cache artifacts (e.g., converted PDFs) may be produced by a small Flask
              service and stored temporarily under pdf_cache/ to speed up viewing.
            </li>
            <li>
              Avatars are stored on Cloudinary.
            </li>
            <li>
              Authentication uses JWTs stored in your browser (localStorage) for session state.
            </li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>How We Use Data</h2>
          <ul>
            <li>Provide core app features (upload, preview, search, Q/A, flashcards, quizzes).</li>
            <li>Operate admin dashboards (e.g., online users and growth) using recent activity.</li>
            <li>Improve reliability, troubleshoot issues, and prevent abuse.</li>
          </ul>
          <p>
            We do not sell your data. We do not use your documents to train foundation models.
            Depending on deployment, an LLM provider may temporarily process prompts/context to
            generate answers; we configure providers to avoid using your data for model training
            where such controls are available.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Retention & Deletion</h2>
          <ul>
            <li>
              Deleting a document in History removes the document and queues associated
              embeddings and cached previews for cleanup.
            </li>
            <li>
              You can delete a conversation for a document from the Chat panel; this removes
              the stored chat history for that document.
            </li>
            <li>
              Admins can deactivate users; deactivated users cannot sign in. To request full
              account deletion (and related data where possible), contact support.
            </li>
            <li>
              System logs and analytics are retained for a limited period and then rotated; the
              window may vary by deployment settings.
            </li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>Security</h2>
          <ul>
            <li>Transport security with HTTPS is required for production deployments.</li>
            <li>Access control is enforced with JWTs; admin routes require admin privileges.</li>
            <li>File names are validated and sanitized on upload; size/type limits are enforced.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>Your Choices</h2>
          <ul>
            <li>Upload, preview, download, and delete your own documents from History.</li>
            <li>Delete chat history per document from the Chat UI.</li>
            <li>Update your profile or remove your avatar from Account settings.</li>
            <li>Request account deletion via support; we’ll remove associated data where possible.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>Contact</h2>
          <p>
            Questions or requests? Visit the Help Center or reach out via the footer support links.
          </p>
        </section>
      </div>
    </div>
  );
}
