
> **摘要**：Phase 1-6 已完成，Phase 7-10 規劃中。Phase 7-16 基於業界/學術比較分析（ChipXplore/RAG-EDA/Ask-EDA/ChipMind/hdl-kgraph/TokenSeive 等 13+ 專案）新增，針對 RAG 管線、token 效率、可靠性、knowledge graph、multi-agent 進行強化。

---

## 7B. Phase 7B：Tool-Level Token Optimization（🔴 P0，新增 2026-07-16）

> 目標：補齊 tool-level token 壓縮，對標 TokenSeive/Tokenless/token-crunch
> 參考：TokenSeive SmartCrusher (85-93%)、TOON format (40-60%)、token-crunch structural collapse (70%+)
> 預估：~3 小時 | 風險：低（TOON 為 lossless 編碼）

### 7B.1 三層壓縮管線

```
┌─ Layer 1: SmartCrusher（詞級）──────────────┐
│ • 複合詞拆分：DesignCompiler → Design Compiler │
│ • 專有名詞保護：dc → Design Compiler（不動）     │
│ • 已有 Caveman：4級壓縮（light/semantic/...）    │
└──────────────────────────────────────────────┘
        ↓
┌─ Layer 2: TOON（結構級，lossless）──────────┐
│ • Tree-Object-Optimized Notation             │
│ • JSON → 三角括號樹狀縮寫                    │
│ • Token: 152 → 63 (-58%)，零資訊損失         │
│ • 適用：action registry、tool definitions     │
└──────────────────────────────────────────────┘
        ↓
┌─ Layer 3: Schema Compression（語義級）──────┐
│ • 結構化壓縮：省略 key names、陣列合併        │
│ • 工具型態推斷：Tool → {n,v,c,v}              │
│ • 適用：靜態資料（EDA_TOOL_INDEX）            │
└──────────────────────────────────────────────┘
```

### 7B.2 TOON Encoder 實作

```javascript
// eda/lib/toon-encoder.mjs
export function encodeToon(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(encodeToon).join(',') + ']';
  if (obj && typeof obj === 'object') {
    const keys = Object.keys(obj);
    return '<' + keys.join(',') + '>' + keys.map(k => encodeToon(obj[k])).join('');
  }
  return JSON.stringify(obj);
}
```

### 7B.3 Differential Dedup

```javascript
// 參考 TokenSeive §4.1 — 偵測 tool definition 版本差異，只傳 delta
export function differentialDedup(oldDef, newDef) {
  const diff = computeMinimalDiff(oldDef, newDef);
  return { _delta: true, _baseVersion: oldDef.version, changes: diff };
}
```

### 7B.4 建立路徑

| Step | 內容 | 工時 |
|------|------|------|
| 7B.1 | TOON encoder/decoder 實作 | 1 hr |
| 7B.2 | SmartCrusher 增強（複合詞拆分） | 0.5 hr |
| 7B.3 | Schema compression（靜態資料） | 0.5 hr |
| 7B.4 | 整合到 caveman pipeline + 測試 | 1 hr |

---

## 11A. 業界/學術比較分析（2026-07-16 新增）

### 11A.1 比較矩陣

| 維度 | 本計畫 | 業界最佳實踐 | 差距 | 更新 |
|------|--------|------------|------|------|
| 架構設計 | ✅ 模組化（3407→72行） | ChipXplore 6-agent、Marco multi-agent | 🟡 缺 agent 協作 | — |
| 搜尋品質 | 🟡 多源並行 + 本地索引 | RAG-EDA + Ask-EDA hybrid RAG | 🔴 無 RAG 管線 | — |
| Token 效率 | 🟢 Caveman 4級壓縮 | SmartCrusher 85-93% + TOON 40-60% | 🔴 缺 tool-level 壓縮 | ⬆️ |
| 可靠性 | 🟡 warning + retry | ChipMind adaptive Top-K + CSA | 🔴 缺 adaptive retrieval | ⬆️ |
| 擴展性 | 🟡 JSON 外部化 | hdl-kgraph MCP + VeriRAG RDF | 🟡 hdl-kgraph 可整合 | ⬇️ |

### 11A.2 關鍵差距

| # | 差距 | 對標專案 | 建議 Phase | 優先級 |
|---|------|---------|-----------|--------|
| G1 | 無 RAG 管線 | RAG-EDA, EDA-Copilot, Ask-EDA | Phase 13 | 🟡 P1 |
| G2 | 無 KG（hdl-kgraph 可整合） | ChipMind, hdl-kgraph | Phase 15（整合） | 🟢 P2 |
| G3 | 縮寫字典 | Ask-EDA (249 abbr) | Phase 11 | 🔴 P0 |
| G4 | Tool-level token 壓縮 | TokenSeive, token-crunch | Phase 7B 🆕 | 🔴 P0 |
| G5 | 無 Benchmark | RAG-EDA, MMCircuitEval | Phase 14 | 🟡 P1 |
| G6 | 無 Query classification | EDA-Copilot (+4.96% accuracy) | Phase 12 | 🔴 P0 |
| G7 🆕 | Adaptive Top-K 缺失 | ChipMind MIG-based | Phase 13 | 🔴 P0 |
| G8 🆕 | 缺 post-retrieval | EDA-Copilot mixed indexing | Phase 13 | 🟡 P1 |
| G9 🆕 | 無 Multi-Agent | Marco (NVIDIA), ChipXplore | Phase 16 🆕 | 🟢 P2 |

