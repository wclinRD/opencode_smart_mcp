---
name: podcast-transcript
description: 管理 Podcast 訂閱、轉錄逐字稿、LLM 整理重點。支援股癌/財女珍妮/AI懶人報。whisper.cpp + Metal GPU 加速。自動寫入 Obsidian vault。
license: MIT
metadata:
  author: wclin
  version: 0.2.0
  tags: [podcast, 逐字稿, transcription, obsidian, whisper]
  trigger:
    - podcast
    - 逐字稿
    - podcast 逐字稿
    - 聽podcast
    - 轉錄
    - 節目
    - /podcast
    - 股癌
  dependencies:
    python:
      - pyyaml
    brew:
      - whisper-cpp (whisper-cli)
      - ffmpeg (ffprobe)
    config_files:
      - ~/opencode/day/podcasts.yaml
      - ~/opencode/day/podcast_agent.py
    vault:
      path: ~/Library/CloudStorage/CloudMounter-pCloud/AppData/obsidian_opencode/opencode/
      folder: 50-資源/56-Podcast-逐字稿
---

# Podcast Transcript Skill v2

> 完整工作流程：檢查環境 → RSS 抓取 → 下載 MP3 → whisper.cpp 轉錄 → LLM 分析整理重點 → 寫入 Obsidian vault

## 相關檔案

| 路徑 | 用途 |
|------|------|
| `~/opencode/day/podcasts.yaml` | 節目設定檔 |
| `~/opencode/day/podcast_agent.py` | Pipeline 主程式（下載 + 轉錄 + 寫入原始筆記） |
| `~/opencode/day/plan.md` | 完整架構說明 |

Vault 掛載點：
```
~/Library/CloudStorage/CloudMounter-pCloud/AppData/obsidian_opencode/opencode/
```

## 完整工作流程

當使用者說「股癌逐字稿」、「轉錄某節目」或類似請求時，執行以下完整流程：

```
Step 1: 讀取設定 & 檢查環境
Step 2: 列出最新集數（確認轉錄目標）
Step 3: 執行 Pipeline（下載 MP3 + whisper 轉錄 + 自動續接 LLM 分析）
Step 4: LLM 分析整理重點
Step 5: 更新 vault 筆記（summary + 全文）
Step 6: 更新索引
Step 7: 回報結果
```

---

## Step 1: 讀取設定 & 檢查環境

### 1a. 讀取設定檔

```bash
python3 -c "import yaml; yaml.safe_load(open('~/opencode/day/podcasts.yaml'))"
# 或直接讀取 podcasts.yaml 確認節目列表
```

### 1b. 確認 vault 掛載

vault 路徑：`~/Library/CloudStorage/CloudMounter-pCloud/AppData/obsidian_opencode/opencode/`

執行 `ls` 檢查該目錄是否存在。若不存在，提示「pCloud 可能未掛載，無法寫入筆記」。

### 1c. 檢查 whisper 模型健康

**重要：模型檔案損毀是最常見的問題。** 檢查模型檔案：

```bash
ls -lh ~/.cache/whisper.cpp/ggml-large-v3-turbo.bin
```

- **正常大小**：~1.5GB（完整下載）
- **若小於 1.5GB**：模型不完整，需重新下載
- **若檔案不存在**：首次使用，需下載

**測試模型是否可正確載入：**

```bash
whisper-cli -m ~/.cache/whisper.cpp/ggml-large-v3-turbo.bin -f /dev/null --output-txt -l zh 2>&1 | grep -i "error"
```

若看到 `ERROR not all tensors loaded` → 模型損毀，刪除重載：

```bash
rm ~/.cache/whisper.cpp/ggml-large-v3-turbo.bin
curl -L -o ~/.cache/whisper.cpp/ggml-large-v3-turbo.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
```

### 1d. 檢查 CLI 工具

```bash
which whisper-cli  # 需存在
which ffprobe      # 需存在
which curl         # 需存在
```

---

## Step 2: 列出最新集數

列出所有節目 + 最新 5 集：

```bash
python3 ~/opencode/day/podcast_agent.py --list
```

若只想看特定節目，篩選輸出或用 `--podcast` 參數。

確認最新的集數資訊（EP 編號、日期、標題），與使用者確認要轉錄哪一集。

---

## Step 3: 執行 Pipeline（下載 + 轉錄 + 自動 LLM 分析）

⚠️ **本步驟完成後，自動進入 Step 4（LLM 分析）和 Step 5（寫入 vault），無需手動觸發。**

### 轉錄最新集數

```bash
python3 ~/opencode/day/podcast_agent.py --run --podcast <節目名稱> --episode 1
```

範例：`python3 ~/opencode/day/podcast_agent.py --run --podcast 股癌 --episode 1`

**參數說明：**
| 參數 | 用途 |
|------|------|
| `--podcast 股癌` | 指定節目 |
| `--episode 1` | 只轉最新 1 集 |
| `--force` | 強制重新轉錄（即使已存在） |
| `--dry-run` | 乾執行，只看不下載 |

