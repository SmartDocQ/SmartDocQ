import React, { useState, useEffect } from "react";
import { apiFetch } from "../config";
import { Edit2, Check, X } from "lucide-react";
import "./SpreadsheetPreview.css";


const formatCellValue = (val) => {
  if (val === null || val === undefined) return "";
  const strVal = String(val).trim();
  // Check for YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD
  const dateTimeRegex = /^(\d{4})-(\d{2})-(\d{2})(?:\s|T)(\d{2}):(\d{2}):(\d{2})$/;
  const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;

  let match = strVal.match(dateTimeRegex) || strVal.match(dateRegex);
  if (match) {
    const year = match[1];
    const monthIndex = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (monthIndex >= 0 && monthIndex < 12) {
      return `${day} ${months[monthIndex]} ${year}`;
    }
  }
  return strVal;
};

const SpreadsheetPreview = ({ documentId, fileType }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [workbook, setWorkbook] = useState(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);

  // Cell Editing States
  const [isEditMode, setIsEditMode] = useState(false);
  const [draftRows, setDraftRows] = useState(null);
  const [mutationsDraft, setMutationsDraft] = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!documentId) {
      setWorkbook(null);
      setError("");
      return;
    }

    const controller = new AbortController();
    const fetchSpreadsheetPreview = async () => {
      setLoading(true);
      setError("");
      setWorkbook(null);
      try {
        const res = await apiFetch(`/api/document/${documentId}/preview/spreadsheet`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Failed to load spreadsheet preview");
        }

        const data = await res.json();
        setWorkbook(data);
        setSelectedSheetIndex(0);
      } catch (err) {
        if (err.name === "AbortError") return;
        console.error("Error fetching spreadsheet preview:", err);
        setError(err.message || "Unable to preview spreadsheet");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchSpreadsheetPreview();

    return () => {
      controller.abort();
    };
  }, [documentId]);

  // If active sheet changes, cancel any active edit mode
  useEffect(() => {
    setIsEditMode(false);
    setDraftRows(null);
    setMutationsDraft([]);
    setEditingCell(null);
  }, [selectedSheetIndex]);

  const handleStartEdit = () => {
    if (!workbook || !workbook.sheets || workbook.sheets.length === 0) return;
    const activeSheet = workbook.sheets[selectedSheetIndex];
    setIsEditMode(true);
    setDraftRows(JSON.parse(JSON.stringify(activeSheet.rows)));
    setMutationsDraft([]);
    setEditingCell(null);
  };

  const handleCancelEdit = () => {
    setIsEditMode(false);
    setDraftRows(null);
    setMutationsDraft([]);
    setEditingCell(null);
  };

  const commitCellChange = () => {
    if (!editingCell) return;
    const { rowIndex, colIndex, value } = editingCell;
    const activeSheet = workbook.sheets[selectedSheetIndex];

    const updatedDraftRows = [...draftRows];
    updatedDraftRows[rowIndex][colIndex] = value;
    setDraftRows(updatedDraftRows);

    const originalValue = activeSheet.rows[rowIndex][colIndex];
    const mutations = mutationsDraft.filter(m => !(m.row === rowIndex && m.column === colIndex));

    if (String(originalValue) !== String(value)) {
      mutations.push({
        type: "update",
        row: rowIndex,
        column: colIndex,
        value: value
      });
    }
    setMutationsDraft(mutations);
    setEditingCell(null);
  };

  const handleSaveAll = async () => {
    if (mutationsDraft.length === 0) {
      setIsEditMode(false);
      setDraftRows(null);
      return;
    }

    setSaving(true);
    const activeSheet = workbook.sheets[selectedSheetIndex];

    try {
      const response = await apiFetch(`/api/document/${documentId}/table`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sheet: activeSheet.name,
          __v: activeSheet.__v || 0,
          mutations: mutationsDraft,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to save cell edits");
      }

      // Success: update the main workbook state permanently
      const updatedSheets = [...workbook.sheets];
      updatedSheets[selectedSheetIndex].rows = draftRows;
      if (updatedSheets[selectedSheetIndex].__v !== undefined) {
        updatedSheets[selectedSheetIndex].__v += 1;
      }
      setWorkbook({ ...workbook, sheets: updatedSheets });

      setToast({ message: "Changes saved successfully!", type: "success" });
      setTimeout(() => setToast(null), 3000);
      setIsEditMode(false);
      setDraftRows(null);
      setMutationsDraft([]);
    } catch (err) {
      console.error("Failed to save cell edits:", err);
      setToast({ message: err.message || "Failed to save changes", type: "error" });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="spreadsheet-loading" aria-live="polite">
        <div className="spinner"></div>
        <p>Loading spreadsheet preview...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="spreadsheet-error" role="alert">
        <p className="spreadsheet-error-title">Unable to preview spreadsheet</p>
        <p className="spreadsheet-error-subtitle">{error}</p>
        <p className="spreadsheet-error-subtitle" style={{ marginTop: 8 }}>
          Download the file to view the full document.
        </p>
      </div>
    );
  }

  if (!workbook || !workbook.sheets || workbook.sheets.length === 0) {
    return (
      <div className="spreadsheet-empty">
        <p className="spreadsheet-empty-title">No spreadsheet data available</p>
      </div>
    );
  }

  const activeSheet = workbook.sheets[selectedSheetIndex];

  return (
    <div className="spreadsheet-preview">
      {/* Action Header panel */}
      <div className="spreadsheet-actions">
        {isEditMode ? (
          <>
            <button className="btn-spreadsheet save" onClick={handleSaveAll} disabled={saving}>
              <Check size={14} style={{ marginRight: 6 }} />
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button className="btn-spreadsheet cancel" onClick={handleCancelEdit} disabled={saving}>
              <X size={14} style={{ marginRight: 6 }} />
              Cancel
            </button>
          </>
        ) : (
          <button className="btn-spreadsheet edit" onClick={handleStartEdit}>
            <Edit2 size={12} style={{ marginRight: 6 }} />
            Edit Table
          </button>
        )}
      </div>

      {workbook.sheets.length > 1 && (
        <div className="sheet-tabs" role="tablist" aria-label="Spreadsheet sheets">
          {workbook.sheets.map((sheet, index) => (
            <button
              key={index}
              role="tab"
              aria-selected={selectedSheetIndex === index}
              className={`sheet-tab-button ${selectedSheetIndex === index ? "active" : ""}`}
              onClick={() => setSelectedSheetIndex(index)}
              title={sheet.name}
              disabled={isEditMode}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {(!activeSheet || (activeSheet.rows.length === 0 && activeSheet.headers.length === 0)) ? (
        <div className="spreadsheet-empty">
          <p className="spreadsheet-empty-title">No spreadsheet data available</p>
        </div>
      ) : (
        <>
          <div className="grid-container">
            <table className="spreadsheet-table">
              <thead>
                <tr>
                  <th className="row-index-header" aria-label="Row number"></th>
                  {activeSheet.headers.map((header, idx) => (
                    <th key={idx} title={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(isEditMode ? draftRows : activeSheet.rows).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td className="row-index-cell">{rowIndex + 1}</td>
                    {row.map((cell, colIndex) => {
                      const isEditing = editingCell && editingCell.rowIndex === rowIndex && editingCell.colIndex === colIndex;
                      const formatted = formatCellValue(cell);
                      
                      const isModified = draftRows && draftRows[rowIndex][colIndex] !== activeSheet.rows[rowIndex][colIndex];
                      let tdClass = "";
                      if (isEditMode) {
                        tdClass = isModified ? "editable-cell modified-cell" : "editable-cell";
                      }

                      return (
                        <td 
                          key={colIndex} 
                          className={tdClass}
                          title={isEditing ? undefined : formatted}
                          onClick={() => {
                            if (isEditMode && !saving) {
                              setEditingCell({ rowIndex, colIndex, value: String(cell || "") });
                            }
                          }}
                        >
                          {isEditing ? (
                            <input
                              className="editing-cell-input"
                              value={editingCell.value}
                              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                              onBlur={commitCellChange}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitCellChange();
                                if (e.key === "Escape") setEditingCell(null);
                              }}
                              autoFocus
                            />
                          ) : (
                            formatted
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="spreadsheet-footer">
            <span>
              {workbook.type === "xlsx" ? `${activeSheet.name} · ` : ""}
              {activeSheet.truncated
                ? `Showing ${activeSheet.rows.length} of ${activeSheet.rowCount} rows`
                : `${activeSheet.rowCount} rows`}{" "}
              · {activeSheet.columnCount} columns
            </span>
          </div>
        </>
      )}

      {toast && (
        <div className={`spreadsheet-toast ${toast.type}`}>
          {toast.type === "success" ? "✓" : "⚠"} {toast.message}
        </div>
      )}
    </div>
  );
};

export default SpreadsheetPreview;
