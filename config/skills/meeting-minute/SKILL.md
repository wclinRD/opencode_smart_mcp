---
name: meeting-minute
description: 會議記錄 Skill — 選單選擇錄音來源（系統/麥克風/兩者），ScreenCaptureKit 錄製，whisper.cpp 轉文字，LLM 整理重點，寫入 Obsidian vault
compatibility: opencode
---

# Meeting Minute Skill

> 完整流程：選擇錄音來源 → ScreenCaptureKit 錄製 → whisper.cpp 語音轉文字 → LLM 分析重點 → 寫入 Obsidian vault

## 相關檔案

| 路徑 | 用途 |
|------|------|
| `scripts/MeetingRecorder.swift` | Swift CLI — ScreenCaptureKit + AVAudioEngine 錄音 |
| `scripts/MeetingRecorder` | 預編譯 binary (arm64) |
| `scripts/RecordingControlPanel.swift` | SwiftUI 懸浮控制面板原始碼 |
| `scripts/RecordingControlPanel` | 預編譯 binary (arm64) |
| `scripts/get-current-meeting.sh` | 從 macOS Calendar 自動偵測當前會議資訊（Swift EventKit） |
| `scripts/get-current-events.swift` | EventKit 核心查詢工具（比舊版 AppleScript 快 10x+） |

## 變更記錄

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-06-02 | v3 | 修復 RecordingControlPanel @main 編譯錯誤；改為 accessory mode（無 Dock icon）+ floating window；stop 時追加 SIGTERM 給 recorder；修復 SystemAudioRecorder 輸出路徑寫死 bug；自動建立輸出目錄；優化效能 |
| 2026-06-02 | v3.1 | 以 Swift EventKit 重寫 get-current-meeting.sh，徹底解決 AppleScript hang 在訂閱行事曆的問題，查詢時間從 25s+ 降至 < 1s；修正行事曆查詢邏輯，正確捕捉進行中會議 |

## 完整工作流程

當使用者說 `/meeting-minute` 或「開始會議記錄」、「錄製會議」時，執行以下流程：

```
Step 0: 檢查環境
Step 1: 詢問錄音來源與會議資訊
Step 2: 建立輸出目錄
Step 3: 編譯/檢查 MeetingRecorder
Step 4: 開始錄音
Step 5: 等待停止訊號
Step 6: 音訊後處理（合併雙軌）
Step 7: whisper.cpp 語音轉文字
Step 8: LLM 分析整理會議重點
Step 9: 寫入 Obsidian vault
Step 10: 更新索引 & 回報結果
```

---

## Step 0: 檢查環境

### 0a. 檢查 CLI 工具

```bash
which whisper-cli   # 需存在
which ffmpeg        # 需存在
which ffprobe       # 需存在
swift --version     # 需 5.0+
```

**環境確認結果（2026-06-02）：**
- macOS 26.5, Swift 6.3, M4 arm64
- whisper-cli, ffmpeg, ffprobe 均正常
- whisper large-v3-turbo 模型 1.5GB 完整
- pCloud vault 已掛載

**若 whisper-cli 不存在**：告知使用者先安裝 whisper.cpp。

### 0b. 檢查 vault 掛載

Vault 路徑：`~/Library/CloudStorage/CloudMounter-pCloud/AppData/obsidian_opencode/opencode/`

```bash
ls "~/Library/CloudStorage/CloudMounter-pCloud/AppData/obsidian_opencode/opencode/"
```

若不存在，提示「pCloud 可能未掛載，無法寫入筆記」。

### 0c. 檢查 whisper 模型

```bash
ls -lh ~/.cache/whisper.cpp/ggml-large-v3-turbo.bin
```

- 正常大小：~1.5GB
- 若小於 1.5GB 或不存在：需下載

```bash
curl -L -o ~/.cache/whisper.cpp/ggml-large-v3-turbo.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
```

---

## Step 1: 詢問錄音來源與會議資訊

### 1a. 使用 question 工具詢問錄音來源

