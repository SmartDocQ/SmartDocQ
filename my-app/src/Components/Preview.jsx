import { useEffect, useRef, useState } from "react";
import "./Preview.css";

const Preview = ({
  file,
  fileUrl,
  isOpen,
  previewWidth,
  lastPreviewWidth,
  setPreviewWidth,
  setLastPreviewWidth,
  setIsPreviewOpen,
}) => {
  const previewRef = useRef(null);

  // Handle keyboard shortcut for toggling preview panel
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        if (isOpen) {
          setLastPreviewWidth(previewWidth);
          setIsPreviewOpen(false);
        } else {
          setIsPreviewOpen(true);
          setPreviewWidth(lastPreviewWidth ?? 40);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, previewWidth, lastPreviewWidth, setPreviewWidth, setLastPreviewWidth, setIsPreviewOpen]);

  const handleToggle = () => {
    if (isOpen) {
      setLastPreviewWidth(previewWidth);
      setIsPreviewOpen(false);
    } else {
      setIsPreviewOpen(true);
      setPreviewWidth(lastPreviewWidth ?? 40);
    }
  };

  return (
    <div
      className={`preview-section ${isOpen ? "open" : "closed"}`}
      ref={previewRef}
      style={{ width: isOpen ? `${previewWidth}%` : "60px" }}
    >
      <div className="preview-header">
        <h2>Document Preview</h2>
        <button
          className="preview-toggle"
          title={isOpen ? "Collapse preview (Ctrl+P)" : "Expand preview (Ctrl+P)"}
          aria-label="Toggle preview panel"
          aria-expanded={isOpen}
          onClick={handleToggle}
        >
          📰
        </button>
      </div>

      {isOpen && (
        <div className="preview-content">
          {file ? <PreviewRenderer file={file} fileUrl={fileUrl} /> : <EmptyPreview />}
        </div>
      )}
    </div>
  );
};

// --- Inner Components ---
function PreviewRenderer({ file, fileUrl }) {
  if (!file) return null;

  const type = file.type;
  const extension = file.name?.split(".").pop().toLowerCase();

  // Loading state for document preview
  if (type === "loading") {
    return (
      <div className="preview-loading">
        <div className="loading-spinner"></div>
        <p>Loading document preview...</p>
        <p className="loading-subtitle">Please wait while we prepare your document</p>
      </div>
    );
  }

  // PDF preview
  if (type === "application/pdf" || extension === "pdf") {
    return (
      <div className="pdf-preview">
        <div className="pdf-frame-wrapper">
          <object data={fileUrl} type="application/pdf" className="pdf-frame">
            <div className="preview-fallback">
              <p>PDF preview not supported.</p>
              <a href={fileUrl} target="_blank" rel="noreferrer" className="fallback-link">
                Open in new tab
              </a>
            </div>
          </object>
        </div>
      </div>
    );
  }

  // Text preview
  if (type === "text/plain" || extension === "txt") {
    return <PlainTextPreview file={file} />;
  }

  // Word preview fallback
  if (
    type === "application/msword" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "doc" ||
    extension === "docx"
  ) {
    return (
      <div className="preview-fallback">
        <div className="fallback-icon">📝</div>
        <p>Word Document</p>
        <p className="fallback-subtitle">Converting to PDF for preview...</p>
        <div className="loading-spinner" style={{margin: "10px auto"}}></div>
        <a href={fileUrl} target="_blank" rel="noreferrer" className="fallback-link">
          Open in Word
        </a>
      </div>
    );
  }

  return (
    <div className="preview-fallback">
      <div className="fallback-icon">📄</div>
      <p>Preview not available</p>
      <p className="fallback-subtitle">For this file type</p>
    </div>
  );
}

function PlainTextPreview({ file }) {
  const [text, setText] = useState("Loading...");
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [status, setStatus] = useState("saved");
  const textareaRef = useRef(null);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result?.toString() ?? "";
      setText(content);
      setEditedText(content);
      setStatus("saved");
    };
    reader.onerror = (err) => {
      console.error("File read error:", err);
      setText("Failed to load text preview.");
      setEditedText("Failed to load text preview.");
    };
    reader.readAsText(file);
  }, [file]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current && isEditing) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editedText, isEditing]);

  // Handle Ctrl+S shortcut for saving text
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isEditing && (e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        setText(editedText);
        setIsEditing(false);
        setStatus("saved");
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, editedText]);

  const handleEdit = () => {
    setIsEditing(true);
    setStatus("unsaved");
    // Focus the textarea after enabling edit mode
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
      // Trigger auto-resize after focusing
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }, 10);
  };

  const handleSave = () => {
    setText(editedText);
    setIsEditing(false);
    setStatus("saved");
  };

  const handleCancel = () => {
    setEditedText(text);
    setIsEditing(false);
    setStatus("saved");
  };

  const handleTextChange = (e) => {
    setEditedText(e.target.value);
    if (status === "saved") {
      setStatus("unsaved");
    }
  };

  return (
    <div className="text-preview">
      <div className="text-preview-controls">
        {isEditing ? (
          <>
            <button className="text-control-btn save-btn" onClick={handleSave}>
              Save
            </button>
            <button className="text-control-btn cancel-btn" onClick={handleCancel}>
              Cancel
            </button>
          </>
        ) : (
          <button className="text-control-btn edit-btn" onClick={handleEdit}>
            Edit
          </button>
        )}
        <div className={`text-status ${status}`}>
          {status === "saved" ? "✓ Saved" : "• Unsaved changes"}
        </div>
      </div>
      
      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="txt-preview txt-editor"
          value={editedText}
          onChange={handleTextChange}
          spellCheck="false"
          rows={1}
        />
      ) : (
        <pre className="txt-preview">{text}</pre>
      )}
    </div>
  );
}

function EmptyPreview() {
  return (
    <div className="preview-empty-state">
      <div className="empty-icon">📄</div>
      <p className="empty-text">No document selected</p>
      <p className="empty-subtitle">Select a document to preview</p>
    </div>
  );
}

export default Preview;