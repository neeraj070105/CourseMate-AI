import React, { useState, useEffect, useCallback, useRef } from "react";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import AuthModal from "./components/AuthModal";
import { authAPI, documentAPI, chatAPI } from "./api";

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem("coursemate_user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [mode, setMode] = useState("general"); // "general" | "pdf"
  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(null);

  // Chat conversation state
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(() => {
    return localStorage.getItem("coursemate_current_chat_id") || null;
  });
  const [messages, setMessages] = useState([]);
  const [currentChatTitle, setCurrentChatTitle] = useState(null);
  const [pdfDeletedNotice, setPdfDeletedNotice] = useState(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [lastFailedQuestion, setLastFailedQuestion] = useState(null);
  const isSubmittingRef = useRef(false);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Handle automatic session expiration and 401 logouts
  useEffect(() => {
    const handleAuthExpired = (event) => {
      setUser(null);
      setDocuments([]);
      setSelectedDocument(null);
      setChats([]);
      setCurrentChatId(null);
      setCurrentChatTitle(null);
      setMessages([]);
      setPdfDeletedNotice(null);
      setLastFailedQuestion(null);
      if (event.detail?.error) {
        setError(event.detail.error);
      }
    };

    window.addEventListener("coursemate:auth_expired", handleAuthExpired);
    return () => {
      window.removeEventListener("coursemate:auth_expired", handleAuthExpired);
    };
  }, []);

  // Verify stored session on mount
  useEffect(() => {
    const token = localStorage.getItem("coursemate_token");
    if (token) {
      authAPI
        .getMe()
        .then((res) => {
          if (res.data?.success && res.data?.data) {
            setUser(res.data.data);
            localStorage.setItem("coursemate_user", JSON.stringify(res.data.data));
          }
        })
        .catch((err) => {
          console.warn("Session check failed, clearing token:", err.message);
          localStorage.removeItem("coursemate_token");
          localStorage.removeItem("coursemate_user");
          setUser(null);
        });
    } else {
      localStorage.removeItem("coursemate_user");
      setUser(null);
    }
  }, []);

  // Load all user documents
  const loadDocuments = useCallback(async () => {
    if (!user) {
      setDocuments([]);
      setSelectedDocument(null);
      return [];
    }

    try {
      const res = await documentAPI.getDocuments();
      if (res.data?.success) {
        const docs = res.data.data;
        setDocuments(docs);
        return docs;
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setUser(null);
      }
      console.warn("Could not load documents:", err.message);
    }
    return [];
  }, [user]);

  // Load user's saved chats
  const loadChats = useCallback(async () => {
    if (!user) {
      setChats([]);
      return [];
    }

    try {
      const res = await chatAPI.getChats();
      if (res.data?.success) {
        setChats(res.data.data);
        return res.data.data;
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setUser(null);
      }
      console.warn("Could not load chats:", err.message);
    }
    return [];
  }, [user]);

  // Load documents and chats when user logs in
  useEffect(() => {
    if (user) {
      loadDocuments();
      loadChats();
    }
  }, [user, loadDocuments, loadChats]);

  // Auto-polling for active background ingestion jobs
  useEffect(() => {
    if (!user) return;
    const hasActiveJobs = documents.some(
      (d) => d.status === "processing" || d.status === "pending"
    );

    if (!hasActiveJobs) return;

    const timer = setInterval(async () => {
      try {
        const res = await documentAPI.getDocuments();
        if (res.data?.success) {
          const freshDocs = res.data.data;
          setDocuments(freshDocs);

          if (selectedDocument) {
            const current = freshDocs.find((d) => d._id === selectedDocument._id);
            if (current && (current.status !== selectedDocument.status || current.chunkCount !== selectedDocument.chunkCount)) {
              setSelectedDocument(current);
            }
          }
        }
      } catch (pollErr) {
        console.debug("Document polling error:", pollErr.message);
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [user, documents, selectedDocument]);

  // Restore current conversation from backend when component mounts or user signs in
  useEffect(() => {
    if (!user) return;

    const savedChatId = localStorage.getItem("coursemate_current_chat_id");
    if (savedChatId) {
      chatAPI
        .getChat(savedChatId)
        .then(async (res) => {
          if (res.data?.success && res.data?.data) {
            const chat = res.data.data;
            setCurrentChatId(chat._id);
            setCurrentChatTitle(chat.title);
            setMode(chat.mode);
            setMessages(chat.messages || []);

            if (chat.mode === "pdf") {
              const currentDocs = await loadDocuments();
              const foundDoc = currentDocs.find((d) => d.documentId === chat.documentId);
              if (foundDoc) {
                setSelectedDocument(foundDoc);
                setPdfDeletedNotice(null);
              } else {
                setSelectedDocument(null);
                setPdfDeletedNotice(
                  `The original PDF file for this chat ("${
                    chat.documentName || "document"
                  }") was deleted or is no longer available.`
                );
              }
            } else {
              setPdfDeletedNotice(null);
            }
          }
        })
        .catch((err) => {
          console.warn("Could not restore saved chat:", err.message);
          localStorage.removeItem("coursemate_current_chat_id");
          setCurrentChatId(null);
          setMessages([]);
        });
    }
  }, [user, loadDocuments]);

  // Select an existing conversation from the sidebar
  const handleSelectChat = async (chatId) => {
    setError(null);
    setLastFailedQuestion(null);
    try {
      const res = await chatAPI.getChat(chatId);
      if (res.data?.success && res.data?.data) {
        const chat = res.data.data;
        setCurrentChatId(chat._id);
        setCurrentChatTitle(chat.title);
        localStorage.setItem("coursemate_current_chat_id", chat._id);
        setMode(chat.mode);
        setMessages(chat.messages || []);

        if (chat.mode === "pdf") {
          const foundDoc = documents.find((d) => d.documentId === chat.documentId);
          if (foundDoc) {
            setSelectedDocument(foundDoc);
            setPdfDeletedNotice(null);
          } else {
            setSelectedDocument(null);
            setPdfDeletedNotice(
              `The original PDF file for this chat ("${
                chat.documentName || "document"
              }") was deleted or is no longer available.`
            );
          }
        } else {
          setPdfDeletedNotice(null);
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load selected chat.");
    }
  };

  // Start a fresh New Chat
  const handleNewChat = () => {
    setCurrentChatId(null);
    setCurrentChatTitle(null);
    setMessages([]);
    setPdfDeletedNotice(null);
    setError(null);
    setLastFailedQuestion(null);
    localStorage.removeItem("coursemate_current_chat_id");

    // If in PDF mode and no document selected yet, auto-select first ready doc
    if (mode === "pdf" && !selectedDocument && documents.length > 0) {
      const firstReady = documents.find((d) => d.status === "completed");
      if (firstReady) {
        setSelectedDocument(firstReady);
      }
    }
  };

  // Delete an individual chat
  const handleDeleteChat = async (chatId) => {
    try {
      await chatAPI.deleteChat(chatId);
      setChats((prev) => prev.filter((c) => c._id !== chatId));

      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setCurrentChatTitle(null);
        setMessages([]);
        setPdfDeletedNotice(null);
        setLastFailedQuestion(null);
        localStorage.removeItem("coursemate_current_chat_id");
      }
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete chat.");
    }
  };

  // Handle PDF Upload
  const handleUploadPDF = async (file) => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }

    const MAX_PDF_SIZE_BYTES = 10485760; // 10 MiB (Cloudinary Free Plan maximum raw asset limit)
    if (file && file.size > MAX_PDF_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      setError(
        `File size (${sizeMb} MB, ${file.size.toLocaleString()} bytes) exceeds the maximum allowed limit of 10 MiB (10,485,760 bytes). Please upload a smaller PDF.`
      );
      return;
    }

    const formData = new FormData();
    formData.append("pdf", file);

    setUploading(true);
    setUploadProgress(0);
    setError(null);
    setLastFailedQuestion(null);

    try {
      const res = await documentAPI.uploadDocument(formData, (progressEvent) => {
        if (progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percent);
        }
      });

      if (res.data?.success && res.data?.data) {
        const newDoc = res.data.data;
        setDocuments((prev) => [newDoc, ...prev.filter((d) => d._id !== newDoc._id)]);
        setSelectedDocument(newDoc);
        setMode("pdf");
        setPdfDeletedNotice(null);

        // Start a fresh conversation for this newly uploaded document
        setCurrentChatId(null);
        setCurrentChatTitle(null);
        setMessages([]);
        setLastFailedQuestion(null);
        localStorage.removeItem("coursemate_current_chat_id");
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || "Failed to upload and process PDF.";
      setError(msg);
      loadDocuments();
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Handle Document Ingestion Retry
  const handleRetryDocument = async (id) => {
    try {
      setError(null);
      const res = await documentAPI.retryDocument(id);
      if (res.data?.success && res.data?.data) {
        const updated = res.data.data;
        setDocuments((prev) => prev.map((d) => (d._id === id ? updated : d)));
        if (selectedDocument?._id === id) {
          setSelectedDocument(updated);
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || "Failed to retry document processing.";
      setError(msg);
    }
  };

  // Handle Document Deletion
  const handleDeleteDocument = async (id) => {
    try {
      await documentAPI.deleteDocument(id);
      const remainingDocs = documents.filter((d) => d._id !== id);
      setDocuments(remainingDocs);

      if (selectedDocument?._id === id) {
        setSelectedDocument(null);
        setPdfDeletedNotice(
          "The associated PDF was deleted. Past answers and page citations are preserved below."
        );
      }
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete document.");
    }
  };

  // Handle Sending a Question (General or PDF mode)
  const handleSendMessage = async (question) => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }

    if (isSubmittingRef.current || loading) return;
    isSubmittingRef.current = true;

    setError(null);
    setLoading(true);
    setLastFailedQuestion(null);

    const optimisticMsg = {
      role: "user",
      content: question,
      timestamp: new Date().toISOString(),
      optimistic: true,
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    if (mode === "general") {
      try {
        const res = await chatAPI.askGeneral(question, currentChatId);
        if (res.data?.success) {
          const { chatId, title, chat } = res.data.data;
          setCurrentChatId(chatId);
          setCurrentChatTitle(title);
          localStorage.setItem("coursemate_current_chat_id", chatId);
          if (chat?.messages) {
            setMessages(chat.messages);
          }
          loadChats();
        }
      } catch (err) {
        setMessages((prev) => prev.filter((m) => !m.optimistic));
        const msg = err.response?.data?.error || err.message || "Could not generate general answer.";
        setError(msg);
        setLastFailedQuestion(question);
      } finally {
        setLoading(false);
        isSubmittingRef.current = false;
      }
    } else {
      // PDF mode
      if (!selectedDocument) {
        setMessages((prev) => prev.filter((m) => !m.optimistic));
        setError("Please select a completed PDF document from the sidebar first.");
        setLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      if (selectedDocument.status !== "completed") {
        setMessages((prev) => prev.filter((m) => !m.optimistic));
        setError(
          `Document is currently ${selectedDocument.status}. Please wait until indexing completes.`
        );
        setLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      try {
        const res = await chatAPI.askPDF(question, selectedDocument.documentId, currentChatId);
        if (res.data?.success) {
          const { chatId, title, chat } = res.data.data;
          setCurrentChatId(chatId);
          setCurrentChatTitle(title);
          localStorage.setItem("coursemate_current_chat_id", chatId);
          if (chat?.messages) {
            setMessages(chat.messages);
          }
          loadChats();
        }
      } catch (err) {
        setMessages((prev) => prev.filter((m) => !m.optimistic));
        const msg = err.response?.data?.error || err.message || "Failed to get answer from document.";
        setError(msg);
        setLastFailedQuestion(question);
      } finally {
        setLoading(false);
        isSubmittingRef.current = false;
      }
    }
  };

  const handleRetry = () => {
    if (lastFailedQuestion) {
      const q = lastFailedQuestion;
      setLastFailedQuestion(null);
      handleSendMessage(q);
    }
  };

  const handleClearChat = async () => {
    if (!currentChatId) {
      setMessages([]);
      return;
    }

    if (confirm("Clear this entire conversation?")) {
      try {
        await chatAPI.deleteChat(currentChatId);
        setChats((prev) => prev.filter((c) => c._id !== currentChatId));
        handleNewChat();
      } catch (err) {
        alert(err.response?.data?.error || "Failed to clear conversation.");
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("coursemate_token");
    localStorage.removeItem("coursemate_user");
    localStorage.removeItem("coursemate_current_chat_id");
    setUser(null);
    setDocuments([]);
    setSelectedDocument(null);
    setChats([]);
    setCurrentChatId(null);
    setCurrentChatTitle(null);
    setMessages([]);
    setPdfDeletedNotice(null);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans antialiased text-slate-800">
      {/* Sidebar Navigation */}
      <Sidebar
        mode={mode}
        setMode={setMode}
        documents={documents}
        selectedDocument={selectedDocument}
        setSelectedDocument={(doc) => {
          setSelectedDocument(doc);
          setPdfDeletedNotice(null);
          handleNewChat();
        }}
        onUploadPDF={handleUploadPDF}
        onRetryDocument={handleRetryDocument}
        onDeleteDocument={handleDeleteDocument}
        onNewChat={handleNewChat}
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        uploading={uploading}
        uploadProgress={uploadProgress}
        user={user}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
      />

      {/* Main Chat Interface */}
      <ChatArea
        mode={mode}
        messages={messages}
        onSendMessage={handleSendMessage}
        onRetry={handleRetry}
        lastFailedQuestion={lastFailedQuestion}
        loading={loading}
        error={error}
        selectedDocument={selectedDocument}
        onRetryDocument={handleRetryDocument}
        currentChatTitle={currentChatTitle}
        pdfDeletedNotice={pdfDeletedNotice}
        onClearChat={handleClearChat}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(userData) => {
          setUser(userData);
          loadDocuments();
          loadChats();
        }}
      />
    </div>
  );
}
