import React, { useEffect, useState, useCallback } from "react";
import "./AdminDashboard.css";
import "./ReportManagement.css";
import { apiUrl } from "../../config";

const ReportManagement = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [limit] = useState(20);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [summary, setSummary] = useState({ total: 0, new: 0, unread: 0, resolved: 0, byCategory: {} });
  const [detail, setDetail] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteReport, setPendingDeleteReport] = useState(null);

  const fetchReports = useCallback(async (opts = {}) => {
    try {
      setLoading(true);
      setError("");
      const token = localStorage.getItem("token");
      const params = new URLSearchParams({
        page: String(opts.page ?? page),
        limit: String(limit),
      });
      if (status) params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
  const res = await fetch(apiUrl(`/api/admin/contact-reports?${params.toString()}`), {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (!res.ok) throw new Error(`Failed to load reports (${res.status})`);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setPage(data.pagination?.page || 1);
      setPages(data.pagination?.pages || 1);
    } catch (err) {
      console.error("Fetch reports error:", err);
      setError(err?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [page, limit, status, search, startDate, endDate]);

  useEffect(() => { fetchReports({ page: 1 }); }, [fetchReports]);

  const fetchSummary = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
  const res = await fetch(apiUrl("/api/admin/contact-reports/analytics/summary"), {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (!res.ok) return;
      const data = await res.json();
      setSummary(data);
    } catch (_) { /* ignore */ }
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const updateStatus = async (id, nextStatus) => {
    try {
      const token = localStorage.getItem("token");
  const res = await fetch(apiUrl(`/api/admin/contact-reports/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" },
        body: JSON.stringify({ status: nextStatus })
      });
      if (!res.ok) throw new Error("Failed to update status");
      await fetchReports({ page });
      // reflect change in detail modal if open
      setDetail((prev)=> prev && prev._id === id ? { ...prev, status: nextStatus } : prev);
      // refresh summary
      fetchSummary();
    } catch (err) {
      alert(err?.message || "Failed to update report");
    }
  };


  const deleteReport = async (id) => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
  const res = await fetch(apiUrl(`/api/admin/contact-reports/${id}`), {
        method: "DELETE",
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (!res.ok) throw new Error("Failed to delete report");
      await fetchReports({ page });
    } catch (err) {
      console.error("Delete report error:", err);
      alert(err?.message || "Failed to delete report");
    } finally {
      setLoading(false);
      setConfirmOpen(false);
      setPendingDeleteReport(null);
    }
  };

  return (
    <div className="report-management">
      <h2>Report Management</h2>

      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        {[{
          title: 'Total Messages', value: summary.total || 0, gradient: 'linear-gradient(135deg,#00FF88,#00CC6A)'
        },{
          title: 'New / Unread', value: summary.new || summary.unread || 0, gradient: 'linear-gradient(135deg,#3b82f6,#2563eb)'
        },{
          title: 'Resolved', value: summary.resolved || 0, gradient: 'linear-gradient(135deg,#22c55e,#16a34a)'
        }].map((c, i) => (
          <div key={i} className="kpi-card">
            <div className="kpi-content">
              <div className="kpi-header"><span className="kpi-title">{c.title}</span></div>
              <div className="kpi-value">{c.value}</div>
            </div>
            <div className="kpi-gradient" style={{ background: c.gradient }}></div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="report-filters" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          className="search-input"
          placeholder="Search name, email, subject, message"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="sort-select" value={status} onChange={(e)=> setStatus(e.target.value)}>
          <option value="">Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
        <input type="date" value={startDate} onChange={(e)=> setStartDate(e.target.value)} />
        <input type="date" value={endDate} onChange={(e)=> setEndDate(e.target.value)} />
        <button className="page-btn" onClick={()=>fetchReports({ page: 1 })} disabled={loading}>Apply</button>
        <button className="page-btn" onClick={()=>{ setSearch(""); setStatus(""); setStartDate(""); setEndDate(""); fetchReports({ page: 1 }); }} disabled={loading}>Clear</button>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="reports-table-container">
        <table className="reports-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Contact</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r._id}>
                <td>
                  <div className="user-details">
                    <div className="user-name">{r.name || r.user?.name || '—'}</div>
                    <div style={{ fontSize: 12, color: '#aaa' }}>{r.user?._id || 'Guest'}</div>
                  </div>
                </td>
                <td>{r.email || r.user?.email || '—'}</td>
                <td>{r.subject}</td>
                <td>
                  <span
                    className={`report-status-badge ${r.status}`}
                    title={r.status.replace('_', ' ')}
                  >
                    {r.status === 'open' ? 'Open' : r.status === 'in_progress' ? 'In Progress' : 'Resolved'}
                  </span>
                </td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  <div className="report-actions">
                    <button className="page-btn" onClick={()=> setDetail(r)} title="View">View</button>
                    <button
                      className="delete-report-btn"
                      onClick={()=> { setPendingDeleteReport(r); setConfirmOpen(true); }}
                      title="Delete Report"
                      aria-label="Delete Report"
                      disabled={loading}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!loading && items.length === 0) && (
          <div className="no-reports"><p>No reports found</p></div>
        )}
      </div>

      {/* Pagination */}
      <div className="pagination">
        <button className="page-btn" onClick={()=> fetchReports({ page: Math.max(1, page - 1) })} disabled={loading || page <= 1}>Prev</button>
        <span className="page-info">Page {page} of {pages}</span>
        <button className="page-btn" onClick={()=> fetchReports({ page: Math.min(pages, page + 1) })} disabled={loading || page >= pages}>Next</button>
      </div>

      {/* Detail modal (view only) */}
      {detail && (
        <div className="confirm-modal-overlay" role="dialog" aria-modal="true" onClick={(e)=>{ if(e.target.classList.contains('confirm-modal-overlay')) setDetail(null); }}>
          <div className="confirm-modal view-modal" style={{ maxWidth: 700 }}>
            <h3>Report Details</h3>
            <div className="view-row"><span className="view-label">From:</span><span className="view-value">{detail.name || detail.user?.name || '—'}</span></div>
            <div className="view-row"><span className="view-label">Email:</span><span className="view-value">{detail.email || detail.user?.email || '—'}</span></div>
            <div className="view-row"><span className="view-label">Subject:</span><span className="view-value">{detail.subject}</span></div>
            <div className="view-row"><span className="view-label">Message:</span></div>
            <div className="view-message"><pre>{detail.message}</pre></div>
            <div className="view-row" style={{ marginTop: 12 }}>
              <span className="view-label">Status:</span>
              <span className={`report-status-badge ${detail.status}`} style={{ marginRight: 8 }}>
                {detail.status === 'open' ? 'Open' : detail.status === 'in_progress' ? 'In Progress' : 'Resolved'}
              </span>
              <select
                className="sort-select"
                value={detail.status}
                onChange={(e) => updateStatus(detail._id, e.target.value)}
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className="confirm-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={()=> setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (same style as UserManagement) */}
      {confirmOpen && (
        <div className="confirm-modal-overlay" role="dialog" aria-modal="true">
          <div className="confirm-modal">
            <h3>Confirm Deletion</h3>
            <p>
              Are you sure you want to delete this report{pendingDeleteReport?.subject ? ` "${pendingDeleteReport.subject}"` : ""}?
            </p>
            <div className="confirm-actions">
              <button
                className="btn-secondary"
                onClick={() => { setConfirmOpen(false); setPendingDeleteReport(null); }}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={() => pendingDeleteReport && deleteReport(pendingDeleteReport._id)}
                disabled={loading}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportManagement;
