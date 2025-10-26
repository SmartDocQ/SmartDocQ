import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiUrl } from '../config';
import './Chat.css';

const ShareChat = () => {
  const { shareId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('Shared Chat');
  const [messages, setMessages] = useState([]);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const res = await fetch(apiUrl(`/api/share/${shareId}`));
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || 'Failed to load shared chat');
        setTitle(json.title || 'Shared Chat');
        setMessages(Array.isArray(json.messages) ? json.messages : []);
      } catch (e) {
        setError(e.message || 'Unable to load share');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [shareId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const format = (text) => {
    if (!text) return '';
    const esc = (s) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    let html = esc(text);
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    if (!html.includes('<p>')) html = `<p>${html}</p>`;
    return html;
  };

  return (
    <div className="chat-section">
      <div className="chat-header">
        <h2>{title}</h2>
        <div className="chat-actions">
          <button className="quiz-open-btn" onClick={() => window.location.assign('/login')}>
            Continue this chat
          </button>
        </div>
      </div>
      <div className="chat-list-wrapper">
        {loading ? (
          <div className="chat-empty-state"><p className="chat-empty">Loading…</p></div>
        ) : error ? (
          <div className="chat-empty-state"><p className="chat-empty">{error}</p></div>
        ) : messages.length === 0 ? (
          <div className="chat-empty-state"><p className="chat-empty">No messages</p></div>
        ) : (
          <ul className="chat-list">
            {messages.map((m, i) => (
              <li key={i} className={`chat-item ${m.role}`}>
                <div className="chat-bubble">
                  <div
                    className="chat-message-content"
                    dangerouslySetInnerHTML={{ __html: format(m.text) }}
                  />
                </div>
              </li>
            ))}
            <div ref={chatEndRef} />
          </ul>
        )}
      </div>
      {/* No input in shared view */}
    </div>
  );
};

export default ShareChat;
