import './BodySection.css';
import video from "../Animations/Guide.mp4"
import Lottie from "lottie-react";
import arrow from "../Animations/Arrow.json";
import thumb from "../Animations/ThumbNail.png";

function BodySection() {
  const cards = [
    {
      id: 1,
      title: "Document Upload & Parsing",
      description: "Easily upload PDFs, DOCX, TXT files, or even URLs. SmartDocQ automatically extracts the text and prepares it for AI processing, handling multiple formats seamlessly.",
      icon: "1",
      gradient: "linear-gradient(45deg, #00FF88, #00BFFF)",
      iconBg: "#25c7bfff"
    },
    {
      id: 2,
      title: "Content Chunking & Embedding",
      description: "Your documents are intelligently split into meaningful segments. Each segment is converted into semantic embeddings, allowing the AI to understand context and relationships within the content.",
      icon: "2",
      gradient: "linear-gradient(45deg, #0066FF, #9933FF)",
      iconBg: "#2469d1ff"
    },
    {
      id: 3,
      title: "Vector Storage & Indexing",
      description: "All embeddings are stored in a high-performance vector database. This enables lightning-fast semantic searches across your entire document repository.",
      icon: "3",
      gradient: "linear-gradient(45deg, #FFD700, #FF8C00)",
      iconBg: "#d66920ff"
    },
    {
      id: 4,
      title: "Query-Based Retrieval",
      description: "Ask any question about your documents, and SmartDocQ retrieves the most relevant content chunks based on contextual understanding, not just keywords.",
      icon: "4",
      gradient: "linear-gradient(45deg, #9933FF, #FF69B4)",
      iconBg: "#9933FF"
    },
    {
        id: 5,
        title: "Answer Generation (RAG + LLM)",
        description: "The retrieved content is processed by Google Gemini LLM using a Retrieval-Augmented Generation pipeline. The result is accurate, concise, natural-language answers tailored to your queries.",
        icon: "5",
        gradient: "linear-gradient(45deg, #FF4500, #9400D3)",
        iconBg: "#bc2d58ff"
      },
      {
        id: 6,
        title: "Interactive User Interface",
        description: "Receive answers instantly through a clean, responsive interface. Users can interact with documents and AI insights in real time, making information retrieval effortless.",
        icon: "6",
        gradient: "linear-gradient(45deg, #7CFC00, #FF1493)",
        iconBg: "#be9b3cff"
      }
  ];

  return (
    <>
    <div className="body-section">
      
      <div className="cards-grid">
        {cards.map((card) => (
          <div key={card.id} className="dark-card" style={{ '--card-gradient': card.gradient, '--icon-bg': card.iconBg }}>
            <div className="card-border"></div>
            <div className="card-content">
              <div className="card-icon" style={{ backgroundColor: card.iconBg }}>
                {card.icon}
              </div>
              <h3 className="card-title">{card.title}</h3>
              <p className="card-description">{card.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
    <h4 className="work-title">Get Started with SmartDocQ in 3 Simple Steps</h4>
    <section className="how-to-use">
      <div className="container">
        <div className="video-section">
          <video autoPlay loop playsInline muted draggable="false" disablePictureInPicture poster={thumb}>
            <source src={video} type="video/mp4"/>Your browser does not support the video tag.</video>
        </div>
        <div className="steps-section">
          <div className="step">
            <h3><span>Step 1:</span> Upload Your Documents</h3>
            <p>Drag and drop PDFs, DOCX, or TXT files into SmartDocQ.</p>
          </div>
          <div className="arrow-wrapper"><Lottie animationData={arrow} loop autoplay className="arrow" /></div>
          <div className="step">
            <h3><span>Step 2:</span> Ask Your Question</h3>
            <p>Type your query naturally, without worrying about keywords.</p>
          </div>
          <div className="arrow-wrapper"><Lottie animationData={arrow} loop autoplay className="arrow" /></div>
          <div className="step">
            <h3><span>Step 3:</span> Get Instant Answers</h3>
            <p>SmartDocQ delivers clear, context-based answers in real time.</p>
          </div>
        </div>
      </div>
    </section>
    </>    
  );
}

export default BodySection;
