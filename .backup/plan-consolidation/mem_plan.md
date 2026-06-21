# 跨 Session 記憶強化計畫

> 最後更新：2026-06-15
> 目標：記憶資料已持久化，但啟動注入不按上下文 → 讓記憶在對的時間出現

---

## 一、現狀

### 1.1 已存在的基礎設施

```
Memory DB (SQLite + FTS5 + sqlite-vec + hybrid RRF)    ✅ 資料跨 session 不消失
smart_memory_store MCP tool (search/store/list/...)      ✅ 工具可用
Auto-store (工具失敗時自動存)                             ✅ 非同步，不 block
Auto-extract (session 結束自動萃取 skill_patches)         ✅ 非同步，不 block
Pre-check (3 工具執行前檢查記憶)                           ⚠️ 只 cover debug/test/cross_file_edit
Auto-inject (session 啟動注入 top 3 findings)              ⚠️ 讀 JSON、不分專案、3 筆強塞
```

### 1.2 核心問題

```
記憶已經持久化，但使用方式粗糙：

1. autoInjectMemory() 讀 JSON 而非 SQLite    → 錯過 BM25 語意搜尋
2. 注入不分專案                                → A 專案的記憶污染 B 專案
3. 注入 3 筆 findings（~200t）                 → 浪費 context budget
4. pre-check 只 cover 3 工具                   → 編輯/推理前不會查記憶
5. pre-check 是 blocking 的                    → 擋住工具執行
6. 無 session checkpoint                       → 隔天回來從零開始
```

### 1.3 競爭情資

| 競爭品 | 相關能力 | 我們的狀態 |
|:---|:---|:---|
| **Continuum** | 持久記憶 + 即時圖譜 | 記憶已持久，缺上下文感知注入 |
| **Cursor** | @ 符號引用記憶 | 需 Agent 主動 pull，我們缺引導 |

---

## 二、設計原則

```
1. Pull 優先，Push 克制
   - 啟動時只給輕提示 (<100 tokens)
   - 具體記憶內容由 Agent 主動 pull 或工具參數自動觸發

2. 上下文才是安全過濾器
   - 只有當工具參數明確指向某個檔案/符號時才自動搜尋記憶
   - 不根據時間或分數「猜」你需要什麼

3. 非同步 findings，不 block 工具
   - 記憶是輔助，不是閘門
   - pre-check 改為非同步注入 findings

4. 不增加基礎設施複雜度
   - 不需要 daemon、TCP、adapter
   - stdio MCP server 即可達成
```

---

## 三、Phase 規劃

### Phase 1：啟動注入強化（1h）

| # | 項目 | 說明 | 難度 | 估時 |
|:--|:---|:---|:--:|:--:|
| P1.1 | **autoInject → SQLite** | 改為 spawn CLI search，用專案名 BM25 搜尋 | 🟢 | 0.5h |
| P1.2 | **輕提示取代 findings** | 只注入 `📋 N 筆記憶可用`（<100t） | 🟢 | 0.5h |

### Phase 2：工具級上下文記憶搜尋（2h）

| # | 項目 | 說明 | 難度 | 估時 |
|:--|:---|:---|:--:|:--:|
| P2.1 | **擴展 pre-check 工具集** | 加入 fast_apply、think、refactor_plan | 🟢 | 0.5h |
| P2.2 | **非同步 findings** | 從 args 萃取 query，BM25 搜尋，結果注入 findings | 🟡 | 1.5h |

### Phase 3：Session Checkpoint（1h）

| # | 項目 | 說明 | 難度 | 估時 |
|:--|:---|:---|:--:|:--:|
| P3.1 | **結束時存 checkpoint** | gracefulShutdown 前存 findings 摘要 | 🟢 | 0.5h |
| P3.2 | **啟動時輕提示** | 提示上次工作時間 + 可用記憶 | 🟢 | 0.5h |

### Phase 4：Personality 引導（1h）

| # | 項目 | 說明 | 難度 | 估時 |
|:--|:---|:---|:--:|:--:|
| P4.1 | **更新 system-prompt** | 加入主動查記憶的時機指引 | 🟢 | 1h |

### 相依性

```
P1 (啟動注入) ← 無相依
P2 (contextual search) ← 無相依（可用 spawn CLI，不依賴 P1）
P3 (checkpoint) ← 無相依
P4 (personality) ← 無相依（文檔更新）
```

---

## 四、成功指標

| 指標 | 現狀 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|:---|:---|:---|:---|:---|:---|
| **注入 token 成本** | ~200t (3 findings) | <100t (輕提示) | <100t | <100t | <100t |
| **注入相關性** | 無過濾 | 專案過濾 | 專案 + 上下文 | 專案 + 上下文 + checkpoint | 同上 |
| **pre-check 工具覆蓋** | 3 工具 | 3 工具 | 6 工具 | 6 工具 | 6 工具 |
| **pre-check 是否 block** | blocking | blocking | 非同步 findings | 非同步 findings | 非同步 |
| **Session 承接** | ❌ | ❌ | ❌ | ✅ 輕提示 | ✅ 輕提示 |
| **Agent 主動查記憶** | 被動 (無指引) | 被動 | 被動 | 被動 | ✅ 有指引 |

---

## 五、風險分析

| 風險 | 影響 | 緩解措施 |
|:---|:---|:---|
| **Spawn CLI 延遲** | 啟動注入變慢幾百 ms | spawn 是非同步的，不影響 session init |
| **BM25 低分命中** | 不相關的記憶進入 findings | threshold 設 0.3，低分不注入 |
| **Checkpoint 過時** | 提示 3 天前的 checkpoint | TTL 7 天自動過期 |
| **Token 膨脹** | Personality 多了 ~100t | 省下的注入 token (-150t) 可 cover |

---

## 六、時間線

```
Day 1: Phase 1 (1h) + Phase 2 (2h)
  ├── autoInjectMemory → SQLite + 輕提示
  ├── contextualSearch 函式實作
  └── 擴展 pre-check 工具集 + 非同步 findings

Day 2: Phase 3 (1h) + Phase 4 (1h)
  ├── Session checkpoint 存/載
  ├── Personality 引導
  └── 測試 + commit
```

---

## 七、相關文件

- [docs/mem_todo.md](./mem_todo.md) — 待辦事項
- [docs/plan.md](./plan.md) — Smart MCP 整體發展藍圖
