import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Automatically inject JWT token from localStorage into requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("coursemate_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Intercept 401 Unauthorized responses to purge invalid/expired tokens and notify the app
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const isAuthEndpoint =
        error.config?.url?.includes("/auth/login") ||
        error.config?.url?.includes("/auth/register");

      if (!isAuthEndpoint) {
        localStorage.removeItem("coursemate_token");
        localStorage.removeItem("coursemate_user");
        localStorage.removeItem("coursemate_current_chat_id");

        window.dispatchEvent(
          new CustomEvent("coursemate:auth_expired", {
            detail: {
              error: error.response.data?.error || "Session expired or invalid token.",
            },
          })
        );
      }
    }
    return Promise.reject(error);
  }
);

// Centralized API calls
export const authAPI = {
  register: (name, email, password) =>
    api.post("/auth/register", { name, email, password }),
  login: (email, password) =>
    api.post("/auth/login", { email, password }),
  getMe: () => api.get("/auth/me"),
};

export const documentAPI = {
  getDocuments: () => api.get("/documents"),
  uploadDocument: (formData, onProgress) =>
    api.post("/documents/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: onProgress,
    }),
  getStatus: (id) => api.get(`/documents/${id}/status`),
  retryDocument: (id) => api.post(`/documents/${id}/retry`),
  deleteDocument: (id) => api.delete(`/documents/${id}`),
};

export const chatAPI = {
  // Conversation management
  getChats: () => api.get("/chat"),
  createChat: (data) => api.post("/chat", data),
  getChat: (id) => api.get(`/chat/${id}`),
  deleteChat: (id) => api.delete(`/chat/${id}`),

  // Asking questions with conversation tracking
  askGeneral: (question, chatId) =>
    api.post("/chat/general", { question, ...(chatId ? { chatId } : {}) }),
  askPDF: (question, documentId, chatId) =>
    api.post("/chat/pdf", {
      question,
      ...(documentId ? { documentId } : {}),
      ...(chatId ? { chatId } : {}),
    }),

  // Legacy compatibility
  getHistory: (mode, documentId) =>
    api.get("/chat/history", {
      params: { mode, ...(documentId ? { documentId } : {}) },
    }),
  clearHistory: (mode, documentId) =>
    api.delete("/chat/history", {
      params: { mode, ...(documentId ? { documentId } : {}) },
    }),
};

export default api;