### 11A.3 已對齊項目

| 優勢 | 說明 |
|------|------|
| 模組化架構 | Action Registry 比多數開源專案更乾淨 |
| 多源並行 | 7 來源比多數專案更廣 |
| 免費無 API key | Veda 收 $29/月，本方案零成本 |
| MCP 整合 | 已走在前面 |
| EDA 索引 | 55+ 工具 + 11 flow + 10 FAQ |

---

## 13. Phase 11：Abbreviation De-hallucination（🔴 P0）

> 目標：建立 EDA 縮寫字典 + 查詢自動展開
> 參考：Ask-EDA (IBM) — 249 組，70%+ recall
> 預估：~1 小時 | 風險：極低

### 11.1 EDA 縮寫字典

```javascript
// eda/data/abbreviations.mjs
export const EDA_ABBREV_DICT = {
  'dc':     { full: 'Design Compiler', vendor: 'Synopsys' },
  'icc2':   { full: 'IC Compiler II', vendor: 'Synopsys' },
  'pt':     { full: 'PrimeTime', vendor: 'Synopsys' },
  'sta':    { full: 'Static Timing Analysis' },
  'p&r':    { full: 'Place and Route' },
  'lec':    { full: 'Logic Equivalence Check' },
  'eco':    { full: 'Engineering Change Order' },
  'drc':    { full: 'Design Rule Check' },
  'lvs':    { full: 'Layout vs Schematic' },
  'pex':    { full: 'Parasitic Extraction' },
  // ... 249+ 組
};

export function expandAbbreviations(query) {
  const words = query.split(/\s+/);
  const found = [];
  const expanded = words.map(w => {
    const match = EDA_ABBREV_DICT[w.toLowerCase().replace(/[^a-z0-9&]/g, '')];
    if (match) { found.push({ abbr: w, full: match.full }); return match.full; }
    return w;
  });
  return { expanded: expanded.join(' '), abbreviations: found };
}
```

### 11.2 建立路徑

| Step | 內容 | 工時 |
|------|------|------|
| 11.1 | 新增 EDA_ABBREV_DICT（249+ 組） | 0.5 hr |
| 11.2 | expandAbbreviations 函式 | 0.2 hr |
| 11.3 | 整合到 enhanceQueryForEDA + auto | 0.3 hr |

---

## 14. Phase 12：Query Intelligence（🔴 P0）

