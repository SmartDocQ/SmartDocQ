import React, { useEffect, useRef, useState } from "react";
import "./Chat.css";
import Lottie from "lottie-react";
import display from "../Animations/Chat-D.json"
import { useToast } from "./ToastContext";
import Quiz from "./Quiz";
import Flashcard from "./Flashcard";
import { apiUrl } from "../config";
import whatsappIcon from "../Animations/whatsapp-svgrepo-com.svg";
import twitterIcon from "../Animations/twitter-color-svgrepo-com.svg";
import gmailIcon from "../Animations/gmail-old-svgrepo-com.svg";

const TypingIndicator = () => (
  <div className="typing-indicator">
    <span></span>
    <span></span>
    <span></span>
  </div>
);

const Chat = ({ chat, setChat, chatInput, setChatInput, sendMessage, clearChat, isTyping, documentId }) => {
  const { showToast } = useToast();
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const [feedbackMap, setFeedbackMap] = useState({}); // { [messageKey]: 'up' | 'down' }
  const [showQuiz, setShowQuiz] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  // Sync feedbackMap from persisted ratings in chat
  useEffect(() => {
    const next = {};
    chat.forEach((msg, idx) => {
      if (msg.role === 'assistant' && msg.rating && msg.rating !== 'none') {
        const key = messageKeyFor(msg, idx);
        next[key] = msg.rating === 'positive' ? 'up' : 'down';
      }
    });
    setFeedbackMap(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat]);

  const saveFeedback = async (idx, rating, revertFn) => {
    if (!documentId) return; // cannot persist without id
    try {
      const token = localStorage.getItem("token");
  const res = await fetch(apiUrl(`/api/chat/${documentId}/message/${idx}/rating`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ rating })
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(()=>({}))).message || 'Failed to save feedback');
      }
      // Update local chat array with persisted rating
      setChat && setChat(prev => prev.map((m, i) => i === idx ? { ...m, rating } : m));
    } catch (err) {
      revertFn && revertFn();
      showToast(err.message || 'Failed to save feedback', { type: 'error' });
    }
  };

  // Format message text to HTML with proper line breaks and formatting
  const formatMessageText = (text) => {
    if (!text) return '';
    
    // Escape HTML to prevent XSS attacks
    const escapeHtml = (unsafe) => {
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };
    
    let formatted = escapeHtml(text);
    
    // Convert line breaks to HTML
    formatted = formatted.replace(/\n\n/g, '</p><p>');
    formatted = formatted.replace(/\n/g, '<br>');
    
    // Handle bullet points
    formatted = formatted.replace(/^• (.+)$/gm, '<li>$1</li>');
    
    // Handle numbered lists
    formatted = formatted.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    
    // Wrap in paragraphs if not already
    if (!formatted.includes('<p>') && !formatted.includes('<li>')) {
      formatted = `<p>${formatted}</p>`;
    } else if (formatted.includes('<li>')) {
      // Wrap list items in ul tags
      formatted = formatted.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    }
    
    // Clean up empty paragraphs
    formatted = formatted.replace(/<p>\s*<\/p>/g, '');
    
    return formatted;
  };

  // Scroll to bottom whenever chat updates or typing status changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto"; // Reset height
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`; // Max height 120px
    }
  }, [chatInput]);

  // Handle input change with validation
  const handleInputChange = (e) => {
    const value = e.target.value;
    if (value.length <= 750) {
      setChatInput(value);
    }
  };

  // Handle key press events
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Copy message to clipboard
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast("Message copied to clipboard", { type: "success" });
    }).catch(() => {
      showToast("Failed to copy", { type: "error" });
    });
  };

  // Handle chat clear
  const handleClearChat = async () => {
    await clearChat();
    showToast("Chat cleared successfully", { type: "success" });
  };

  // Feedback selection per assistant message
  const messageKeyFor = (msg, idx) => msg.id || `${msg.role}-${idx}`;
  const toggleFeedback = (key, idx, type) => {
    const current = feedbackMap[key];
    let nextMap;
    let rating = 'none';
    if (current === type) {
      // Toggle off
      nextMap = (prev) => { const { [key]: _, ...rest } = prev; return rest; };
      rating = 'none';
    } else {
      nextMap = (prev) => ({ ...prev, [key]: type });
      rating = type === 'up' ? 'positive' : 'negative';
      showToast("Thanks for your feedback", { type: "success" });
    }
    // Optimistic update with revert if needed
    const prevState = feedbackMap;
    setFeedbackMap(typeof nextMap === 'function' ? nextMap : nextMap);
    saveFeedback(idx, rating, () => setFeedbackMap(prevState));
  };

  return (
    <div className="chat-section">
      <div className="chat-header">
        <h2>Chat</h2>
        <div className="chat-actions">
          <button
            className="quiz-open-btn"
            onClick={() => setShowQuiz(true)}
            title={documentId ? "Generate quiz from this document" : "Select a document to generate a quiz"}
            disabled={!documentId}
          >
            Quiz
          </button>
          <button
            className="quiz-open-btn"
            onClick={() => setShowFlashcards(true)}
            title={documentId ? "Generate flashcards from this document" : "Select a document to generate flashcards"}
            disabled={!documentId}
          >
            Flashcards
          </button>
          <button 
            className="export-chat-button" 
            onClick={async () => {
              try {
                if (!documentId) return;
                const token = localStorage.getItem('token');
                const res = await fetch(apiUrl(`/api/chat/${documentId}/export.pdf`), {
                  headers: { Authorization: token ? `Bearer ${token}` : '' }
                });
                if (!res.ok) {
                  const j = await res.json().catch(()=>({ message: 'Failed to export chat' }));
                  throw new Error(j.message || 'Failed to export chat');
                }
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'Chat.pdf';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
              } catch (err) {
                showToast(err.message || 'Export failed', { type: 'error' });
              }
            }}
            title="Export chat"
            disabled={chat.length === 0}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          {/* Share Button with menu */}
          <ShareControl documentId={documentId} chat={chat} />
          <button 
            className="clear-chat-button" 
            onClick={handleClearChat}
            title="Clear chat"
            disabled={chat.length === 0}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div className="chat-list-wrapper">
        {chat.length === 0 ? (
          <div className="chat-empty-state">
            <Lottie animationData={display} loop={true} style={{ height: 90}} />
            <p className="chat-empty">Ask anything about your document.</p>
            <p className="empty-subtitle">Start a conversation to get insights</p>
          </div>
        ) : (
          <ul className="chat-list">
            {chat.map((msg, idx) => (
              <li key={messageKeyFor(msg, idx)} className={`chat-item ${msg.role}`}>
                <div className="chat-bubble">
                  <div 
                    className="chat-message-content"
                    dangerouslySetInnerHTML={{
                      __html: formatMessageText(msg.text)
                    }}
                  />
                </div>
                <div className="message-actions">
                  <button 
                    className="copy-button"
                    onClick={() => copyToClipboard(msg.text)}
                    title="Copy message"
                    aria-label="Copy message"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                  {msg.role === 'assistant' && (
                    <>
                      <button 
                        className={`thumb-button up${feedbackMap[messageKeyFor(msg, idx)] === 'up' ? ' active' : ''}`}
                        aria-label="Thumbs up"
                        onClick={() => toggleFeedback(messageKeyFor(msg, idx), idx, 'up')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                        </svg>
                      </button>
                      <button 
                        className={`thumb-button down${feedbackMap[messageKeyFor(msg, idx)] === 'down' ? ' active' : ''}`}
                        aria-label="Thumbs down"
                        onClick={() => toggleFeedback(messageKeyFor(msg, idx), idx, 'down')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
            {isTyping && (
              <li className="chat-item assistant">
                <TypingIndicator />
              </li>
            )}
            <div ref={chatEndRef} /> {/* Scroll target */}
          </ul>
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Type your question..."
          value={chatInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          maxLength={750}
          rows={1}
        />
        <button
          className="chat-send"
          onClick={sendMessage}
          disabled={!chatInput.trim() || isTyping}
        >
          {isTyping ? 'Sending...' : 'Send'}
        </button>
      </div>
      {showQuiz && documentId && (
        <Quiz
          docId={documentId}
          onClose={() => setShowQuiz(false)}
        />
      )}
      {showFlashcards && documentId && (
        <Flashcard
          docId={documentId}
          onClose={() => setShowFlashcards(false)}
        />
      )}
    </div>
  );
};

export default Chat;

// Inline Share control component (kept here to avoid extra file wiring)
const ShareControl = ({ documentId, chat }) => {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const menuRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Create a share snapshot and return the public link
  const createShareLink = async () => {
    if (!documentId) throw new Error('Missing document');
    if (!chat || chat.length === 0) throw new Error('Nothing to share yet');
    const token = localStorage.getItem('token');
    const res = await fetch(apiUrl(`/api/share/chat/${documentId}`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : ''
      }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'Failed to create share link');
    return `${window.location.origin}/share/${json.shareId}`;
  };

  // Copy link flow (uses createShareLink)
  const createShareAndCopy = async () => {
    try {
      setCreating(true);
      const link = await createShareLink();
      await navigator.clipboard.writeText(link);
      showToast('Share link copied', { type: 'success' });
      setOpen(false);
    } catch (err) {
      const msg = err?.message || 'Could not copy share link';
      if (msg === 'Nothing to share yet') {
        showToast(msg, { type: 'warning' });
      } else {
        showToast(msg, { type: 'error' });
      }
    } finally {
      setCreating(false);
    }
  };

  // WhatsApp share: prefer app if installed, fallback to web
  const shareToWhatsApp = async () => {
    try {
      setCreating(true);
      const link = await createShareLink();
      const text = `Shared chat from SmartDocQ (expires in 24h) ${link}`;
      const encoded = encodeURIComponent(text);
      const appUrl = `whatsapp://send?text=${encoded}`;
      const webUrl = `https://wa.me/?text=${encoded}`;

      // Heuristic: on mobile, try app first with a timed fallback; on desktop, open web
      const ua = navigator.userAgent || '';
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

      if (isMobile) {
        // Try to open the app
        const timeout = setTimeout(() => {
          try { window.open(webUrl, '_blank', 'noopener,noreferrer'); } catch (_) {}
        }, 800);
        try {
          window.location.href = appUrl;
        } catch (_) {
          clearTimeout(timeout);
          window.open(webUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        // Desktop: open web WhatsApp (will hand off to app if possible)
        window.open(webUrl, '_blank', 'noopener,noreferrer');
      }
      setOpen(false);
    } catch (err) {
      const msg = err?.message || 'WhatsApp share failed';
      if (msg === 'Nothing to share yet') {
        showToast(msg, { type: 'warning' });
      } else {
        showToast(msg, { type: 'error' });
      }
    } finally {
      setCreating(false);
    }
  };

  // X (Twitter) share: try app deep link, fallback to web intent
  const shareToX = async () => {
    try {
      setCreating(true);
      const link = await createShareLink();
      const text = `Shared chat from SmartDocQ (expires in 24h) ${link}`;
      const encoded = encodeURIComponent(text);
      const webUrl = `https://twitter.com/intent/tweet?text=${encoded}`;
      const ua = navigator.userAgent || '';
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

      if (isMobile) {
        // Try known app schemes; many clients still support twitter://
        const appSchemes = [
          `twitter://post?message=${encoded}`,
          `twitter://post?text=${encoded}`,
          `x://post?message=${encoded}`,
        ];
        let opened = false;
        const fallbackTimer = setTimeout(() => {
          if (!opened) {
            try { window.open(webUrl, '_blank', 'noopener,noreferrer'); } catch (_) {}
          }
        }, 800);
        try {
          // Attempt first scheme; if blocked, fallback timer will trigger
          window.location.href = appSchemes[0];
          opened = true;
        } catch (_) {
          // If navigation throws synchronously, fallback immediately
          clearTimeout(fallbackTimer);
          window.open(webUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        window.open(webUrl, '_blank', 'noopener,noreferrer');
      }
      setOpen(false);
    } catch (err) {
      const msg = err?.message || 'Share to X failed';
      if (msg === 'Nothing to share yet') {
        showToast(msg, { type: 'warning' });
      } else {
        showToast(msg, { type: 'error' });
      }
    } finally {
      setCreating(false);
    }
  };

  // Email share: open mail client via mailto, fallback to Gmail web compose
  const shareToEmail = async () => {
    try {
      setCreating(true);
      const link = await createShareLink();
      const subject = 'Shared chat from SmartDocQ (expires in 24h)';
      const body = `Shared chat from SmartDocQ (expires in 24h)\n\n${link}`;
      const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      const gmailWeb = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      let fallback = setTimeout(() => {
        try { window.open(gmailWeb, '_blank', 'noopener,noreferrer'); } catch (_) {}
      }, 800);
      try {
        window.location.href = mailto;
      } catch (_) {
        clearTimeout(fallback);
        window.open(gmailWeb, '_blank', 'noopener,noreferrer');
      }
      setOpen(false);
    } catch (err) {
      const msg = err?.message || 'Email share failed';
      if (msg === 'Nothing to share yet') {
        showToast(msg, { type: 'warning' });
      } else {
        showToast(msg, { type: 'error' });
      }
    } finally {
      setCreating(false);
    }
  };

  const disabled = !documentId || !chat || chat.length === 0;

  const pendingLink = null; // we create when user clicks copy link

  const disabledShare = (platform) => {
    showToast(`${platform} integration coming soon`, { type: 'info' });
  };

  return (
    <div className="share-control" ref={menuRef}>
      <button
        className="export-chat-button share-button"
        title={disabled ? 'Start a chat to share' : 'Share chat'}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3"></circle>
          <circle cx="6" cy="12" r="3"></circle>
          <circle cx="18" cy="19" r="3"></circle>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
        </svg>
      </button>
      {open && (
        <div className="share-menu" role="menu">
          <button className="share-item" onClick={shareToWhatsApp} disabled={creating}>
            <span className="share-icon" aria-hidden="true">
              <img src={whatsappIcon} alt="WhatsApp" width={18} height={18} />
            </span>
            WhatsApp
          </button>
          <button className="share-item" onClick={shareToX} disabled={creating}>
            <span className="share-icon" aria-hidden="true">
              <img src={twitterIcon} alt="X (Twitter)" width={18} height={18} />
            </span>
            X (Twitter)
          </button>
          <button className="share-item" onClick={shareToEmail} disabled={creating}>
            <span className="share-icon" aria-hidden="true">
              <img src={gmailIcon} alt="Email" width={18} height={18} />
            </span>
            Email
          </button>
          <div className="share-sep" />
          <button className="share-item copy" onClick={createShareAndCopy} disabled={creating}>
            {creating ? 'Generating…' : 'Copy link'}
          </button>
          <div className="share-note">This link will expire in 24 hours.</div>
        </div>
      )}
    </div>
  );
};