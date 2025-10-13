import React, { useEffect, useState } from "react";
import { useToast } from "../ToastContext";
import AdminDashboard from "./AdminDashboard";
import { apiUrl } from "../../config";

const AdminRoute = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    const checkAdminAccess = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          showToast("Please login to access the admin panel.", { type: "error", duration: 2500 });
          setIsAdmin(false);
          return;
        }

        // Try to access admin dashboard to verify admin rights
  const response = await fetch(apiUrl("/api/admin/dashboard"), {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });

        if (response.ok) {
          setIsAdmin(true);
        } else if (response.status === 403) {
          // Not admin
          showToast("Access denied. Admin privileges required.", { type: "error", duration: 2500 });
          setIsAdmin(false);
        } else if (response.status === 401) {
          // Invalid/expired token
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          showToast("Session expired. Please login again.", { type: "error", duration: 2500 });
          setIsAdmin(false);
        } else {
          throw new Error("Failed to verify admin access");
        }
      } catch (error) {
        console.error("Admin access check error:", error);
        showToast("Error checking admin access. Please try again.", { type: "error", duration: 2500 });
      } finally {
        setLoading(false);
      }
    };

    checkAdminAccess();
  }, [showToast]);

  if (loading) {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        background: "#0a0a0a",
        color: "#e0e0e0"
      }}>
        <div>
          <div style={{
            width: "40px",
            height: "40px",
            border: "3px solid rgba(0, 255, 136, 0.3)",
            borderTop: "3px solid #00FF88",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 20px"
          }}></div>
          <p>Verifying admin access...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "60vh",
        background: "transparent",
        color: "#e0e0e0"
      }}>
        <div style={{ background: "#111", border: "1px solid #333", padding: 24, borderRadius: 8 }}>
          You must be logged in with admin privileges to view this page.
        </div>
      </div>
    );
  }

  return <AdminDashboard />;
};

export default AdminRoute;