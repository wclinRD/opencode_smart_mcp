---
description: 測試執行、覆蓋率分析、測試建議
---

# Smart MCP 測試 Skill

## 呼叫慣例

```
Core 工具：直接呼叫 smart_test()
Standard 工具：smart_smart_run({tool:"工具名", args:{...}})
```

## 工具速查

| 工具 | 呼叫方式 | 用途 |
|------|---------|------|
| `smart_test` | **直接** `smart_test({root})` | 執行測試（自動偵測框架） |
| `coverage` | `smart_smart_run({tool:"coverage", args:{file}})` | 檢查特定檔案覆蓋率 |
| `test_suggest` | `smart_smart_run({tool:"test_suggest", args:{file}})` | 推薦需補的測試案例 |

## 標準流程

```
執行全部測試:
  smart_test({root:"."})

執行特定測試:
  smart_test({include:"**/*.test.ts"})

檢查覆蓋率:
  smart_smart_run({tool:"coverage", args:{file:"src/foo.ts", threshold:80}})

取得測試建議:
  smart_smart_run({tool:"test_suggest", args:{file:"src/foo.ts"}})

Watch 模式（開發中）:
  smart_test({watch:true})
```

## 注意

- `smart_test` 是 Core 工具，**直接呼叫**
- 自動偵測 vitest/jest/mocha/ava/node:test
- `coverage` 需要專案已有覆蓋率設定

## Token 優化提示

- `smart_test` 輸出通常很小（<20KB），不使用壓縮
- `coverage` 輸出超過 10KB 時會 L1 空白壓縮（無損失）
- 若看到 `_optimized` metadata，資料完整可直接使用