提供三個選項：
- **系統音訊**：錄製電腦播放的聲音（會議軟體、瀏覽器等）→ `--source system`
- **麥克風**：僅錄製麥克風輸入 → `--source mic`
- **兩者都要**：同時錄製系統音訊 + 麥克風，會後合併 → `--source both`

### 1b. 自動偵測會議資訊（EventKit）

先執行會議偵測腳本：

```bash
bash ~/.config/opencode/skills/meeting-minute/scripts/get-current-meeting.sh
```

若找到進行中或即將開始的會議，自動填入資訊（title、時間、地點）。  
若找不到才用 question 手動詢問。

> **注意：** get-current-meeting.sh 使用 Swift EventKit（非 AppleScript），查詢 < 1s，不會 hang 在訂閱行事曆。

### 1c. 詢問會議基本資訊（備援）

使用 question 工具詢問：
- **會議標題／主題**（必要）
- **會議日期**（預設今天）
- **參與者**（選填，逗號分隔）

---

## Step 2: 建立輸出目錄

建立以日期命名的輸出目錄：

```bash
mkdir -p "~/MeetingRecordings/$(date +%Y-%m-%d)_<會議標題>"
```

範例：`~/MeetingRecordings/2026-06-02_WeeklySync/`

> **注意：** MeetingRecorder v3 已內建自動建立輸出目錄，此步驟可省略。但仍建議預先建立以確保路徑正確。

---

## Step 3: 編譯/檢查 MeetingRecorder & ControlPanel

檢查預編譯 binary：

```bash
ls -l ~/.config/opencode/skills/meeting-minute/scripts/MeetingRecorder
ls -l ~/.config/opencode/skills/meeting-minute/scripts/RecordingControlPanel
```

若不存在或需要重新編譯：

```bash
cd ~/.config/opencode/skills/meeting-minute/scripts

# MeetingRecorder（一般 Swift script）
swiftc -o MeetingRecorder MeetingRecorder.swift

# RecordingControlPanel（需 -parse-as-library 以支援 @main + SwiftUI App）
swiftc -o RecordingControlPanel -parse-as-library RecordingControlPanel.swift
```

編譯成功確認：

```bash
file ~/.config/opencode/skills/meeting-minute/scripts/MeetingRecorder
# 預期輸出: Mach-O 64-bit executable arm64
file ~/.config/opencode/skills/meeting-minute/scripts/RecordingControlPanel
# 預期輸出: Mach-O 64-bit executable arm64
```

> **注意：** RecordingControlPanel 使用 `@main` + SwiftUI App 結構，編譯時必須加 `-parse-as-library`，否則會出現 `'main' attribute cannot be used in a module that contains top-level code` 錯誤。

---

## Step 4: 開始錄音

### 4a. 啟動 MeetingRecorder（背景執行）

MeetingRecorder 會自動寫入 `.status` 和 `.control` 檔案，不需要 nohup redirect。

**系統音訊 only：**
```bash
~/.config/opencode/skills/meeting-minute/scripts/MeetingRecorder \
  --source system \
  --output "~/MeetingRecordings/<日期>_<標題>/system_audio.wav" \
  --log "~/MeetingRecordings/<日期>_<標題>/recorder.log" &
echo $! > "~/MeetingRecordings/<日期>_<標題>/recorder.pid"
```

**麥克風 only：**
```bash
~/.config/opencode/skills/meeting-minute/scripts/MeetingRecorder \
  --source mic \
  --output "~/MeetingRecordings/<日期>_<標題>/mic_audio.wav" \
  --log "~/MeetingRecordings/<日期>_<標題>/recorder.log" &
echo $! > "~/MeetingRecordings/<日期>_<標題>/recorder.pid"
```

**兩者都要：**
```bash
~/.config/opencode/skills/meeting-minute/scripts/MeetingRecorder \
  --source both \
  --output-system "~/MeetingRecordings/<日期>_<標題>/system_audio.wav" \
  --output-mic "~/MeetingRecordings/<日期>_<標題>/mic_audio.wav" \
  --log "~/MeetingRecordings/<日期>_<標題>/recorder.log" &
echo $! > "~/MeetingRecordings/<日期>_<標題>/recorder.pid"
```

