import React, { useState } from "react";
import "./Quiz.css";
import { pyApiUrl } from "../config";

const Quiz = ({ docId, onClose }) => {
  const [quizData, setQuizData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userAnswers, setUserAnswers] = useState({});
  const [showResults, setShowResults] = useState(false);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [showExplanation, setShowExplanation] = useState(false);

  // Settings
  const [numQuestions, setNumQuestions] = useState(10);
  const [difficulty, setDifficulty] = useState("medium");
  const [showSettings, setShowSettings] = useState(true);

  const generateQuiz = async () => {
    setIsLoading(true);
    setShowSettings(false);
    try {
      const token = localStorage.getItem("token");
  const response = await fetch(pyApiUrl("/api/document/generate-quiz"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          doc_id: docId,
          num_questions: numQuestions,
          difficulty: difficulty,
          question_types: ["mcq", "true_false", "short_answer"],
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setQuizData(data.quiz);
        setCurrentQuestion(0);
        setUserAnswers({});
        setShowResults(false);
        setScore(0);
      } else {
        alert(data.error || "Failed to generate quiz");
        setShowSettings(true);
      }
    } catch (error) {
      console.error("Quiz generation error:", error);
      alert("Failed to generate quiz: " + error.message);
      setShowSettings(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswerSelect = (answer) => {
    setSelectedAnswer(answer);
    setShowExplanation(false);
  };

  const handleSubmitAnswer = () => {
    if (!selectedAnswer && (quizData.questions[currentQuestion].type !== "short_answer" || selectedAnswer === null)) {
      alert("Please select an answer");
      return;
    }

    const currentQ = quizData.questions[currentQuestion];
    const isCorrect = String(selectedAnswer).trim() === String(currentQ.correct_answer).trim();

    setUserAnswers({
      ...userAnswers,
      [currentQuestion]: {
        selected: selectedAnswer,
        correct: currentQ.correct_answer,
        isCorrect: isCorrect,
      },
    });

    setShowExplanation(true);

    if (isCorrect) {
      setScore(score + 1);
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestion < quizData.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    } else {
      setShowResults(true);
    }
  };

  const restartQuiz = () => {
    setQuizData(null);
    setCurrentQuestion(0);
    setUserAnswers({});
    setShowResults(false);
    setScore(0);
    setSelectedAnswer(null);
    setShowExplanation(false);
    setShowSettings(true);
  };

  if (isLoading) {
    return (
      <div className="quiz-backdrop">
        <div className="quiz-container">
          <div className="quiz-loading">
            <div className="spinner"></div>
            <p>Generating your quiz...</p>
          </div>
        </div>
      </div>
    );
  }

  if (showSettings) {
    return (
      <div className="quiz-backdrop">
        <div className="quiz-container">
          <div className="quiz-header">
            <h2>SmartQuiz</h2>
            <button className="close-btn" onClick={onClose} aria-label="Close quiz">✕</button>
          </div>

          <div className="quiz-settings">
            <h3>Quiz Settings</h3>

            <div className="setting-group">
              <label>Number of Questions:</label>
              <select value={numQuestions} onChange={(e) => setNumQuestions(Number(e.target.value))}>
                <option value={5}>5 Questions</option>
                <option value={10}>10 Questions</option>
                <option value={15}>15 Questions</option>
                <option value={20}>20 Questions</option>
              </select>
            </div>

            <div className="setting-group">
              <label>Difficulty Level:</label>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            <button className="generate-btn" onClick={generateQuiz}>Generate Quiz</button>
          </div>
        </div>
      </div>
    );
  }

  if (showResults) {
    const percentage = Math.round((score / quizData.questions.length) * 100);
    let message = "";
    if (percentage >= 90) message = "Excellent! Outstanding performance!";
    else if (percentage >= 70) message = "Great job! You did well!";
    else if (percentage >= 50) message = "Good effort! Keep practicing!";
    else message = "Keep studying! You'll improve!";

    return (
      <div className="quiz-backdrop">
        <div className="quiz-container">
          <div className="quiz-header">
            <h2>Quiz Results</h2>
            <button className="close-btn" onClick={onClose} aria-label="Close quiz">✕</button>
          </div>

          <div className="quiz-results">
            <div className="score-circle">
              <div className="score-text">{score}/{quizData.questions.length}</div>
              <div className="percentage">{percentage}%</div>
            </div>

            <p className="result-message">{message}</p>

            <div className="result-actions">
              <button className="restart-btn" onClick={restartQuiz}>Try Again</button>
              <button className="close-result-btn" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!quizData || !quizData.questions) return null;

  const currentQ = quizData.questions[currentQuestion];

  return (
    <div className="quiz-backdrop">
      <div className="quiz-container">
        <div className="quiz-header">
          <h2>📝 Quiz</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close quiz">✕</button>
        </div>

        <div className="quiz-progress">
          <div className="progress-text">Question {currentQuestion + 1} of {quizData.questions.length}</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${((currentQuestion + 1) / quizData.questions.length) * 100}%` }}></div>
          </div>
        </div>

        <div className="quiz-content">
          <div className="question-card">
            <div className="question-type-badge">{String(currentQ.type || '').replace("_", " ").toUpperCase()}</div>
            <h3 className="question-text">{currentQ.question}</h3>

            {currentQ.type === "mcq" && (
              <div className="mcq-options">
                {(currentQ.options || []).map((option, index) => (
                  <button
                    key={index}
                    className={`mcq-option ${selectedAnswer === option ? "selected" : ""} ${
                      showExplanation
                        ? option === currentQ.correct_answer
                          ? "correct"
                          : option === selectedAnswer
                          ? "incorrect"
                          : ""
                        : ""
                    }`}
                    onClick={() => !showExplanation && handleAnswerSelect(option)}
                    disabled={showExplanation}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}

            {currentQ.type === "true_false" && (
              <div className="true-false-options">
                <button
                  className={`tf-option ${selectedAnswer === "true" ? "selected" : ""} ${
                    showExplanation
                      ? String(currentQ.correct_answer) === "true"
                        ? "correct"
                        : selectedAnswer === "true"
                        ? "incorrect"
                        : ""
                      : ""
                  }`}
                  onClick={() => !showExplanation && handleAnswerSelect("true")}
                  disabled={showExplanation}
                >
                  ✓ True
                </button>
                <button
                  className={`tf-option ${selectedAnswer === "false" ? "selected" : ""} ${
                    showExplanation
                      ? String(currentQ.correct_answer) === "false"
                        ? "correct"
                        : selectedAnswer === "false"
                        ? "incorrect"
                        : ""
                      : ""
                  }`}
                  onClick={() => !showExplanation && handleAnswerSelect("false")}
                  disabled={showExplanation}
                >
                  ✗ False
                </button>
              </div>
            )}

            {currentQ.type === "short_answer" && (
              <div className="short-answer-input">
                <textarea
                  value={selectedAnswer || ""}
                  onChange={(e) => !showExplanation && handleAnswerSelect(e.target.value)}
                  placeholder="Type your answer here..."
                  disabled={showExplanation}
                  rows={4}
                />
              </div>
            )}

            {showExplanation && (
              <div className="explanation-box">
                <h4>{userAnswers[currentQuestion]?.isCorrect ? "✓ Correct!" : "✗ Incorrect"}</h4>
                <p><strong>Correct Answer:</strong> {String(currentQ.correct_answer)}</p>
                <p><strong>Explanation:</strong> {currentQ.explanation}</p>
              </div>
            )}

            <div className="question-actions">
              {!showExplanation ? (
                <button className="submit-answer-btn" onClick={handleSubmitAnswer}>Submit Answer</button>
              ) : (
                <button className="next-question-btn" onClick={handleNextQuestion}>
                  {currentQuestion < quizData.questions.length - 1 ? "Next Question →" : "View Results"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Quiz;