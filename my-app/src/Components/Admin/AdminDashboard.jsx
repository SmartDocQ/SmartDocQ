import React, { useState, useEffect, useCallback } from "react";
import "./AdminDashboard.css";
import { useToast } from "../ToastContext";
import AdminStats from "./AdminStats";
import RealTimeMetrics from "./RealTimeMetrics";
import UserManagement from "./UserManagement";
import ReportManagement from "./ReportManagement";
import SystemLogs from "./SystemLogs";
import SystemSettings from "./SystemSettings";
import logo from "../logo.png";
import { apiUrl } from "../../config";

const AdminDashboard = () => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [adminData, setAdminData] = useState({
    stats: {},
    users: [],
    documents: [],
    logs: [],
    settings: {}
  });
  const [loading, setLoading] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const fetchAdminData = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
  const response = await fetch(apiUrl("/api/admin/dashboard"), {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (!response.ok) throw new Error("Failed to fetch admin data");
      const data = await response.json();
      setAdminData(data);
    } catch (error) {
      console.error("Error fetching admin data:", error);
      showToast && showToast("Failed to load admin data", { type: "error" });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "realtime", label: "Real Metrics" },
    { id: "users", label: "Users" },
    { id: "reports", label: "Reports" },
    { id: "logs", label: "System Logs" },
    { id: "settings", label: "Settings" }
  ];

  const renderTabContent = () => {
    if (loading) {
      return (
        <div className="admin-loading">
          <div className="loading-spinner"></div>
          <p>Loading admin data...</p>
        </div>
      );
    }

    switch (activeTab) {
      case "dashboard": return (
        <AdminStats data={adminData.stats} onRefresh={fetchAdminData} />
      );
      case "realtime": return <RealTimeMetrics stats={adminData.stats} onRefresh={fetchAdminData} />;
      case "users": return <UserManagement users={adminData.users} onRefresh={fetchAdminData} />;
  case "reports": return <ReportManagement reports={adminData.reports} onRefresh={fetchAdminData} />;
      case "logs": return <SystemLogs logs={adminData.logs} onRefresh={fetchAdminData} />;
      case "settings": return <SystemSettings settings={adminData.settings} onRefresh={fetchAdminData} />;
      default: return <AdminStats data={adminData.stats} onRefresh={fetchAdminData} />;
    }
  };

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <div className="admin-logo-section">
          <img className="logo" src={logo} alt="SmartDoc Logo" />
        </div>
        <h1 className="admin-title">Admin Panel</h1>
        <div className="admin-actions">
          <button className="logout-btn" onClick={() => setShowLogoutModal(true)}>
            Logout
          </button>
        </div>
      </div>

      <div className="admin-content">
        <nav className="admin-sidebar">
          <div className="admin-nav">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`nav-tab ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        <main className="admin-main">
          {renderTabContent()}
        </main>
      </div>

      {/* Logout Modal */}
      {showLogoutModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="logout-title">
          <div className="modal-card">
            <div className="modal-header">
              <h3 id="logout-title">Confirm Logout</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to logout?</p>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowLogoutModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  localStorage.removeItem("token");
                  localStorage.removeItem("user");
                  window.location.href = "/";
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;