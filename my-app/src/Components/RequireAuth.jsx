import React from "react";

const RequireAuth = ({ children }) => {
  const token = localStorage.getItem("token");

  if (!token) {
    // Block content and show a simple access message without redirecting
    return (
      <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#111", border: "1px solid #333", padding: 20, borderRadius: 8, color: "#e0e0e0" }}>
          You must be logged in to access this page.
        </div>
      </div>
    );
  }

  return children;
};

export default RequireAuth;
