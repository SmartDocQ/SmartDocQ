import './History.css';
import { useState, useMemo, useCallback } from 'react';
import Lottie from "lottie-react";
import hd from "../Animations/H-D.json";
import dl from "../Animations/Bin.json";

// Define prop types for validation
const HistoryPropTypes = {
  history: (props) => {
    if (!Array.isArray(props.history)) {
      return new Error('History prop must be an array');
    }
    return null;
  },
  onToggle: (props) => {
    if (typeof props.onToggle !== 'function') {
      return new Error('onToggle must be a function');
    }
    return null;
  },
  onSelect: (props) => {
    if (typeof props.onSelect !== 'function') {
      return new Error('onSelect must be a function');
    }
    return null;
  },
  onRemove: (props) => {
    if (typeof props.onRemove !== 'function') {
      return new Error('onRemove must be a function');
    }
    return null;
  },
  onRename: (props) => {
    if (typeof props.onRename !== 'function') {
      return new Error('onRename must be a function');
    }
    return null;
  },
  onPinToggle: (props) => {
    if (typeof props.onPinToggle !== 'function') {
      return new Error('onPinToggle must be a function');
    }
    return null;
  },
  formatBytes: (props) => {
    if (typeof props.formatBytes !== 'function') {
      return new Error('formatBytes must be a function');
    }
    return null;
  }
};

