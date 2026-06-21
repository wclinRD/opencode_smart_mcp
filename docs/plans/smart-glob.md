# smart_glob 設計方案

> **核心原則**：完全向後相容（相同 tool ID `glob`），所有新功能為 opt-in，預設行為與內建 glob 一致。

---

## 一、現狀分析：OpenCode 內建 glob 的限制

從原始碼分析（`anomalyco/opencode/packages/opencode/src/tool/glob.ts`），目前內建 glob：

```ts
// 核心實作：Ripgrep.files({ cwd, glob: [pattern], signal })
// 參數：只有 pattern + path
// 輸出：檔案路徑清單，按 mtime 排序，上限 100 筆
```

| 維度 | 現狀 | 問題 |
|------|------|------|
| **參數** | `pattern`, `path` | 無法過濾、無法排除、無法控制行為 |
| **Pattern 語法** | 基礎 glob (`*`, `**`, `?`, `[...]`) | 無 brace expansion、無 negation、無 extglob |
| **過濾** | 無 | 無法依大小/時間/類型過濾 |
| **內容搜尋** | 無 | 無法同時搜尋檔案內容 |
| **輸出** | 純路徑清單 | 無 metadata、無分組、無統計 |
| **安全** | 100 筆上限 | 無 timeout、無深度限制 |
| **效能** | ripgrep 單次掃描 | 無快取、無策略分派 |

---

## 二、設計目標

```
Layer 1: 向後相容層（預設）— 行為 = 內建 glob
Layer 2: 增強過濾層（opt-in）— 檔案屬性過濾
Layer 3: 內容搜尋層（opt-in）— 檔案內容匹配
Layer 4: 進階輸出層（opt-in）— metadata、分組、JSON
```

---

## 三、API 設計

### 完整參數表

```typescript
interface SmartGlobParams {
  // ===== Layer 1: 向後相容（與內建 glob 完全一致）=====
  pattern: string;             // glob pattern（支援 brace expansion）
  path?: string;               // 搜尋根目錄（預設: cwd）

  // ===== Layer 2: 增強過濾 =====
  // 多 pattern
  patterns?: string[];         // 多個 pattern（OR 邏輯）
  exclude?: string[];          // 排除 pattern（negation 替代方案）

  // 檔案類型
  type?: "file" | "dir" | "symlink" | "all";  // 預設: "all"

  // 大小過濾
  minSize?: number;            // 最小位元組
  maxSize?: number;            // 最大位元組

  // 時間過濾
  modifiedAfter?: string;      // ISO 8601 或相對時間 "7d", "24h"
  modifiedBefore?: string;
  createdAfter?: string;
  createdBefore?: string;

  // 深度控制
  maxDepth?: number;           // 最大目錄深度（相對於 path）

  // 可見性
  hidden?: boolean;            // 包含隱藏檔案（預設: true，與內建一致）
  ignoreGitignore?: boolean;   // 忽略 .gitignore（預設: false，尊重 gitignore）
  ignoreVcs?: boolean;         // 忽略 .git/ 等 VCS 目錄（預設: true）

  // ===== Layer 3: 內容搜尋 =====
  content?: string;            // 內容 regex pattern（只回傳匹配的檔案）
  contentRegex?: boolean;      // content 是否為 regex（預設: true）
  contentCaseSensitive?: boolean; // 預設: false

  // ===== Layer 4: 輸出控制 =====
  limit?: number;              // 結果上限（預設: 100，與內建一致）
  offset?: number;             // 分頁偏移
  sort?: "name" | "size" | "mtime" | "ctime";  // 排序（預設: "mtime"）
  order?: "asc" | "desc";      // 排序方向（預設: "desc"）
  format?: "paths" | "json" | "grouped" | "stats";  // 輸出格式
  includeStats?: boolean;      // 附帶檔案 stat 資訊

  // ===== 安全 =====
  timeout?: number;            // 毫秒 timeout（預設: 30000）
  followSymlinks?: boolean;    // 追蹤 symlink（預設: false）
}
```

### 輸出格式

#### `format: "paths"`（預設，向後相容）
```
src/tool/glob.ts
src/tool/grep.ts
src/util/filesystem.ts
...
(Results truncated: 100/2347 files. Use --limit to adjust.)
```

#### `format: "json"`
```json
{
  "count": 100,
  "total": 2347,
  "truncated": true,
  "pattern": "src/**/*.ts",
  "elapsed": "45ms",
  "files": [
    { "path": "src/tool/glob.ts", "size": 2048, "mtime": "2026-06-12T10:30:00Z", "type": "file" },
    ...
  ]
}
```

#### `format: "grouped"`
```
src/tool/
  glob.ts (2.0KB)
  grep.ts (5.3KB)
  registry.ts (1.2KB)
src/util/
  filesystem.ts (8.1KB)
  wildcard.ts (1.5KB)
---
3 directories, 100 files (2347 total)
```

