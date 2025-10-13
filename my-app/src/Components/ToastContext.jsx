import React, { createContext, useContext, useState, useCallback } from "react";
import "./Toast.css";

const ToastContext = createContext();

export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, options = {}) => {
    const id = Date.now();
    const duration = options.duration || 2000;

    // add new toast
    setToasts((prev) => [...prev, { id, message, ...options, duration }]);

    // start exit animation before removal
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((toast) =>
          toast.id === id ? { ...toast, exiting: true } : toast
        )
      );

      // remove after animation (0.3s)
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, 300);
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.type || "info"} ${
              toast.exiting ? "exit" : ""
            }`}
            style={{ backgroundColor: toast.backgroundColor }}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
