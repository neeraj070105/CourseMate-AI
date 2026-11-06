import React, { useRef } from "react";
import {
  MessageSquare,
  FileText,
  Plus,
  Trash2,
  Upload,
  LogOut,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2,
  BookOpen,
  X,
  Clock,
  RotateCcw,
} from "lucide-react";

// Exact 10 MiB Cloudinary Free Plan limit in bytes (10 * 1024 * 1024)
const MAX_PDF_SIZE_BYTES = 10485760;

export default function Sidebar({
  mode,
  setMode,
  documents,
  selectedDocument,
  setSelectedDocument,
  onUploadPDF,
  onRetryDocument,
  onDeleteDocument,
  onNewChat,
  chats = [],
  currentChatId,
  onSelectChat,
  onDeleteChat,
  uploading,
  uploadProgress,
  user,
  onOpenAuth,
  onLogout,
  isOpen,
  setIsOpen,
}) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
        alert("Please select a valid PDF file.");
        return;
      }
      if (file.size > MAX_PDF_SIZE_BYTES) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        alert(
          `File size (${sizeMb} MB, ${file.size.toLocaleString()} bytes) exceeds the maximum allowed limit of 10 MiB (10,485,760 bytes). Please upload a smaller PDF.`
        );
        e.target.value = "";
        return;
      }
      onUploadPDF(file);
      e.target.value = "";
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
          <div className="flex items-center space-x-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white font-bold text-xs">
              CM
            </div>
            <div>
              <span className="font-semibold text-slate-800 text-base tracking-tight">
                CourseMate AI
              </span>
              <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 border border-indigo-100">
                Study
              </span>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-600 md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <button
            onClick={() => {
              onNewChat();
              if (window.innerWidth < 768) setIsOpen(false);
            }}
            className="flex w-full items-center justify-center space-x-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50 hover:border-indigo-300 hover:text-indigo-600 transition"
          >
            <Plus className="h-4 w-4 text-indigo-600" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Two Chat Modes Selector */}
        <div className="px-3 pb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1 mb-1.5">
            Chat Mode
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => {
                setMode("general");
                if (window.innerWidth < 768) setIsOpen(false);
              }}
              className={`flex items-center justify-center space-x-1.5 rounded-md py-1.5 text-xs font-medium transition ${
                mode === "general"
                  ? "bg-white text-indigo-600 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Ask Anything</span>
            </button>
            <button
              onClick={() => {
                setMode("pdf");
                if (window.innerWidth < 768) setIsOpen(false);
              }}
              className={`flex items-center justify-center space-x-1.5 rounded-md py-1.5 text-xs font-medium transition ${
                mode === "pdf"
                  ? "bg-white text-indigo-600 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Ask from PDF</span>
            </button>
          </div>
        </div>

        {/* In PDF mode: Course Documents Section */}
        {mode === "pdf" && (
          <div className="flex flex-col border-b border-slate-100 px-3 pb-3 pt-1">
            <div className="flex items-center justify-between px-1 mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Course Documents
              </span>
              <span className="text-[10px] text-slate-400">
                {documents.length} PDF{documents.length === 1 ? "" : "s"}
              </span>
            </div>

            {/* Simple PDF Upload Trigger */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="application/pdf"
              className="hidden"
            />
            <button
              onClick={() => {
                if (!user) {
                  onOpenAuth();
                  return;
                }
                fileInputRef.current?.click();
              }}
              disabled={uploading}
              className="mb-1.5 flex w-full items-center justify-center space-x-1.5 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 hover:border-indigo-400 transition disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Uploading PDF ({uploadProgress}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload Course PDF</span>
                </>
              )}
            </button>

            {/* Compact Document List */}
            <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
              {documents.length === 0 ? (
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-center">
                  <p className="text-[11px] font-medium text-slate-500">No PDFs uploaded yet</p>
                </div>
              ) : (
                documents.map((doc) => {
                  const isSelected = selectedDocument?.documentId === doc.documentId;
                  const isCompleted = doc.status === "completed";
                  const isFailed = doc.status === "failed";
                  const isPending = doc.status === "pending";
                  const isProcessing = doc.status === "processing";

                  return (
                    <div
                      key={doc._id}
                      onClick={() => {
                        setSelectedDocument(doc);
                      }}
                      className={`group relative flex items-center justify-between rounded-lg p-2 text-xs transition cursor-pointer border ${
                        isSelected
                          ? "bg-indigo-50/80 border-indigo-200 text-indigo-900 font-medium"
                          : "bg-white border-slate-100 text-slate-700 hover:bg-slate-50 hover:border-slate-200"
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0 pr-2">
                        <FileText
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isSelected ? "text-indigo-600" : "text-slate-400"
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[11px]" title={doc.originalName}>
                            {doc.originalName}
                          </p>
                          <div className="flex items-center space-x-1.5 text-[9px] text-slate-400">
                            <span>{formatFileSize(doc.fileSize)}</span>

                            {isPending && (
                              <span className="flex items-center text-slate-500">
                                <Clock className="h-2 w-2 mr-0.5" />
                                Pending
                              </span>
                            )}

                            {isProcessing && (
                              <span className="flex items-center text-amber-600 font-medium">
                                <Loader2 className="h-2 w-2 animate-spin mr-0.5" />
                                {doc.ocrUsed ? "Processing (OCR)" : "Processing"}
                              </span>
                            )}

                            {isCompleted && (
                              <span className="text-emerald-600 flex items-center font-medium">
                                <CheckCircle2 className="h-2 w-2 mr-0.5" />
                                Ready
                              </span>
                            )}

                            {isFailed && (
                              <span
                                className="text-red-500 flex items-center font-medium"
                                title={doc.errorMessage || "Processing failed"}
                              >
                                <AlertCircle className="h-2 w-2 mr-0.5" />
                                Failed
                              </span>
                            )}

                            {isFailed && onRetryDocument && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRetryDocument(doc._id);
                                }}
                                title="Retry Processing"
                                className="inline-flex items-center space-x-0.5 rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-medium text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition"
                              >
                                <RotateCcw className="h-2 w-2 mr-0.5" />
                                Retry
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Delete Action */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${doc.originalName}" and its RAG index?`)) {
                            onDeleteDocument(doc._id);
                          }
                        }}
                        title="Delete Document"
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Chat History Section */}
        <div className="flex flex-1 flex-col overflow-hidden px-3 pt-2">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Chat History
            </span>
            {chats.length > 0 && (
              <span className="text-[10px] text-slate-400">
                {chats.length} saved
              </span>
            )}
          </div>

          {/* List of Saved Chats */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {!user ? (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center">
                <MessageSquare className="mx-auto h-6 w-6 text-slate-300 mb-1.5" />
                <p className="text-xs font-medium text-slate-600">Sign in to save chats</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Your conversations will be stored persistently in MongoDB.
                </p>
              </div>
            ) : chats.length === 0 ? (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center">
                <Clock className="mx-auto h-6 w-6 text-slate-300 mb-1.5" />
                <p className="text-xs font-medium text-slate-600">No saved chats yet</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Ask a question to start your first conversation!
                </p>
              </div>
            ) : (
              chats.map((chat) => {
                const isSelected = currentChatId === chat._id;
                return (
                  <div
                    key={chat._id}
                    onClick={() => {
                      onSelectChat(chat._id);
                      if (window.innerWidth < 768) setIsOpen(false);
                    }}
                    className={`group relative flex items-center justify-between rounded-lg p-2 text-xs transition cursor-pointer border ${
                      isSelected
                        ? "bg-indigo-50 border-indigo-200 text-indigo-900 font-medium"
                        : "bg-white border-transparent text-slate-700 hover:bg-slate-50 hover:border-slate-100"
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0 pr-2">
                      {chat.mode === "pdf" ? (
                        <FileText
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isSelected ? "text-indigo-600" : "text-slate-400"
                          }`}
                        />
                      ) : (
                        <MessageSquare
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isSelected ? "text-indigo-600" : "text-slate-400"
                          }`}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[11px]">{chat.title}</p>
                        <div className="flex items-center space-x-1 text-[9px] text-slate-400">
                          {chat.mode === "pdf" && chat.documentName && (
                            <span className="truncate max-w-[90px]">{chat.documentName}</span>
                          )}
                          <span>•</span>
                          <span>{formatDate(chat.updatedAt || chat.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat(chat._id);
                      }}
                      title="Delete Conversation"
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600 transition"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* User Account / Footer */}
        <div className="border-t border-slate-100 p-3">
          {user ? (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-xs">
              <div className="flex items-center space-x-2 min-w-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-semibold text-xs shrink-0">
                  {user.name ? user.name[0].toUpperCase() : "U"}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{user.name}</p>
                  <p className="truncate text-[10px] text-slate-400">{user.email}</p>
                </div>
              </div>
              <button
                onClick={onLogout}
                title="Sign Out"
                className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200 transition"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="flex w-full items-center justify-center space-x-1.5 rounded-lg bg-slate-900 py-2 text-xs font-medium text-white hover:bg-slate-800 transition"
            >
              <User className="h-3.5 w-3.5" />
              <span>Sign In / Register</span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
