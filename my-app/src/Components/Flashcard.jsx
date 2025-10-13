import React, { useEffect, useState } from "react";
import { useToast } from "./ToastContext";
import { pyApiUrl } from "../config";
import "./Flashcard.css";

const Flashcard = ({ docId, onClose }) => {
  const { showToast } = useToast();
  const [flashcards, setFlashcards] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [numCards, setNumCards] = useState(20);
  const [showSettings, setShowSettings] = useState(true);
  const [studyMode, setStudyMode] = useState(false);
  const [masteredCards, setMasteredCards] = useState(new Set());

  // Body scroll lock and allow ESC/backdrop click to close
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = original; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const onBackdropClick = (e) => {
    if (e.target.classList.contains('flashcard-backdrop')) {
      onClose && onClose();
    }
  };

  const generateFlashcards = async () => {
    setIsLoading(true);
    setShowSettings(false);
    try {
      const token = localStorage.getItem("token");
  const response = await fetch(pyApiUrl("/api/document/generate-flashcards"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          doc_id: docId,
          num_cards: numCards,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        const cards = data.flashcards || [];
        const generated = cards.length;
        if (generated === 0) {
          showToast("No flashcards could be generated from this document. Try choosing fewer cards or use a richer document.", { type: "error" });
          setShowSettings(true);
          return;
        }
        if (generated < numCards) {
          showToast(`Only ${generated} of ${numCards} flashcards could be generated from this document.`, { type: "warning" });
        } else {
          showToast(`Generated ${generated} flashcards.`, { type: "success" });
        }
        setFlashcards(cards);
        setCurrentIndex(0);
        setIsFlipped(false);
        setStudyMode(true);
      } else {
        showToast(data.error || "Failed to generate flashcards", { type: "error" });
        setShowSettings(true);
      }
    } catch (error) {
      console.error("Flashcard generation error:", error);
      showToast("Failed to generate flashcards: " + error.message, { type: "error" });
      setShowSettings(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFlip = () => setIsFlipped(!isFlipped);
  const handleNext = () => { if (currentIndex < flashcards.length - 1) { setCurrentIndex(currentIndex + 1); setIsFlipped(false); } };
  const handlePrevious = () => { if (currentIndex > 0) { setCurrentIndex(currentIndex - 1); setIsFlipped(false); } };
  const toggleMastered = () => {
    const next = new Set(masteredCards);
    if (next.has(currentIndex)) next.delete(currentIndex); else next.add(currentIndex);
    setMasteredCards(next);
  };

  const exportToJSON = () => {
    const dataStr = JSON.stringify(flashcards, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "flashcards.json";
    link.click();
  };

  if (isLoading) {
    return (
  <div className="flashcard-backdrop" onClick={onBackdropClick}>
        <div className="flashcard-container">
          <div className="flashcard-loading">
            <div className="spinner"></div>
            <p>Generating your flashcards...</p>
          </div>
        </div>
      </div>
    );
  }

  if (showSettings) {
    return (
  <div className="flashcard-backdrop" onClick={onBackdropClick}>
        <div className="flashcard-container">
          <div className="flashcard-header">
            <h2>SmartCardsQ</h2>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>

          <div className="flashcard-settings">
            <h3>Flashcard Settings</h3>

            <div className="setting-group">
              <label>Number of Flashcards:</label>
              <select value={numCards} onChange={(e) => setNumCards(Number(e.target.value))}>
                <option value={5}>5 Cards</option>
                <option value={10}>10 Cards</option>
                <option value={15}>15 Cards</option>
                <option value={20}>20 Cards</option>
                <option value={30}>30 Cards</option>
              </select>
            </div>

            <button className="generate-btn" onClick={generateFlashcards} disabled={!docId}>
              Generate Flashcards
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!studyMode || flashcards.length === 0) return null;
  const currentCard = flashcards[currentIndex];

  return (
  <div className="flashcard-backdrop" onClick={onBackdropClick}>
      <div className="flashcard-container">
        <div className="flashcard-header">
          <h2>SmartCardsQ</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="flashcard-progress">
          <span>Card {currentIndex + 1} of {flashcards.length}</span>
          <span>Mastered: {masteredCards.size} / {flashcards.length}</span>
        </div>

        <div className="flashcard-study">
          <div className={`flashcard ${isFlipped ? "flipped" : ""}`} onClick={handleFlip}>
            <div className="flashcard-front">
              <div className="card-badge">{currentCard.category || "General"}</div>
              <div className="card-content">{currentCard.front}</div>
              <div className="flip-hint">Click to flip</div>
            </div>
            <div className="flashcard-back">
              <div className="card-badge">{currentCard.difficulty || "Medium"}</div>
              <div className="card-content">{currentCard.back}</div>
              <div className="flip-hint">Click to flip back</div>
            </div>
          </div>

          <div className="flashcard-controls">
            <div className="fc-left">
              {currentIndex > 0 && (
                <button className="control-btn" onClick={handlePrevious}>← Previous</button>
              )}
            </div>
            <label className="mastered-checkbox">
              <input type="checkbox" checked={masteredCards.has(currentIndex)} onChange={toggleMastered} />
              <span>Mastered</span>
            </label>
            <div className="fc-right">
              {currentIndex < flashcards.length - 1 && (
                <button className="control-btn" onClick={handleNext}>Next →</button>
              )}
            </div>
          </div>

          <div className="flashcard-export">
            <button className="export-btn" onClick={exportToJSON}>Export JSON</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Flashcard;