### 預期輸出

```
============================================================
  Gooaye 股癌
============================================================
  待處理: 1 集

  [EP665] EP665 | 🌸
  ──────────────────────────────────────────────────
  ⬇️  下載音檔...
  ✅ 46.9 MB
  🎙️  轉錄中...
  ✅ 269s (11.2x)
  📝 已寫入: 50-資源/56-Podcast-逐字稿/股癌/EP665.md
  📝 節目索引已更新
```

### 效能參考（M4 Pro + large-v3-turbo）

| 集數長度 | 轉錄時間 | 倍率 |
|----------|---------|------|
| 15 分鐘 | ~30s | ~30x |
| 50 分鐘 | ~270s (4.5min) | ~11x |

### 轉錄輸出路徑

- MP3 暫存：`~/PodcastTranscripts/<節目名稱>/`（轉錄後自動刪除）
- 原始 txt：`~/PodcastTranscripts/<節目名稱>/<集數>.txt` — **LLM 分析時讀取此檔案**
- 筆記：寫入 vault `50-資源/56-Podcast-逐字稿/<節目名稱>/<集數>.md`
  - ⚠️ **Vault 只存 frontmatter + 佔位符，不存逐字稿全文**
  - 逐字稿原文僅存於 `~/PodcastTranscripts/` 暫存目錄
  - 節省 vault 空間，避免污染 Obsidian graph

> **注意**：`status: "pending_analysis"` 表示等待 LLM 分析；分析完成後改為 `"analyzed"`

### Pipeline 完成後自動續接 LLM 分析

Pipeline 結束後，**必須**自動執行以下續接步驟（不可停下來問使用者）：

```
Pipeline 完成
  │
  ├── 讀取 ~/PodcastTranscripts/<節目>/<集數>.txt (原始逐字稿)
  ├── 讀取 vault .md (確認 status: pending_analysis)
  ├── LLM 分析全文產出重點 (Step 4)
  ├── edit 取代 .md 中的佔位符 (Step 5)
  ├── 更新 frontmatter status → "analyzed"
  │
  └── 回報結果 (Step 7)
```

---

## Step 4: LLM 分析整理重點

Pipeline 在 vault 只寫入 frontmatter + 佔位符（無逐字稿內容）。使用 LLM 從暫存 txt 讀取全文，產出結構化重點。

### 操作方式

1. **讀取逐字稿全文**：從 `~/PodcastTranscripts/<節目名稱>/<集數>.txt` 讀取原始文字
   - 若檔案不存在，再從 vault `.md` 中的 `<!-- ... -->` 佔位符判斷狀態
   
2. **確認 LLM 分析前置條件**：
   - txt 檔案存在且非空（正常轉錄後 ~30KB+）
   - vault 筆記狀態為 `pending_analysis`
   
3. **LLM 分析**：使用自身推理能力，分析逐字稿內容，產出以下結構：

#### 📌 輸出格式範本

```
### 📌 本集一句話
[一句話總結本集核心]

### 🔥 市場總覽
- [核心觀點 1]
- [核心觀點 2]

### 📊 [主題 1：如被動元件/半導體]
- [分析細節]
- [關鍵數字]

### 🚀 [主題 2：如 SpaceX IPO]
- [分析細節]

### 💡 [主題 3：最大亮點]
- [分析細節]

### 🎯 操作哲學 / 投資策略
- [操作建議]

---

## QA 精選

### [問題主題]
[回答重點]
```

#### LLM 分析指南

分析逐字稿時，專注於：
- **提取核心論點與脈絡** — 主持人想表達什麼
- **辨識立場與分析邏輯** — 是看好還是看壞？理由是？
- **標註關鍵數據** — 公司名稱、數字、日期、事件
- **區分事實與主觀評論**
- **保留原文關鍵用語**（專有名詞保持原樣）
- **從 QA 中提取有價值的內容**（操作紀律、人生感悟、投資心法）

### 常見重點分類

| 分類 | 應包含 |
|------|--------|
| **市場總覽** | 指數方向、資金流向、市場情緒 |
| **產業分析** | 供需變化、毛利率、BB ratio、同業比較 |
| **個股/IPO** | 估值看法、風險、供應鏈效應 |
| **操作哲學** | 進出邏輯、風險管理、心態調整 |
| **QA 精選** | 有啟發性的問答、具體案例 |

---

## Step 5: 更新 vault 筆記（寫入 LLM 分析結果）

Pipeline 在 vault 寫入的是 frontmatter + 佔位符（`<!-- ... -->`）。LLM 分析後，將結構化重點寫入取代佔位符。

### 筆記最終結構