> 目標：自動分類查詢類型，選擇最佳搜尋策略
> 參考：EDA-Copilot (TODAES'25) — 4類分類器，+4.96% accuracy
> 預估：~2 小時 | 風險：低

### 12.1 Query Classification

```javascript
// eda/query/classify.mjs
export const QUERY_TYPES = {
  TOOL_ISSUE: 'tool_issue',   // "DC compile error"
  PDK_LOOKUP: 'pdk_lookup',   // "SKY130 standard cell"
  ACADEMIC:   'academic',     // "recent papers on ML P&R"
  FLOW_GUIDE: 'flow_guide',   // "how to set up DFT"
  TOOL_DOCS:  'tool_docs',    // "Vivado constraint syntax"
  GENERAL:    'general',
};
```

### 12.2 策略路由

| Query Type | 來源權重 | Max Results |
|-----------|---------|-------------|
| TOOL_ISSUE | community > github > faq | 8 |
| PDK_LOOKUP | github > pdk_index | 5 |
| ACADEMIC | scholar > openalex > exa | 10 |
| FLOW_GUIDE | flow_index > community > web | 8 |
| TOOL_DOCS | docs_index > web > github | 8 |
| GENERAL | all sources balanced | 10 |

---

## 15. Phase 13：Hybrid Retrieval RAG（🟡 P1）

> 目標：建立 RAG 管線（BM25 + embedding hybrid + adaptive Top-K + post-retrieval reranker）
> 參考：RAG-EDA、EDA-Copilot、ChipMind (AAAI'26)
> 預估：~5 小時 | 風險：中

### 13.1 架構

```
Query → classifyQuery() → Hybrid Retrieval (BM25 + Embedding + Local)
  → RRF fusion → Adaptive Top-K (ChipMind MIG) → Post-retrieval reranker → Top-K
```

### 13.2 Adaptive Top-K（ChipMind）

```javascript
export function adaptiveTopK(query, classification, candidates) {
  const complexity = estimateQueryComplexity(query, classification);
  let k = complexity === 'simple' ? 3 : complexity === 'moderate' ? 6 : 10;
  return candidates.slice(0, k).filter((item, i, arr) =>
    !arr.slice(0, i).some(prev => isDuplicate(prev, item)));
}
```

### 13.3 建立路徑

| Step | 內容 | 工時 |
|------|------|------|
| 13.1 | fusion.mjs（RRF） | 1 hr |
| 13.2 | embedding.mjs（LLM rerank） | 1 hr |
| 13.3 | Adaptive Top-K（ChipMind） | 1 hr |
| 13.4 | Post-retrieval reranker | 0.5 hr |
| 13.5 | 整合 + 測試 | 1.5 hr |

---

## 16. Phase 14：EDA QA Benchmark（🟡 P1）

> 目標：建立 EDA 問答評估基準集
> 參考：RAG-EDA (ORD-QA)、MMCircuitEval (3614 pairs)
> 預估：~3 小時 | 風險：低

| 指標 | 目標 |
|------|------|
| Recall@K | ≥ 0.8 |
| MRR | ≥ 0.6 |
| Accuracy@1 | ≥ 0.85 |
| Abbreviation Recall | ≥ 0.9 |
| Token Efficiency | ≤ 500 |

---

## 17. Phase 15：Knowledge Graph（🟢 P2，整合 hdl-kgraph）

> 目標：整合 hdl-kgraph MCP server
> 預估：~3 小時（原 8hr → -5hr）| 風險：低

| Step | 內容 | 工時 |
|------|------|------|
| 15.1 | Clone + 安裝 hdl-kgraph | 0.5 hr |
| 15.2 | 整合到 smart_eda_search | 1 hr |
| 15.3 | 整合到 troubleshoot + docs + auto | 1 hr |
| 15.4 | 測試 | 0.5 hr |

---

## 18. Phase 16：Multi-Agent Orchestration（🟢 P2，長期）

> 目標：建立多 agent 協作架構
> 參考：Marco (NVIDIA)、ChipXplore (ICLAD'25)
> 預估：~8 小時 | 風險：高

### 16.1 Agent 角色

```
Query Agent → Retrieval Agent → Knowledge Agent → Code Agent → Document Agent
                                                                  ↓
                                                          Orchestrator
```

| Step | 內容 | 工時 |
|------|------|------|
| 16.1 | Agent 介面 + 通訊協議 | 2 hr |
| 16.2 | Query + Retrieval Agent | 2 hr |
| 16.3 | Orchestrator | 2 hr |
| 16.4 | 整合測試 | 2 hr |

---

## 11. Phase 7-16 風險評估

| Phase | 風險 | 緩解 |
|-------|------|------|
| Phase 7: Token 效率 | 低 | Caveman 已完成 |
| Phase 7B: Tool-Level Token 🆕 | 低 | TOON lossless |
| Phase 8: 搜尋品質 | 低 | 改良不改架構 |
| Phase 9: 可靠性 | 低 | warning + cache + test |
| Phase 10: 長期改進 | 低 | 非關鍵路徑 |
| Phase 11: Abbreviation | 極低 | 純資料 |
| Phase 12: Query Intelligence | 低 | prompt-based |
| Phase 13: Hybrid RAG | 中 | adaptive + post-retrieval |
| Phase 14: Benchmark | 低 | 評估基準集 |
| Phase 15: Knowledge Graph | 低 | 整合 hdl-kgraph |
| Phase 16: Multi-Agent 🆕 | 高 | 長期目標 |

---

## 12. Phase 7-16 估計工時

| Phase | 工時 | 累計 | 優先級 |
|-------|------|------|--------|
| Phase 7: Token 效率 | 3 hr | 9.5 hr | ✅ 已完成 |
| Phase 7B: Tool-Level Token 🆕 | 3 hr | 12.5 hr | 🔴 P0 |
| Phase 8: 搜尋品質 | 2.5 hr | 15 hr | 🟡 P1 |
| Phase 9: 可靠性 | 4 hr | 19 hr | 🟡 P1 |
| Phase 10: 長期改進 | 3 hr | 22 hr | 🟢 P2 |
| Phase 11: Abbreviation | 1 hr | 23 hr | 🔴 P0 |
| Phase 12: Query Intelligence | 2 hr | 25 hr | 🔴 P0 |
| Phase 13: Hybrid RAG | 5 hr | 30 hr | 🟡 P1 |
| Phase 14: Benchmark | 3 hr | 33 hr | ✅ 已完成 |
| Phase 15: Knowledge Graph | 3 hr | 36 hr | 🟢 P2 |
| Phase 16: Multi-Agent 🆕 | 8 hr | 44 hr | 🟢 P2 |

**總計：~44 小時**

### 建議執行順序

```
第一批（高 ROI，~6 hr）：Phase 11 → 12 → 7B
第二批（搜尋品質，~10.5 hr）：Phase 8 → 13 → 14
第三批（可靠性，~7 hr）：Phase 9 → 10
第四批（擴展性，~11 hr）：Phase 15 → 16
```
