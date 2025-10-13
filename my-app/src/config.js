// Centralized API configuration for frontend
// Configure these in Vercel as environment variables:
// - REACT_APP_API_URL (Node/Express backend base URL)
// - REACT_APP_PY_API_URL (Python backend base URL)

export const API_BASE = (process.env.REACT_APP_API_URL || "http://localhost:5000").replace(/\/$/, "");
export const PY_API_BASE = (process.env.REACT_APP_PY_API_URL || "http://localhost:5001").replace(/\/$/, "");

export const apiUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
export const pyApiUrl = (path) => `${PY_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
