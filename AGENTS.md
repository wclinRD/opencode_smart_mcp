# Smart MCP Agent

## 專案定位

Smart MCP 是一個 MCP（Model Context Protocol）伺服器，提供智慧化工具路由與程式碼分析能力。核心設計哲學：**用最少 token 做最多事**。

## 架構概覽

```
src/
├── server/          # MCP 伺服器入口 + Loader
│   ├── index.mjs    # 主入口（JSON-RPC over stdio）
│   └── loader.mjs   # Plugin Loader（core→native, standard→router）
├── plugins/
│   ├── core/        # 原生 MCP 工具（Direct call）
│   │   ├── fast-apply.mjs   # 統一編輯引擎
│   │   ├── edit-chain.mjs   # 批次編輯鏈（Layer 0）
│   │   ├── grep.mjs         # 程式碼搜尋
│   │   ├── lsp.mjs          # LSP 橋接
│   │   └── ...
│   └── standard/    # Router 工具（經 smart_run）
│       ├── adr.mjs          # 架構決策記錄
│       ├── planner.mjs      # 任務規劃
│       ├── goal.mjs         # 目標追蹤
│       └── ...
├── lib/             # 共享函式庫
│   ├── apply-engine.mjs     # Hashline/SearchReplace/Sed 編輯引擎
│   ├── smart-read.mjs       # 漸進式檔案讀取
│   └── ...
└── cli/             # CLI 工具（子行程執行）
    ├── contextual-grep.mjs
    └── ...
config/
├── agents/smart-mcp.md   # Agent 系統提示詞
└── tools/manifest.json   # 工具清單（Loader 自動生成）
```

## 關鍵慣例

- **Plugin 位置決定級別**：`core/` = native MCP tool（Layer 0），`standard/` = sub-tool（經 smart_run）
- **Loader 自動註冊**：新增 .mjs 到 plugins/ 目錄即可，重啟後自動生效
- **manifest.json 唯讀**：由 Loader 自動產生，勿手動編輯
- **smart-mcp.md 雙同步**：`config/agents/smart-mcp.md` ↔ `~/.config/opencode/agents/smart-mcp.md`

## 🧠 Session Note（compaction 前必寫）

Compaction 前（或 context 快滿時），寫一行 note 描述你在做什麼：
```
smart_compact({note: "在做什麼、進度到哪、下一步", auto: true})
```
這行 note 會以 🎯 優先顯示在 recovery context 最上方。
