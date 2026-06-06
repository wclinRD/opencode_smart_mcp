---
description: 安全掃描：憑證洩漏、注入漏洞、相依性弱點。提交前必掃。
---

# Smart MCP 安全 Skill

## 呼叫慣例

```
Core 工具：直接呼叫 smart_security(), smart_grep(), smart_test()
```

## 工具速查

| 工具 | 呼叫方式 | 用途 |
|------|---------|------|
| `smart_security` | **直接** `smart_security({scan:"all"})` | 完整安全掃描 |
| `smart_grep` | **直接** `smart_grep({pattern, include})` | 精準定位問題 |
| `smart_test` | **直接** `smart_test({root})` | 驗證修復無副作用 |
| `fast_apply` | `ssr({tool:"fast_apply", args:{format, text}})` | 🥇 批次修復漏洞（支援 unified-diff） |
| `edit` | `ssr({tool:"edit", args:{...}})` | 🥈 單點修復 |

> `ssr` = `smart_smart_run`

## 標準流程

```
完整掃描（一次到位）:
  smart_security({scan:"all"})

定位 + 修復 credentials 洩漏:
  // 1. 掃描
  smart_security({scan:"credentials"})
  
  // 2. 精準定位
  smart_grep({pattern:"password|secret|key|token", include:"*.{js,ts,py}"})
  
  // 3. 🥇 批次修復（多檔案一致修改）
  ssr({tool:"fast_apply", args:{format:"search-replace", text:"<<SEARCH/REPLACE blocks>>", dryRun:true}})
  // 確認後：ssr({tool:"fast_apply", args:{format:"search-replace", text:"...", apply:true}})
  
  // 4. 複掃確認無殘留
  smart_security({scan:"credentials"})
  
  // 5. 驗證功能
  smart_test({root:"."})

CI 前阻斷檢查:
  // 有 high 風險就阻止
  smart_security({scan:"all", failOn:"high"})
```

## 注意

- `smart_security` 是 Core 工具，**直接呼叫**（不需 smart_smart_run）
- `failOn` 可設 high/medium/low 阻斷閾值
- `fast_apply` 預設 dryRun:true，安全無副作用
- 注意誤報（如測試資料中的 fake key）

## Token 優化提示

- `smart_security` 掃描結果超過 10KB 時會自動 L2 摘要（保留高/中風險，摘要低風險）
- 若看到 `_optimized.level >= 2` metadata 表示低風險項目已被隱藏
- 需要完整報告時加上 `format:'full'` 重新呼叫
- level 0/1 的資料完整可直接使用