### 4b. 啟動懸浮控制面板

```bash
~/.config/opencode/skills/meeting-minute/scripts/RecordingControlPanel \
  --session "~/MeetingRecordings/<日期>_<標題>" \
  --pid $(cat "~/MeetingRecordings/<日期>_<標題>/recorder.pid") &
```

面板無 Dock icon（accessory mode），浮動視窗常駐最上層。  
點擊「停止」會寫入 `stop` 到 `.control`，同時對 recorder PID 發送 SIGTERM 作為備援。

### 4c. 確認錄音啟動

```bash
sleep 2
cat "~/MeetingRecordings/<日期>_<標題>/.status"
```

預期輸出：`00:0x|recording`（x 為秒數）

### 4d. 通知使用者

告知使用者：
- ✅ 錄音已開始
- 懸浮面板已開啟，可使用「暫停」/「繼續」/「停止」按鈕
- 錄音來源：[系統音訊 / 麥克風 / 兩者]
- 輸出目錄：[路徑]

### 4e. Permission 注意事項

首次使用時，macOS 會彈出權限對話框：
- **Screen Recording**：系統音訊需要（ScreenCaptureKit）
- **Microphone**：麥克風需要

告知使用者需要在系統提示時允許。若無權限，錄音會靜默失敗。

---

## Step 5: 等待停止訊號

### 5a. 透過懸浮面板停止（推薦）

使用者在懸浮面板點擊「停止」按鈕，會寫入 `stop` 到 `.control` 檔案。

### 5b. 透過指令停止（備援）

當使用者說「停止錄音」時，寫入 control 檔案：

```bash
echo "stop" > "~/MeetingRecordings/<日期>_<標題>/.control"
sleep 2
```

### 5c. 確認錄音停止

```bash
cat "~/MeetingRecordings/<日期>_<標題>/.status"
```

預期輸出包含 `stopping` 或 `complete`。

### 5d. 檢查輸出檔案

```bash
ls -lh "~/MeetingRecordings/<日期>_<標題>/"
```

確認 WAV 檔案存在且大小正常（>0 bytes）。

---

## Step 6: 音訊後處理

若來源為 `both`，將系統音訊與麥克風合併為單一音檔。

### 6a. 合併雙軌音訊

```bash
ffmpeg -y \
  -i "~/MeetingRecordings/<日期>_<標題>/system_audio.wav" \
  -i "~/MeetingRecordings/<日期>_<標題>/mic_audio.wav" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2" \
  "~/MeetingRecordings/<日期>_<標題>/merged_audio.wav"
```

### 6b. 轉換為 whisper 最佳格式

whisper.cpp 支援 16-bit WAV 效果最佳。確認格式：

```bash
ffprobe "~/MeetingRecordings/<日期>_<標題>/merged_audio.wav" 2>&1 | grep -E "Audio|Duration"
```

若需要轉換：

```bash
ffmpeg -y -i "<input>" -ar 16000 -ac 1 -sample_fmt s16 "<output>_16k.wav"
```

記錄輸出音檔路徑供下一步使用：
- **system only**：`system_audio.wav`
- **mic only**：`mic_audio.wav`
- **both**：`merged_audio.wav`（或 `merged_audio_16k.wav`）

---

## Step 7: whisper.cpp 語音轉文字

### 7a. 執行轉錄

```bash
whisper-cli \
  -m ~/.cache/whisper.cpp/ggml-large-v3-turbo.bin \
  -f "<音檔路徑>" \
  --output-txt \
  -l auto \
  -of "~/MeetingRecordings/<日期>_<標題>/transcript"
```

- `-l auto`：自動偵測語言。若已知語言可指定（`-l zh` 中文、`-l en` 英文）
- `-of`：輸出檔案前綴，會產生 `transcript.txt`

### 7b. 讀取逐字稿

```bash
cat "~/MeetingRecordings/<日期>_<標題>/transcript.txt"
```

### 7c. 效能參考

