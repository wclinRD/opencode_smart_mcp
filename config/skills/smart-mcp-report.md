---
description: 報告與圖表：Mermaid 圖表、HTML 報告、Token 優化
---

# Smart MCP 報告 Skill

## 呼叫慣例

```
Standard 工具皆經 smart_smart_run({tool:"工具名", args:{...}})
```

## 工具速查

| 工具 | 呼叫方式 | 用途 |
|------|---------|------|
| `diagram` | `smart_smart_run({tool:"diagram", args:{type, title}})` | Mermaid 圖表 |
| `report` | `smart_smart_run({tool:"report", args:{type, title}})` | HTML 報告 |
| `toonify` | `smart_smart_run({tool:"toonify", args:{command, content}})` | Token 優化 30-65% |

## 標準流程

```
產生流程圖:
  smart_smart_run({tool:"diagram", args:{type:"flowchart", title:"架構圖", direction:"TB"}})

產生時序圖:
  smart_smart_run({tool:"diagram", args:{type:"sequence", title:"API 流程"}})

產生類別圖:
  smart_smart_run({tool:"diagram", args:{type:"class", title:"類別圖"}})

產生測試報告:
  smart_smart_run({tool:"report", args:{type:"test", title:"測試報告"}})

產生安全報告:
  smart_smart_run({tool:"report", args:{type:"security", title:"安全掃描報告"}})

Token 優化（大量資料時）:
  smart_smart_run({tool:"toonify", args:{command:"optimize", content: largeJSON}})

查看優化統計:
  smart_smart_run({tool:"toonify", args:{command:"stats"}})
```

## 注意

- `diagram` 輸出 Mermaid 格式，可貼入 Markdown
- `report` 輸出 HTML 檔案

## Token 優化提示

- `diagram` / `report` 輸出通常很小（<10KB），不使用壓縮
- 大 JSON 資料輸出前先用 `toonify` 壓縮可省 30-65% token
- 若看到 `_optimized` metadata，資料完整可直接使用