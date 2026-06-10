---
description: 除錯流程：錯誤記憶庫比對 → 根因分析 → 修復 → 驗證。先查 memory_store 看遇過沒，有 hit 秒解。
---

# Smart MCP 除錯 Skill

## 呼叫慣例

```
Core 工具：直接呼叫 smart_test(), smart_deep_think(), ...
Standard 工具：smart_smart_run({tool:"工具名", args:{...}})
```

## 工具速查

| 工具 | 呼叫方式 | 用途 |
|------|---------|------|
| `error_diagnose` | `ssr({tool:"error_diagnose", args:{error}})` | 錯誤 KB 比對（先查，有 hit 秒解） |
| `debug` | `ssr({tool:"debug", args:{error}})` | 根因分析 |
| `memory_store` | `ssr({tool:"memory_store", args:{command, query}})` | 跨 session 記憶 |
| `smart_deep_think` | **直接** `smart_deep_think({topic, template:"debug"})` | 深度除錯推理 |
| `fast_apply` | `ssr({tool:"fast_apply", args:{format, text}})` | **🥇 優先修復**—套用 LLM patch（省 token 40-60%） |
| `patch_gen` | `ssr({tool:"patch_gen", args:{input}})` | 分析輸出→編輯指令自動轉換 |
| `code_type_infer` | `ssr({tool:"code_type_infer", args:{file}})` | 型別錯誤精確定位 |
| `edit` | `ssr({tool:"edit", args:{file, oldString, newString}})` | 🥈 備用修復（`edit` 非 `smart_edit`） |
| `smart_test` | **直接** `smart_test({root})` | 驗證修復 |

> `ssr` = `smart_smart_run`

## 標準除錯流程

```
Step 1: 查記憶庫 — 有 hit 秒解
  ssr({tool:"error_diagnose", args:{error:"錯誤訊息", noMemory:false}})

Step 2: 根因分析
  ssr({tool:"debug", args:{error:"錯誤訊息", file:"src/app.ts"}})

Step 3: 深入推理（必要時）
  smart_deep_think({topic:"分析錯誤根因", template:"debug", steps:5})

Step 4: 修復（🥇 fast_apply 優先，🥈 edit 備用）
  // 🥇 優先：patch_gen → fast_apply 閉環
  ssr({tool:"patch_gen", args:{input:"<debug 或 thinking 的輸出>", preview:true}})
  // 確認後：
  ssr({tool:"fast_apply", args:{format:"search-replace", text:"<<SEARCH/REPLACE blocks>>", apply:true}})
  
  // 🥈 備用：手動 edit
  // ssr({tool:"edit", args:{file:"src/app.ts", oldString:"buggy code", newString:"fixed code", apply:true}})

Step 5: 驗證
  smart_test({root:"."})

Step 6: 存入記憶庫 — 下次秒解
  ssr({
    tool:"memory_store",
    args:{command:"store", query:"錯誤關鍵字", resolution:"解法描述", category:"runtime"}
  })
```

## 型別錯誤專用流程

```
// 型別錯誤 → code_type_infer 比 debug 更精確
ssr({tool:"code_type_infer", args:{file:"src/app.ts", symbol:"variableName"}})
// → 直接看到變數的實際型別 + 定義位置
```

## 注意

- `error_diagnose` 比 `debug` 更快（查記憶庫而已），優先呼叫
- `memory_store` 的 `store` 指令在修復成功後務必執行
- `fast_apply` 預設 dryRun:true，安全無副作用
- `edit` 工具名是 `edit`，**不是** `smart_edit`

## Token 優化提示

- `error_diagnose` / `debug` 輸出通常很小（<15KB），不使用壓縮
- 若看到 `_optimized` metadata，僅為空白壓縮，無資訊損失
- `fast_apply` 的 unified-diff 格式最省 token（比 search-replace 省 40-60%）
