---
description: 除錯流程：錯誤記憶庫比對 → 根因分析 → 修復 → 驗證。先查 memory_store 看遇過沒，有 hit 秒解。
---

# Smart MCP 除錯 Skill

## 呼叫慣例

```
Core 工具：直接呼叫 smart_test(), smart_thinking(), ...
Standard 工具：smart_smart_run({tool:"工具名", args:{...}})
```

## 工具速查

| 工具 | 呼叫方式 | 用途 |
|------|---------|------|
| `error_diagnose` | `smart_smart_run({tool:"error_diagnose", args:{error}})` | 錯誤 KB 比對（先查，有 hit 秒解） |
| `debug` | `smart_smart_run({tool:"debug", args:{error}})` | 根因分析 |
| `memory_store` | `smart_smart_run({tool:"memory_store", args:{command, query}})` | 跨 session 記憶 |
| `smart_thinking` | **直接** `smart_thinking({topic, template:"debug"})` | 深度除錯推理 |
| `edit` | `smart_smart_run({tool:"edit", args:{file, oldString, newString}})` | 修復（注意：工具名是 `edit` 非 `smart_edit`） |
| `smart_test` | **直接** `smart_test({root})` | 驗證修復 |

## 標準除錯流程

```
Step 1: 查記憶庫 — 有 hit 秒解
  smart_smart_run({tool:"error_diagnose", args:{error:"錯誤訊息", noMemory:false}})

Step 2: 根因分析
  smart_smart_run({tool:"debug", args:{error:"錯誤訊息", file:"src/app.ts"}})

Step 3: 深入推理（必要時）
  smart_thinking({topic:"分析錯誤根因", template:"debug", steps:5})

Step 4: 修復
  smart_smart_run({tool:"edit", args:{file:"src/app.ts", oldString:"buggy code", newString:"fixed code", apply:true}})

Step 5: 驗證
  smart_test({root:"."})

Step 6: 存入記憶庫 — 下次秒解
  smart_smart_run({
    tool:"memory_store",
    args:{command:"store", query:"錯誤關鍵字", resolution:"解法描述", category:"runtime"}
  })
```

## 注意

- `error_diagnose` 比 `debug` 更快（查記憶庫而已），優先呼叫
- `memory_store` 的 `store` 指令在修復成功後務必執行
- `edit` 工具名是 `edit`，**不是** `smart_edit`
