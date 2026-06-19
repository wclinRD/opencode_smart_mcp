// compaction-fix.js — OpenCode Plugin: Compaction Context Recovery
//
// 問題：OpenCode 自動 compaction 後，LLM 常常忘記自己在做什麼，
//       因為中間對話被壓縮成摘要，auto-continue 只給一個 "continue"。
//
// 解法：在 compaction 前注入當前任務狀態到 compaction prompt，
//       compaction 後把 auto-continue 換成精確的恢復指令。
//
// 雙系統橋接：Smart MCP 的 auto-compact (Tier 2/3) 會寫入 ~/.smart/recent-recovery.txt，
//           此 plugin 在 onCompacting 時讀取該檔案，確保 OpenCode compaction
//           摘要中保留 Smart MCP 層的 recovery context。
//
// Hooks used:
//   event                          → 追蹤 todo 狀態 + compaction 事件
//   chat.message                   → 追蹤使用者目標
//   experimental.session.compacting → compaction 前注入上下文（含 Smart MCP recovery）
//   experimental.compaction.autocontinue → 確保 auto-continue 啟用
//   experimental.chat.messages.transform → 改造 auto-continue 訊息

// ============================================================
// In-memory state (survives compaction — plugin process ≠ LLM context)
// ============================================================
const sessionState = new Map(); // sessionID → { goal, todos, lastActions, compactionCount }

function getState(sessionID) {
  if (!sessionState.has(sessionID)) {
    sessionState.set(sessionID, {
      goal: "",
      todos: [],
      lastActions: [],
      compactionCount: 0,
      lastUserMessage: "",
    });
  }
  return sessionState.get(sessionID);
}