const History = ({
  history = [],
  isOpen,
  onToggle,
  onSelect,
  onRemove,
  onRename,
  onPinToggle,
  formatBytes
}) => {
  const [editingId, setEditingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [actionLock, setActionLock] = useState(false);

  const getFileIcon = useCallback(() => '📄', []);

  const formatFileType = useCallback((fileType) => {
    if (!fileType) return 'unknown';
    const type = fileType.toLowerCase();
    if (type.includes('pdf')) return 'PDF';
    if (type.includes('word') || type.includes('document') || type.includes('docx')) return 'Document';
    if (type.includes('text') || type.includes('txt')) return 'Text';
    return 'File';
  }, []);

  const filteredAndSortedHistory = useMemo(() => {
    let result = [...history];

    // Search filter
    if (searchTerm) {
      result = result.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Sorting with pinned items on top
    result.sort((a, b) => {
      // Pinned items first
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
        case 'date':
          comparison =
            new Date(a.uploadedAt || a.uploadDate || 0) -
            new Date(b.uploadedAt || b.uploadDate || 0);
          break;
        default:
          comparison = 0;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [history, searchTerm, sortBy, sortOrder]);

  const handleEditClick = useCallback((item, e) => {
    if (actionLock) return;
    e.stopPropagation();
    setEditingId(item.id);
    setNewName(item.name);
  }, [actionLock]);

  const handleSaveRename = useCallback((e) => {
    e.stopPropagation();
    if (newName.trim() !== '' && !actionLock) {
      setActionLock(true);
      Promise.resolve(onRename(editingId, newName.trim()))
        .then(() => {
          setEditingId(null);
          setNewName('');
        })
        .finally(() => setActionLock(false));
    }
  }, [newName, editingId, onRename, actionLock]);

  const handleCancelEdit = useCallback((e) => {
    e.stopPropagation();
    if (actionLock) return;
    setEditingId(null);
    setNewName('');
  }, [actionLock]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleSaveRename(e);
    else if (e.key === 'Escape') handleCancelEdit(e);
  }, [handleSaveRename, handleCancelEdit]);

  const handleDeleteClick = useCallback((item, e) => {
    if (actionLock) return;
    e.stopPropagation();
    setItemToDelete(item);
    setShowDeleteConfirm(true);
  }, [actionLock]);

  const confirmDelete = useCallback(() => {
    if (itemToDelete && !actionLock) {
      setActionLock(true);
      Promise.resolve(onRemove(itemToDelete.id))
        .then(() => {
          setShowDeleteConfirm(false);
          setItemToDelete(null);
        })
        .finally(() => setActionLock(false));
    }
  }, [itemToDelete, onRemove, actionLock]);

  const cancelDelete = useCallback(() => {
    if (actionLock) return;
    setShowDeleteConfirm(false);
    setItemToDelete(null);
  }, [actionLock]);

  const handleSortChange = useCallback((e) => {
    setSortBy(e.target.value);
  }, []);

  const toggleSortOrder = useCallback(() => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  }, [sortOrder]);

  const handlePinClick = useCallback((item, e) => {
    e.stopPropagation();
    if (actionLock) return;
    onPinToggle(item.id);
  }, [actionLock, onPinToggle]);

  return (
    <>
      <div className={`history-section ${isOpen ? "open" : "closed"}`}>
        <div className="history-header">
          <h2>Upload History</h2>
          <button
            className="history-toggle"
            title={isOpen ? "Close sidebar (Ctrl+B)" : "Open sidebar (Ctrl+B)"}
            aria-label="Toggle history sidebar"
            onClick={onToggle}
            disabled={actionLock}
          >🗂️</button>
        </div>

        {isOpen && (
          <div className="history-list-wrapper">
            <div className="history-controls">
              <div className="search-container">
                <div className="search-icon">🔍</div>
                <input
                  type="text"
                  placeholder="Search files..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                  disabled={actionLock}
                />
                {searchTerm && (
                  <button
                    className="clear-search"
                    onClick={() => setSearchTerm('')}
                    aria-label="Clear search"
                    disabled={actionLock}
                  >✕</button>
                )}
              </div>

              <div className="sort-container">
                <select
                  value={sortBy}
                  onChange={handleSortChange}
                  className="sort-select"
                  disabled={actionLock}
                >
                  <option value="name">Sort by Name</option>
                  <option value="date">Sort by Date</option>
                  <option value="size">Sort by Size</option>
                </select>
                <button
                  className="sort-order"
                  onClick={toggleSortOrder}
                  title={sortOrder === 'asc' ? "Ascending" : "Descending"}
                  aria-label={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
                  disabled={actionLock}
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>

            {filteredAndSortedHistory.length === 0 ? (
              <div className="history-empty-state">
                <Lottie id="ei" animationData={hd} loop={true}/>
                <p className="history-empty">
                  {searchTerm ? "No matching files found" : "No files uploaded yet"}
                </p>
                <p className="empty-subtitle" id="es">
                  {searchTerm ? "Try a different search term" : "Your uploaded files will appear here"}
                </p>
              </div>
            ) : (
              <ul className="history-list">
                {filteredAndSortedHistory.map((item) => (
                  <li
                    key={item.id}
                    className={`history-item ${item.pinned ? 'pinned-item' : ''}`}
                    onClick={() => !actionLock && onSelect(item)}
                  >
                    <div className="file-info">
                      <div className="file-icon">{getFileIcon()}</div>
                      <div className="file-size">{formatBytes(item.size)}</div>
                    </div>

                    <div className="item-details">
                      {editingId === item.id ? (
                        <div className="edit-mode">
                          <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="rename-input"
                            autoFocus
                            disabled={actionLock}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="edit-actions">
                            <button
                              className="save-btn"
                              onClick={handleSaveRename}
                              title="Save"
                              disabled={actionLock}
                            >✓</button>
                            <button
                              className="cancel-btn"
                              onClick={handleCancelEdit}
                              title="Cancel"
                              disabled={actionLock}
                            >✕</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="history-name">{item.name}</div>
                          <div className="file-type">{formatFileType(item.type)}</div>
                        </>
                      )}
                    </div>

                    <div className="item-actions">
                      {/* Pin/Unpin Button - Enhanced Styling */}
                      <button
                        className={`pin-button ${item.pinned ? 'pinned' : ''}`}
                        title={item.pinned ? "Unpin from favorites" : "Pin to favorites"}
                        aria-label={item.pinned ? "Unpin document" : "Pin document"}
                        onClick={(e) => handlePinClick(item, e)}
                        disabled={actionLock || editingId !== null}
                      >
                        <span className="pin-icon">{item.pinned ? '📌' : '📍'}</span>
                      </button>

                      <button
                        className="history-edit"
                        title="Rename document"
                        aria-label="Rename document"
                        onClick={(e) => handleEditClick(item, e)}
                        disabled={actionLock || editingId !== null}
                      >✏️</button>

                      <button
                        className="history-delete"
                        title="Remove from history"
                        aria-label="Remove from history"
                        onClick={(e) => handleDeleteClick(item, e)}
                        disabled={actionLock || editingId !== null}
                      >🗑️</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {showDeleteConfirm && itemToDelete && (
        <div className="delete-confirm-overlay">
          <div className="delete-confirm-popup">
            <Lottie id="del" animationData={dl} loop={true}/>
            <p className="delete-confirm-message">
              Are you sure you want to delete "<span className="delete-filename">{itemToDelete.name}</span>"?
            </p>
            <div className="delete-confirm-actions">
              <button
                className="delete-cancel-btn"
                onClick={cancelDelete}
                disabled={actionLock}
              >Cancel</button>
              <button
                className="delete-confirm-btn"
                onClick={confirmDelete}
                disabled={actionLock}
              >
                {actionLock ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Add prop validation
History.propTypes = HistoryPropTypes;

export default History;