#### `format: "stats"`（count-only）
```
2347 files matching "src/**/*.ts"
Total size: 45.2MB
Largest: src/cli/exa-search.mjs (1.2MB)
Newest:  src/tool/glob.ts (2026-06-12T10:30:00Z)
```

---

## 四、實作架構

### 方案 A：Rust 原生二進位（🥇 推薦）

```
smart_glob (Rust binary)
├── ignore crate      ← ripgrep 同款，平行目錄遍歷 + gitignore
├── globset crate     ← 多 pattern 策略分派（Extension/Prefix/Suffix/Regex）
├── regex crate       ← 內容搜尋（線性時間，無回溯）
├── memchr + SIMD     ← literal 加速
└── serde_json        ← JSON 輸出
```

**優勢**：
- 與 ripgrep 同等效能（平行 walker + SIMD + 策略分派）
- `ignore` crate 內建 gitignore、hidden file、symlink 處理
- `globset` 自動選擇最快匹配策略
- 單一二進位，無外部依賴（ripgrep 已安裝在大多數環境）

**劣勢**：
- 需要 Rust 編譯環境（或預編譯 binary）
- 與 Node.js MCP server 的整合需要 child_process

### 方案 B：Node.js + ripgrep 包裝（🥈 備選）

```
smart_glob (Node.js)
├── child_process exec("rg --files --glob ...")  ← 檔案發現
├── child_process exec("rg --json ...")          ← 內容搜尋
├── fs.statSync                                  ← metadata
└── 自訂 glob 匹配（brace expansion, negation）  ← 補 rg 不足
```

**優勢**：
- 與現有 smart-agent 架構一致（Node.js）
- 開發快速
- ripgrep 已安裝

**劣勢**：
- 多次 child_process 呼叫有 overhead
- brace expansion 需自幹
- 無法做到 globset 等級的策略分派

### 方案 C：混合架構（🥉 務實方案，選定）

```
smart_glob (Node.js MCP tool)
├── 輕量 pattern 分析層（JS）
│   ├── brace expansion 展開
│   ├── negation 分離
│   └── 策略偵測（literal/prefix/suffix/glob）
├── ripgrep 執行層（child_process）
│   ├── rg --files --glob（檔案發現）
│   └── rg --json（內容搜尋，optional）
├── 後處理層（JS）
│   ├── stat 收集（size, mtime, type）
│   ├── 過濾（minSize, maxSize, 時間範圍）
│   ├── 排序、分頁
│   └── 格式化輸出
└── 安全層
    ├── timeout（child_process killSignal）
    ├── 結果上限
    └── symlink loop 偵測
```

---

## 五、與內建 glob 的對照

| 功能 | 內建 glob | smart_glob | 備註 |
|------|----------|------------|------|
| `pattern` | ✅ | ✅ | 向後相容 |
| `path` | ✅ | ✅ | 向後相容 |
| 多 pattern | ❌ | ✅ `patterns: []` | |
| 排除 pattern | ❌ | ✅ `exclude: []` | |
| Brace expansion | ❌ | ✅ `{ts,js,mjs}` | |
| Extglob | ❌ | ✅ `@(a\|b)` | |
| 檔案類型過濾 | ❌ | ✅ `type: "file"` | |
| 大小過濾 | ❌ | ✅ `minSize/maxSize` | |
| 時間過濾 | ❌ | ✅ `modifiedAfter` | |
| 深度限制 | ❌ | ✅ `maxDepth` | |
| 隱藏檔案控制 | ❌ | ✅ `hidden: false` | |
| gitignore 控制 | ❌ | ✅ `ignoreGitignore` | |
| 內容搜尋 | ❌ | ✅ `content: "TODO"` | 殺手級功能 |
| JSON 輸出 | ❌ | ✅ `format: "json"` | |
| 分組輸出 | ❌ | ✅ `format: "grouped"` | |
| 統計輸出 | ❌ | ✅ `format: "stats"` | |
| 排序控制 | ❌ (固定 mtime) | ✅ `sort/order` | |
| 分頁 | ❌ | ✅ `offset/limit` | |
| 檔案 metadata | ❌ | ✅ `includeStats` | |
| Timeout | ❌ | ✅ `timeout` | |
| Symlink 控制 | ❌ | ✅ `followSymlinks` | |

---

## 六、核心實作細節

### 6.1 Pattern 分析與策略分派（參考 ripgrep globset）

```typescript
function analyzePattern(pattern: string): MatchStrategy {
  // ExtensionStrategy: "*.ts" → 直接比對副檔名（最快）
  if (/^\*\.[a-zA-Z0-9]+$/.test(pattern)) return "extension";

  // PrefixStrategy: "src/*" → Aho-Corasick 前綴匹配
  if (pattern.endsWith("/*") && !pattern.includes("**"))
    return "prefix";

  // SuffixStrategy: "*_test.ts" → Aho-Corasick 後綴匹配
  if (pattern.startsWith("*") && countStars(pattern) === 1)
    return "suffix";

  // LiteralStrategy: "src/foo/bar.ts" → 直接 stat 檢查
  if (!hasWildcard(pattern)) return "literal";

  // GlobStrategy: 完整 glob 匹配
  return "glob";
}
```

