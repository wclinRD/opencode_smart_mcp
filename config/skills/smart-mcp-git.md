---
description: Git 操作流程：狀態檢視 → commit → PR → code review
---

# Smart MCP Git Skill

## 呼叫慣例

```
Standard 工具皆經 smart_smart_run({tool:"工具名", args:{...}})
```

## 工具速查

| 工具 | 呼叫方式 | 用途 |
|------|---------|------|
| `git_context` | `smart_smart_run({tool:"git_context", args:{all:true}})` | 當前狀態（取代 git status+diff） |
| `git_commit` | `smart_smart_run({tool:"git_commit", args:{all:true}})` | 自動 conventional commit |
| `git_pr` | `smart_smart_run({tool:"git_pr", args:{noPublish:true}})` | 預覽/建立 PR |
| `git_review` | `smart_smart_run({tool:"git_review", args:{staged:true}})` | 程式碼審查 |
| `import_graph` | `smart_smart_run({tool:"import_graph", args:{root}})` | 變更影響範圍 |

## 標準流程

```
日常 commit:
  // 1. 了解當前狀態
  smart_smart_run({tool:"git_context", args:{all:true}})
  
  // 2. 預覽 commit message
  smart_smart_run({tool:"git_commit", args:{dryRun:true}})
  
  // 3. 實際提交
  smart_smart_run({tool:"git_commit", args:{all:true}})

建立 PR:
  // 1. 確認變更
  smart_smart_run({tool:"git_context", args:{all:true}})
  
  // 2. 提交
  smart_smart_run({tool:"git_commit", args:{all:true}})
  
  // 3. 預覽 PR
  smart_smart_run({tool:"git_pr", args:{noPublish:true}})

Code Review:
  // 審查 staged changes
  smart_smart_run({tool:"git_review", args:{staged:true}})
  
  // 安全審查
  smart_smart_run({tool:"git_review", args:{staged:true, focus:"security"}})
```

## 注意

- commit 前務必先用 `git_context` 確認只 stage 了 intended 檔案
- `git_pr` 的 `noPublish:true` 只預覽不建立

## Token 優化提示

- `git_context` / diff 輸出會 L1 lossless 壓縮（無資訊損失）
- LLM 需要完整 diff 做判斷，因此不進行摘要
- 若看到 `_optimized.level === 1`，資料完整可直接使用
