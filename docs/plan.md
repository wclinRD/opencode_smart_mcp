# Smart MCP — 效能與 Token 優化強化計畫

> 本文件定義 token 優化策略的架構設計與實作路線。
> 與 todo.md 互為補充：plan.md 定義「為什麼做、架構長怎樣」，todo.md 定義「具體步驟」。

---

## 一、核心問題

Smart MCP 已實作 4 項 token 優化手段，但零散未成體系：

| 已實作 | 省 token 估算 | 問題 |
|--------|-------------|------|
| Toonify（JSON/CSV/YAML 被動壓縮） | 30-65% | 只看 JSON-like 格式，fire-and-forget 非同步不影響當前回應 |
| Selective tool listing（8 visible / 45 routed） | ~70% tools list | 已完善 |
| Onion architecture（106 行 core + 8 skills） | ~97% system prompt | 已完善 |
| 4-tier model router（T1 $0 ~ T4 LLM） | ~60-86% API cost | 已完善 |

**核心缺口**：工具輸出內容本身沒有系統性的壓縮策略。

---

## 二、設計哲學：分層擔責 + 透明告知 + 按需取回

```
LLM 端不可控（放掉）               MCP Server 端可控（全力做）
─────────────────────────          ─────────────────────────
Prompt caching (Anthropic API)     工具回傳內容格式 ✅
Context compaction pipeline       輸出壓縮/截斷/快取 ✅
ToolSearch deferred loading       Plugin responsePolicy ✅
Streaming response (MCP protocol)  透明標記 + 按需取回 ✅
```

### 核心原則

1. **每個工具自己決定「什麼可以壓縮」** — Plugin 宣告 `responsePolicy`
2. **LLM 永遠知道自己看到的是壓縮版** — Response 附加 `_optimized` metadata
3. **Lossless 優先** — L1 零風險，全部工具都做
4. **Lossy 限縮範圍** — L2 只開放有明確「重要/不重要」分割的工具
5. **不確定的就不壓** — Format 不明或無法判斷重要資訊 → 降級 L0

---

## 三、壓縮層級定義

| 層級 | 名稱 | 作法 | 資訊損失 | 適用 |
|------|------|------|---------|------|
| L0 | Raw | 不處理，直接 passthrough | 無 | 小輸出 <10KB |
| L1 | Lossless Compress | 縮短 key、壓縮空白、格式正規化 | **無**（所有 value 保留） | 結構化資料 10-50KB |
| L2 | Smart Summary | 保留 critical section，壓縮/略過次要 section | 有選擇性損失 | 大輸出 50KB+ |
| L3 | Truncated | **不使用** — 改用互動式 format:full | — | 取消，改按需取回 |

---

## 四、Response Policy 機制

每個 Plugin 宣告自己的壓縮邊界：

```js
export default {
  name: 'smart_grep',
  responsePolicy: {
    maxLevel: 1,           // 最高壓縮層級（預設 1）
    criticalFields: [],     // 必須保留的欄位
    compressibleFields: [], // 可 lossless 壓縮的欄位
    droppableFields: [],    // 可丟棄的欄位（僅 L2 適用）
  }
}
```

預設值 `maxLevel: 1` — opt-in 才能開 L2，不是 opt-out。

### 各工具壓縮策略

| 工具 | 典型大小 | maxLevel | 理由 |
|------|---------|----------|------|
| smart_grep | 3-10KB | 0 | 結果很小且關鍵 |
| smart_learn | 2-5KB | 0 | 結果很小 |
| smart_test | 5-20KB | 0 | 結果很小 |
| smart_security | 30-200KB | 2 | 高/中/低風險可分割 |
| git_context/diff | 5-30KB | 1 | LLM 需完整 diff 做判斷 |
| import_graph | 10-50KB | 1 | JSON→Toonify lossless |
| code_query/AST | 5-30KB | 1 | JSON→Toonify lossless |
| naming/coverage | 3-10KB | 0 | 結果很小 |
| exa_crawl | 50-500KB | 2 | Readability 已 lossy |
| research | 50-500KB | 2 | 多文章 highlights 就夠 |
| pw_browser | 10-30KB | 1 | 結構化文字 |
| debug/error_diagnose | 3-15KB | 0 | 結果很小 |

