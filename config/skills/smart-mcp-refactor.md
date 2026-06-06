---
description: 程式碼重構：安全改名、跨檔案編輯、依賴分析、命名稽核。先分析依賴再動手。
---

# Smart MCP 重構 Skill

## 呼叫慣例

```
Core 工具：直接呼叫 smart_test(), smart_grep(), ...  
Standard 工具：smart_smart_run({tool:"工具名", args:{...}})
```

## 工具速查

| 工具 | 呼叫方式 | 用途 |
|------|---------|------|
| `import_graph` | `ssr({tool:"import_graph", args:{root, focus}})` | 跨檔案依賴分析 |
| `naming` | `ssr({tool:"naming", args:{root}})` | 命名慣例稽核 |
| `rename_safety` | `ssr({tool:"rename_safety", args:{name, newName}})` | 安全改名分析（預覽模式） |
| `cross_file_edit` | `ssr({tool:"cross_file_edit", args:{file, pattern, replacement}})` | 跨檔案批量編輯 |
| `edit` | `ssr({tool:"edit", args:{file, oldString, newString}})` | 單檔案精確編輯（名為 `edit` 非 `smart_edit`） |
| `code_impact` | `ssr({tool:"code_impact", args:{files, symbols}})` | 變更影響分析（files/symbols 是陣列） |
| `code_ast` | `ssr({tool:"code_ast", args:{file, symbol}})` | AST 結構查詢（取代盲目 grep） |
| `code_call_graph` | `ssr({tool:"code_call_graph", args:{file, symbol}})` | 函式呼叫關係追蹤 |
| `fast_apply` | `ssr({tool:"fast_apply", args:{format, text}})` | **LLM patch 套用**（支援 5 格式，token 省 40-60%） |
| `patch_gen` | `ssr({tool:"patch_gen", args:{input}})` | 分析輸出→編輯指令橋接 |
| `impact_flow` | `ssr({tool:"impact_flow", args:{diff}})` | 完整變更影響管線（diff→CKG→test） |
| `arch_overview` | `ssr({tool:"arch_overview", args:{root}})` | 專案架構總覽（層次+依賴+違規） |
| `smart_test` | **直接** `smart_test({root})` | 重構後驗證測試 |
| `workflow` | `ssr({tool:"workflow", args:{command, goal}})` | 重構工作流自動化（refactor-flow 模板） |
| `compose` | `ssr({tool:"compose", args:{pipeline}})` | 工具 pipeline 組合 |
| `planner` | `ssr({tool:"planner", args:{goal, command:"plan"}})` | 重構計畫分解 |

> `ssr` = `smart_smart_run`

## 標準重構流程

### 流程 A：安全改名（最常見）

```
1. import_graph — 了解依賴
   ssr({tool:"import_graph", args:{root:"src/", focus:"目標檔案.ts"}})

2. arch_overview — 看整體架構（大規模重構才需要）
   ssr({tool:"arch_overview", args:{root:"src/"}})

3. naming — 稽核命名
   ssr({tool:"naming", args:{root:"src/"}})

4. rename_safety — 預覽改名影響
   ssr({tool:"rename_safety", args:{name:"oldFunc", newName:"newFunc", dryRun:true}})

5. code_impact / impact_flow — 評估變更風險
   ssr({tool:"code_impact", args:{files:["src/module.ts"], symbols:["exportedFunc"]}})
   // 或完整管線
   ssr({tool:"impact_flow", args:{file:"src/module.ts", root:"."}})

6. 實際修改（三種方式，依情境選一種）
   // 🥇 優先：fast_apply（支援 unified-diff / SEARCH/REPLACE / lazy）
   ssr({tool:"fast_apply", args:{format:"search-replace", text:"<<SEARCH/REPLACE blocks>>", dryRun:true}})
   // 確認後 ssr({tool:"fast_apply", args:{format:"search-replace", text:"...", apply:true}})

   // 🥈 跨檔案批量取代
   ssr({tool:"cross_file_edit", args:{file:"src/ref.ts", pattern:"oldName", replacement:"newName", dryRun:true}})

   // 🥉 單檔案精確取代
   ssr({tool:"edit", args:{file:"src/target.ts", oldString:"function oldName(", newString:"function newName("}})

7. 驗證
   smart_test({root:"."})
```

### 流程 B：分析→patch 閉環（LLM 生成重構建議時）

```
1. 用分析工具理解問題
   code_ast / code_call_graph / import_graph / debug

2. patch_gen — 自動產生編輯指令
   ssr({tool:"patch_gen", args:{input:"<分析工具輸出>", preview:true}})
   
3. fast_apply — 套用 patch（先預覽）
   ssr({tool:"fast_apply", args:{format:"search-replace", text:"...", dryRun:true}})

4. 確認後套用
   ssr({tool:"fast_apply", args:{format:"search-replace", text:"...", apply:true}})

5. 驗證
   smart_test({root:"."})
```

### 流程 C：程式碼結構分析（重構前理解程式碼）

```
// AST 查詢取代盲目 grep
ssr({tool:"code_ast", args:{file:"src/module.ts", symbol:"MyClass", kind:"class", recursive:true}})

// 函式呼叫關係
ssr({tool:"code_call_graph", args:{file:"src/module.ts", symbol:"myFunction", direction:"callers", depth:2, crossFile:true}})
```

## 注意

- `rename_safety` 預設 dryRun:true，安全無副作用
- `edit` 預設 dryRun:true，需手動設 apply:true 才實際修改
- `cross_file_edit` 預設 dryRun:true
- `fast_apply` 預設 dryRun:true，3+ 檔案須 apply:true 明確授權
- `code_impact` 的參數是 `files`（陣列）和 `symbols`（陣列），非單一字串
- 複雜重構（5+ 步驟）先用 `planner plan` 或 `workflow refactor-flow` 分解

## 不存在工具提醒

❌ `refactor_plan` — 不存在，改用：
   ssr({tool:"planner", args:{goal:"重構 auth 模組", command:"plan"}})

❌ `smart_edit` — 不存在，工具名是 `edit`
❌ `smart_fast_apply` — 不存在，工具名是 `fast_apply`
