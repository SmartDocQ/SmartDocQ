import React, { useEffect, useMemo, useRef, useState } from "react";
import "./Chat.css";
import Lottie from "lottie-react";
import display from "../Animations/Chat-D.json"
import { useToast } from "./ToastContext";
import Quiz from "./Quiz";
import Flashcard from "./Flashcard";
import { apiUrl } from "../config";

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
  // Spelling suggestion state
  const [missWord, setMissWord] = useState(null); // caret-based suggestion chip
  const [lastChecked, setLastChecked] = useState({ word: '', ts: 0 });
  const [spellMap, setSpellMap] = useState({}); // { [wordLower]: { correct, suggestion? } }

  const fetchSuggestion = async (word) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(apiUrl(`/api/search/spellcheck?word=${encodeURIComponent(word)}`), {
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Spellcheck failed');
      if (data && data.correct === false && Array.isArray(data.suggestions) && data.suggestions.length) {
        setMissWord((prev) => ({ ...(prev || {}), word, suggestion: data.suggestions[0] }));
      } else {
        setMissWord(null);
      }
    } catch (_) {
      // Silent fail
      setMissWord(null);
    }
  };

  // Batch spellcheck for overlay
  const batchCheck = async (words) => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(apiUrl(`/api/search/spellcheck/batch`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ words })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Spellcheck failed');
      setSpellMap(data?.results || {});
    } catch (_) {
      setSpellMap({});
    }
  };

  const getWordAtCaret = (value, caret) => {
    // Find token boundaries around caret in textarea value
    let start = caret;
    let end = caret;
    const isWordChar = (ch) => /[A-Za-z'\-]/.test(ch || '');
    while (start > 0 && isWordChar(value[start - 1])) start--;
    while (end < value.length && isWordChar(value[end])) end++;
    const word = value.slice(start, end);
    return { word, start, end };
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    if (value.length <= 750) {
      setChatInput(value);
      // Debounced batch spellcheck on current tokens
      const tokens = Array.from(new Set((value.match(/[A-Za-z'-]{3,}/g) || []).map(w => w.toLowerCase())));
      if (tokens.length) {
        const now = Date.now();
        // naive debounce via timeout
        clearTimeout(handleInputChange._t);
        handleInputChange._t = setTimeout(() => batchCheck(tokens), 250);
      } else {
        setSpellMap({});
      }
      // Real-time: check word at caret when user types space or ends a word
      const caret = e.target.selectionStart || value.length;
      const { word, start, end } = getWordAtCaret(value, caret - 1);
      if (word && word.length >= 3) {
        setMissWord({ word, start, end, suggestion: null });
        const now = Date.now();
        if (lastChecked.word !== word || now - lastChecked.ts > 800) {
          setLastChecked({ word, ts: now });
          fetchSuggestion(word);
        }
      } else {
        setMissWord(null);
      }
    }
  };

  // Build overlay HTML with underlines for misspelled words (clickable)
  const overlayHtml = useMemo(() => {
    if (!chatInput) return "";
    let html = "";
    // Iterate through text and wrap tokens
    const re = /[A-Za-z'-]{1,}|[^A-Za-z'-]+/g;
    let m;
    let idx = 0;
    while ((m = re.exec(chatInput)) !== null) {
      const segment = m[0];
      const start = idx;
      const end = idx + segment.length;
      idx = end;
      if (/^[A-Za-z'-]{1,}$/.test(segment)) {
        const low = segment.toLowerCase();
        const info = spellMap[low];
        if (info && info.correct === false && info.suggestion) {
          html += `<span class="miss" data-start="${start}" data-end="${end}" data-word="${segment}" data-suggest="${info.suggestion}">${segment}</span>`;
        } else {
          html += segment;
        }
      } else {
        // Preserve spaces/newlines
        html += segment
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br/>')
          .replace(/ {2}/g, ' &nbsp;');
      }
    }
    return html;
  }, [chatInput, spellMap]);

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
        <div className="chat-input-wrap">
          <div
            className="spell-overlay"
            onClick={(e) => {
              const t = e.target;
              if (t && t.classList && t.classList.contains('miss')) {
                const s = parseInt(t.getAttribute('data-start') || '0', 10);
                const en = parseInt(t.getAttribute('data-end') || '0', 10);
                const sug = t.getAttribute('data-suggest') || '';
                if (!isNaN(s) && !isNaN(en) && sug) {
                  const before = chatInput.slice(0, s);
                  const after = chatInput.slice(en);
                  const next = `${before}${sug}${after}`;
                  setChatInput(next);
                  setMissWord(null);
                  setTimeout(() => textareaRef.current?.focus(), 0);
                }
              }
            }}
            dangerouslySetInnerHTML={{ __html: overlayHtml }}
          />
          <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Type your question..."
          value={chatInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          spellCheck={true}
          maxLength={750}
          rows={1}
          />
        </div>
        {missWord && missWord.suggestion && (
          <button
            className="spell-suggest-btn"
            type="button"
            onClick={() => {
              // Replace the misspelled word range with suggestion
              const before = chatInput.slice(0, missWord.start);
              const after = chatInput.slice(missWord.end);
              const next = `${before}${missWord.suggestion}${after}`;
              setChatInput(next);
              setMissWord(null);
              // Restore focus
              setTimeout(() => textareaRef.current?.focus(), 0);
            }}
            title={`Replace "${missWord.word}" with "${missWord.suggestion}"`}
          >
            Fix "{missWord.word}" → "{missWord.suggestion}"
          </button>
        )}
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