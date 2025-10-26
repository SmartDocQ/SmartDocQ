import { useEffect, useRef, useState } from "react";
// PDF rendering powered by pdf.js via react-pdf so selections live in our DOM (enables toolbar)
import { Document as PdfDocument, Page, pdfjs } from "react-pdf";
import { useToast } from "./ToastContext";
import { apiUrl } from "../config";
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
  documentId,
  filename,
  onTextSaved,
  onSummarizeSelection,
}) => {
  const previewRef = useRef(null);
  const [selUI, setSelUI] = useState({ visible: false, text: "", rect: null });
  const toolbarRef = useRef(null);
  const [toolbarPos, setToolbarPos] = useState({ left: 12, top: 12 });
  const [fadingOut, setFadingOut] = useState(false);
  const [justShown, setJustShown] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [lastEditEnd, setLastEditEnd] = useState(0);
  const dragStartedInPreview = useRef(false);

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

  // Show floating summarize toolbar when user selects text within the preview panel
  useEffect(() => {
    const onMouseDownCapture = (e) => {
      // track whether selection started inside preview (not inside editor)
      try {
        const t = e.target;
        const inEditor = t && t.closest && t.closest('.txt-editor');
        dragStartedInPreview.current = !!(previewRef.current && previewRef.current.contains(t) && !inEditor);
      } catch (_) {
        dragStartedInPreview.current = false;
      }
    };

    const onMouseUp = () => {
      try {
        // Suppress while editing or just after leaving editor to avoid flicker
        const ae = document.activeElement;
        if (ae && ae.classList && ae.classList.contains('txt-editor')) {
          setSelUI({ visible: false, text: "", rect: null });
          return;
        }
        if (Date.now() - lastEditEnd < 250) {
          setSelUI({ visible: false, text: "", rect: null });
          return;
        }
        if (!dragStartedInPreview.current) {
          setSelUI({ visible: false, text: "", rect: null });
          return;
        }
        const sel = window.getSelection && window.getSelection();
        const text = sel ? String(sel.toString() || "").trim() : "";
        if (!text) {
          setSelUI({ visible: false, text: "", rect: null });
          return;
        }
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const node = range.commonAncestorContainer && (range.commonAncestorContainer.nodeType === 1
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentNode);
        // Ignore if selection is inside the text editor
        try {
          if (node && typeof node.closest === 'function') {
            const inEditor = node.closest('.txt-editor');
            if (inEditor) {
              setSelUI({ visible: false, text: "", rect: null });
              return;
            }
          }
        } catch (_) { /* ignore */ }
        if (previewRef.current && node && previewRef.current.contains(node)) {
          setSelUI({
            visible: true,
            text,
            rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
          });
          setJustShown(true);
          setFadingOut(false);
          setTimeout(() => setJustShown(false), 20);
        } else {
          setSelUI({ visible: false, text: "", rect: null });
        }
      } catch (_) {
        setSelUI({ visible: false, text: "", rect: null });
      } finally {
        dragStartedInPreview.current = false;
      }
    };

    const onScrollOrResize = () => setSelUI(prev => ({ ...prev, visible: false }));

    const onMouseDown = (e) => {
      if (!selUI.visible) return;
      if (toolbarRef.current && toolbarRef.current.contains(e.target)) return;
      if (selUI.rect) {
        const pad = 3;
        const { left, top, right, bottom } = selUI.rect;
        if (e.clientX >= left - pad && e.clientX <= right + pad && e.clientY >= top - pad && e.clientY <= bottom + pad) {
          return;
        }
      }
      setFadingOut(true);
      // Clear the browser text selection immediately so onMouseUp won't re-open the popup
      try {
        const s = window.getSelection && window.getSelection();
        if (s && s.removeAllRanges) s.removeAllRanges();
      } catch (_) { /* ignore */ }
      setTimeout(() => setSelUI({ visible: false, text: "", rect: null }), 160);
    };

    const onFocusIn = (e) => {
      try {
        const t = e.target;
        if (t && t.classList && t.classList.contains('txt-editor')) {
          setIsEditing(true);
        }
      } catch (_) {}
    };
    const onFocusOut = (e) => {
      try {
        const t = e.target;
        if (t && t.classList && t.classList.contains('txt-editor')) {
          setIsEditing(false);
          setLastEditEnd(Date.now());
        }
      } catch (_) {}
    };

    document.addEventListener('mousedown', onMouseDownCapture, true);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onMouseDownCapture, true);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [selUI.visible, selUI.rect, lastEditEnd]);

  // Recalculate toolbar position when selection changes or toolbar mounts
  useEffect(() => {
    if (!selUI.visible || !selUI.rect) return;
    const margin = 8;
    const tw = (toolbarRef.current?.offsetWidth) || 160;
    const th = (toolbarRef.current?.offsetHeight) || 36;
    // Prefer placing above the selection; if not enough room, place below
    let top = selUI.rect.top - th - margin;
    if (top < margin) top = selUI.rect.bottom + margin;
    // Center horizontally over the selection and clamp to viewport
    let left = selUI.rect.left + (selUI.rect.width / 2) - (tw / 2);
    left = Math.max(margin, Math.min(window.innerWidth - tw - margin, left));
    setToolbarPos({ left, top });
  }, [selUI.visible, selUI.rect]);

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
          {file ? (
            <PreviewRenderer
              file={file}
              fileUrl={fileUrl}
              documentId={documentId}
              filename={filename || file?.name}
              onTextSaved={onTextSaved}
            />
          ) : (
            <EmptyPreview />
          )}
        </div>
      )}

      {/* Floating summarize toolbar (no selection rectangle to avoid UI clutter) */}
      {selUI.visible && selUI.rect && (
        <>
          <div
            className={`selection-toolbar ${justShown ? 'enter' : ''} ${fadingOut ? 'leave' : ''}`}
            style={{
              position: 'fixed',
              zIndex: 1001,
              left: toolbarPos.left,
              top: toolbarPos.top
            }}
            ref={toolbarRef}
          >
            <button
              className="summarize-mini"
              onClick={() => {
                onSummarizeSelection && onSummarizeSelection(selUI.text);
                setFadingOut(true);
                setTimeout(() => setSelUI({ visible: false, text: "", rect: null }), 160);
                try {
                  const s = window.getSelection && window.getSelection();
                  if (s && s.removeAllRanges) s.removeAllRanges();
                } catch (_) { /* ignore */ }
              }}
              title="Summarize selection and send to chat"
            >
              Summarize
            </button>
            <button
              className="close-mini"
              onClick={() => {
                setFadingOut(true);
                setTimeout(() => setSelUI({ visible: false, text: "", rect: null }), 160);
              }}
              title="Close"
            >
              ×
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// --- Inner Components ---
function PreviewRenderer({ file, fileUrl, documentId, filename, onTextSaved }) {
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
    return <PdfPreview fileUrl={fileUrl} />;
  }

  // Text preview
  if (type === "text/plain" || extension === "txt") {
    return <PlainTextPreview file={file} documentId={documentId} filename={filename} onTextSaved={onTextSaved} />;
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

// Lightweight PDF viewer using react-pdf (pdf.js)
function PdfPreview({ fileUrl }) {
  const [numPages, setNumPages] = useState(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const wrapRef = useRef(null);

  // Ensure pdf.js worker is available (fallback to CDN if bundler doesn't provide it)
  useEffect(() => {
    try {
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.js";
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    const update = () => {
      const w = wrapRef.current?.clientWidth || 600;
      setContainerWidth(Math.max(320, Math.min(1200, w - 24)));
    };
    update();
    const ro = new ResizeObserver(update);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", update);
    return () => {
      try { ro.disconnect(); } catch (_) {}
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="pdf-preview">
      <div className="pdf-scroll" ref={wrapRef}>
        <PdfDocument
          file={fileUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={<div className="preview-loading"><div className="loading-spinner"></div><p>Loading PDF…</p></div>}
          error={
            <div className="preview-fallback">
              <p>Failed to load PDF.</p>
              <a href={fileUrl} target="_blank" rel="noreferrer" className="fallback-link">Open in new tab</a>
            </div>
          }
        >
          {Array.from(new Array(numPages || 0), (_, i) => (
            <div key={i} className="pdf-page">
              <Page
                pageNumber={i + 1}
                width={containerWidth}
                renderTextLayer
                renderAnnotationLayer={false}
              />
            </div>
          ))}
        </PdfDocument>
      </div>
    </div>
  );
}

function PlainTextPreview({ file, documentId, filename, onTextSaved }) {
  const [text, setText] = useState("Loading...");
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [status, setStatus] = useState("saved");
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef(null);
  const { showToast } = useToast();

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
        doSave();
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

  const doSave = async () => {
    if (!documentId) {
      // Local-only fallback
      setText(editedText);
      setIsEditing(false);
      setStatus("saved");
      showToast && showToast("Saved locally (no documentId)", { type: "info" });
      return;
    }

    try {
      setIsSaving(true);
      const token = localStorage.getItem("token");
      const res = await fetch(apiUrl(`/api/document/${documentId}/text`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ text: editedText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.message || data?.error || "Save failed";
        throw new Error(msg);
      }

      if (data?.requireConfirmation) {
        showToast && showToast("Sensitive content detected; indexing paused until you consent.", { type: "info" });
      } else {
        showToast && showToast("Saved and reindexed", { type: "success" });
      }
      setText(editedText);
      setIsEditing(false);
      setStatus("saved");
      onTextSaved && onTextSaved(data?.message || "Saved");
    } catch (e) {
      showToast && showToast(e.message || "Save failed", { type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = () => {
    doSave();
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
            <button className="text-control-btn save-btn" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
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