| 錄音長度 | 轉錄時間（M4 Pro + large-v3-turbo） |
|---------|-----------------------------------|
| 15 分鐘 | ~30s |
| 30 分鐘 | ~90s |
| 1 小時 | ~270s (4.5min) |

---

## Step 8: LLM 分析整理會議重點

使用自身推理能力，分析逐字稿全文，產出結構化會議記錄。

### 8a. 逐字稿取樣

若逐字稿過長，取摘要分析。優先使用完整內容，必要時分段。

### 8b. LLM 分析指南

分析會議逐字稿時，專注於：

- **主題分類**：辨識討論的主要議題與子議題
- **決策記錄**：記錄做出的決策、結論
- **行動項目**：提取待辦事項、負責人、截止日期
- **關鍵討論**：標註有爭議或深入討論的議題
- **時間線**：按討論順序整理，保留上下文

### 8c. 輸出格式範本

```
## 會議資訊
- **標題**：[會議標題]
- **日期**：[日期]
- **錄音長度**：[時長]
- **來源**：[系統/麥克風/兩者]

---

## 討論摘要

### [主題 1]
- [討論內容摘要]
- [關鍵觀點]

### [主題 2]
- [討論內容摘要]
- [關鍵觀點]

---

## 決議事項
- ✅ [決議 1]
- ✅ [決議 2]

---

## 待辦事項
- [ ] [事項] — [負責人] — [期限]
- [ ] [事項] — [負責人] — [期限]

---

## 重點關注
- 🔴 [高優先級項目]
- 🟡 [需跟進項目]

---

## 逐字稿
<!-- 原始逐字稿請見錄音目錄 -->
```

### 8d. 常見分類

| 分類 | 應包含 |
|------|--------|
| **討論摘要** | 每個主題的討論重點、各方觀點 |
| **決議事項** | 團隊做出的決定、同意的事項 |
| **待辦事項** | 具體行動、負責人、時間 |
| **重點關注** | 需要追蹤的高優先級項目 |
| **下次會議** | 下次討論的議題（若有提及） |

---

## Step 9: 寫入 Obsidian vault

### 9a. 確認 vault 路徑

```bash
ls "~/Library/CloudStorage/CloudMounter-pCloud/AppData/obsidian_opencode/opencode/"
```

### 9b. 決定筆記分類

會議記錄歸類於：
```
70-日誌/73-會議記錄/<年>/<月>/<日期>_<會議標題>.md
```

### 9c. 建立目錄（若不存在）

```bash
mkdir -p "~/Library/CloudStorage/CloudMounter-pCloud/AppData/obsidian_opencode/opencode/70-日誌/73-會議記錄/$(date +%Y)/$(date +%m)"
```

### 9d. 寫入筆記

筆記包含：
1. **YAML frontmatter**（必要）
2. **會議資訊**（日期、標題、參與者、時長）
3. **LLM 分析結果**（Step 8 產出）
4. **逐字稿連結**（指向錄音目錄，vault 內不存全文）

#### Frontmatter 範例

```yaml
---
title: "<會議標題>"
date: <YYYY-MM-DD>
tags:
  - meeting
  - meeting-minute
duration: <分鐘>
participants: <參與者>
recording: <錄音檔路徑>
status: complete
---
```

#### 寫入操作

使用 `write` 工具將完整內容寫入 vault `.md`。

### 9e. 舊版注意事項

檔案已存在時，檢查 `status` 欄位：
- `pending_transcribe`：等待轉錄
- `pending_analysis`：等待 LLM 分析
- `complete`：已完成

若為 `complete` 且無新錄音，跳過。

---

## Step 10: 更新索引 & 回報結果

### 10a. 確認 vault 索引已更新

（目前 vault 無自動索引維護，建立檔案即完成。）

### 10b. 回報結果

向使用者回報：
- ✅ 錄音完成（來源、時長、檔案大小）
- ✅ 語音轉文字完成（逐字稿長度）
- ✅ LLM 會議重點分析完成
- ✅ 筆記寫入位置：[vault 路徑]
- 💡 主要待辦事項 / 重點摘要（1-2 項）

