import './Footer.css';
import { FaGithub, FaLinkedin, FaTwitter, FaDiscord } from 'react-icons/fa';
import { useLocation, Link } from 'react-router-dom';

const Footer = () => {
  const location = useLocation();
  const isUploadPage = location.pathname === "/upload";
  const isHelpPage = location.pathname === "/help";
  const isPrivacyPage = location.pathname === "/privacy";
  const isTermsPage = location.pathname === "/terms";

  const year = new Date().getFullYear();

  return (
  <footer className={`footer ${isUploadPage ? 'upload-footer' : ''} ${(isHelpPage || isPrivacyPage || isTermsPage) ? 'footer--flush' : ''}`} role="contentinfo">
      <div className="footer-container">
        <div className="footer-main" aria-label="Footer navigation">
          <section className="footer-section company-info">
            <div className="footer-logo" aria-label="SmartDocQ">
              <h3>SmartDocQ</h3>
            </div>
            <p className="company-description">
              Revolutionizing document processing with cutting-edge AI technology. Experience the future of intelligent document automation.
            </p>
            <nav className="social-links" aria-label="Social links">
              <a href="https://github.com/SmartDocQ/SmartDocQ.git" className="social-link" aria-label="GitHub" target="_blank" rel="noreferrer noopener">
                <FaGithub />
              </a>
              <a href="https://www.linkedin.com/in/smart-docq-230215382/" className="social-link" aria-label="LinkedIn" target="_blank" rel="noreferrer noopener">
                <FaLinkedin />
              </a>
              <a href="https://twitter.com/SmartDocQ" className="social-link" aria-label="Twitter" target="_blank" rel="noreferrer noopener">
                <FaTwitter />
              </a>
              <a href="https://discord.gg/Yv9Ktrgz" className="social-link" aria-label="Discord" target="_blank" rel="noreferrer noopener">
                <FaDiscord />
              </a>
            </nav>
          </section>

          <section className="footer-section support">
            <h4>Support</h4>
            <ul className="footer-links">
              <li><Link to="/help">Help Center</Link></li>
              <li><Link to="/help#faq">FAQ</Link></li>
            </ul>
          </section>

          {/* Room for future quick links without breaking layout */}
          <section className="footer-section optional-links" aria-hidden="true">
            <h4 className="visually-hidden">Quick Links</h4>
          </section>
        </div>

        <div className="footer-bottom">
          <div className="footer-bottom-content">
            <div className="copyright">
              <p>&copy; {year} SmartDocQ. All rights reserved.</p>
            </div>
            <div className="legal-links">
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
