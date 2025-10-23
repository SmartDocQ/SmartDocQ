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
            SmartDocQ processes your documents to enable features like semantic
            search, question answering, flashcards, and quizzes. We design our
            systems with privacy-by-default principles and minimize data where possible.
          </p>
        </section>

        <section className="privacy-section">
          <h2>What We Collect</h2>
          <ul>
            <li>Account info: name, email, avatar (Cloudinary hosted).</li>
            <li>Documents and derived data (embeddings, previews, cached extracts).</li>
            <li>Usage metadata (timestamps, feature usage) for reliability and security.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>How We Use Data</h2>
          <ul>
            <li>Provide core features (upload, preview, Q/A, study tools).</li>
            <li>Improve quality, performance, and security of the service.</li>
            <li>Respond to support requests and prevent abuse.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>Storage & Retention</h2>
          <p>
            Documents are stored in your deployment’s configured storage and database.
            Derived data (e.g., embeddings) may be cached to speed up responses. You can
            delete uploads from History; associated derived data is queued for removal.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Third Parties</h2>
          <p>
            We may use trusted processors (e.g., Cloudinary for avatars). We don’t sell your
            data. Subprocessors are limited to what’s needed to deliver the service.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Your Choices</h2>
          <ul>
            <li>Download or delete your documents at any time from History.</li>
            <li>Update your profile or remove your avatar from Account.</li>
            <li>Request account deletion to purge associated data where possible.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>Contact</h2>
          <p>
            Questions? Visit the Help Center or contact support via the footer links.
          </p>
        </section>
      </div>
    </div>
  );
}
