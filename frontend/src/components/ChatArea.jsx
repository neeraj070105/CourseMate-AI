import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  Send,
  Loader2,
  Trash2,
  Menu,
  FileText,
  MessageSquare,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  BookOpen,
  RotateCcw,
} from "lucide-react";

/**
 * Preprocesses Markdown content from the assistant to ensure KaTeX math delimiters
 * and citations are properly formatted.
 */
function preprocessContent(content) {
  if (!content || typeof content !== "string") return "";

  // 1. Normalize block math \[ ... \] to $$ ... $$
  let text = content.replace(/\\\[([\s\S]*?)\\\]/g, (_, eq) => `\n$$\n${eq.trim()}\n$$\n`);

  // 2. Normalize inline math \( ... \) to $ ... $
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, eq) => `$${eq.trim()}$`);

  // 3. Normalize double-escaped backslashes before common LaTeX symbols
  text = text.replace(
    /\\\\(delta|Sigma|epsilon|gamma|lambda|alpha|beta|theta|phi|omega|in|subseteq|subset|cup|cap|times|rightarrow|leftarrow|le|ge|neq|approx|equiv|forall|exists|emptyset|infty)\b/g,
    "\\$1"
  );

  // 4. Wrap isolated LaTeX math commands that are outside dollar delimiters into $...$
  text = text.replace(
    /(?:^|(?<=[^\$\`\\]))(\\(?:delta|Sigma|epsilon|gamma|lambda|alpha|beta|theta|phi|omega)(?:\([^)]*\)|_[a-zA-Z0-9]+|\^[a-zA-Z0-9]+|\s*=\s*[^.,;\s]+)?)(?=[^\$\`\w]|$)/g,
    (match, formula) => `$${formula.trim()}$`
  );

  // 5. Convert page citations like [Page 1] or [Pages 1, 2] to special links for safe pill rendering
  text = text.replace(/\[(Pages?\s+[\d\s,]+)\]/gi, "[$1](#page-citation)");

  return text;
}

/**
 * Renders Assistant responses using full GitHub Flavored Markdown and KaTeX math.
 */
function AssistantMarkdown({ content }) {
  const processed = preprocessContent(content);

  return (
    <div className="prose prose-slate max-w-none text-slate-800 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Headings
          h1: ({ node, ...props }) => (
            <h1 className="text-base sm:text-lg font-bold text-slate-900 mt-4 mb-2 first:mt-0 pb-1 border-b border-slate-200" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="text-sm sm:text-base font-bold text-slate-900 mt-3 mb-1.5 first:mt-0" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="text-xs sm:text-sm font-semibold text-slate-900 mt-2.5 mb-1 first:mt-0" {...props} />
          ),
          h4: ({ node, ...props }) => (
            <h4 className="text-xs font-semibold text-slate-800 mt-2 mb-1 first:mt-0" {...props} />
          ),

          // Paragraphs & Lists
          p: ({ node, ...props }) => (
            <p className="my-2 leading-relaxed first:mt-0 last:mb-0" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="my-2 ml-5 list-disc space-y-1 text-slate-700" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-2 ml-5 list-decimal space-y-1 text-slate-700" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="leading-relaxed" {...props} />
          ),

          // Bold & Italic
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-slate-900" {...props} />
          ),
          em: ({ node, ...props }) => (
            <em className="italic text-slate-800" {...props} />
          ),

          // Blockquotes
          blockquote: ({ node, ...props }) => (
            <blockquote className="my-2 border-l-4 border-indigo-400 bg-slate-50/70 py-1 px-3 italic text-slate-700 rounded-r text-xs sm:text-sm" {...props} />
          ),

          // Horizontal Rule
          hr: ({ node, ...props }) => (
            <hr className="my-3 border-slate-200" {...props} />
          ),

          // Tables (GFM)
          table: ({ node, ...props }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-slate-200 shadow-2xs">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs sm:text-sm" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => (
            <thead className="bg-slate-100/90 text-slate-800 font-semibold" {...props} />
          ),
          tbody: ({ node, ...props }) => (
            <tbody className="divide-y divide-slate-100 bg-white" {...props} />
          ),
          th: ({ node, ...props }) => (
            <th className="px-3 py-2 font-semibold text-slate-900 border-r border-slate-200 last:border-r-0 whitespace-nowrap" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="px-3 py-2 text-slate-700 border-r border-slate-100 last:border-r-0 whitespace-normal" {...props} />
          ),
          tr: ({ node, ...props }) => (
            <tr className="hover:bg-slate-50/60 transition-colors" {...props} />
          ),

          // Code blocks & inline code
          code: ({ node, inline, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const isMultiline = String(children).includes("\n");
            if (!inline && (match || isMultiline)) {
              return (
                <div className="my-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-slate-100 text-xs sm:text-sm font-mono shadow-inner">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </div>
              );
            }
            return (
              <code
                className="rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-xs text-indigo-700 font-semibold"
                {...props}
              >
                {children}
              </code>
            );
          },

          // Links and Citation Badges
          a: ({ node, href, children, ...props }) => {
            if (href === "#page-citation" || (href && href.startsWith("#page-"))) {
              return (
                <span className="inline-flex items-center rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-100 mx-0.5 align-baseline">
                  {children}
                </span>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-indigo-600 underline hover:text-indigo-800 transition"
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatArea({
  mode,
  messages = [],
  onSendMessage,
  onRetry,
  lastFailedQuestion,
  loading,
  error,
  selectedDocument,
  onRetryDocument,
  currentChatTitle,
  pdfDeletedNotice,
  onClearChat,
  onToggleSidebar,
}) {
  const [input, setInput] = useState("");
  const [expandedSources, setExpandedSources] = useState({});
  const [showPdfDeletedBanner, setShowPdfDeletedBanner] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const isSubmittingRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    if (!pdfDeletedNotice) {
      setShowPdfDeletedBanner(false);
      return;
    }

    setShowPdfDeletedBanner(true);

    const timer = setTimeout(() => {
      setShowPdfDeletedBanner(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, [pdfDeletedNotice]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!input.trim() || loading || isSubmittingRef.current) return;
    if (mode === "pdf" && (pdfDeletedNotice || !selectedDocument)) return;

    isSubmittingRef.current = true;
    const submittedText = input.trim();
    onSendMessage(submittedText);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Safety timeout to reset synchronous submission lock
    setTimeout(() => {
      isSubmittingRef.current = false;
    }, 300);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
  };

  const toggleSource = (idx) => {
    setExpandedSources((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const sampleGeneralPrompts = [
    "What is the difference between DFA and NFA?",
    "Explain Big-O notation with simple code examples",
    "What is the difference between a process and a thread?",
    "How does indexing make database queries faster?",
  ];

  const samplePDFPrompts = [
    "What are the main topics covered in this material?",
    "Summarize the key takeaways from this document",
    "List the critical definitions and formulas mentioned",
  ];

  const isPdfNotFound = (text) => {
    if (!text) return false;
    return text.toLowerCase().includes("information was not found in the provided");
  };

  const cleanExcerpt = (text, queryOrContent = "") => {
    if (!text || typeof text !== "string") return "Relevant section from course document.";
    let cleaned = text
      .replace(/This page intentionally contains substantial text[^\n.]*[\n.]*/gi, "")
      .replace(/so that a \d+-token chunking configuration can create multiple chunks[^\n.]*[\n.]*/gi, "")
      .replace(/^Database Systems\s*[–-]\s*Page\s*\d+\s*/gi, "")
      .replace(/Database Systems\s*[–-]\s*Page\s*\d+\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return "Relevant section from course document.";

    if (cleaned.length <= 220) return cleaned;

    if (queryOrContent && typeof queryOrContent === "string") {
      const stopwords = new Set([
        "what", "is", "a", "an", "the", "are", "in", "of", "to", "how",
        "why", "does", "do", "explain", "describe", "define", "for", "with",
        "from", "and", "or", "that", "this", "these", "those"
      ]);
      const words = (queryOrContent.match(/[A-Za-z0-9_-]+/g) || [])
        .filter((w) => !stopwords.has(w.toLowerCase()) && w.length > 2);

      for (let i = 0; i < words.length - 1; i++) {
        const phrase = `${words[i]} ${words[i + 1]}`;
        const idx = cleaned.toLowerCase().indexOf(phrase.toLowerCase());
        if (idx !== -1) {
          const start = Math.max(0, idx);
          const snippet = cleaned.slice(start, start + 217).trim();
          return (start > 0 ? "..." : "") + snippet + (start + 217 < cleaned.length ? "..." : "");
        }
      }

      for (const w of words) {
        const regex = new RegExp(`\\b${w}\\b`, "i");
        const match = cleaned.match(regex);
        if (match && match.index != null) {
          const start = Math.max(0, match.index);
          const snippet = cleaned.slice(start, start + 217).trim();
          return (start > 0 ? "..." : "") + snippet + (start + 217 < cleaned.length ? "..." : "");
        }
      }
    }

    return cleaned.slice(0, 217) + "...";
  };

  return (
    <div className="flex flex-1 flex-col h-screen overflow-hidden bg-white">
      {/* Top Header Bar */}
      <header className="flex h-14 items-center justify-between border-b border-slate-200 px-4 shrink-0 bg-white/80 backdrop-blur-xs">
        <div className="flex items-center space-x-3 min-w-0">
          <button
            onClick={onToggleSidebar}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-md md:hidden"
            title="Toggle Menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center space-x-2 min-w-0">
            {mode === "general" ? (
              <div className="flex items-center space-x-2 min-w-0">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                  <MessageSquare className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-sm font-semibold text-slate-800 truncate max-w-[200px] sm:max-w-md">
                    {currentChatTitle || "Ask Anything"}
                  </h1>
                  <p className="text-[11px] text-slate-400 hidden sm:block">
                    Direct study assistance via Gemini
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center space-x-2 min-w-0">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                  <FileText className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h1 className="text-sm font-semibold text-slate-800 truncate max-w-[200px] sm:max-w-xs md:max-w-md">
                      {selectedDocument
                        ? selectedDocument.originalName
                        : currentChatTitle || "Ask from My PDF"}
                    </h1>
                    {selectedDocument && !pdfDeletedNotice && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700 border border-emerald-100 shrink-0">
                        PDF Mode
                      </span>
                    )}
                    {pdfDeletedNotice && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.2 text-[10px] font-medium text-amber-700 border border-amber-200 shrink-0">
                        PDF Deleted
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate hidden sm:block">
                    {pdfDeletedNotice
                      ? "Original document was deleted. Saved answers and citations preserved."
                      : selectedDocument
                      ? `Retrieval-Augmented Q&A (${selectedDocument.chunkCount || "Ready"} chunks indexed)`
                      : "Select or upload a PDF from the sidebar"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center space-x-2">
          {messages.length > 0 && (
            <button
              onClick={onClearChat}
              className="flex items-center space-x-1 rounded-md px-2.5 py-1 text-xs text-slate-500 hover:text-red-600 hover:bg-slate-50 transition border border-transparent hover:border-slate-200"
              title="Clear active conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear Chat</span>
            </button>
          )}
        </div>
      </header>

      {/* PDF Deleted Warning Banner if applicable */}
      {showPdfDeletedBanner && pdfDeletedNotice && (
        <div className="mx-4 mt-3 flex items-start space-x-2.5 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200 shrink-0">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-950">Associated Document Removed</p>
            <p className="mt-0.5 text-amber-800">{pdfDeletedNotice}</p>
          </div>
        </div>
      )}

      {/* Document Processing Banner */}
      {mode === "pdf" && selectedDocument && (selectedDocument.status === "processing" || selectedDocument.status === "pending") && (
        <div className="mx-4 mt-3 flex items-start space-x-2.5 rounded-lg bg-indigo-50/90 p-3 text-xs text-indigo-900 border border-indigo-200 shrink-0">
          <Loader2 className="h-4 w-4 shrink-0 text-indigo-600 mt-0.5 animate-spin" />
          <div className="flex-1">
            <p className="font-semibold text-indigo-950">
              Processing Document {selectedDocument.ocrUsed ? "(OCR Active)" : ""}
            </p>
            <p className="mt-0.5 text-indigo-800">
              CourseMate AI is currently extracting text, chunking, and indexing "{selectedDocument.originalName}".
              Questions will be enabled once indexing completes.
            </p>
          </div>
        </div>
      )}

      {/* Document Failed Banner */}
      {mode === "pdf" && selectedDocument && selectedDocument.status === "failed" && (
        <div className="mx-4 mt-3 flex items-start justify-between space-x-2.5 rounded-lg bg-red-50 p-3 text-xs text-red-900 border border-red-200 shrink-0">
          <div className="flex items-start space-x-2.5 min-w-0">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            <div className="min-w-0">
              <p className="font-semibold text-red-950">Document Processing Failed</p>
              <p className="mt-0.5 text-red-800 break-words">
                {selectedDocument.errorMessage || "An error occurred during text extraction or indexing."}
              </p>
            </div>
          </div>
          {onRetryDocument && (
            <button
              onClick={() => onRetryDocument(selectedDocument._id)}
              className="ml-3 shrink-0 inline-flex items-center space-x-1 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-red-700 border border-red-300 hover:bg-red-50 transition shadow-2xs"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Retry Processing</span>
            </button>
          )}
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Welcome Screen When Messages Empty */}
          {messages.length === 0 && (
            <div className="my-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                {mode === "general" ? (
                  <Sparkles className="h-6 w-6" />
                ) : (
                  <BookOpen className="h-6 w-6" />
                )}
              </div>

              <h2 className="text-lg font-semibold text-slate-800">
                {mode === "general"
                  ? "Welcome to CourseMate AI"
                  : selectedDocument
                  ? `Studying "${selectedDocument.originalName}"`
                  : "Select a PDF to Begin"}
              </h2>

              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                {mode === "general"
                  ? "Ask any question about your courses, homework, algorithms, writing, or exam prep."
                  : selectedDocument
                  ? "Ask questions strictly answered by your uploaded document. Answers include exact page citations."
                  : "Upload a course PDF in the sidebar or pick an existing document to start questioning your material."}
              </p>

              {/* Starter Question Chips */}
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {(mode === "general"
                  ? sampleGeneralPrompts
                  : selectedDocument
                  ? samplePDFPrompts
                  : []
                ).map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(prompt);
                      textareaRef.current?.focus();
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-2xs hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-700 transition"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages Stream */}
          {messages.map((msg, index) => {
            const isUser = msg.role === "user";
            const notFound = !isUser && isPdfNotFound(msg.content);
            const isPdfAssistant =
              !isUser &&
              (mode === "pdf" || (msg.sources && msg.sources.length > 0));

            // Filter and deduplicate sources actually cited in the final answer
            const renderedSources = [];
            const seenSources = new Set();
            const sourceList = Array.isArray(msg.sources) ? msg.sources : [];

            // Find all page numbers explicitly cited in msg.content
            const pageMatches = msg.content ? Array.from(msg.content.matchAll(/\[Pages?\s+([\d\s,]+)\]/gi)) : [];
            const citedPages = new Set();
            pageMatches.forEach((m) => {
              const digits = m[1].match(/\d+/g) || [];
              digits.forEach((d) => citedPages.add(Number(d)));
            });

            sourceList.forEach((src) => {
              if (!src) return;
              const pageNum = src.page_number != null ? Number(src.page_number) : null;

              if (citedPages.size > 0 && pageNum != null && !citedPages.has(pageNum)) {
                return;
              }

              const pageLabel = pageNum != null ? `Page ${pageNum}` : "Document";
              const rawText = src.text ? src.text.trim().replace(/\s+/g, " ") : "";
              const key = src.chunk_id || `${pageLabel}_${rawText.slice(0, 80)}`;

              if (!seenSources.has(key)) {
                seenSources.add(key);
                const excerpt = src.excerpt
                  ? cleanExcerpt(src.excerpt)
                  : cleanExcerpt(rawText, msg.content);
                renderedSources.push({
                  pageNumber: pageNum,
                  excerpt,
                });
              }
            });

            return (
              <div
                key={msg._id || index}
                className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
              >
                {/* Bubble Container */}
                <div
                  className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? "bg-slate-900 text-white rounded-br-xs"
                      : notFound
                      ? "bg-amber-50/80 text-amber-950 border border-amber-200 rounded-bl-xs"
                      : "bg-slate-100/90 text-slate-800 rounded-bl-xs shadow-2xs"
                  }`}
                >
                  {/* Sender label */}
                  <div
                    className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wider ${
                      isUser
                        ? "text-slate-400"
                        : notFound
                        ? "text-amber-700"
                        : "text-indigo-600"
                    }`}
                  >
                    {isUser ? "You" : notFound ? "Document Notice" : "CourseMate AI"}
                  </div>

                  {/* Message Content: Rich Markdown for Assistant, clean text for User */}
                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words font-sans text-sm">
                      {msg.content}
                    </div>
                  ) : (
                    <AssistantMarkdown content={msg.content} />
                  )}

                  {/* PDF Sources Section (Only shown when cited sources exist) */}
                  {isPdfAssistant && !notFound && renderedSources.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-200/80">
                      <button
                        type="button"
                        onClick={() => toggleSource(index)}
                        className="inline-flex items-center space-x-1 text-xs font-medium text-slate-500 hover:text-indigo-600 transition focus:outline-none"
                      >
                        <span>Sources</span>
                        {expandedSources[index] ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>

                      {/* Expandable Sources Details */}
                      {expandedSources[index] && (
                        <div className="mt-2 text-xs">
                          <p className="font-semibold text-slate-700 mb-1.5">Sources</p>
                          <ul className="space-y-1.5 text-slate-600">
                            {renderedSources.map((src, sIdx) => (
                              <li key={sIdx} className="leading-relaxed">
                                <span className="font-semibold text-slate-800">
                                  • {src.pageNumber ? `Page ${src.pageNumber}` : "Document"}
                                </span>
                                {" — "}
                                <span>{src.excerpt}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Loading Indicator */}
          {loading && (
            <div className="flex items-start">
              <div className="rounded-2xl rounded-bl-xs bg-slate-100 px-4 py-3 text-sm text-slate-600 flex items-center space-x-2 shadow-2xs">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                <span className="text-xs">
                  {mode === "pdf"
                    ? "Searching PDF & synthesizing answer..."
                    : "CourseMate is thinking..."}
                </span>
              </div>
            </div>
          )}

          {/* Error Banner with Retry Option */}
          {error && (
            <div className="flex items-center justify-between rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-200">
              <div className="flex items-center space-x-2 min-w-0 pr-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                <span className="truncate">{error}</span>
              </div>
              {onRetry && lastFailedQuestion && (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={loading}
                  className="shrink-0 flex items-center space-x-1 rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 transition disabled:opacity-50"
                  title="Retry failed generation"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom Input Area */}
      <div className="border-t border-slate-200 bg-white p-3 shrink-0">
        <div className="mx-auto max-w-3xl">
          <form
            onSubmit={handleSubmit}
            className="relative flex items-end rounded-xl border border-slate-300 bg-white p-1.5 shadow-2xs focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500"
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={
                loading ||
                (mode === "pdf" && (
                  pdfDeletedNotice ||
                  !selectedDocument ||
                  selectedDocument.status !== "completed"
                ))
              }
              placeholder={
                mode === "pdf"
                  ? pdfDeletedNotice
                    ? "Associated PDF was deleted. Start a New Chat with an uploaded PDF."
                    : !selectedDocument
                    ? "Please select an uploaded PDF from the sidebar first"
                    : selectedDocument.status === "processing" || selectedDocument.status === "pending"
                    ? "Document is still processing (OCR & Ingestion). Please wait..."
                    : selectedDocument.status === "failed"
                    ? "Document processing failed. Click 'Retry Processing' above to try again."
                    : `Ask a question from "${selectedDocument.originalName}"...`
                  : "Ask anything (course questions, code, math, essays)..."
              }
              className="w-full resize-none bg-transparent px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none disabled:bg-transparent disabled:placeholder-slate-400"
            />

            <button
              type="submit"
              disabled={
                loading ||
                !input.trim() ||
                (mode === "pdf" && (
                  pdfDeletedNotice ||
                  !selectedDocument ||
                  selectedDocument.status !== "completed"
                ))
              }
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-40"
              title="Send question"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>

          {/* Subtitle / Mode Disclaimer */}
          <div className="mt-2 text-center text-[11px] text-slate-400">
            {mode === "pdf" ? (
              <span>
                PDF Mode: Answers are strictly generated from the selected document with page citations.
              </span>
            ) : (
              <span>
                Ask Anything: Powered by Gemini for general academic assistance.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