### 6.2 Brace Expansion

```typescript
function expandBraces(pattern: string): string[] {
  // "src/**/*.{ts,js,mjs}" → ["src/**/*.ts", "src/**/*.js", "src/**/*.mjs"]
  // 支援巢狀："{a,b/{c,d}}" → ["a", "b/c", "b/d"]
  // 用 ripgrep 的 brace expansion 或自幹
}
```

### 6.3 內容搜尋整合

```typescript
// 當指定 content 時，兩階段執行：
// Phase 1: rg --files --glob <pattern>  → 候選檔案
// Phase 2: rg --json <content> <files>   → 過濾匹配內容的檔案
// 合併結果回傳
```

### 6.4 安全防護

```typescript
const SAFETY = {
  DEFAULT_LIMIT: 100,        // 與內建一致
  MAX_LIMIT: 10000,          // 絕對上限
  DEFAULT_TIMEOUT: 30000,    // 30 秒
  MAX_TIMEOUT: 120000,       // 2 分鐘
  MAX_DEPTH: 64,             // 最大遞迴深度
  SYMLINK_MAX: 32,           // symlink 追蹤上限
};
```

---

## 七、業界參考技術

### 演算法層面
- **Russ Cox 線性時間演算法**：不回溯到更早的 `*`，複雜度從 O(n^e) 降到 O(n)
- **Thompson NFA 模擬**：`globber-ai` 用 NFA 取代遞迴回溯，保證 O(tokens × input_len)
- **非遞迴堆疊演算法**：`FastGlobbing`（C/C++/Java/Python/JS），被 `ugrep` 採用

### 策略分派
- **ripgrep globset**：7 級策略（Extension → BasenameLiteral → Literal → Suffix → Prefix → RequiredExtension → RegexSet），按速度排序
- **Wildcard (.NET)**：`*.ext` → EndsWith, `prefix*` → StartsWith, `*contains*` → IndexOf
- **glob-library-java**：6 級引擎自動選擇（Empty/Everything/EqualTo/StartsWith/EndsWith/Contains/Glob）

### 編譯技術
- **Aho-Corasick**：ripgrep 用於多 prefix/suffix 單次掃描匹配
- **SIMD 加速**：zlob (Zig) 用 SIMD bitmask 一次比對多個 extension；Wildcard (.NET) 用 SearchValues 硬體加速
- **RadixTree 前綴過濾**：LLVM SpecialCaseList 用 RadixTree 索引 glob 前綴，效能提升 81-98%

### 檔案系統層面
- **Walk-and-Match**：Python CPython #116392，`**` 之後的 segment 轉為 regex 過濾，減少 scandir 呼叫（`Lib/**` 快 5.62x）
- **平行遍歷**：ripgrep 的 work-stealing parallel walker；vexy_glob (Python+Rust) 10-100x 快於原生
- **直接 syscall**：zlob 用 `getdents64` 跳過 libc 開銷

### 安全性
- **線性時間保證**：防止 `a*a*a*a*a*a*a*a*b` 指數爆炸
- **遞迴深度限制**：minimatch 的 `maxGlobstarRecursion`
- **GLOB_LIMIT**：限制匹配數量，控制 CPU/記憶體

---

## 八、與 smart_ 工具生態的整合

`smart_glob` 作為 Layer 1 Direct MCP tool，與其他 smart_ 工具協同：

```
smart_glob({pattern: "**/*.ts"})
  → 快速檔案發現
  → 結果餵給 smart_grep / smart_read / smart_lsp

smart_glob({pattern: "**/*.ts", content: "TODO|FIXME"})
  → 同時做檔案發現 + 內容搜尋
  → 取代「先 glob 再 grep」的兩步操作

smart_glob({pattern: "**/*.ts", format: "json", includeStats: true})
  → 結構化輸出
  → 直接餵給 smart_think 分析
```

---

## 九、總結

| 維度 | 內建 glob | smart_glob |
|------|----------|------------|
| **Token 效率** | 需要 glob → grep 兩步 | 一步完成（content 參數） |
| **LLM 決策品質** | 只有路徑，需再讀檔案判斷 | metadata 直接附帶大小/時間/類型 |
| **大型專案** | 100 筆硬上限 | 可分頁、可過濾、可統計 |
| **安全性** | 無 timeout | timeout + symlink 防護 + 深度限制 |
| **靈活性** | 2 個參數 | 20+ 參數，全 opt-in |
| **向後相容** | - | 預設行為 100% 一致 |

**一句話總結**：`smart_glob` = 內建 glob 的超集，預設行為完全相容，所有增強功能 opt-in，讓 LLM 用更少 token 做更精準的檔案發現。