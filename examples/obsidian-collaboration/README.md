## 🏗️ Obsidian Collaboration — 架構概覽

> 基於 Smart MCP 的多 AI 助理 Obsidian 協作系統

```
┌─────────────────────────────────────────────────────┐
│                  Obsidian Vault                       │
│                                                       │
│  40 個目錄 × 4 層深度 × ~150+ 知識頁面               │
│                                                       │
│  📁 00-入口/        ← 🚪 M1 進出控制點               │
│  📁 10-感知層/      ← 🤖 M2 機器人專區               │
│  📁 60-個人/        ← 🔐 M3 個人資料區               │
│  📁 80-索引/        ← 🔗 M4 跨域整合                 │
│  📁 85-機器人索引/  ← 🤖 機器人導航索引               │
│  📁 70-日誌/        ← 📝 會話日誌（保留但不索引）     │
│  📁 89-記憶體/      ← 🧠 向量記憶體資料               │
└─────────────────────────────────────────────────────┘
         ↕ 讀寫互動
┌─────────────────────────────────────────────────────┐
│                 Smart MCP Agent                       │
│                                                       │
│  M1: permission_guard.sh  — 進出控制守門人            │
│  M2: robot_quarantine.sh  — 機器人專區隔離            │
│  M3: personal_shield.sh   — 個人資料遮罩             │
│  M4: cross_domain_linker  — 跨域整合索引器            │
│  C1: wiki_dedup            — 去重合併                 │
│  S1: weekly_digest         — 週報產生器               │
│  S2: tag_taxonomy          — 分類法管理器             │
│  T1: vector_memory         — 向量記憶體引擎           │
│                                                       │
│  🧠 Self-Reflection Loop（跨 session 學習）          │
└─────────────────────────────────────────────────────┘
```

## 📐 架構層次

### Layer 1: 防護層（Guard Layer）
| 機制 | 功能 | 實作 |
|------|------|------|
| M1: 進出控制 | 機器人進出需經同意 | permission_guard.sh |
| M2: 機器人隔離 | 機器人專區禁止人類進入 | robot_quarantine.sh |
| M3: 個人遮罩 | 個人資料不可暴露 | personal_shield.sh |

### Layer 2: 整合層（Integration Layer）
| 機制 | 功能 | 實作 |
|------|------|------|
| M4: 跨域索引 | 跨分區整合索引 | cross_domain_linker |
| C1: 去重合併 | 重複頁面合併 | wiki_dedup |

### Layer 3: 服務層（Service Layer）
| 機制 | 功能 | 實作 |
|------|------|------|
| S1: 週報 | 週期性知識摘要 | weekly_digest |
| S2: 分類法 | 標籤一致性管理 | tag_taxonomy |
| T1: 向量記憶體 | 相似性搜尋 | vector_memory |

## 🔄 資料流

```
人類知識輸入 → 📝 10-感知層/ → 🧹 wiki_dedup → 🔗 80-索引/
                                    ↓
                              📊 tag_taxonomy → 🏷️ 標籤一致性
                                    ↓
                              🧠 vector_memory → 📐 向量索引
                                    ↓
                              📊 88-儀表板/ → 🔍 即時監控
                                    ↓
                              📋 S1 週報 → 📤 知識摘要輸出
```

## 🛡️ 安全邊界

| 區域 | 權限 | 說明 |
|------|------|------|
| 00-入口/ | ✅ 所有人 | 識別碼註冊、首頁 |
| 10-感知層/ | 🤖 機器人專用 | LLM 標記、待審核 |
| 60-個人/ | 🔐 僅本人 | 個人知識、私密資料 |
| 70-日誌/ | 📝 保留不索引 | 會話記錄、原始輸出 |
| 80-索引/ | 🔗 公開整合 | 跨域地圖、摘要 |
| 85-機器人索引/ | 🤖 機器人專用 | 機器人導航 |

## 🧩 Self-Reflection Loop

```
Session 結束
    ↓
📊 工具成功率分析
    ↓
🎯 關鍵問題：哪些工具最常失敗？
    ↓
📝 產生學習報告 → 存入 70-日誌/
    ↓
🔧 自動更新 skill 規則
    ↓
✅ 下次 session 更好
```

## 🚀 Quick Start

```bash
# 1. 進出控制
bash scripts/permission_guard.sh enter "Claude" "寫入10-感知層/"
bash scripts/permission_guard.sh approve "req_xxxx"
bash scripts/permission_guard.sh exit "Claude"

# 2. 機器人專區隔離
bash scripts/robot_quarantine.sh scan
bash scripts/robot_quarantine.sh fence

# 3. 個人資料遮罩
bash scripts/personal_shield.sh scan
bash scripts/personal_shield.sh protect

# 4. 跨域索引
bash scripts/cross_domain_linker.sh scan
bash scripts/cross_domain_linker.sh rebuild
```
