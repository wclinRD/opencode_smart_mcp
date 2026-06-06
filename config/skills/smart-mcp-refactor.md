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
| `import_graph` | `smart_smart_run({tool:"import_graph", args:{root, focus}})` | 跨檔案依賴分析 |
| `naming` | `smart_smart_run({tool:"naming", args:{root}})` | 命名慣例稽核 |
| `rename_safety` | `smart_smart_run({tool:"rename_safety", args:{name, newName}})` | 安全改名分析（預覽模式） |
| `cross_file_edit` | `smart_smart_run({tool:"cross_file_edit", args:{file, pattern, replacement}})` | 跨檔案批量編輯 |
| `edit` | `smart_smart_run({tool:"edit", args:{file, oldString, newString}})` | 單檔案精確編輯（注意：工具名是 `edit` 非 `smart_edit`） |
| `code_impact` | `smart_smart_run({tool:"code_impact", args:{files:['...'], symbols:['...']}})` | 變更影響分析（files/symbols 是陣列） |
| `smart_test` | **直接** `smart_test({root})` | 重構後驗證測試 |
| `planner` | `smart_smart_run({tool:"planner", args:{goal, command:"plan"}})` | 重構計畫分解 |

## 標準重構流程

```
1. import_graph — 了解依賴
   smart_smart_run({tool:"import_graph", args:{root:"src/", focus:"目標檔案.ts"}})

2. naming — 稽核命名
   smart_smart_run({tool:"naming", args:{root:"src/"}})

3. rename_safety — 預覽改名影響
   smart_smart_run({tool:"rename_safety", args:{name:"oldFunc", newName:"newFunc", dryRun:true}})

4. code_impact — 評估變更風險
   smart_smart_run({tool:"code_impact", args:{files:["src/module.ts"], symbols:["exportedFunc"]}})

5. 實際修改（先預覽再套用）
   // 跨檔案批量改
   smart_smart_run({tool:"cross_file_edit", args:{file:"src/ref.ts", pattern:"oldName", replacement:"newName", dryRun:true}})
   
   // 或單檔案精確改
   smart_smart_run({tool:"edit", args:{file:"src/target.ts", oldString:"function oldName(", newString:"function newName("}})

6. 驗證
   smart_test({root:"."})
```

## 注意

- `rename_safety` 預設 dryRun:true，安全無副作用
- `edit` 預設 dryRun:true，需手動設 apply:true 才實際修改
- `cross_file_edit` 預設 dryRun:true
- `code_impact` 的參數是 `files`（陣列）和 `symbols`（陣列），非單一字串

## 不存在工具提醒

❌ `refactor_plan` — 不存在，改用：
   smart_smart_run({tool:"planner", args:{goal:"重構 auth 模組", command:"plan"}})

❌ `smart_edit` — 不存在，工具名是 `edit`
