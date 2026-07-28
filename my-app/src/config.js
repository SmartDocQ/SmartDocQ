// Centralized API configuration for frontend
// Configure these in Vercel as environment variables:
// - REACT_APP_API_URL (Node/Express backend base URL)

export const API_BASE = (process.env.REACT_APP_API_URL || "http://localhost:5000").replace(/\/$/, "");

const rawMb = Number(process.env.REACT_APP_MAX_UPLOAD_SIZE_MB);
export const MAX_UPLOAD_SIZE_MB = Number.isFinite(rawMb) && rawMb > 0 ? rawMb : 15;

export const apiUrl = (path) =>
  `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

// Helper to get CSRF token from document cookies
const getCsrfToken = () => {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match ? match[1] : "";
};

// Prevent multiple triggers on 401
let isRedirecting = false;

// Coalesce concurrent CSRF refresh requests to prevent duplicate backend calls
let activeCsrfPromise = null;

// Fetch wrapper for authenticated requests using httpOnly cookies
export const apiFetch = async (
  path,
  { body, signal, headers: extraHeaders, ...rest } = {}
) => {
  const url = path.startsWith("http") ? path : apiUrl(path);
  
  let csrfToken = getCsrfToken();
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes((rest.method || "GET").toUpperCase());
  const isAuthRoute = url.includes("/api/auth/");

  if (isMutating && !csrfToken && !isAuthRoute) {
    if (!activeCsrfPromise) {
      activeCsrfPromise = (async () => {
        try {
          const refreshRes = await fetch(apiUrl("/api/auth/csrf"), {
            credentials: "include",
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json().catch(() => ({}));
            if (refreshData.success && refreshData.data && refreshData.data.csrfToken) {
              return refreshData.data.csrfToken;
            }
          }
        } catch (err) {
          console.error("Failed to refresh CSRF token:", err);
        } finally {
          activeCsrfPromise = null;
        }
        return "";
      })();
    }

    const refreshedToken = await activeCsrfPromise;
    if (refreshedToken) {
      csrfToken = refreshedToken;
    }
  }

  try {
    let res = await fetch(url, {
      ...rest,
      body,
      signal,
      credentials: "include",
      headers: {
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        ...(extraHeaders || {}),
      },
    });

    // Auto-recovery: If a mutating request fails with 403, the CSRF token may be expired or out of sync.
    // Refresh the token via the authenticated /csrf endpoint and retry the request once.
    if (res.status === 403 && isMutating && !isAuthRoute) {
      console.warn("Mutating request failed with 403. Attempting automatic CSRF token recovery...");
      
      if (!activeCsrfPromise) {
        activeCsrfPromise = (async () => {
          try {
            const refreshRes = await fetch(apiUrl("/api/auth/csrf"), {
              credentials: "include",
            });
            if (refreshRes.ok) {
              const refreshData = await refreshRes.json().catch(() => ({}));
              if (refreshData.success && refreshData.data && refreshData.data.csrfToken) {
                return refreshData.data.csrfToken;
              }
            }
          } catch (err) {
            console.error("Failed to refresh CSRF token in retry flow:", err);
          } finally {
            activeCsrfPromise = null;
          }
          return "";
        })();
      }

      const refreshedToken = await activeCsrfPromise;
      if (refreshedToken) {
        console.info("CSRF token recovered. Retrying original request...");
        res = await fetch(url, {
          ...rest,
          body,
          signal,
          credentials: "include",
          headers: {
            ...(body instanceof FormData
              ? {}
              : { "Content-Type": "application/json" }),
            ...(extraHeaders || {}),
            "X-CSRF-Token": refreshedToken,
          },
        });
      }
    }

    if (res.status === 401 && !isRedirecting && !isAuthRoute) {
      isRedirecting = true;

      console.warn("Session expired. Triggering global unauthorized event...");

      try {
        localStorage.removeItem("user");
        window.dispatchEvent(new Event("userChanged"));
      } catch {}

      // Defer event so other in-flight 401 responses hit the isRedirecting guard
      // before navigation/modal handling finishes.
      setTimeout(() => {
        window.dispatchEvent(new Event("unauthorized"));
      }, 100);
    }

    return res;
  } catch (err) {
    if (err.name === "AbortError") {
      throw err;
    }
    console.error("API Fetch Error:", err);
    throw new Error("Network error");
  }
};