// ============================================================
// Plugin Definition
// ============================================================
const plugin = {
  id: "compaction-fix",

  server: async (input, config = {}) => {
    const { client } = input;
    const DEBUG = config.debug || false;

    function log(...args) {
      if (DEBUG) console.log("[compaction-fix]", ...args);
    }

    // ============================================================
    // Hook: event — 追蹤 todo 狀態 + compaction 事件
    // ============================================================
    async function onEvent({ event }) {
      const sessionID =
        event.properties?.sessionID ||
        event.info?.sessionID ||
        event.sessionID;

      if (!sessionID) return;

      // 追蹤 todo 更新
      if (event.type === "todo.updated") {
        const state = getState(sessionID);
        state.todos = event.properties?.todos || [];
        log(`todo.updated: ${state.todos.length} items`);
      }

      // 追蹤 compaction 事件
      if (event.type === "session.compacted") {
        const state = getState(sessionID);
        state.compactionCount++;
        log(
          `session.compacted #${state.compactionCount} — goal: "${state.goal.slice(0, 80)}", todos: ${state.todos.filter((t) => t.status === "in_progress").length} in_progress`
        );
      }

      // 追蹤 session 刪除 → 清理狀態
      if (event.type === "session.deleted") {
        sessionState.delete(sessionID);
        log(`session.deleted: cleaned up ${sessionID}`);
      }
    }

    // ============================================================
    // Hook: chat.message — 追蹤使用者目標
    // ============================================================
    async function onChatMessage(input, output) {
      const { sessionID } = input;
      if (!sessionID) return;

      const state = getState(sessionID);

      // 從 user message 中提取目標
      const textParts = (output.parts || []).filter((p) => p.type === "text");
      const fullText = textParts.map((p) => p.text || "").join(" ");

      if (fullText && fullText.length > 5) {
        state.lastUserMessage = fullText;
        // 只取前 200 字作為目標摘要
        state.goal = fullText.slice(0, 200);
        log(`chat.message: goal updated → "${state.goal.slice(0, 80)}..."`);
      }
    }

    // ============================================================
    // Hook: experimental.session.compacting — compaction 前注入上下文
    // ============================================================
    async function onCompacting(input, output) {
      const { sessionID } = input;
      const state = getState(sessionID);

      // 建立 todo 摘要
      const todoLines = state.todos.map((t) => {
        const icon =
          t.status === "completed"
            ? "✅"
            : t.status === "in_progress"
              ? "🔄"
              : "⏳";
        return `${icon} [${t.status}] ${t.content}`;
      });

      const inProgressTodos = state.todos.filter(
        (t) => t.status === "in_progress"
      );
      const pendingTodos = state.todos.filter(
        (t) => t.status === "pending"
      );

      // === 讀取 Smart MCP 共享 recovery context ===
      // 雙系統橋接：Smart MCP 的 auto-compact 會寫入 ~/.smart/recent-recovery.txt，
      // 我們在 compaction 時嵌入其內容，確保 OpenCode summarizer 保留它。
      let smartMcpRecovery = "";
      try {
        const { readFileSync, existsSync } = await import("fs");
        const { resolve } = await import("path");
        const { homedir } = await import("os");
        const recoveryFile = resolve(homedir(), ".smart", "recent-recovery.txt");
        if (existsSync(recoveryFile)) {
          smartMcpRecovery = readFileSync(recoveryFile, "utf-8").trim();
        }
      } catch {
        // 檔案不存在或無法讀取 → 忽略
      }

      // 建立 recovery 區塊 — 要求 summarizer 附加到摘要末端
      // 這是關鍵：messages.transform 在 compaction 後不會被呼叫，
      // 所以必須直接在 compaction context 中嵌入恢復指令，
      // 讓 summarizer 把它保留在壓縮後的對話中。
      const recoveryBlock = [
        ``,
        `---`,
        `## 🔄 RECOVERY INSTRUCTION — APPEND THIS SECTION VERBATIM TO THE END OF YOUR SUMMARY`,
        ``,
        `**Goal**: ${state.goal || "(see context above)"}`,
        ``,
        inProgressTodos.length > 0
          ? `**In-progress tasks**:\n${inProgressTodos.map((t) => `  - ${t.content}`).join("\n")}`
          : `**In-progress tasks**: none`,
        ``,
        pendingTodos.length > 0
          ? `**Pending tasks**:\n${pendingTodos.map((t) => `  - ${t.content}`).join("\n")}`
          : ``,
        // 嵌入 Smart MCP 的 recovery context（若有）
        smartMcpRecovery ? `\n**Smart MCP Recovery**:\n${smartMcpRecovery}` : "",
        ``,
        `**Instructions for agent after compaction**:`,
        `1. Continue working — do NOT restart from scratch`,
        `2. Use todowrite to track progress`,
        `3. Complete the in-progress task first, then pending tasks`,
        `4. Review the summary above to recall context`,
      ].filter(Boolean).join("\n");

      // 注入到 compaction prompt 的 context
      output.context = [
        `## Current Task Context (MUST preserve in summary)`,
        ``,
        `**Goal**: ${state.goal || "(unknown)"}`,
        ``,
        `**TODO List**:`,
        todoLines.length > 0
          ? todoLines.join("\n")
          : "  (no todos tracked)",
        ``,
        `**In-Progress Tasks**: ${
          inProgressTodos.length > 0
            ? inProgressTodos.map((t) => t.content).join("; ")
            : "none"
        }`,
        ``,
        `**Compaction Count**: ${state.compactionCount + 1}`,
        ``,
        `## CRITICAL: When summarizing, you MUST preserve:`,
        `1. All file paths and line numbers mentioned`,
        `2. Error messages and stack traces`,
        `3. TODO items with their exact status (in_progress/completed/pending)`,
        `4. The current goal and what the user asked you to do`,
        `5. Any architectural decisions or design choices made`,
        `6. Variable names, function names, and code snippets`,
        ``,
        `## FINAL INSTRUCTION: Append the following section VERBATIM at the very end of your summary.`,
        `Do NOT compress or rewrite it. The agent needs these exact instructions to continue working:`,
        recoveryBlock,
      ];

      log(
        `compacting: injecting context + recovery (${state.todos.length} todos, ${inProgressTodos.length} in_progress, goal: "${state.goal.slice(0, 50)}...")`
      );
      log(`HOOK[compacting] — injected recovery block: ${inProgressTodos.length} in_progress, ${pendingTodos.length} pending`);
    }

    // ============================================================
    // Hook: experimental.compaction.autocontinue — 確保 auto-continue 啟用
    // ============================================================
    async function onAutoContinue(input, output) {
      // 永遠啟用 auto-continue（我們會在 messages.transform 中改造訊息內容）
      output.enabled = true;
      log(`autocontinue: enabled for session ${input.sessionID}`);
    }

    // ============================================================
    // Hook: experimental.chat.messages.transform — 改造 auto-continue 訊息
    // ============================================================
    async function onMessagesTransform(input, output) {
      const messages = output.messages || [];
      if (messages.length === 0) return;

      log(`messages.transform: called with ${messages.length} messages`);

      // 找到最後一個 user message（auto-continue 或一般 user message）
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.info?.role !== "user") {
        log(`messages.transform: last message is not user role, skipping`);
        return;
      }

      const sessionID = lastMsg.info?.sessionID;
      if (!sessionID) return;

      const state = getState(sessionID);

      // === 判斷是否需要注入 recovery prompt ===
      // 條件 A: 剛剛經歷了 compaction（state.compactionCount > 0）
      // 條件 B: 這是 auto-continue（短訊息 or "continue" or "auto-continue"）
      const lastTextParts = (lastMsg.parts || []).filter((p) => p.type === "text");
      const lastText = lastTextParts.map((p) => p.text || "").join(" ").trim();
      const isAutoContinue = lastText.length < 100 ||
        lastText.toLowerCase().includes("continue") ||
        lastText.includes("auto-continue") ||
        /^[\s\.,!?;:]*$/.test(lastText);

      // 檢查是否有 compaction part（向後相容舊格式）
      const hasCompactionPart = messages.some((m) =>
        (m.parts || []).some((p) => p.type === "compaction")
      );

      const needsRecovery = state.compactionCount > 0 && (hasCompactionPart || isAutoContinue);

      if (!needsRecovery) {
        if (state.compactionCount > 0) {
          log(`messages.transform: compactionCount=${state.compactionCount} but not auto-continue (len=${lastText.length}), skipping`);
        }
        return;
      }

      // === 建立恢復指令 ===
      const inProgressTodos = state.todos.filter(
        (t) => t.status === "in_progress"
      );
      const pendingTodos = state.todos.filter(
        (t) => t.status === "pending"
      );

      const recoveryPrompt = [
        `## 🔄 Context Restored After Compaction (#${state.compactionCount})`,
        ``,
        `**Your goal was**: ${state.goal || "(review conversation summary above)"}`,
        ``,
        inProgressTodos.length > 0
          ? `**In-progress tasks**:\n${inProgressTodos.map((t) => `  - ${t.content}`).join("\n")}`
          : `**In-progress tasks**: none`,
        ``,
        pendingTodos.length > 0
          ? `**Pending tasks**:\n${pendingTodos.map((t) => `  - ${t.content}`).join("\n")}`
          : "",
        ``,
        `## Instructions:`,
        `1. Review the conversation summary above to recall what you were doing`,
        `2. Check the TODO list — pick up the first "in_progress" item`,
        `3. If unsure, re-read the last few tool outputs in the summary`,
        `4. Continue working — do NOT restart from scratch`,
        ``,
        `Use \`todowrite\` to update task status as you progress.`,
      ]
        .filter(Boolean)
        .join("\n");

      // 改造 text parts
      let replaced = false;
      for (const part of lastTextParts) {
        const text = part.text || "";
        if (
          text.trim().toLowerCase() === "continue" ||
          text.includes("auto-continue") ||
          text.trim().length < 20
        ) {
          part.text = recoveryPrompt;
          replaced = true;
          log(`messages.transform: replaced auto-continue with recovery prompt`);
          break;
        }
      }

      if (!replaced) {
        // 如果找不到 auto-continue text，覆蓋第一個 text part
        if (lastTextParts.length > 0) {
          lastTextParts[0].text = recoveryPrompt;
          replaced = true;
          log(`messages.transform: forced replacement of first text part`);
        }
      }

      // 重置 compactionCount（避免下次重複注入）
      if (replaced) {
        state.compactionCount = 0;
        log(`messages.transform: injected recovery prompt, reset compactionCount`);
      }
    }

    // ============================================================
    // Return hooks
    // ============================================================
    log("plugin initialized");

    return {
      event: onEvent,
      "chat.message": onChatMessage,
      "experimental.session.compacting": onCompacting,
      "experimental.compaction.autocontinue": onAutoContinue,
      "experimental.chat.messages.transform": onMessagesTransform,
    };
  },
};

export default plugin;