---

## 五、調適後的壓縮 Response 格式

壓縮過的回應附加 `_optimized` metadata：

```json
{
  "_optimized": {
    "level": 2,
    "originalSize": 85000,
    "compressedSize": 12000,
    "cacheKey": "sha256-xxx",
    "message": "This is a summary. Use format:'full' to get the complete data."
  },
  "data": { ... 壓縮後的內容 ... }
}
```

LLM 可根據 `_optimized.level` 決定是否需要取回完整版。

---

## 六、Agent 行為規範

Agent personality 中明確定義：

```
當工具回傳 _optimized.level >= 2 時：
  1. 先判斷摘要資訊是否足夠回答使用者問題
  2. 如果不夠 → 用相同參數 + format:'full' 取回完整版
  3. 如果使用者要求「找出全部」「分析所有」「比對差異」
     → 無論如何必須取回完整版
```

---

## 七、實作路線

### Phase 1：核心架構（目前）

```
目標：建立基礎壓縮 pipeline，L1 全面啟用，L2 限 3 工具
時程：2-3 天
```

| 元件 | 說明 |
|------|------|
| `src/lib/output-optimizer.mjs` | Format auto-detect + 4 層級壓縮 + _optimized metadata 注入 |
| `src/lib/cache-manager.mjs` | 泛化 SQLite 快取（從 exa_crawl 抽出） |
| `src/server/index.mjs` | respond() 整合同步壓縮 + _optimized 標記 |
| `src/server/loader.mjs` | Plugin 新增 responsePolicy 支援 |
| Plugin responsePolicy | 各核心工具宣告壓縮邊界 |
| Agent personality | 加入 token 優化行為提示 |

### Phase 2：Smart Output Pipeline（Phase 1 後）

```
目標：完整 Pipeline Layer（format → compress → truncate → cache）
時程：5-7 天
```

| 元件 | 說明 |
|------|------|
| `src/lib/output-pipeline.mjs` | Pipeline 框架：addStage → run |
| Pipeline 整合 | plugin 可選宣告 responsePipeline 覆寫預設 |
| Cache 統一管理 | 合併 exa_crawl cache + 新 cache |
| Agent skills 整合 | 各 skill 加入 token 優化提示 |

---

## 八、預期成效

| 優化項目 | 目前 | Phase 1 後 | Phase 2 後 |
|---------|------|-----------|-----------|
| System prompt | ~3KB（已做） | ~3KB | ~3KB |
| Tools listing | ~70% 省（已做） | ~70% 省 | ~70% 省 |
| **Tool 輸出壓縮** | **~30-65%（被動, fire-and-forget）** | **~40-60%（主動同步）** | **~50-70%（結構感知）** |
| 重複呼叫浪費 | ❌ 無快取 | ✅ SQLite cache | ✅ LRU + SQLite |
| 大輸出處理 | ❌ 原始回傳 | ✅ 層級處理 | ✅ 語意截斷 |
| **整體 token 節省** | **~40-50%** | **~60-70%** | **~75-85%** |

---

## 九、不做什麼

| 項目 | 原因 |
|------|------|
| L3 Truncated（只回摘要 + cache key） | 風險 > 效益，改用 format:full 互動機制 |
| Progressive tool loading（ToolSearch） | 需 opencode 支援 MCP protocol 擴展 |
| Context compaction pipeline | 需 opencode client 端支援 |
| Prompt caching（cache_control） | 需 Anthropic API 支援 |
| Streaming response chunks | MCP protocol 不支援分塊 |
