import React, { useState, useEffect, useCallback, useRef } from "react";
import "./UserManagement.css";
import { apiUrl } from "../../config";

const UserManagement = ({ users = [], onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [serverUsers, setServerUsers] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [totals, setTotals] = useState({ totalUsers: 0, totalActiveUsers: 0, totalAdminUsers: 0 });
  const abortRef = useRef(null);
  // Delete confirmation modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState(null);

  const fetchUsers = useCallback(async (opts = {}) => {
    // Cancel any in-flight request before starting a new one
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch (e) { /* noop */ }
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setLoading(true);
      setError("");
      const page = opts.page ?? pagination.page;
      const limit = opts.limit ?? pagination.limit;
      const token = localStorage.getItem("token");
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        search: searchTerm,
        sortBy,
        sortOrder
      });
  const res = await fetch(apiUrl(`/api/admin/users?${params.toString()}`), {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "application/json"
        },
        signal: controller.signal
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch users (${res.status})`);
      }
      const data = await res.json();
      // Ignore if a newer request has started
      if (abortRef.current !== controller) return;
      setServerUsers(Array.isArray(data.users) ? data.users : []);
      if (data.pagination) setPagination(data.pagination);
      if (data.totals) setTotals(data.totals);
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("Fetch users error:", err);
      setError(err?.message || "Failed to load users");
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [searchTerm, sortBy, sortOrder, pagination.page, pagination.limit]);

  // Initial load
  useEffect(() => {
    fetchUsers({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch on sort changes
  useEffect(() => {
    fetchUsers({ page: 1 });
  }, [sortBy, sortOrder, fetchUsers]);

  // Debounced refetch on search term changes
  useEffect(() => {
    const t = setTimeout(() => fetchUsers({ page: 1 }), 300);
    return () => clearTimeout(t);
  }, [searchTerm, fetchUsers]);

  // Abort on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch (e) { /* noop */ }
        abortRef.current = null;
      }
    };
  }, []);

  // prefer server-provided list when available; if fetch failed, fall back to prop users
  const usingServerData = serverUsers !== null;
  const sourceUsers = usingServerData ? serverUsers : users;

  // rely on server-side search/sort when using server data; only client-sort on fallback
  const sortedUsers = usingServerData ? sourceUsers : [...sourceUsers].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];
    if (sortBy === "createdAt") {
      aVal = new Date(aVal);
      bVal = new Date(bVal);
    }
    if (sortOrder === "asc") return aVal > bVal ? 1 : -1;
    return aVal < bVal ? 1 : -1;
  });

  const handleDeleteUser = async (userId) => {
    try {
      setLoading(true);
      // Optimistic UI update
  const prev = (Array.isArray(serverUsers) && serverUsers.length ? serverUsers : users);
      const prevSnap = [...prev];
      setServerUsers(prev.filter(u => u._id !== userId));
      const token = localStorage.getItem("token");
  const response = await fetch(apiUrl(`/api/admin/users/${userId}`), {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        setServerUsers(prevSnap);
        throw new Error(`Failed to delete user (${response.status})`);
      }

      await fetchUsers();
      onRefresh && onRefresh();
    } catch (error) {
      console.error("Error deleting user:", error);
      alert(error?.message || "Failed to delete user");
    } finally {
      setLoading(false);
      setConfirmOpen(false);
      setPendingDeleteUser(null);
    }
  };

  const handleToggleUserStatus = async (userId) => {
    try {
      setLoading(true);
      // Optimistic UI update
  setServerUsers((prev) => (Array.isArray(prev) && prev.length ? prev : sourceUsers).map(u => u._id === userId ? { ...u, isActive: !u.isActive } : u));
      const token = localStorage.getItem("token");
  const response = await fetch(apiUrl(`/api/admin/users/${userId}/toggle-status`), {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) {
        // Revert on error
  setServerUsers((prev) => (Array.isArray(prev) && prev.length ? prev : sourceUsers).map(u => u._id === userId ? { ...u, isActive: !u.isActive } : u));
        throw new Error(`Failed to update user status (${response.status})`);
      }

      await fetchUsers();
      onRefresh && onRefresh();
    } catch (error) {
      console.error("Error updating user status:", error);
      alert(error?.message || "Failed to update user status");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const formatBytes = (bytes) => {
    if (!bytes) return "0 B";
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className="user-management">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="user-management-header">
        <h2>User Management</h2>
        <div className="user-management-actions">
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <div className="select-control">
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [field, order] = e.target.value.split("-");
                setSortBy(field);
                setSortOrder(order);
              }}
              className="sort-select"
              aria-label="Sort users"
            >
              <option value="createdAt-desc">Newest First</option>
              <option value="createdAt-asc">Oldest First</option>
              <option value="name-asc">Name A-Z</option>
              <option value="name-desc">Name Z-A</option>
              <option value="email-asc">Email A-Z</option>
            </select>
          </div>
        </div>
      </div>

      <div className="user-stats-summary">
        <div className="stat-item">
          <span className="stat-label">Total Users:</span>
          <span className="stat-value">{usingServerData ? (totals.totalUsers || 0) : users.length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Active Users:</span>
          <span className="stat-value">{usingServerData ? (totals.totalActiveUsers || 0) : sourceUsers.filter(u => u.isActive).length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Admin Users:</span>
          <span className="stat-value">{usingServerData ? (totals.totalAdminUsers || 0) : sourceUsers.filter(u => u.isAdmin).length}</span>
        </div>
      </div>

      <div className="users-table-container">
        <table className="users-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Status</th>
              <th>Role</th>
              <th>Documents</th>
              <th>Storage Used</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.map((user) => (
              <tr key={user._id} className={!user.isActive ? "inactive-user" : ""}>
                <td>
                  <div className="user-info">
                    <div className="user-avatar">
                      {user.avatar ? (
                        <img src={user.avatar} alt="" />
                      ) : (
                        <span>{user.name?.charAt(0)?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="user-details">
                      <span className="user-name">{user.name}</span>
                      {user.isAdmin && <span className="admin-badge">ADMIN</span>}
                    </div>
                  </div>
                </td>
                <td>{user.email}</td>
                <td>
                  <span className={`status-badge ${user.isActive ? "active" : "inactive"}`}>
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <span className={`role-badge ${user.role || "user"}`}>
                    {(user.role || "user").toUpperCase()}
                  </span>
                </td>
                <td>{user.stats?.documentCount || 0}</td>
                <td>{formatBytes(user.stats?.totalStorage || 0)}</td>
                <td>{formatDate(user.createdAt)}</td>
                <td>
                  <div className="user-actions">
                    <button
                      className={`toggle-status-btn ${user.isActive ? 'danger' : 'success'}`}
                      onClick={() => handleToggleUserStatus(user._id)}
                      disabled={loading}
                      aria-label={user.isActive ? "Deactivate User" : "Activate User"}
                      title={user.isActive ? "Deactivate User" : "Activate User"}
                    >
                      {/* Power icon */}
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2v8" />
                        <path d="M5.5 7a8 8 0 1 0 13 0" />
                      </svg>
                    </button>
                    <button
                      className="delete-user-btn"
                      onClick={() => { setPendingDeleteUser(user); setConfirmOpen(true); }}
                      disabled={loading || user.isAdmin}
                      aria-label="Delete User"
                      title="Delete User"
                    >
                      {/* Trash icon */}
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

        {(!loading && sortedUsers.length === 0) && (
          <div className="no-users">
            <p>No users found</p>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {usingServerData && (
        <div className="pagination">
          <button
            className="page-btn"
            onClick={() => fetchUsers({ page: Math.max(1, (pagination.page || 1) - 1) })}
            disabled={loading || (pagination.page || 1) <= 1}
          >
            Prev
          </button>
          <span className="page-info">
            Page {pagination.page || 1} of {pagination.pages || 1}
          </span>
          <button
            className="page-btn"
            onClick={() => fetchUsers({ page: Math.min((pagination.pages || 1), (pagination.page || 1) + 1) })}
            disabled={loading || (pagination.page || 1) >= (pagination.pages || 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmOpen && (
        <div className="confirm-modal-overlay" role="dialog" aria-modal="true">
          <div className="confirm-modal">
            <h3>Confirm Deletion</h3>
            <p>
              Are you sure you want to delete this user{pendingDeleteUser?.name ? ` "${pendingDeleteUser.name}"` : ""}?
              This will also delete all their documents and chats.
            </p>
            <div className="confirm-actions">
              <button
                className="btn-secondary"
                onClick={() => { setConfirmOpen(false); setPendingDeleteUser(null); }}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                onClick={() => pendingDeleteUser && handleDeleteUser(pendingDeleteUser._id)}
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

export default UserManagement;