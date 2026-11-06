const axios = require("axios");

const getPrimaryModel = () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const getFallbackModels = () => {
  const primary = getPrimaryModel();
  return (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash,gemini-3.1-flash-lite,gemini-flash-latest")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m && m !== primary);
};

const SYSTEM_INSTRUCTION = `You are CourseMate AI, an expert academic study assistant designed to help students learn efficiently.

Core Guidelines:
1. Be concise, well-structured, accurate, and pedagogically sound.
2. Start immediately with the direct answer. Never include conversational filler, greetings, or self-referential introductory phrases (e.g., avoid "Sure, I can help with that!", "As an AI...", "Here is an explanation:").
3. For simple academic questions, differences, or definitions:
   - Provide a clear, short conceptual explanation (1-3 sentences).
   - Use a clean GitHub Flavored Markdown comparison table whenever comparing two or more concepts (such as DFA vs NFA, Stack vs Queue, Process vs Thread).
   - Include a brief, concrete example or key distinguishing feature.
   - Do NOT add unnecessary filler sections, repetitive summaries, or bloated boilerplate.
4. Formatting Standards:
   - Use standard Markdown: clear headings (## or ###), bold text for key terms, bullet points, and tables.
   - Mathematical expressions: Format mathematical symbols, variables, transition functions, and formulas using standard LaTeX syntax enclosed in single dollar signs for inline math (e.g., $Q$, $\\Sigma$, $\\delta$, $\\delta(q, a) = p$, $O(n \\log n)$) or double dollar signs for block formulas ($$...$$). Never leave raw LaTeX commands like \\delta or \\Sigma unescaped or outside math delimiters.
   - Code: Use fenced code blocks with the language identifier (e.g., \`\`\`python).`;

/**
 * Calls the Google Gemini API to generate an answer for general chat.
 * @param {string} prompt - User query
 * @param {Array<{ role: string, content: string }>} conversationHistory - Optional recent conversation history
 * @returns {Promise<string>}
 */
const generateGeneralAnswer = async (prompt, conversationHistory = []) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in backend environment.");
  }

  // Construct message contents
  const contents = [];

  // Include recent history if provided (up to last 6 messages)
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-6);
    for (const msg of recent) {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  // Add the current user prompt
  contents.push({
    role: "user",
    parts: [{ text: prompt }],
  });

  const payload = {
    contents,
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  const primaryModel = getPrimaryModel();
  const fallbackModels = getFallbackModels();
  const modelsToTry = [primaryModel, ...fallbackModels];
  let lastError = null;

  for (const model of modelsToTry) {
    const startTime = Date.now();
    try {
      console.log(`[Gemini] Calling model '${model}' (prompt length: ${prompt.length})...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 15000, // 15-second bounded timeout (well above typical ~1.8s generation)
      });

      const elapsed = Date.now() - startTime;
      const candidate = response.data?.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;

      if (text) {
        console.log(`[Gemini] Model '${model}' succeeded in ${elapsed}ms (${text.length} chars generated)`);
        return text.trim();
      } else {
        console.warn(`[Gemini] Model '${model}' returned empty content candidates after ${elapsed}ms`);
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const status = err.response?.status;
      const errorDetail = err.response?.data?.error?.message || err.message;
      console.warn(`[Gemini] Model '${model}' failed after ${elapsed}ms [HTTP ${status || "N/A"}]: ${errorDetail}`);
      lastError = err;

      // For non-retryable client errors (e.g. 400 invalid argument / decommissioned model), skip to next model immediately
      if (status === 400 || status === 404) {
        continue;
      }
    }
  }

  throw new Error(
    `Gemini general chat generation failed: ${lastError?.response?.data?.error?.message || lastError?.message || "Service unavailable"}`
  );
};

const REWRITE_SYSTEM_INSTRUCTION = `You are an expert query reformulator for a conversational document retrieval system.
Given the recent conversation history between a student and an AI assistant, and the student's latest question, rewrite the latest question into a single, complete, standalone question suitable for document retrieval.

Rules:
1. If the question refers to previous context (using pronouns like 'it', 'its', 'they', 'them', 'this', 'that', 'the second one', 'difference between them', etc.), rewrite it into a clear standalone search query that preserves the student's exact intent and core topic.
2. If the question is already complete and standalone (does not depend on previous conversation), return it unchanged.
3. Preserve the student's actual intent. Do not unnecessarily rewrite questions that are already standalone.
4. Do NOT answer the question.
5. Do NOT include introductory filler, explanations, markdown quotes, or notes.
6. Return ONLY the rewritten standalone question.`;

/**
 * Rewrites a conversational follow-up question into a standalone question using conversation history.
 * @param {string} question - Current student question
 * @param {Array<{ role: string, content: string }>} conversationHistory - Last 6 messages (at most 3 pairs)
 * @returns {Promise<string>} Standalone rewritten question or original question on fallback
 */
const rewritePdfQuery = async (question, conversationHistory = []) => {
  if (!question || !question.trim()) return "";
  const trimmedQ = question.trim();

  // If no history exists, question is already standalone
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return trimmedQ;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[Gemini:Rewrite] GEMINI_API_KEY not configured, using original question.");
    return trimmedQ;
  }

  // Format last 6 messages
  const recent = conversationHistory.slice(-6);
  const historyText = recent
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content ? m.content.trim() : ""}`)
    .join("\n");

  const prompt = `Conversation History:\n${historyText}\n\nStudent Question:\n${trimmedQ}\n\nStandalone Question:`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: REWRITE_SYSTEM_INSTRUCTION }],
    },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
    },
  };

  const primaryModel = getPrimaryModel();
  const fallbackModels = getFallbackModels();
  const modelsToTry = [primaryModel, ...fallbackModels];

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      const candidate = response.data?.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;

      if (text && text.trim()) {
        const cleaned = text.trim().replace(/^["']|["']$/g, "").trim();
        if (cleaned) {
          return cleaned;
        }
      }
    } catch (err) {
      console.warn(`[Gemini:Rewrite] Model '${model}' failed: ${err.message}`);
    }
  }

  // Fallback to original question if rewriting fails
  return trimmedQ;
};

module.exports = {
  generateGeneralAnswer,
  rewritePdfQuery,
};
