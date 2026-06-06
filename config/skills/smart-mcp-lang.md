---
description: 語言專案健康檢查：Python/TypeScript/Rust 環境、型別、專案分析
---

# Smart MCP 語言專案 Skill

## 呼叫慣例

```
Standard 工具皆經 smart_smart_run({tool:"工具名", args:{...}})
```

## 工具速查

| 工具 | 呼叫方式 | 用途 |
|------|---------|------|
| `py_helper` | `smart_smart_run({tool:"py_helper", args:{command}})` | Python 分析 |
| `ts_helper` | `smart_smart_run({tool:"ts_helper", args:{command}})` | TypeScript 分析 |
| `rs_helper` | `smart_smart_run({tool:"rs_helper", args:{command}})` | Rust 分析 |

## 標準流程

```
Python:
  smart_smart_run({tool:"py_helper", args:{command:"check-env"}})
  smart_smart_run({tool:"py_helper", args:{command:"check-deps"}})
  smart_smart_run({tool:"py_helper", args:{command:"typecheck"}})
  smart_smart_run({tool:"py_helper", args:{command:"analyze"}})

TypeScript:
  smart_smart_run({tool:"ts_helper", args:{command:"check-config"}})
  smart_smart_run({tool:"ts_helper", args:{command:"check-unused"}})
  smart_smart_run({tool:"ts_helper", args:{command:"analyze"}})

Rust:
  smart_smart_run({tool:"rs_helper", args:{command:"check"}})
  smart_smart_run({tool:"rs_helper", args:{command:"clippy"}})
  smart_smart_run({tool:"rs_helper", args:{command:"analyze"}})
  smart_smart_run({tool:"rs_helper", args:{command:"fmt"}})
```