---

## 注意事項

| 事項 | 說明 |
|------|------|
| **權限** | 首次使用需授予 Screen Recording + Microphone 權限 |
| **Vault 掛載** | pCloud CloudMounter 可能離線，操作前確認路徑存在 |
| **模型完整性** | large-v3-turbo 應為 ~1.5GB |
| **GPU 加速** | M4 Pro Metal GPU 加速（~11x real-time） |
| **音檔保留** | 錄音檔保留於 `~/MeetingRecordings/` 供後續查閱 |
| **vault 不存逐字稿全文** | 僅存分析結果，節省空間 |
| **同時錄製** | `both` 模式為雙軌同時錄製，會後用 ffmpeg amix 合併 |

## 已知問題

| 問題 | 解決方案 |
|------|----------|
| 權限未授予錄音無資料 | 檢查 System Settings → Privacy → Screen Recording + Microphone |
| ScreenCaptureKit 首次使用需權限 | 告知使用者在系統彈出對話框時點「允許」 |
| 模型未下載或損毀 | 刪除 `~/.cache/whisper.cpp/ggml-large-v3-turbo.bin` 後重新下載 |
| Vault 離線 | 確認 CloudMounter pCloud 已連接 |
| ControlPanel 編譯 `@main` 錯誤 | 編譯時加 `-parse-as-library` 參數 |
| **get-current-events.swift 首次使用需 EventKit 權限** | 系統彈出授權對話框時點「允許」；若已拒絕，至 System Settings → Privacy → Calendar 開啟 |

## 已修正問題 (v3)

| 問題 | 修正 |
|------|------|
| **SystemAudioRecorder 輸出路徑寫死** | `stream()` 建立 writer 時使用 `outputSystemPath` 屬性而非硬編碼 `./system_audio.wav`。會導致指定 `--output-system` 路徑無效 |
| **輸出目錄未自動建立** | 錄音前自動 `mkdir -p` 建立輸出目錄，避免寫入失敗 |
| **ControlPanel @main 編譯錯誤** | 將 free functions (`parseArgs`, `writeControl`, `readStatus`) 移至 App struct 內做為 static/instance methods |
| **ControlPanel 無 Dock icon 隱藏** | 啟動時呼叫 `NSApplication.shared.setActivationPolicy(.accessory)`，不顯示 Dock icon |
| **ControlPanel 非浮動視窗** | 加入 `.windowLevel(.floating)`，常駐最上層 |
| **Stop 未終止 recorder 行程** | 停止時除寫入 `stop` 到 `.control`，也對 recorder PID 發送 SIGTERM 作為備援 |
| **get-current-meeting.sh 查不到進行中會議** | 舊版 AppleScript 只搜 `start date` 範圍，漏掉已開始的會議。新版 EventKit 使用 `start date ≤ now ≤ end date` 邏輯 |
| **get-current-meeting.sh hang 在訂閱行事曆** | AppleScript 遇 Taiwan Holiday 等訂閱行事曆會 hang 超過 25s。全面改用 Swift EventKit，查詢 < 1s |

## Skill 目錄結構

```
meeting-minute/
├── SKILL.md                    # 本檔案（Agent 執行指引）
├── scripts/
│   ├── MeetingRecorder.swift   # Swift 錄音程式原始碼
│   ├── MeetingRecorder         # 預編譯 binary (arm64)
│   ├── RecordingControlPanel.swift  # SwiftUI 懸浮面板原始碼
│   └── RecordingControlPanel   # 預編譯 binary (arm64)
```

## 懸浮控制面板

錄音時會自動開啟 SwiftUI 懸浮面板，提供以下功能：

| 按鈕 | 功能 |
|------|------|
| ⏸ 暫停 | 暫停錄音（寫入 `pause` 到 `.control`） |
| ▶️ 繼續 | 恢復錄音（寫入 `resume` 到 `.control`） |
| ⏹ 停止 | 停止錄音（寫入 `stop` 到 `.control`） |

面板會每秒讀取 `.status` 檔案更新計時器（格式：`MM:SS|state`）。
