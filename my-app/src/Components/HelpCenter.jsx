import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import "./HelpCenter.css";

const Section = ({ id, title, children }) => (
  <section id={id} className="hc-section">
    <h2 className="hc-title">{title}</h2>
    <div className="hc-body">{children}</div>
  </section>
);

const QA = ({ q, a }) => (
  <details className="hc-qa">
    <summary>{q}</summary>
    <div className="hc-a">{a}</div>
  </details>
);

export default function HelpCenter() {
  const location = useLocation();

  // Smoothly scroll to section when hash is present (e.g., /help#faq)
  useEffect(() => {
    if (!location.hash) return;
    const el = document.querySelector(location.hash);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [location]);

  return (
    <div className="help-center-page">
      <div className="help-center">
        <header className="hc-hero">
          <h1>Help Center</h1>
          <p>Quick answers and guides for SmartDocQ.</p>
        </header>

        <nav className="hc-nav" aria-label="Help Center navigation">
          <a href="#getting-started">Getting Started</a>
          <a href="#uploads">Uploads</a>
          <a href="#qa">Chat & Q/A</a>
          <a href="#study">Study</a>
          <a href="#account">Account</a>
          <a href="#faq">FAQ</a>
          <a href="#troubleshooting">Troubleshoot</a>
          <a href="#contact">Contact</a>
        </nav>

      <Section id="getting-started" title="Getting Started">
        <ul>
          <li>Sign up or sign in using email/password or Google.</li>
          <li>Use <strong>Upload</strong> to add your documents.</li>
          <li>Open <strong>Chat</strong> to ask questions about your documents.</li>
        </ul>
      </Section>

      <Section id="uploads" title="Uploading Documents">
        <ul>
          <li>Supported: PDF, DOCX, TXT. Max size may be limited by your plan/environment.</li>
          <li>Upload status: queued → indexing → done. Large files take longer.</li>
          <li>Converted files (e.g., Word→PDF) retain links to the original in history.</li>
        </ul>
      </Section>

      <Section id="qa" title="Chat & Q/A">
        <ul>
          <li>Ask natural questions. Results are grounded in your uploaded content.</li>
          <li>Use feedback (👍/👎) to improve future responses.</li>
          <li>Rate limiting may apply—retry in a moment if you hit limits.</li>
        </ul>
      </Section>

      <Section id="study" title="Flashcards & Quizzes">
        <ul>
          <li>Generate flashcards or quizzes from your documents for quick revision.</li>
          <li>Track attempts and review explanations to improve understanding.</li>
        </ul>
      </Section>

      <Section id="account" title="Account & Admin">
        <ul>
          <li>Update profile and avatar from your account page.</li>
          <li>Admins can manage users, documents, and view system stats in the Admin panel.</li>
          <li>Deactivated users cannot sign in until reactivated by an admin.</li>
        </ul>
      </Section>

      <Section id="faq" title="FAQ">
        <QA q="Which file types are supported?" a={<p>PDF, DOCX and TXT are supported. Other formats may be converted to PDF before processing.</p>} />
        <QA q="Why do I see 'indexing'?" a={<p>We create embeddings and cache your content for fast Q/A. Large files or first-time uploads take longer. You can continue once the status shows <em>done</em>.</p>} />
        <QA q="Is there a file size limit?" a={<p>Yes, uploads may be limited by your deployment plan. If uploads fail, try splitting the document or compressing it.</p>} />
        <QA q="How is my data used?" a={<p>Your files are stored and processed to power search, Q/A, flashcards and quizzes. See <a href="#privacy">Privacy Policy</a> for details and data removal.</p>} />
        <QA q="Can I delete my account and data?" a={<p>Yes. Deleting your account removes your profile and attempts to delete associated documents, chats, and reports. Some cached data may take time to purge.</p>} />
        <QA q="I don't get good answers" a={<p>Make sure the document finished indexing and your question refers to its content. Try more specific queries or smaller chunks. Use feedback buttons to improve results.</p>} />
        <QA q="Where are avatars stored?" a={<p>Avatars are hosted on Cloudinary. You can replace or remove them anytime from your account profile.</p>} />
        <QA q="Google Sign-In doesn't work" a={<p>Make sure pop-ups are allowed and you’re signed into the correct Google account. If the problem persists, try email/password login or contact support.</p>} />
        <QA q="My account is deactivated" a={<p>Deactivated users can’t sign in. Contact an administrator to reactivate your account.</p>} />
        <QA q="Admin access denied" a={<p>You must be an admin user. Ask an existing admin to grant you admin rights, or use the configured admin credentials if provided for your deployment.</p>} />
        <QA q="Quiz/Flashcards missing" a={<p>Ensure the document is indexed and contains enough content. Very short or image-only PDFs may not produce meaningful questions.</p>} />
        <QA q="Upload stuck or failed" a={<p>Check file type/size, network connection, and try again. If it keeps failing, reach out via the Contact form and include the file name.</p>} />
      </Section>

      <Section id="troubleshooting" title="Troubleshooting">
        <ul>
          <li>Upload failed: check file size/type and try again.</li>
          <li>No answers returned: ensure the document finished indexing and your question references its content.</li>
          <li>Login issues: reset password or sign in with Google if enabled.</li>
        </ul>
      </Section>

      <Section id="contact" title="Contact Support">
        <p>Use the <strong>Contact</strong> form to report issues or request features. Include screenshots and document names when possible.</p>
      </Section>

      <Section id="privacy" title="Privacy Policy">
        <p>We store metadata and content needed to provide features like search, Q/A, and history. Avatars are hosted on Cloudinary. Remove your account to delete associated data where possible.</p>
      </Section>

      <Section id="terms" title="Terms of Service">
        <p>Use SmartDocQ responsibly. Avoid uploading sensitive or illegal content. Service availability and features may change over time.</p>
      </Section>
      </div>
    </div>
  );
}
