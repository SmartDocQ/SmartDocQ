import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "./UploadPage.css";
import { useToast } from "./ToastContext";
import History from "./History";
import Preview from "./Preview";
import Chat from "./Chat";
import { apiUrl, pyApiUrl } from "../config";

const API_URL = apiUrl("/api/document/upload"); // Node -> saves to MongoDB Atlas
const BATCH_API_URL = apiUrl("/api/document/upload/batch"); // Multi-file upload
const HISTORY_URL = apiUrl("/api/document/my"); // Node -> lists from MongoDB Atlas

const UploadPage = () => {
  const { showToast } = useToast();

  const [file, setFile] = useState(null); // primary file for preview
  const [files, setFiles] = useState([]); // all selected files for batch
  const [fileUrl, setFileUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [history, setHistory] = useState([]);
  const [uploaded, setUploaded] = useState(false);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);
  const [previewWidth, setPreviewWidth] = useState(40);
  const [lastPreviewWidth, setLastPreviewWidth] = useState(40);
  const [currentDoc, setCurrentDoc] = useState(null);


  const isOverDrop = useRef(false);
  const fileInputRef = useRef(null);

  // Supported file types: PDF, Word, and Text only
  const supportedTypes = useMemo(
    () => [
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    []
  );

  // --- Fetch history from backend ---
  const fetchHistory = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(HISTORY_URL, {
        headers: {
          Authorization: token ? `Bearer ${token}` : ''
        }
      });
      if (!res.ok) throw new Error("Failed to fetch upload history");
      const docs = await res.json();
      setHistory(
        docs.map(doc => ({
          id: doc.doc_id || doc._id, // stable id for UI keys
          name: doc.name,
          type: doc.type,
          size: doc.size,
          uploadedAt: doc.uploadedAt || doc.createdAt || new Date().toISOString(),
          documentId: doc._id, // Mongo _id for API routes
          originalName: doc.originalName, // For converted documents
          originalType: doc.originalType,  // For converted documents
          pinned: !!doc.pinned,
          pinnedAt: doc.pinnedAt || null
        }))
      );
    } catch (err) {
      showToast && showToast(err.message, { type: "error" });
    }
  }, [showToast]);

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line
  }, []);

  // --- LocalStorage persistence ---
  useEffect(() => {
    localStorage.setItem("sd_upload_history", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem("sd_ui_history_open", isHistoryOpen ? "1" : "0");
  }, [isHistoryOpen]);

  useEffect(() => {
    localStorage.setItem("sd_ui_preview_open", isPreviewOpen ? "1" : "0");
  }, [isPreviewOpen]);

  useEffect(() => {
    localStorage.setItem("sd_ui_preview_width", String(previewWidth));
  }, [previewWidth]);

  // --- Hotkeys ---
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setIsHistoryOpen((v) => !v);
      }
      if (e.ctrlKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        if (isPreviewOpen) {
          setLastPreviewWidth(previewWidth);
          setIsPreviewOpen(false);
        } else {
          setIsPreviewOpen(true);
          if (lastPreviewWidth) setPreviewWidth(lastPreviewWidth);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPreviewOpen, previewWidth, lastPreviewWidth]);

  // --- File Upload Handlers ---
  const handleFileChange = (e) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    validateAndSetFiles(list);
  };

  // Sanitize filename to prevent XSS
  const sanitizeFilename = (filename) => {
    return filename
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\//g, '&#x2F;');
  };

  // Validate filename
  const validateFilename = (filename) => {
    // Check for invalid characters that could cause issues
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(filename)) {
      return false;
    }
    // Check filename length (max 255 characters)
    if (filename.length > 255) {
      return false;
    }
    return true;
  };

  const validateAndSetFiles = (incoming) => {
    const maxSizeMb = 25;
    const accepted = [];
    const rejected = [];
    for (const f of incoming) {
      if (!supportedTypes.includes(f.type)) {
        rejected.push(`${f.name}: unsupported type`);
        continue;
      }
      if (f.size > maxSizeMb * 1024 * 1024) {
        rejected.push(`${f.name}: too large (> ${maxSizeMb}MB)`);
        continue;
      }
      if (!validateFilename(f.name)) {
        rejected.push(`${f.name}: invalid filename`);
        continue;
      }
      accepted.push(f);
    }
    if (rejected.length) {
      showToast && showToast(`Some files were skipped: ${rejected.slice(0,3).join("; ")}${rejected.length>3?"…":""}`, { type: "warning" });
    }
    if (!accepted.length) return;
    // Append to existing selections and de-duplicate by name+size+lastModified
    setFiles(prev => {
      const combo = [...prev, ...accepted];
      const seen = new Set();
      const uniq = [];
      for (const f of combo) {
        const key = `${f.name}|${f.size}|${f.lastModified}`;
        if (!seen.has(key)) { seen.add(key); uniq.push(f); }
      }
      // If this is the first time we have any file, set preview
      if (!file && uniq.length) {
        const first = uniq[0];
        setFile(first);
        const url = URL.createObjectURL(first);
        setFileUrl((prevUrl) => { if (prevUrl) URL.revokeObjectURL(prevUrl); return url; });
      }
      return uniq;
    });
  };

  // Clear currently selected local files (before upload)
  const clearSelectedFiles = () => {
    setFiles([]);
    setFile(null);
    setUploaded(false);
    setFileUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Clear only the selection UI (keep any open preview/chat)
  const clearFileSelection = () => {
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Remove an individual file from the current selection
  const removeSelectedFile = (targetKey) => {
    setFiles((prev) => {
      const next = prev.filter((f) => `${f.name}|${f.size}|${f.lastModified}` !== targetKey);
      // If the primary file is removed, reassign or clear
      if (file && `${file.name}|${file.size}|${file.lastModified}` === targetKey) {
        if (next.length) setFile(next[0]); else setFile(null);
      }
      return next;
    });
  };

  // --- UPDATED UPLOAD HANDLER ---
  const handleUpload = async () => {
  const selected = files.length ? files : (file ? [file] : []);
  if (!selected.length) {
    showToast && showToast("Please select file(s) first", { type: "warning" });
    return;
  }
  setIsUploading(true);
  setUploadProgress(0);

  const formData = new FormData();
  const useBatch = selected.length > 1;
  if (useBatch) {
    // Backend caps at 10 per request
    const batch = selected.slice(0, 10);
    batch.forEach(f => formData.append("files", f));
  } else {
    formData.append("file", selected[0]);
  }

  const start = Date.now();
  const interval = setInterval(() => {
    setUploadProgress((p) => {
      const elapsed = Date.now() - start;
      return Math.min(95, p + Math.max(1, Math.floor(elapsed / 500)));
    });
  }, 200);

  try {
    const token = localStorage.getItem("token");
    const res = await fetch(useBatch ? BATCH_API_URL : API_URL, {
      method: "POST",
      body: formData,
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Upload failed");

    clearInterval(interval);
    setUploadProgress(100);
    setIsUploading(false);

    if (useBatch) {
      const count = Array.isArray(data.items) ? data.items.length : selected.length;
      const convertedCount = Array.isArray(data.items) ? data.items.filter(item => item.converted).length : 0;
      let message = `Uploaded ${count} file(s)`;
      if (convertedCount > 0) {
        message += ` (${convertedCount} Word document${convertedCount > 1 ? 's' : ''} converted to PDF)`;
      }
      showToast && showToast(message, { type: "success" });
      // Clear just the selected files UI after successful batch upload
      clearFileSelection();
    } else {
      const f0 = selected[0];
      let message = `Uploaded ${sanitizeFilename(f0.name)}`;
      if (data.converted) {
        message += " (converted to PDF)";
      }
      showToast && showToast(message, { type: "success" });
      
      // Set currentDoc so chat works (prefer doc_id if provided)
      const currentDocData = {
        id: data.doc_id || data.documentId,
        name: data.converted ? f0.name.replace(/\.(docx?|DOCX?)$/, ".pdf") : f0.name,
        type: data.converted ? "application/pdf" : f0.type,
        size: f0.size,
        uploadedAt: new Date().toISOString(),
        documentId: data.documentId
      };
      setCurrentDoc(currentDocData);
      setUploaded(true);
      
      // If converted to PDF, automatically display it
      if (data.converted) {
        try {
          // Get the converted PDF from the server
          const token = localStorage.getItem("token");
          const downloadUrl = apiUrl(`/api/document/${data.documentId}/download`);
          fetch(downloadUrl, {
            headers: { Authorization: `Bearer ${token}` }
          }).then(async (downloadRes) => {
            if (downloadRes.ok) {
              const blob = await downloadRes.blob();
              const url = URL.createObjectURL(blob);
              // Keep URL for fallback open-in-new-tab, but pass File to preview so react-pdf can read locally
              const fileObj = new File([blob], currentDocData.name, { type: "application/pdf" });
              setFile(fileObj);
              setFileUrl(url);
              setIsPreviewOpen(true);
              showToast && showToast(`Displaying converted PDF: ${currentDocData.name}`, { type: "info" });
            }
          }).catch((err) => {
            console.error("Error loading converted PDF:", err);
          });
        } catch (err) {
          console.error("Error setting up converted PDF preview:", err);
        }
      }
    }
    // Clear file chooser selection after any upload
    clearFileSelection();
    fetchHistory();

  } catch (err) {
    clearInterval(interval);
    setIsUploading(false);
    showToast && showToast(err.message, { type: "error" });
  }
};


  // --- Drag & Drop ---
  const onDragOver = (e) => {
    e.preventDefault();
    isOverDrop.current = true;
  };
  const onDragLeave = () => {
    isOverDrop.current = false;
  };
  const onDrop = (e) => {
    e.preventDefault();
    isOverDrop.current = false;
    const list = Array.from(e.dataTransfer.files || []);
    if (list.length) validateAndSetFiles(list);
  };

  // --- Helpers ---
  const formatBytes = (bytes) => {
    if (!bytes) return "0 B";
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };
  const removeHistoryItem = async (id) => {
  try {
    const token = localStorage.getItem("token");
    const res = await fetch(apiUrl(`/api/document/${id}`), {
      method: "DELETE",
      headers: {
        Authorization: token ? `Bearer ${token}` : ''
      }
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "Delete failed");
    }
    
    // If the deleted document is currently being viewed, clear the chat and reset view
    const currentDocId = currentDoc?.documentId || currentDoc?._id || currentDoc?.id;
    if (currentDocId === id) {
      setChat([]);
      setCurrentDoc(null);
      setUploaded(false);
      setIsPreviewOpen(false);
    }
    
    showToast && showToast("Document deleted successfully", { type: "success" });
    fetchHistory(); // Refresh from backend
  } catch (err) {
    showToast && showToast(err.message, { type: "error" });
  }
};
  const selectHistoryItem = async (item) => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        showToast && showToast("Please login to view the document", { type: "error" });
        return;
      }
      
      // Show loading state immediately
      setCurrentDoc(item);
      setUploaded(true);
      setIsPreviewOpen(true);
      setFile({ name: item.name, type: "loading" }); // Special loading type
      setFileUrl("");
      
      // For Word docs that were converted to PDF, treat them as PDF for preview
      const isOriginallyWord = (item.originalType === "application/msword" || 
                               item.originalType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      const isConvertedToPdf = isOriginallyWord && item.type === "application/pdf";
      
      if (isConvertedToPdf || item.type === "application/pdf") {
        // Direct PDF preview (either original PDF or converted from Word)
        const downloadUrl = apiUrl(`/api/document/${item.documentId}/download`);
        const downloadRes = await fetch(downloadUrl, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (downloadRes.ok) {
          const blob = await downloadRes.blob();
          const url = URL.createObjectURL(blob);
          const fileObj = new File([blob], item.name, { type: "application/pdf" });
          setFile(fileObj);
          setFileUrl(url);
          if (isConvertedToPdf) {
            showToast && showToast(`Showing converted PDF: ${item.name}`, { type: "info" });
          }
        } else {
          throw new Error("Failed to load PDF");
        }
      } else {
        // For Word docs that failed conversion or other file types, try Flask preview first
        const isWord = (item.type === "application/msword" || item.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.(docx?|DOCX?)$/.test(item.name||""));
        if (isWord) {
          try {
            // Try to get PDF preview from Flask (this might be cached and fast)
            const previewUrl = pyApiUrl(`/api/document/preview/${item.id || item.documentId}.pdf`);
            const previewRes = await fetch(previewUrl);
            if (previewRes.ok) {
              // Success: use PDF preview
              setFileUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return previewUrl; });
              setFile({ name: item.name, type: "application/pdf" });
            } else {
              // Fallback: download original file for fallback display
              const res = await fetch(apiUrl(`/api/document/${item.documentId || item.id}/download`), {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (!res.ok) {
                const t = await res.text().catch(() => "");
                throw new Error(t || "Failed to download document");
              }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const f = new File([blob], item.name || "document", { type: item.type || blob.type || "application/octet-stream" });
              setFileUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
              setFile(f);
            }
          } catch (err) {
            // Error with preview, fallback to download
            const res = await fetch(apiUrl(`/api/document/${item.documentId || item.id}/download`), {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
              const t = await res.text().catch(() => "");
              throw new Error(t || "Failed to download document");
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const f = new File([blob], item.name || "document", { type: item.type || blob.type || "application/octet-stream" });
            setFileUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
            setFile(f);
          }
        } else {
          // Download the file bytes from Node and build a blob URL
          const res = await fetch(apiUrl(`/api/document/${item.documentId || item.id}/download`), {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(t || "Failed to download document");
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          // Create a File object so existing Preview logic (esp. text preview) works
          const f = new File([blob], item.name || "document", { type: item.type || blob.type || "application/octet-stream" });
          // Cleanup previous URL
          setFileUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
          setFile(f);
        }
      }

      showToast && showToast(`Opened ${sanitizeFilename(item.name)}`, { type: "info" });

      // Load chat history for this document
      try {
        const chatRes = await fetch(apiUrl(`/api/chat/${item.documentId || item._id || item.id}`), {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (chatRes.ok) {
          const data = await chatRes.json();
          setChat((data && Array.isArray(data.messages)) ? data.messages : []);
        } else {
          setChat([]);
        }
      } catch {
        setChat([]);
      }
    } catch (err) {
      showToast && showToast(err.message, { type: "error" });
    }
  };

  // Revoke object URL on unmount
  useEffect(() => {
    return () => {
      setFileUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
    };
  }, []);

  // --- ✅ Rename Handler ---
  const renameHistoryItem = async (id, newName) => {
  try {
    if (!validateFilename(newName)) {
      showToast && showToast("Invalid filename.", { type: "error" });
      return;
    }
    const token = localStorage.getItem("token");
    const res = await fetch(apiUrl(`/api/document/${id}`), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ name: newName })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "Rename failed");
    }
    showToast && showToast(`Renamed to "${sanitizeFilename(newName)}"`, { type: "success" });
    fetchHistory(); // Refresh from backend
  } catch (err) {
    showToast && showToast(err.message, { type: "error" });
  }
};

  const handlePinToggle = async (id) => {
    try {
      // Find the item to get its Mongo documentId and current pinned state
      const item = history.find(h => h.id === id);
      if (!item) return;
      const token = localStorage.getItem("token");
      const url = apiUrl(`/api/document/${item.documentId}/${item.pinned ? 'unpin' : 'pin'}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to toggle pin');
      }
      // Optimistic local update for snappy UX
      setHistory(prev => prev.map(x => x.id === id ? { ...x, pinned: !x.pinned, pinnedAt: !x.pinned ? new Date().toISOString() : null } : x));
      // Then reconcile with backend to ensure sort and state
      fetchHistory();
    } catch (e) {
      showToast && showToast(e.message || 'Failed to toggle pin', { type: 'error' });
    }
  };

const sendMessage = async () => {
  const text = chatInput.trim();
  if (!text || isTyping) return;

  const docId = currentDoc?.documentId || currentDoc?._id || currentDoc?.id;
  if (!docId) {
    setChat(prev => [...prev, { role: "assistant", text: "⚠️ No document selected", at: Date.now() }]);
    return;
  }

  const now = Date.now();
  setChat(prev => [...prev, { role: "user", text, at: now }]);
  setChatInput("");
  setIsTyping(true);

  try {
    const token = localStorage.getItem("token");
    const res = await fetch(apiUrl(`/api/chat/${docId}/message`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : ""
      },
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => ({}));
    const appended = Array.isArray(data.appended) ? data.appended : [];
    if (appended.length) {
      setChat(prev => [...prev, ...appended.filter(m => m && m.role === "assistant")]);
    }
  } catch (err) {
    setChat(prev => [
      ...prev,
      { role: "assistant", text: "⚠️ Error: " + err.message, at: Date.now() }
    ]);
  } finally {
    setIsTyping(false);
  }
};

  const clearChat = async () => {
    const docId = currentDoc?.documentId || currentDoc?._id || currentDoc?.id;
    
    // Clear frontend immediately for better UX
    setChat([]);
    
    // Also delete from backend/Atlas if document is selected
    if (docId) {
      try {
        const token = localStorage.getItem("token");
        await fetch(apiUrl(`/api/chat/${docId}`), {
          method: "DELETE",
          headers: {
            Authorization: token ? `Bearer ${token}` : ""
          }
        });
        console.log("Chat deleted from Atlas");
      } catch (err) {
        console.error("Failed to delete chat from Atlas:", err);
        // Don't show error to user since frontend is already cleared
      }
    }
  };

  return (
    <div className={`upload-container-dark ${uploaded ? "three-cols" : "two-cols"}`}>
      <History
        history={history}
        isOpen={isHistoryOpen}
        onToggle={() => setIsHistoryOpen(!isHistoryOpen)}
        onSelect={selectHistoryItem}
        onRemove={removeHistoryItem}
        onRename={renameHistoryItem}
        onPinToggle={handlePinToggle}
        formatBytes={formatBytes}
      />

      <div className={`right-section ${isHistoryOpen ? "" : "full-width"}`}>
        {!uploaded ? (
          <div className="upload-section">
            <h1 className="upload-title">📂 Upload Your Document</h1>
            <p className="upload-subtitle">
              Upload PDFs, Word files, or Text documents for SmartDocQ analysis.
            </p>
            <div
              className={`upload-box ${isOverDrop.current ? "drag-over" : ""}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <div className={`file-input-wrapper ${files.length ? 'has-file' : ''}`}>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleFileChange}
                  className="file-input"
                  id="file-upload"
                  ref={fileInputRef}
                />
                <label htmlFor="file-upload" className="file-input-button">
                  <svg viewBox="0 0 24 24">
                    <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
                  </svg>
                  {files.length ? 'Add More Files' : 'Choose Files'}
                </label>
              </div>

              {/* Selected files summary */}
              {files.length > 0 && (
                files.length === 1 ? (
                  <div className="file-info-simple">
                    <span className="file-name">{sanitizeFilename(files[0].name)}</span>
                    <span className="file-size">{formatBytes(files[0].size)}</span>
                    <button type="button" className="remove-file" aria-label="Remove selected file" onClick={clearSelectedFiles}>×</button>
                  </div>
                ) : (
                  <div className="file-list">
                    {files.map((f) => {
                      const key = `${f.name}|${f.size}|${f.lastModified}`;
                      return (
                        <div className="file-chip" key={key} title={f.name}>
                          <span className="chip-name">{sanitizeFilename(f.name)}</span>
                          <span className="chip-size">{formatBytes(f.size)}</span>
                          <button type="button" className="chip-remove" aria-label={`Remove ${f.name}`} onClick={() => removeSelectedFile(key)}>×</button>
                        </div>
                      );
                    })}
                    <div className="file-summary">
                      {files.length} files • {formatBytes(files.reduce((s,f)=>s+f.size,0))}
                      <button type="button" className="file-summary-clear" onClick={clearSelectedFiles} aria-label="Clear all files">Clear all</button>
                    </div>
                  </div>
                )
              )}

              <div className="upload-actions">
                <button
                  className="upload-button"
                  onClick={handleUpload}
                  disabled={((!files.length && !file) || isUploading)}
                >
                  {isUploading ? "Uploading..." : files.length > 1 ? "Upload All" : "Upload"}
                </button>
                <span className="upload-hint">or drag & drop here</span>
              </div>

              {isUploading && (
                <div style={{ marginTop: 16 }}>
                  {/* Simple, native progress element for maximum reliability */}
                  <progress className="progress-native" max={100} value={Math.max(0, Math.min(100, uploadProgress))} />
                  <div className="progress-native-label">{uploadProgress}%</div>
                </div>
              )}

              {/* File type restrictions notice */}
              <div className="file-restrictions">
                <p>Allowed file types: PDF, Word, and Text files</p>
                <p>Maximum file size: 25MB</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="three-cols-container">
            <Preview
              file={file}
              fileUrl={fileUrl}
              isOpen={isPreviewOpen}
              previewWidth={previewWidth}
              lastPreviewWidth={lastPreviewWidth}
              setPreviewWidth={setPreviewWidth}
              setLastPreviewWidth={setLastPreviewWidth}
              setIsPreviewOpen={setIsPreviewOpen}
              documentId={currentDoc?.documentId || currentDoc?._id || currentDoc?.id}
              filename={currentDoc?.name}
              onTextSaved={() => {
                // Refresh history so size/timestamps update for text/plain docs
                fetchHistory();
              }}
              onSummarizeSelection={async (selectedText) => {
                try {
                  const docId = currentDoc?.documentId || currentDoc?._id || currentDoc?.id;
                  if (!selectedText) {
                    showToast && showToast("Select text in the page to summarize. For PDFs opened in the built-in viewer, selection may not be accessible—copy the text or use text/Word preview.", { type: "info" });
                    return;
                  }
                  // Append the user's action into chat immediately
                  const userMsgText = `Summarize the following selection:\n\n"""\n${selectedText}\n"""`;
                  const userAt = Date.now();
                  setChat(prev => [
                    ...prev,
                    { role: 'user', text: userMsgText, at: userAt }
                  ]);
                  setIsTyping(true);
                  const res = await fetch(pyApiUrl('/api/summarize'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ selectionText: selectedText, docId })
                  });
                  const data = await res.json().catch(()=>({}));
                  if (!res.ok) throw new Error(data.error || 'Summarization failed');
                  const summary = (data && data.summary) ? data.summary : 'No summary produced.';
                  const asstAt = Date.now();
                  setChat(prev => [
                    ...prev,
                    { role: 'assistant', text: summary, at: asstAt }
                  ]);

                  // Persist both messages to chat history on the Node backend
                  if (docId) {
                    try {
                      const token = localStorage.getItem('token');
                      await fetch(apiUrl(`/api/chat/${docId}/append`), {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: token ? `Bearer ${token}` : ''
                        },
                        body: JSON.stringify({
                          messages: [
                            { role: 'user', text: userMsgText, at: userAt },
                            { role: 'assistant', text: summary, at: asstAt, rating: 'none' }
                          ]
                        })
                      });
                    } catch (persistErr) {
                      console.warn('Failed to persist summarize messages:', persistErr);
                      // Non-blocking: UI already updated; user can continue
                    }
                  }
                } catch (e) {
                  setChat(prev => [
                    ...prev,
                    { role: 'assistant', text: `⚠️ ${e.message || 'Summarization failed'}`, at: Date.now() }
                  ]);
                } finally {
                  setIsTyping(false);
                }
              }}
            />

            <Chat
              chat={chat}
              setChat={setChat}
              chatInput={chatInput}
              setChatInput={setChatInput}
              sendMessage={sendMessage}
              clearChat={clearChat}
              isTyping={isTyping}
              documentId={currentDoc?.documentId || currentDoc?._id || currentDoc?.id}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default UploadPage;