```
---
[frontmatter — 保留不變]
---

# [標題]

來源節目：[[節目名稱]]  
播出日期：[日期]  
時長：[長度]  
轉錄時間：[時間戳]

---

## 重點整理

[Step 4 產出的結構化摘要 — LLM 寫入]

<!-- 原始逐字稿暫存於轉錄目錄， vault 不存放全文 -->
```

### 筆記位置

```
vault/50-資源/56-Podcast-逐字稿/<節目名稱>/<集數>.md
```

### 更新方式

使用 `edit` 工具：

1. **讀取 vault `.md`** → 保留 frontmatter 不動
2. **分析 txt 全文** → 從 `~/PodcastTranscripts/<節目名稱>/<集數>.txt` 讀取
3. **寫入 LLM 重點** → 使用 `edit` 取代 `<!-- 此處由 LLM 分析後填入結構化重點 -->` 佔位符
4. **更新 frontmatter 狀態**：將 `status: "pending_analysis"` 改為 `status: "complete"`

---

## Step 6: 更新索引

Pipeline 已完成初步索引更新，但 LLM 整理後建議重新更新以確保一致性：

```python
python3 -c "
import sys; sys.path.insert(0, '~/opencode/day')
import podcast_agent
config = podcast_agent.load_config()
key = '<節目名稱>'
info = config['podcasts'][key]
podcast_agent.update_podcast_index(config, key, info)
podcast_agent.update_master_index(config)
"
```

---

## Step 7: 回報結果

向使用者回報：
- ✅ 轉錄完成（集數、長度、轉錄時間）
- ✅ LLM 重點分析完成
- ✅ 筆記寫入路徑
- 💡 本集最值得關注的 1-2 個重點

---

## 選用功能

### 📋 列出所有節目

```bash
python3 ~/opencode/day/podcast_agent.py --list
```

### ➕ 新增節目

1. 使用 `question` 詢問節目資訊（名稱、顯示名稱、RSS、語言、標籤、作者、官網、描述）
2. 使用 `edit` 加入 `~/opencode/day/podcasts.yaml` 的 `podcasts:` 區塊
3. 驗證：`python3 ~/opencode/day/podcast_agent.py --list`

```yaml
節目名稱:
  name: "顯示名稱"
  rss: "https://..."
  lang: zh
  model: large-v3-turbo
  enabled: true
  tags: [標籤1, 標籤2]
  author: "主持人"
  homepage: "https://..."
  description: "簡介"
```

### ❌ 刪除節目

將該筆 `enabled` 設為 `false`（軟刪除）。

### 📖 閱讀逐字稿

1. 列出節目 → 選擇節目 → 列出集數 → 選擇集數
2. 使用 `read` 讀取筆記，優先讀前 100 行
3. 若 vault 不存在，提示 pCloud 可能未掛載

---

## 注意事項

| 事項 | 說明 |
|------|------|
| **Vault 掛載** | pCloud CloudMounter 可能離線，執行任何 vault 操作前先確認路徑存在 |
| **模型完整性** | large-v3-turbo 應為 ~1.5GB。小於此值代表下載中斷，需刪除重載 |
| **GPU 加速** | M4 Pro Metal GPU 加速已確認（~11x real-time with large-v3-turbo） |
| **idempotent** | Pipeline 自動跳過已轉錄集數 |
| **MP3 清理** | `keep_audio: false` 設定下，轉錄後自動刪除 MP3 |
| **podcasts.yaml** | 固定在 `~/opencode/day/podcasts.yaml`，編輯後務必用 `--list` 驗證 |
| **LLM 摘要時機** | 須在 pipeline 完成後執行，因為需要完整逐字稿內容 |

## 已知問題 & 解決方案

| 問題 | 症狀 | 解決方案 |
|------|------|----------|
| 模型損毀 | whisper 1s 完成、output 空白、"not all tensors loaded" | 刪除模型重載 |
| 輸出檔案路徑錯誤 | whisper 寫到 CWD 而非 audio 目錄 | 確保 script 使用 `-of` 參數指定輸出路徑 |
| Vault 離線 | 路徑不存在、寫入失敗 | 確認 CloudMounter pCloud 已連接 |
| RSS timeout | `--list` 或 `--run` 卡住逾時 | curl timeout 設 60s（SoundOn 偶發慢回應），編輯 line 211 改 timeout=60 |
| 逐字稿內容空白 | `## 逐字稿` 段落寫入 "(無內容)"，但 pipeline 顯示轉錄成功 | **原因**：`transcribe()` 中 `-of` 指定輸出前綴為 `out_dir/path.stem`，但讀取用 `path.with_suffix(".mp3\.txt")` → 檔案不存在。<br>**修復**：改讀 `str(output_base) + ".txt"`（line 276-277）<br>**觸發情境**：檔案副檔名非 `.mp3`（如部分 RSS 音檔）時尤其容易發生 |
| Force 後重跑需注意 | 轉錄失敗後重新執行沒反應 | 使用 `--force` 旗標強制重新下載+轉錄：`--run --podcast X --episode 1 --force` |
