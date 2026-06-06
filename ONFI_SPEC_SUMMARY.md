# ONFI (Open NAND Flash Interface) 規格重點整理

> **目標讀者**: Verilog 數位 IC 設計工程師（進行 NAND Flash Controller / PHY 數位設計）
> **最新版本**: ONFI 6.0 / JEDEC JESD230G（2024 年 11 月發布）
> **官方網站**: https://www.onfi.org/（PDF 遭 Cloudflare 阻擋，本報告整合多個權威來源）
> **JEDEC JESD230G**: https://www.jedec.org/（需註冊免費下載）
> **整理日期**: 2026-06-06

---

## 目錄

1. [ONFI 版本演進總覽](#1-onfi-版本演進總覽)
2. [ONFI 6.0 / JESD230G — 最新世代](#2-onfi-60--jesd230g--最新世代)
3. [ONFI 5.2 核心變化 — SCA 協議](#3-onfi-52-核心變化--sca-協議)
4. [介面信號定義與 Pinout](#4-介面信號定義與-pinout)
5. [NAND Flash 基本操作命令集](#5-nand-flash-基本操作命令集)
6. [功能暫存器 (Feature Registers)](#6-功能暫存器-feature-registers)
7. [ONFI 控制器架構](#7-onfi-控制器架構)
8. [Behavioral Flow 狀態機 (ONFI 5.0 §7)](#8-behavioral-flow-狀態機-onfi-50-7)
9. [PHY 層關鍵設計要點](#9-phy-層關鍵設計要點)
10. [初始化與訓練序列](#10-初始化與訓練序列)
11. [時序模式與速度等級](#11-時序模式與速度等級)
12. [Signal Integrity 技術](#12-signal-integrity-技術)
13. [電氣規格與 DC 特性](#13-電氣規格與-dc-特性-onfi-50-213)
14. [Verilog 實現建議](#14-verilog-實現建議)
15. [參考資源](#15-參考資源)

---

## 1. ONFI 版本演進總覽

| 版本 | 發布時間 | 介面技術 | 最大速度 | 關鍵技術 |
|------|---------|---------|---------|---------|
| **1.0** | 2006-12 | Async SDR | 50 MT/s | 統一 pinout/命令集、參數頁面(Parameter Page) |
| **2.0** | 2008 | **NV-DDR** | 133 MT/s | 雙倍資料率(DDR)、源同步時脈(DQS) |
| **2.1** | 2009 | NV-DDR | 200 MT/s |  |
| **2.2/2.3** | 2010 | NV-DDR | 200 MT/s | EZ-NAND（隱藏 ECC 細節） |
| **3.0** | 2011-03 | **NV-DDR2** | 400 MT/s | **差分信號**(RE_t/RE_c, DQS_t/DQS_c)、**ODT**(On-Die Termination) |
| **3.2** | 2013-07 | NV-DDR2 | 533 MT/s |  |
| **4.0** | 2014-04 | **NV-DDR3** | 800 MT/s | **ZQ Calibration**、DCC、Read/Write DQ Training |
| **4.1** | 2017-12 | NV-DDR3 | 1200 MT/s | DCC、Read/Write Training(>800MT/s)、2.5V Vcc |
| **4.2** | 2020-02 | NV-DDR3 | **1600 MT/s** | BGA-252b 四通道封裝、放寬 Multi-plane 限制 |
| **5.0** | 2021-05 | **NV-LPDDR4** | **2400 MT/s** | LTT 低功耗、DBI(Data Bus Inversion)、BGA-178/154/146b |
| **5.1** | 2023 | NV-LPDDR4 | **3600 MT/s** | DFE(決策回饋等化器)、非對稱 DQS、VrefQ Calibration |
| **5.2** | **2024-02** | SCA + NV-LPDDR4 | **3600 MT/s** | **SCA 協議**(Separate Command Address) — **最大變革** |
| **6.0** | **2024-11** | **SCA + NV-LPDDR4** | **4800 MT/s** | **JEDEC JESD230G** 正式納入 SCA、SCA mode pin、4800 MT/s |
| _6.4k_ | _開發中_ | _SCA+_ | _6400 MT/s_ | _InPsytech ONFI 6400 @4nm（2025~2026）_ |

### 重點結論

> ONFI 從 1.0 到 6.0，速度從 **50 → 4800 MT/s**（**96 倍增長**）。傳統命令/位址非同步傳輸方式導致**匯流排利用率隨速度提升反而下降**（讀取場景降至約 50%）。**SCA 協議（ONFI 5.2 引入，6.0 正式化）正是為解決此問題而設計。**
>
> **⚠ ONFI 6.0 規格已透過 JEDEC JESD230G 發布**（2024 年 11 月 18 日），可至 JEDEC 官網免費下載（需註冊）。ONFI 與 JEDEC 的 NAND Flash Task Group 為 Joint Task Group，兩者規格互通。

---

## 2. ONFI 6.0 / JESD230G — 最新世代

### 2.1 ONFI 6.0 與 JEDEC JESD230G 的關係

ONFI 6.0 規格由 **JEDEC JESD230G**（NAND Flash Interface Interoperability Standard）定義，由 JEDEC 與 ONFI 工作小組**聯合開發**（Joint Task Group），於 **2024 年 11 月 18 日**正式發布。

| 項目 | 內容 |
|------|------|
| **正式名稱** | JEDEC JESD230G - NAND Flash Interface Interoperability Standard |
| **速度** | **最高 4800 MT/s** (4.8 GT/s) — 對比 JESD230 初版 400 MT/s 的 **12 倍** |
| **協議** | Conventional Protocol (向後相容) + **SCA Protocol** (Separate Command Address) |
| **SCA mode pin** | 利用封裝既有 NU (Not Used) pin，Power-up 決定 Conventional 或 SCA 模式 |
| **向後相容** | 完全支援 JESD230~JESD230F（對應 ONFI 1.0~5.2） |
| **發布日期** | 2024 年 11 月 18 日 |
| **下載** | JEDEC 官網免費，需註冊 https://www.jedec.org/ |

### 2.2 JESD230G 與 JESD230F 的主要差異

| 面向 | JESD230F (ONFI 5.1/5.2) | JESD230G (ONFI 6.0) |
|------|------------------------|---------------------|
| **最大速度** | 3600 MT/s | **4800 MT/s** (增強 33%) |
| **SCA 協議** | 選配（ONFI 5.2 定義） | **正式納入標準** |
| **SCA mode pin** | 無 | **有** — 封裝 NU pin 指定 Conventional/SCA 模式 |
| **信號完整性** | DFE, Asymmetric DQS | DFE + **FFE (Feed-Forward Equalizer)** |
| **PI-LTT** | — | **Power Isolated LTT** (M31 PHY 支援) |
| **封裝** | BGA-178b, BGA-154b, BGA-146b | 同左（新增 SCA mode pin 定義） |

### 2.3 SCA Mode Pin — 關鍵硬體變革

JESD230G 定義了一個全新的 **SCA mode pin**（使用既有封裝中的一個 NU/NC pin）：

```
Power-up 時 SCA mode pin 的狀態決定：
  ├─ High / Float → Conventional Protocol（傳統模式，向後相容）
  │    CE=CE_n, ALE=ALE, CLE=CLE, WE=WE_n
  │    DQ[7:0] = CMD + ADDR + DATA 時分複用
  │
  └─ Low → SCA Protocol（新模式）
       CE → CA_CE (Command/Address bus enable)
       ALE → CA[1] (Command/Address packet bit 1)
       CLE → CA[0] (Command/Address packet bit 0)
       WE → CA_CLK (Command/Address clock)
       DQ[7:0] = 僅 DATA（可與 CA 匯流排並行操作）
```

> **對 IC 設計的影響**：Controller/PHY 需要能同時支援兩種 pin assignment。SCA 模式下，ALE/CLE/WE 被重新定義為 CA 匯流排功能。

---

## 3. ONFI 5.2 核心變化 — SCA 協議

### 3.1 為什麼需要 SCA？

傳統 ONFI 協議（1.0~5.1）中，命令(Command)、位址(Address)、資料(Data) 透過 DQ[7:0] **時分複用**：

- **資料**：同步傳輸、差分取樣 → 高速
- **命令/位址**：**非同步傳輸、單端取樣** → 低速

隨著速度提升，命令/位址傳輸延遲占比越來越大，導致**匯流排效率顯著下降**（讀取場景約 50%）。

### 3.2 SCA (Separate Command Address) 協議

SCA 是 ONFI 5.2 的**最大變革**，將命令/位址與資料**分離到獨立匯流排**：

```
傳統： DQ[7:0] ← 時分複用 (CMD + ADDR + DATA)
SCA：  DQ[7:0] ← 僅 DATA
       CA[1:0] ← 專用 CMD/ADDR 封包匯流排
```

#### 新增信號

| 信號 | 方向 | 描述 |
|------|------|------|
| **CA[1:0]_x** | Host → Device | 命令/位址封包（2-bit 專用匯流排） |
| **CA_CEy_x_n** | Host → Device | 命令/位址匯流排致能（per CE） |
| **CA_CLK_x** | Host → Device | 命令/位址時脈 |

其中 `x` = 通道編號, `y` = CE 編號

#### 核心優勢

- **並行處理**：Host 可在前一個 Read/Program 的資料傳輸尚未完成時，**同時發送下一個命令**
- **提升吞吐量**：命令/位址與資料流量可並行，類似 DRAM (如 DDR4 的 CA bus)
- **提高匯流排利用率**：解決傳統協議效率衰減問題

#### SCA 協議命令集

- ONFI 5.2 **同時支援** Conventional Protocol Command Set（向下相容）與 SCA Protocol Command Set
- SCA 命令集可包含**第三個週期**，用於：
  - Multi-plane Page Program
  - Page Cache Program
  - Multi-plane Copyback Program

#### 新增時序參數

| 參數 | 描述 |
|------|------|
| **tWLCEL_CA** | CA_CLK low setup 到第一個 CE# low（啟用 SCA 後） |
| tCA_SET | CA 匯流排設定時間 |
| tCA_HLD | CA 匯流排保持時間 |

#### 設備訓練 (Device Trainings)

SCA 介面需要進行以下訓練以確保正常操作：
- **Read Training**
- **Write Training**
- **CA Bus Training**

---

### 3.3 SCA CA 封包序列化格式 — 實作關鍵

SCA 協議中，命令與位址透過 **CA[1:0] 匯流排**以 **2-bit 序列化**方式傳輸：

```
CA_CLK 週期:     T0    T1    T2    T3    T4    T5    T6    T7
CA[1] (CLE→):   CMD0  CMD1  CMD2  CMD3  ADR0  ADR1  ADR2  ADR3
CA[0] (ALE→):   CMD4  CMD5  CMD6  CMD7  ADR4  ADR5  ADR6  ADR7
                └── 命令位元組 ──┘ └── 位址位元組 ──┘
```

**封包結構**:
| 欄位 | 寬度 | 說明 |
|------|:----:|------|
| 命令碼 | 8 bits | 透過 CA[1:0] 4 個 CLK 週期序列化 |
| 位址段 | 40 bits (5 cycles) | 透過 CA[1:0] 20 個 CLK 週期序列化 |
| CA_CE_n | 1 bit | 封包開始/結束控制，CA_CLK 下降沿取樣 |
| 封包間隙 | 1+ CA_CLK | tWLCEL_CA 時間 |

**CA 匯流排操作規則**:
1. **CA_CE_n 下降沿** → 開始 CA 封包傳輸
2. **CA_CLK 上升沿** → 取樣 CA[1:0] 資料
3. CA[1:0] 在 CA_CLK 上升沿前後需滿足 tCA_SET / tCA_HLD
4. **8-bit 命令** → 需要 4 個 CA_CLK 週期序列化
5. **40-bit 地址** → 需要 20 個 CA_CLK 週期（x8 版本，5 位址週期 × 8 bits / 2）
6. **CA_CE_n 上升沿** → 封包結束
7. DQ 匯流排可透過 CA 封包中的特殊命令致能/禁能

**SCA 命令集的第三週期擴展**:
```
傳統 2 週期命令 (CMD + ADDR):
  T0-T3: CA[1:0] = 命令碼
  T4-T23: CA[1:0] = 位址 (5 bytes × 8 bits / 2 = 20 CLK)

SCA 3 週期命令 (CMD + ADDR + CMD2):
  T0-T3: CA[1:0] = 主命令碼 (如 80h)
  T4-T23: CA[1:0] = 位址
  T24-T27: CA[1:0] = 次命令碼 (如 11h/81h)
```

**CA Bus Training**: SCA 協議必須進行 CA 匯流排訓練，類似 Write DQ Training：
- 發送已知 CA 模式 → NAND 回傳結果 → 調整 CA 時序
- 訓練命令透過 CA 匯流排本身發送（catch-22，需預設低速模式支援）

**對控制器的影響**:
- 需要 **CA 封包組裝器** (Packetizer)：將命令 + 位址 → 2-bit 序列
- 需要 **CA 時脈域**：CA_CLK 可能與 PHY 時脈不同步
- 傳統 CMD/ADDR 發送單元可被 CA 封包組裝器替代
- CA 封包長度可程式（取決於位址週期數）

---

## 4. 介面信號定義與 Pinout

### 4.1 各模式信號對照表

| 信號 | SDR | NV-DDR | NV-DDR2/3 | NV-LPDDR4 | SCA | 類型 | 描述 |
|------|-----|--------|-----------|-----------|-----|------|------|
| **CLE** | ✓ | ✓ | ✓ | ✓ | ✓ | Input | Command Latch Enable |
| **ALE** | ✓ | ✓ | ✓ | ✓ | ✓ | Input | Address Latch Enable |
| **CE_n** | ✓ | ✓ | ✓ | ✓ | ✓ | Input | Chip Enable |
| **RE_n** | ✓ | — | — | — | ✓ | Input | Read Enable (SDR) |
| **RE_t** | — | W/R_n | RE_t | RE_t | — | Input | Read Enable (true) |
| **RE_c** | — | — | RE_c | RE_c | — | Input | Read Enable (complement) |
| **WE_n** | ✓ | CLK | WE_n | WE_n | ✓ | Input | Write Enable / Clock |
| **WP_n** | ✓ | ✓ | ✓ | ✓ | ✓ | Input | Write Protect |
| **R/B_n** | ✓ | ✓ | ✓ | ✓ | ✓ | Output | Ready / Busy |
| **DQ[7:0]** | ✓ | ✓ | ✓ | ✓ | ✓ | I/O | Data bus (SDR 僅資料) |
| **DQS** | — | ✓ | DQS_t | DQS_t | ✓ | I/O | Data Strobe (true) |
| **DQS_c** | — | — | ✓ | ✓ | ✓ | I/O | Data Strobe (complement) |
| **ZQ** | — | — | ✓ | ✓ | ✓ | — | ZQ Calibration |
| **DBI** | — | — | — | ✓ | ✓ | I/O | Data Bus Inversion (NV-LPDDR4 選配) |
| **CA[1:0]** | — | — | — | — | **✓** | Input | CMD/Address packet bus (SCA 專用) |
| **CA_CEy_n** | — | — | — | — | **✓** | Input | CA bus enable (SCA 專用) |
| **CA_CLK** | — | — | — | — | **✓** | Input | CA clock (SCA 專用) |

### 4.2 SDR 模式匯流排狀態機

```
CE_n | ALE | CLE | WE_n | RE_n | Bus State
-----|-----|-----|------|------|----------
  1  |  X  |  X  |  X   |  X   | Standby
  0  |  0  |  0  |  1   |  1   | Idle
  0  |  0  |  1  |  0   |  1   | Command cycle
  0  |  1  |  0  |  0   |  1   | Address cycle
  0  |  0  |  0  |  0   |  1   | Data input cycle (Host→Device)
  0  |  0  |  0  |  1   |  0   | Data output cycle (Device→Host)
  0  |  1  |  1  |  X   |  X   | Undefined
```

### 4.3 封裝選項

| ONFI 版本 | 封裝類型 |
|-----------|---------|
| 1.0 | TSOP-48, WSOP-48, LGA-52, BGA-63 |
| 2.x~4.x | BGA-100, BGA-132, BGA-152, BGA-272b (四通道) |
| 4.2 | BGA-252b (四通道，更小面積) |
| **5.0+** | **BGA-178b, BGA-154b, BGA-146b** (更小 footprint) |

---

## 5. NAND Flash 基本操作命令集

### 5.1 核心命令（ONFI 通用）

| 命令 | 第一碼 | 第二碼 | 地址週期 | 說明 |
|------|--------|--------|---------|------|
| **Read Page** | 00h | 30h | 5 | 讀取一頁資料 |
| **Read Page (cache)** | 31h | — | 5 | 快取讀取 |
| **Program Page** | 80h | 10h | 5 | 寫入一頁資料 |
| **Program Page (cache)** | 80h | 15h | 5 | 快取寫入 |
| **Block Erase** | 60h | D0h | 3 | 抹除一個區塊 |
| **Read Status** | 70h | — | 0 | 讀取狀態暫存器 |
| **Reset** | FFh | — | 0 | 設備重置 |
| **Read ID** | 90h | — | 1 | 讀取設備 ID |
| **Set Features** | EFh | — | 1+資料 | 設定功能暫存器 |
| **Get Features** | EEh | — | 1+資料 | 讀取功能暫存器 |
| **Parameter Page** | ECh | — | 1 | 讀取參數頁面 |
| **Change Row Address** | 85h | 11h | 5 | 改變行位址（Read-while-write） |
| **Read Unique ID** | EDh | — | 1 | 讀取唯一 ID |

### 5.2 Multi-plane 與快取命令

SCA 協議命令集增加**第三週期**用於：

| 操作 | 第一碼 | 第二碼 | 第三碼 (SCA) | 說明 |
|------|--------|--------|-------------|------|
| Multi-plane Program | 80h | 10h | 11h/81h | 跨 plane 同時寫入 |
| Page Cache Program | 80h | 15h | 10h/1Ah | 管線寫入 |
| Multi-plane Copyback | 00h | 35h | 15h/05h | 跨 plane 內部複製 |

### 5.3 典型操作序列

```
=== Read Page ===
Step 1: 發送 00h (CLE=1)
Step 2: 發送 5 個地址週期 (ALE=1, 行+列位址)
Step 3: 發送 30h (CLE=1)
Step 4: 等待 R/B_n = 1 (Ready)
Step 5: 讀取資料 (RE_n toggling, DQ 輸出)

=== Program Page ===
Step 1: 發送 80h (CLE=1)
Step 2: 發送 5 個地址週期 (ALE=1)
Step 3: 寫入資料 (WE_n toggling, DQ 輸入)
Step 4: 發送 10h (CLE=1)
Step 5: 等待 R/B_n = 1 (Ready)
Step 6: 發送 70h (CLE=1) 讀取狀態確認

=== Block Erase ===
Step 1: 發送 60h (CLE=1)
Step 2: 發送 3 個地址週期 (ALE=1, 僅行位址)
Step 3: 發送 D0h (CLE=1)
Step 4: 等待 R/B_n = 1 (Ready)
Step 5: 發送 70h 讀取狀態確認
```

---

## 6. 功能暫存器 (Feature Registers)

### 6.1 Feature Address 總覽

| 位址 | 功能 | 支援介面 |
|------|------|---------|
| **01h** | Timing Mode — 選擇 data interface 類型與時序模式 | SDR / NV-DDR / NV-DDR2/3 / NV-LPDDR4 |
| **02h** | NV-DDR2/NV-DDR3/NV-LPDDR4 Configuration | NV-DDR2/3 / NV-LPDDR4 |
| **10h** | I/O Drive Strength — 輸出驅動強度設定 | NV-DDR / NV-DDR2/3 / NV-LPDDR4 |
| **20h** | DCC, Read, Write TX Training | NV-DDR2/3 / NV-LPDDR4 |
| **21h** | Write Training RX | NV-DDR2/3 / NV-LPDDR4 |
| **22h** | Channel ODT Configuration (NV-LPDDR4) | NV-LPDDR4 |
| **23h** | Internal VrefQ Value | NV-DDR2/3 / NV-LPDDR4 |

### 6.2 FA 01h — Timing Mode (所有介面通用)

```
Sub Feature  Bit 7  Bit 6  Bit 5  Bit 4  Bit 3  Bit 2  Bit 1  Bit 0
P1           TMN[4] PC     └── Data Interface Type ──┘  └── TMN[3:0] ──┘
P2           ─────────────────── Reserved (0) ──────────────────────────
P3           ─────────────────── Reserved (0) ──────────────────────────
P4           ─────────────────── Reserved (0) ──────────────────────────
```

- **PC (Parameter Change, P1[6])**: 寫 1 後設備在下個 Set Features 前使用新參數
- **Data Interface Type (P1[5:4])**: 00b=SDR, 01b=NV-DDR, 10b=NV-DDR2/3, 11b=NV-LPDDR4
- **TMN[4:0] (P1[3:0] + P1[7])**: 時序模式號碼（如 TM10 = 0Ah）

### 6.3 FA 10h — I/O Drive Strength

```
P2[3:0] = Driver Strength 編碼
```

典型驅動強度值：
- NV-DDR3: 35Ω / 37.5Ω / 40Ω / 45Ω / 50Ω / 60Ω
- NV-LPDDR4: Pull-up = VccQ/3 (搭配 50Ω CH_ODT), Pull-down = 37.5Ω

### 6.4 FA 20h — DCC, Read, Write TX Training

```
Sub Feature  Bit 7  Bit 6  Bit 5  Bit 4  Bit 3  Bit 2    Bit 1    Bit 0
P1           ───────── Reserved (0) ──────────  DCC_FACT  DCCI_EN  DCCE_EN
P2           ─────────────────── Reserved (0) ──────────────────────────
P3           ───── Reserved (0) ─────  └─ Read Training ─┘  └─ Write ─┘
                                               pattern len    TX size
P4           ─────────────────── Reserved (0) ──────────────────────────
```

- **DCCE_EN**: Explicit DCC 啟用（發送 FEh 命令序列啟動 DCC 訓練）
- **DCCI_EN**: Implicit DCC 啟用（透過正常 RE_t/RE_c 操作自動訓練）
- **DCC_FACTORY**: 使用出廠預設 DCC 校準值
- **Read Training pattern length**: 1b=32 Bytes, 0b=16 Bytes
- **DCC Training (RE_t/c)**: 可透過 Set Feature (FA 20h) 或專用命令 (CMD 18h) 觸發

### 6.5 FA 22h — Channel ODT (NV-LPDDR4)

```
P1[3:0] = CH_ODT[3:0]

0010b = 150Ω    0011b = 100Ω    0100b = 75Ω
0101b = 60Ω     0110b = 50Ω     0111b = 40Ω
1000b = 30Ω     其他 = Reserved
```

### 6.6 FA 23h — Internal VrefQ Value

- **6-bit 編碼**, 範圍 0.0% ~ 72.0% of VccQ (步進 1.5%)
- 編碼值 00h = 0.0%, 01h = 1.5%, ..., 30h = 72.0%
- 計算公式: VrefQ = (code × 1.5)% × VccQ
- Reset 後保留，出廠預設為 Vendor Specific

---

## 7. ONFI 控制器架構

### 7.1 建議模組劃分

```
┌──────────────────────────────────────────────────┐
│                 NAND Flash Controller             │
│                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │
│  │ Host I/F     │  │ Command     │  │ Data     │ │
│  │ (AXI/WB/etc) │◄─┤ Scheduler   │◄─┤ Buffer   │ │
│  └──────┬───────┘  └──────┬──────┘  └────┬─────┘ │
│         │                 │              │        │
│  ┌──────▼─────────────────▼──────────────▼─────┐ │
│  │           Controller FSM                    │ │
│  │  (Protocol Engine + Sequence Generator)     │ │
│  └──────▲──────────────────────────────────────┘ │
│         │                                        │
│  ┌──────▼──────────────────────────────────────┐ │
│  │           PHY Interface / PHY               │ │
│  │  (SDR / NV-DDR / NV-DDR2/3 / NV-LPDDR4)    │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
         │
         ▼
    ONFI Bus ───► NAND Flash Devices
```

### 7.2 各模組功能說明

| 模組 | 功能 |
|------|------|
| **Host I/F** | AXI3/AXI4 slave (控制暫存器存取) + AXI master (DMA) |
| **Command Scheduler** | 命令佇列管理、仲裁、QoS、SCA 協議的 CA 排程 |
| **Data Buffer** | 讀/寫緩衝區、位元寬度轉換 (Host width ↔ 8-bit) |
| **Controller FSM** | 主狀態機：解析命令 → 產生時序序列 → 控制 PHY |
| **PHY** | 信號層驅動：時脈產生、DQS 對齊、訓練、ODT 控制 |

### 7.3 Controller FSM 狀態圖（簡化）

```
                    ┌──────────┐
                    │  IDLE    │ ◄──── Reset
                    └────┬─────┘
                         │ 收到命令
                    ┌────▼─────┐
                    │ CMD phase│ (CLE=1, 發送命令碼)
                    └────┬─────┘
                         │ 需要地址
                    ┌────▼─────┐
                    │ ADDR ph. │ (ALE=1, 發送 3~5 地址週期)
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         ┌────▼───┐ ┌───▼────┐ ┌──▼───┐
         │DATA IN │ │DATA OUT│ │EXEC  │ (Program/Erase)
         │(Write) │ │(Read)  │ │      │
         └────┬───┘ └───┬────┘ └──┬───┘
              │          │          │
              └──────────┼──────────┘
                         │
                    ┌────▼─────┐
                    │ WAIT     │ (等待 R/B_n)
                    └────┬─────┘
                         │ Ready
                    ┌────▼─────┐
                    │ STATUS   │ (選配：讀取狀態)
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ COMPLETE │ (中斷/DMA 通知)
                    └──────────┘
```

### 7.4 SCA 協議對控制器的影響

對 Controller 而言，SCA 協議需要：

1. **CA 匯流排管理邏輯**：獨立於資料路徑的命令/位址發送單元
2. **並行排程器**：命令佇列中可同時存在多個未完成的 CA 傳輸
3. **分離的時脈域**：CA_CLK 可能與 DQS/CLK 不同步
4. **訓練狀態機**：SCA 介面的 Read/Write/CA Bus Training

---

## 8. Behavioral Flow 狀態機 (ONFI 5.0 §7)

> 以下狀態機直接來自 ONFI 5.0 Section 7，是 Verilog 控制器實作的**直接參考**。

### 8.1 Target 層級狀態機

Target 狀態機描述主機操作 Target 時的允許序列。使用變數：

| 變數 | 說明 | 初始值 |
|------|------|--------|
| `tbStatusOut` | 資料讀取週期是否回傳狀態值 | FALSE |
| `tbChgCol` | 是否允許 Change Read Column | FALSE |
| `tbChgColEnh` | 是否允許 Change Read Column Enhanced | FALSE |
| `tCopyback` | 是否正在執行 Copyback 命令 | FALSE |
| `tLunSelected` | 目前選擇的 LUN 編號 | 0 |
| `tLastCmd` | 上一個命令的第一碼 | — |
| `tReturnState` | 狀態操作後返回的狀態 | — |
| `tbStatus78hReq` | 下次狀態操作是否為 78h | FALSE |

#### 7.1.1 Idle 狀態群

```
T_PowerOn ──→ T_PowerOnReady ──→ T_Idle
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                   T_Idle_WP_   T_Idle_RB_   T_Cmd_Decode
                   Transition   Transition       │
                                                ▼
                                         ┌──────────┐
                                         │ 命令解碼  │
                                         └─────┬────┘
                          ┌──────────┬──────────┼──────────┬──────────┐
                          ▼          ▼          ▼          ▼          ▼
                     T_RST_    T_RID_    T_RPP_    T_PP_    T_RD_
                     Execute   Execute   Execute   Execute  Execute
                          ▼          ▼          ▼          ▼          ▼
                     T_BE_    T_SF_    T_GF_    T_RS_    T_RSE_
                     Execute   Execute   Execute  Execute  Execute
                          ▼          ▼          ▼
                     T_VS_    T_ODTC_   T_RU_
                     Execute  Execute   Execute
```

**T_Cmd_Decode 命令分發**:
| 命令 | 前往狀態 | 條件 |
|------|---------|------|
| FFh (Reset) | `T_RST_Execute` | — |
| FCh (Sync Reset) | `T_RST_Execute_Sync` | — |
| FAh (Reset LUN) | `T_RST_Execute_LUN` | — |
| 90h (Read ID) | `T_RID_Execute` | — |
| ECh (Read Param Page) | `T_RPP_Execute` | — |
| EDh (Read Unique ID) | `T_RU_Execute` | — |
| 80h (Page Program) | `T_PP_Execute` | WP_n=1 |
| 60h (Block Erase) | `T_BE_Execute` | WP_n=1 |
| 00h (Read) | `T_RD_Execute` | — |
| EFh (Set Features) | `T_SF_Execute` | — |
| EEh (Get Features) | `T_GF_Execute` | — |
| 70h (Read Status) | `T_RS_Execute` | — |
| 78h (Read Status Enhanced) | `T_RSE_Execute` | — |
| E1h (Volume Select) | `T_VS_Execute` | — |
| E2h (ODT Configure) | `T_ODTC_Execute` | — |
| 80h/60h | `T_Idle` (拒絕) | WP_n=0 |

#### 7.1.2 Read 狀態群

```
T_RD_Execute ──→ T_RD_AddrWait ──→ T_RD_Addr ──→ T_RD_LUN_Execute
                                                          │
                                                    T_RD_LUN_Confirm
                                                          │
                                              ┌───────────┼───────────┐
                                              ▼           ▼           ▼
                                        T_RD_Cmd_Pass  (wait 30h)  (wait 31h/32h/35h)
                                              │
                                        ┌─────┴─────┐
                                        ▼           ▼
                                   T_Idle_Rd   T_RD_Copyback
```

#### 7.1.3 Program 狀態群

```
T_PP_Execute ──→ T_PP_AddrWait ──→ T_PP_Addr ──→ T_PP_LUN_Execute
                                                          │
                                                    T_PP_LUN_DataWait
                                                          │
                              ┌───────────┬───────────────┼───────────────┐
                              ▼           ▼               ▼               ▼
                        T_PP_LUN_   T_PP_Cmd_    T_PP_ColChg    T_PP_MplWait
                        DataPass    Pass
                              │           │
                              ▼           ▼
                        T_PP_LUN_   ┌──────┴──────┐
                        DataWait    ▼              ▼
                               T_Idle(10h/15h)  T_PP_MplWait(11h)
```

#### 7.1.4 Erase 狀態群

```
T_BE_Execute ──→ T_BE_Addr ──→ T_BE_LUN_Execute ──→ T_BE_LUN_Confirm
                                                              │
                                                        T_BE_Cmd_Pass
                                                              │
                                                   ┌──────────┴──────────┐
                                                   ▼                     ▼
                                             T_Idle (D0h)     T_BE_MplWait (D1h)
```

#### 7.1.5 Set/Get Features 狀態群

```
T_SF_Execute ──→ T_SF_Addr ──→ T_SF_WaitForParams ──→ T_SF_StoreParam
                                                              │
                                                    T_SF_Complete ──→ T_SF_UpdateStatus
                                                              │           │
                                                         (busy tITC)    T_Idle / T_Idle_Rd

T_GF_Execute ──→ T_GF_Addr ──→ T_GF_RetrieveParams ──→ T_GF_Ready ──→ T_Idle_Rd
```

#### 7.1.6 Reset 狀態群

```
T_RST_Execute ──→ T_RST_Perform ──→ T_RST_End ──→ T_Idle / T_Idle_Rd
     │                 │
     │            (FFh: SDR介面)
     │            (FCh: 同步Reset)
     ▼
T_RST_Execute_Sync
     │
     ▼
T_RST_Execute_LUN ──→ T_RST_LUN_Addr ──→ T_RST_LUN_Perform ──→ T_Idle
```

### 8.2 LUN 層級狀態機

LUN 狀態機描述 Target 內單一 LUN 的行為。關鍵變數：

| 變數 | 說明 | 初始值 |
|------|------|--------|
| `lunStatus[7:0]` | LUN 狀態暫存器 | 00h |
| `lunFail[x][1:0]` | 各 plane 的 FAIL/FAILC 位元 | 00b |
| `lunLastConfirm` | 最後確認命令週期 | FFh |
| `lunReturnState` | 狀態操作後返回狀態 | L_Idle |
| `lunStatusCmd` | 最後狀態命令 | 70h |
| `lunbInterleave` | 是否執行 multi-plane 操作 | FALSE |

#### 7.2.1 LUN Idle 狀態群

```
L_Idle ──→ L_Idle_TargetRequest
               │
     ┌─────────┼──────────┬──────────┐
     ▼         ▼          ▼          ▼
L_RST_    L_WP_     L_SR_     L_Status_
Execute   Update    Update    Execute
     │         │          │          │
     ▼         ▼          ▼          ▼
L_IDLE_   L_Idle_   L_Idle_   L_Idle_RdPp
Rd        Rd        VolAddr   (參數頁讀取)
```

#### 7.2.2 LUN Read 狀態群

```
L_RD_WaitForCmd ──→ (30h/35h) ──→ L_RD_ArrayRead ──→ L_RD_Xfer ──→ L_Idle_Rd
     │                  │                              │
     │             (35h = multi-plane)            (cache read)
     │                  │                              │
     ▼                  ▼                              ▼
L_RD_Cache_Xfer   L_RD_Mpl_Wait                  L_RD_Cache_Xfer
```

**tR (Read Busy Time)** 期間 LUN 在 `L_RD_ArrayRead` 狀態，`lunStatus[6]=0`（R/B_n busy）。

#### 7.2.3 LUN Program 狀態群

```
L_PP_Prog_Wait ──→ (完成) ──→ L_PP_Sts ──→ L_Idle / L_Idle_Rd
     │
     ├── (interleave) ──→ L_PP_Mpl_Sts ──→ L_PP_Mpl_Wait
     │                                              │
     └── (overlap complete) ──→ L_PP_Mpl_Overlap ──→ lunReturnState
```

**tPROG** 期間 LUN 在 Program 執行狀態。

#### 7.2.4 LUN Erase 狀態群

```
L_BE_Mpl_Wait ──→ (完成) ──→ L_BE_Sts ──→ L_Idle
     │
     ├── (overlap) ──→ L_BE_Mpl_Overlap ──→ lunReturnState
     └── (next cmd) ──→ L_BE_Mpl_NextCmd ──→ L_BE_Prog
```

**tBERS** 期間 LUN 在 Erase 執行狀態。

### 8.3 狀態機 Verilog 實作建議

```verilog
// ===== Target-level FSM: 3-segment coding =====
typedef enum logic [5:0] {
  T_IDLE, T_CMD_DECODE, T_RST_EXECUTE, T_RST_PERFORM, T_RST_END,
  T_RID_EXECUTE, T_RPP_EXECUTE, T_RU_EXECUTE,
  T_PP_EXECUTE, T_PP_ADDR_WAIT, T_PP_ADDR, T_PP_LUN_EXECUTE,
  T_PP_LUN_DATA_WAIT, T_PP_LUN_DATA_PASS, T_PP_CMD_PASS,
  T_PP_MPL_WAIT, T_PP_COLCHG, T_PP_ROWCHG,
  T_RD_EXECUTE, T_RD_ADDR_WAIT, T_RD_ADDR, T_RD_LUN_EXECUTE,
  T_RD_LUN_CONFIRM, T_RD_CMD_PASS, T_RD_COPYBACK,
  T_BE_EXECUTE, T_BE_ADDR, T_BE_LUN_EXECUTE,
  T_BE_LUN_CONFIRM, T_BE_CMD_PASS, T_BE_MPL_WAIT,
  T_SF_EXECUTE, T_SF_ADDR, T_SF_WAIT_PARAMS, T_SF_STORE_PARAM,
  T_SF_COMPLETE, T_SF_UPDATE_STATUS,
  T_GF_EXECUTE, T_GF_ADDR, T_GF_RETRIEVE, T_GF_READY,
  T_RS_EXECUTE, T_RS_PERFORM,
  T_RSE_EXECUTE, T_RSE_ADDR, T_RSE_SELECT,
  T_VS_EXECUTE, T_VS_COMPLETE,
  T_ODTC_EXECUTE, T_ODTC_ADDR, T_ODTC_WAIT_PARAM,
  T_ODTC_STORE_PARAM, T_ODTC_COMPLETE,
  T_IDLE_RD, T_IDLE_RD_STATUS, T_IDLE_RD_XFER,
  T_CR_EXECUTE, T_CR_ADDR, T_CR_WAIT_CMD, T_CR_RETURN,
  T_CRE_EXECUTE, T_CRE_COLADDR, T_CRE_ROWADDR_WAIT,
  T_CRE_ROWADDR, T_CRE_WAIT_CMD, T_CRE_RETURN
} target_state_t;
```

### 8.4 Multi-plane 操作流程（ONFI 5.0 §6）

多平面支援 Program/Read/Erase/Copyback 在同 LUN 不同 block 上執行。有兩種模式：
- **Concurrent**: 收集所有 plane 的命令/地址/資料後才開始陣列操作
- **Overlapped**: 每個 plane 立即開始，背景執行期間繼續收集下一 plane 的資料

#### 7.4.1 Multi-plane Page Program
```
CMD: 80h → ADDR(col+row) → DATA → CMD: 11h   ──  Plane A
CMD: 81h → ADDR(col+row) → DATA → CMD: 10h/15h ──  Plane B (最終確認)
```
- 80h (初始) 或 81h (後續)，視 parameter page 支援
- 11h 表示"暫停，等待更多"
- 10h (Program) 或 15h (Cache Program) 結束
- 各個 row address 的 plane bits 必須不同
- tPLPBSY (multi-plane program busy) 通常 << tPROG

#### 7.4.2 Multi-plane Read
```
CMD: 00h → ADDR(col+row) → CMD: 32h   ──  Plane A
CMD: 00h → ADDR(col+row) → CMD: 30h/31h ──  Plane B (最終確認)
```
- 32h = "暫停" (非最終 plane)
- 30h (Read) 或 31h (Read Cache) 結束
- 讀取資料前必須先發 Change Read Column Enhanced (06h → ADDR → E0h)
- tPLRBSY (multi-plane read busy) << tR
- 支援 Cache Sequential (最後用 31h) 和 Cache Random (每組兩筆資料)

#### 7.4.3 Multi-plane Block Erase
```
CMD: 60h → ADDR(row, plane A) → CMD: D1h   ──  Plane A (暫停)
CMD: 60h → ADDR(row, plane B) → CMD: D0h   ──  Plane B (執行)
```
- D1h = "暫停，等待更多"
- D0h = 開始執行
- JEDEC JTG 替代定義: 60h → ADDR → 60h → ADDR → D0h (無 D1h 命令)
- tPLEBSY << tBERS

#### 7.4.4 Multi-plane Copyback
```
  Read 階段:  00h → ADDR → 35h  (非多平面) 或
              00h → ADDR → 32h  (多平面讀取)
  Program 階段: 85h/81h → ADDR → 11h (Plane A)
               85h/81h → ADDR → 10h (Plane B)
```
- Read 階段的 plane addresses 必須與 Program 階段相同
- Destination 所有 page addresses 必須相同
- Source page addresses (多平面讀取時) 必須相同

#### 7.4.5 Multi-plane 狀態暫存器行為
| 位元 | WP_n | RDY | ARDY | VSP | CSP | VSP | FAILC | FAIL |
|:----:|:----:|:---:|:----:|:---:|:---:|:---:|:----:|:----:|
| 獨立? | N | SP | VSP | N | N | N | **Y** | **Y** |
- FAIL/FAILC 每個 plane address 獨立
- Read Status (70h) 回傳複合值 (OR)
- Read Status Enhanced (78h) 可取得特定 LUN/plane 的獨立值

---

## 9. PHY 層關鍵設計要點

### 9.1 各模式 PHY 需求

| 介面模式 | 時脈 | 信號類型 | DLL/PLL 需求 | DQS 處理 |
|---------|------|---------|-------------|---------|
| **SDR** | WE_n 當 clock | 單端 | 無 | 無 DQS |
| **NV-DDR** | CLK (獨立的) | 單端 (DQS) | 基本 PLL | 源同步 DQS |
| **NV-DDR2** | CLK | **差分**(DQS_t/c, RE_t/c) | PLL + DLL | DQS 對齊 |
| **NV-DDR3** | CLK | 差分 + **ZQ 校準** | PLL + DLL | DQS 訓練 (78ps 解析度) |
| **NV-LPDDR4** | CLK | 差分 + **DBI** + **LTT** | PLL + DLL | DFE 等化器 |
| **SCA / ONFI 6.0** | CA_CLK + CLK | 差分 + CA 匯流排 + **PI-LTT** | PLL + DLL + **FFE** | 多模式訓練、SCA CA 訓練 |

### 9.2 PHY 數位前端 (DFE) 關鍵功能

```
┌──────────────────────────────────────┐
│            PHY Digital Core          │
│                                      │
│  ┌─────────┐  ┌──────────────────┐  │
│  │ PLL/DLL  │  │ TX/RX Control   │  │
│  │ CLK Gen  │  │ ┌────────────┐  │  │
│  └────┬─────┘  │ │ DQS align  │  │  │
│       │        │ │ Delay line │  │  │
│  ┌────▼─────┐  │ └────────────┘  │  │
│  │ DIV/PH   │  │ ┌────────────┐  │  │
│  │ Shifter  │  │ │ DBI Gen/   │  │  │
│  └──────────┘  │ │ Check      │  │  │
│                │ └────────────┘  │  │
│  ┌──────────┐  │ ┌────────────┐  │  │
│  │ Training │  │ │ ODT/ZQ     │  │  │
│  │ FSM      │  │ │ Control    │  │  │
│  └──────────┘  │ └────────────┘  │  │
│                └──────────────────┘  │
└──────────────────────────────────────┘
```

### 9.3 訓練功能

| 訓練類型 | 支援版本 | 說明 |
|---------|---------|------|
| **ZQ Calibration** | NV-DDR2+ | 校準 ODT 電阻值（透過外部高精度電阻） |
| **Duty Cycle Correction (DCC)** | NV-DDR3+ (≥800MT/s) | 調整信號 duty cycle，補償高速傳輸路徑不對稱 |
| **Read DQ Calibration** | NV-DDR3+ | 確保讀取取樣點對齊眼圖中心 |
| **Write DQ Calibration** | NV-DDR3+ | 確保寫入取樣點對齊眼圖中心 |
| **VrefQ Calibration** | NV-LPDDR4+ | 校準參考電壓 |
| **DFE (Decision Feedback Equalizer)** | ONFI 5.1+ | 消除 post-symbol 干擾 |
| **SCA CA Bus Training** | **ONFI 5.2+** | CA 匯流排訓練 |
| **SCA Read/Write Training** | **ONFI 5.2+** | SCA 模式讀寫訓練 |
| **FFE (Feed-Forward Equalizer)** | **ONFI 6.0 / JESD230G** | 預先補償通道損失（TX 端） |
| **PI-LTT** (Power Isolated LTT) | **ONFI 6.0 / JESD230G** | 改進版 LTT，更低功耗 |

### 9.4 DFE (Decision Feedback Equalizer) 實現說明

DFE 是 ONFI 5.1+ 高速介面 (≥1600MT/s) 的關鍵技術，用於消除 post-symbol ISI：

```
DQ in → [Gain] → [Summer] → [Slicer (FF)] → 量化輸出 (0/1)
                 ↑           │
                 │      ┌────┴──── [TAP×1CK] → ×T1 ──┘
                 │      └──────────── [TAP×2CK] → ×T2 ──┘
                 │      └───────────────────── [TAP×3CK] → ×T3 ──┘
                 │      └────────────────────────────── [TAP×4CK] → ×T4 ──┘
                 └─── ← 加總回授項 (消除已決定符號的 ISI)
```

**數位設計要點**:
- **Tap 數量**: ONFI 5.1+ 至少需要 4 taps (T1~T4)
- **權重調整**: LMS 適應性演算法，訓練階段自動決定 tap weights
- **初始訓練**: 需要 known pattern → 誤差計算 → 權重更新 (類似 DDR5 DFE)
- **時序**: 每個 tap 延遲 1 UI，必須滿足 feedback timing closure
- **Slicer**: 以 flip-flop 實現，clock 為恢復的 DQS
- **Noise 優勢**: DFE 不會放大高頻雜訊（不同於 CTLE/FFE）

**注意**: DFE 有 error propagation 特性 — 若一個 slicer 判斷錯誤，會導致 burst errors 直到 pipeline 清空。

### 9.5 Per-bit DQ Deskew 訓練（高速模式關鍵技術）

ONFI 高速模式 (>1200MT/s) 要求每個 DQ bit 獨立延遲調整：

```
PHY Clock ──→ [Delay Line 0] ──→ DQ0 (per-bit phase adjust)
           ├─→ [Delay Line 1] ──→ DQ1
           ├─→ [Delay Line 2] ──→ DQ2
           ...
           └─→ [Delay Line 7] ──→ DQ7
```

**訓練演算法 (Patent CN118609619B)**:
1. 初始化所有 Delay_x = 0，執行 WRITE DQ TRAINING 指令
2. 對每個 BitLine_x 獨立尋找有效窗口下邊界 (Delay_x -= 1 until error)
3. 對每個 BitLine_x 獨立尋找有效窗口上邊界 (Delay_x += 1 until error)
4. 上下邊界中間點 = 最佳取樣點
5. 支援 Configurable Step Length (Step) 加速掃描
6. 支援 Configurable Repetition Count 過濾雜訊影響

**Write DQ Training 觸發方式**:
- TX side: CMD 63h + targeted address, read back with CMD 64h
- RX side: CMD 76h + LUN address + Data pattern (3 address cycles)

**Read DQ Training 觸發方式**:
- CMD 62h + targeted address
- 設備回傳 known pattern → host 調整 per-bit delay

### 9.6 FFE (Feed-Forward Equalizer) — ONFI 6.0 新增

FFE 在 TX 端預先補償通道高頻損失:

```
FFE Tap 結構 (TX FIR Filter):
Data in ─→ [TAP0: ×C0] ─→ (+) ─→ Output to driver
          ─→ [TAP1: ×C1] ─→ (+) ↑
          ─→ [TAP2: ×C2] ─→ (+) ↑
          ...
```
- C0 為主游標，C1~Cn 為 post-cursor taps
- Tap weights 透過 training 決定
- 不會放大雜訊 (不同於 RX CTLE)

### 9.7 DBI (Data Bus Inversion)

NV-LPDDR4 新增的選配功能，透過控制信號方向限制電流消耗：
- 當 DQ 匯流排上多數位元為 0 時，反轉資料並置位 DBI 信號
- 可減少 simultaneous switching noise (SSN) 與功耗

### 9.8 DLL/PLL 頻率設計對照表

PHY 的 PLL/DLL 必須為各時序模式產生正確的取樣時脈。下表從時序模式參數推導：

| 介面 | 模式 | tDSC/tRC (min) | DQS 頻率 | DLL 需求 | PLL 倍頻 (參考 50MHz ref) |
|:----:|:----:|:--------------:|:--------:|:--------:|:------------------------:|
| SDR | 0~5 | 100~20 ns | — | 無 | 直通 |
| NV-DDR | 0~5 | 50~10 ns | 20~100 MHz | 基本 delay line | ×1 (50MHz→50/100MHz) |
| NV-DDR2 | 0~7 | 30~5 ns | 33~200 MHz | 基本 delay line | ×1~×4 |
| NV-DDR3 | 8~11 | 3.75~1.875 ns | 267~533 MHz | 中精度 (≥8 phase) | ×5~×11 |
| NV-DDR3 | 12~15 | 1.667~1.25 ns | 600~800 MHz | 高精度, DCC 必須 | ×12~×16 |
| NV-DDR3 | 16~19 | 1.111~0.833 ns | 900~1200 MHz | 極高精度, DCC+訓練 | ×18~×24 |
| NV-LPDDR4 | 8~11 | 3.75~1.875 ns | 267~533 MHz | 同 NV-DDR3 8-11 | ×5~×11 |
| NV-LPDDR4 | 12~15 | 1.667~1.25 ns | 600~800 MHz | 同 NV-DDR3 12-15 | ×12~×16 |
| NV-LPDDR4 | 16~19 | 1.111~0.833 ns | 900~1200 MHz | 同 NV-DDR3 16-19 | ×18~×24 |
| ONFI 6.0 | — | 0.625~0.417 ns | **1600~2400 MHz** | **最高精度, DFE+FFE** | **×32~×48** |

**PLL/DLL 設計關鍵參數**:
- **解析度**: Arasan 架構 78ps（約 1/16 UI @ 800MT/s），NV-DDR3 Mode 19 需 ~42ps 解析度
- **相位數**: >=8-phase 建議（含 DQS 對齊 + per-bit deskew）
- **鎖定時間**: ≤ 5µs（上電後需在 tVCC 內鎖定）
- **工作頻寬**: 從 50 MHz (SDR TM0) 到 2400 MHz (ONFI 6.0)，建議使用**除頻回授 + 多模 VCO**
- **DCC**: ≥800MT/s 必須使用，透過 FA 20h 或 CMD 18h 觸發校正
- **可程式化**: 建議支援至少 3 段 VCO 選頻 + 可編程除率

> **注意**: 單一 PLL 鎖定全頻段不切實際，建議設計 2~3 組 VCO：
> - VCO1: 100~400 MHz (SDR/NV-DDR/NV-DDR2)
> - VCO2: 400~1200 MHz (NV-DDR2/3 中高速)
> - VCO3: 1200~2400+ MHz (NV-LPDDR4/ONFI 6.0)

---

## 10. 初始化與訓練序列

### 10.1 Power-on 初始化流程

```
Power-on
  │
  ├─ 1. 等待電源穩定 (tVCC)
  ├─ 2. 等待設備 Ready (R/B_n = 1)
  ├─ 3. 發送 Reset 命令 (FFh)
  ├─ 4. 等待 tRST（約 5μs~500μs）
  ├─ 5. 讀取 Parameter Page (ECh) → 了解設備能力
  │      • 支援的介面模式（SDR/NV-DDR/NV-DDR2/3/NV-LPDDR4/SCA）
  │      • 支援速度等級、頁面大小、區塊大小
  │      • ODT 設定值、ZQ 校準資訊
  │      • SCA 協議支援能力（ONFI 5.2）
  ├─ 6. Read ID (90h) → 獲取製造商/設備 ID
  ├─ 7. Set Features (EFh) → 設定操作模式
  ├─ 8. 執行 SCA 初始化（若啟用 SCA 模式）
  │      • 啟用 SCA 協議（透過 Set Features）
  │      • SCA CA Bus Training
  │      • SCA Read/Write Training
  ├─ 9. 掃描 Bad Block → 建立 Bad Block Table
  ├─ 10. 通知 Host 控制器 Ready
  └─ 11. 等待操作請求
```

### 10.2 Parameter Page 結構（完整版，ONFI 5.0 §5.7）

Read Parameter Page 命令 (ECh) 回傳 512-byte 結構，分 4 個區塊：

**Block 1 修訂與特性 (Byte 0–31)**:
| Byte | O/M | 欄位 | 說明 | 設計用途 |
|:----:|:---:|------|------|---------|
| 0–3 | M | 簽名 | 4Fh 4Eh 46h 49h = "ONFI" | 驗證相容性 |
| 4–5 | M | 修訂號 | [12]=5.0, [11]=4.2, [10]=4.1, [9]=4.0, [8]=3.2, [7]=3.1, [6]=3.0, [5]=2.3, [4]=2.2, [3]=2.1, [2]=2.0, [1]=1.0 | 決定支援 ONFI 版本 |
| 6–7 | M | 支援特性 | [0]=16bit bus, [5]=NV-DDR, [8]=NV-DDR2, [13]=NV-DDR3, [14]=ZQ cal, [15]=Package Elec | PHY 模式選擇 |
| 8–9 | O | 選配命令支援 | [0]=Cache Prog, [1]=Cache Read, [2]=Get/Set Feat, [3]=RSE, [4]=Copyback, [10]=Vol Sel, [11]=ODT Config, [12]=LUN Get/Set, [13]=ZQ Long/Short | 可用命令 |
| 10 | O | JTG 主命令支援 | [0]=Random Data Out | — |
| 11 | O | 訓練命令支援 | [0]=Expl DCC, [1]=Impl DCC, [2]=Read DQ train, [3]=Write DQ TX, [4]=Write DQ RX | 訓練能力 |
| 12–13 | O | Ext. Param Page 長度 | 16-byte 為單位 | — |

**Block 2 製造商資訊 (Byte 32–79)**:
| Byte | O/M | 欄位 | 說明 |
|:----:|:---:|------|------|
| 32–43 | M | 製造商 | 12 ASCII |
| 44–63 | M | 型號 | 20 ASCII |
| 64 | M | JEDEC ID | — |
| 65–66 | O | 日期碼 | 年 + 週 |

**Block 3 記憶體組織 (Byte 80–127)**:
| Byte | O/M | 欄位 | 說明 | 設計用途 |
|:----:|:---:|------|------|---------|
| 80–83 | M | 每頁資料 bytes | 2 的冪次 | address mapping |
| 84–85 | M | 備用區 bytes | 無限制 | — |
| 92–95 | M | 每塊頁數 | 32 的倍數 | Block/Page 計算 |
| 96–99 | M | 每 LUN 塊數 | 無限制 | LUN 容量 |
| 100 | M | LUN 數量 | 0 起編號 | 多 LUN 排程 |
| 101 | M | 地址週期數 | [7:4]=Col, [3:0]=Row | 地址發送 |
| 102 | M | bits/cell | SLC=1, MLC=2, TLC=3, QLC=4, FFh=未指定 | — |
| 103–104 | M | 最大壞塊數 | 每 LUN | 保留管理 |
| 105–106 | M | Block 耐用度 | value × 10^mult | wear-leveling |
| 112 | M | ECC 位元數 | 每 512-byte, FFh=使用 Ext ECC Info | ECC 引擎 |
| 113 | M | 平面地址 bits | [3:0] | Multi-plane |
| 114 | O | Multi-plane 屬性 | [0]=overlap/concurrent, [1]=無 block 限制, [2]=cache prog, [4]=read cache, [5]=XNOR block 限制 | 多平面 FSM |
| 116–117 | O | NV-DDR3 mode | [0]=Mode 19 | 速度 |
| 118–121 | O | NV-LPDDR4 mode | [16]=Mode 19 ... [0]=Mode 0-3 | 速度 |

**Block 4 電氣參數 (Byte 128–255)**:
| Byte | O/M | 欄位 | 說明 | 設計用途 |
|:----:|:---:|------|------|---------|
| 129–130 | M | SDR 時序模式 | [5]=Mode 5 ... [0]=Mode 0 (必=1) | SDR 速度 |
| 141 | O | NV-DDR 時序模式 | [5]=Mode 5 ... [0]=Mode 0 | — |
| 142 | O | NV-DDR2 時序模式 | [7]=Mode 7 ... [0]=Mode 0 | — |
| 143 | O | NV-DDR/NV-DDR2 特性 | [0]=tCAD slow/fast, [1]=典型電容, [2]=CLK stop, [3]=Vpp 需要序列 | PHY 配置 |
| 151 | M | 驅動強度 | [4]=35/37.5/50Ω, [3]=37.5/50Ω, [2]=18Ω, [1]=25Ω, [0]=35/50Ω, 預設 35Ω | IO Pad |
| 158 | O | NV-DDR2/3 特性 | [0]=自終止 ODT, [1]=矩陣終止 ODT, [2]=30Ω ODT, [3]=RE 差動, [4]=DQS 差動, [5]=需外部 VREFQ (≥200MT/s) | ODT |
| 159 | M | Warmup 週期 | [7:4]=輸入, [3:0]=輸出 | 訓練長度 |
| 160–161 | O | NV-DDR3 mode(續) | [15]=Mode 18 ... [0]=Mode 0-3 | 高速 |
| 162 | O | NV-DDR2 mode(續) | [2]=Mode 10, [1]=Mode 9, [0]=Mode 8 | 高速 |
| 254–255 | M | CRC-16 | poly=8005h, init=4F4Eh, 涵蓋 Byte 0-253 | 完整性驗證 |
| 256–511 | M | 冗餘頁 1 | Byte 0-255 副本 | 容錯 |
| 512–767 | M | 冗餘頁 2 | Byte 0-255 副本 | 容錯 |

**Extended Parameter Page**: 選配，簽名 "EPPS"，以 16-byte section 組織。支援 Extended ECC Info。

### 10.3 Status Register 位元定義（ONFI 5.0 §5.13）

所有 ONFI NAND 統一格式：
```
Bit:    7         6         5   4   3   2   1         0
      ┌─────────┬─────────┬───┬───┬───┬───┬─────────┬─────────┐
      │  WP_n   │   RDY   │ARP│VSP│VSP│VSP│  FAILC  │  FAIL   │
      └─────────┴─────────┴───┴───┴───┴───┴─────────┴─────────┘
```
| Bit | 名稱 | 說明 | 使用時機 |
|:---:|------|------|---------|
| 0 | FAIL | 1=命令失敗 (Prog/Erase/ZQ) | 操作完成後讀取 |
| 1 | FAILC | 1=前一個命令失敗 (Cache 專用) | Cache Program |
| 2–5 | VSP | Vendor 自定義 | — |
| 6 | RDY | 1=空閒。R/B_n = AND of SR[6] | Busy 檢測 |
| 7 | WP_n | 反映 WP_n 腳位 | 保護檢查 |

**多平面操作**: FAIL(bit0) 和 FAILC(bit1) 每個 plane 獨立。Read Status Enhanced (78h) 可指定 LUN/plane。

---

### 10.4 DCC (Duty Cycle Correction) 訓練 FSM

DCC 訓練在 ≥800MT/s 必需，用於校正 RE_t/c 及 DQS_t/c 的 duty cycle 失真：

```
DCC Training FSM (可透過 Explicit 或 Implicit 模式觸發):

  [IDLE] ──(Set Feature FA 20h 啟用 DCC)──→ [CONFIG]
     │                                            │
     │  Explicit (DCCE_EN=1): CMD FEh 觸發         │
     │  Implicit (DCCI_EN=1): 正常操作自動訓練     │
     │                                            ▼
     │                                   [WAIT_ATRAIN]  (tATRAIN = 1~5 µs)
     │                                            │
     │                                   ┌────────┴────────┐
     │                                   ▼                 ▼
     │                              [ADJUST_DCC]    [MONITOR_DCC]
     │                                   │                 │
     │                                    └──────┬────────┘
     │                                           ▼
     │                                   [MEASURE_DUTY]
     │                                    • 取樣 RE_t/c 或 DQS_t/c
     │                                    • 計算 high/low 脈衝寬度
     │                                           │
     │                                    duty 在 45%~55%?
     │                                   ┌───┴───┐
     │                                   │       │
     │                                 Yes      No
     │                                   │       │
     │                                   ▼       ▼
     │                              [COMPLETE] [ADJUST]
     │                                   │       │
     │                                   └───────┘
     │                                           │
     │                                   調整 DCC code
     │                                   (增加/減少 delay cell)
     │                                           │
     │                                   WAIT tATRAIN
     │                                           │
     └─────────────────────────────────────────────┘
```

**實作參數**:
| 參數 | 說明 | 典型值 |
|------|------|--------|
| tATRAIN | DCC 訓練時間 | 1~5 µs (NAND 內部) |
| DCC code 解析度 | 每步調整量 | ~1~5 ps (取決於製程) |
| DCC code 範圍 | 可校正量 | ±15% UI |
| 感測方法 | high pulse vs low pulse | 需 2 組測量路徑 |
| 訓練模式 | Explicit (CMD 18h/FEh) 或 Implicit (自動) | 可配置 |

**DCC 狀態機 Verilog 控制信號**:
```verilog
// FA 20h P1 bit 控制
assign dcc_explicit_en = feat_20h_p1[0];   // DCCE_EN
assign dcc_implicit_en = feat_20h_p1[1];   // DCCI_EN
assign dcc_factory    = feat_20h_p1[2];   // DCC_FACTORY

// DCC code 更新
// 可類比控制 (DCC_CODE[5:0]) 或數位控制
// 每次調整後需等待 tATRAIN 再測量
```

### 10.5 Read DQ Training 詳細 FSM

Read DQ Training 讓 Host 調整自己的內部 VrefQ 並做 per-bit DQ-DQS de-skew：

```
Read DQ Training FSM (每個 LUN 獨立執行):

  [IDLE]
     │
     ▼
  [CONFIG_PATTERN]        // 配置訓練模式長度 (FA 20h P3)
     │                    // 16 Bytes 或 32 Bytes pattern
     ▼
  [ODT_ENABLE]            // 確保 ODT ENABLE 命令已發
     │
     ▼
  [SEND_CMD_READ_TRAIN]   // CMD 62h + 目標位址 (LUN)
     │
     ▼
  [WAIT_tWHRT]            // tWHRT = address cycle to data output for training
     │                    // (General Timing param, ~80~120ns)
     ▼
  [RECEIVE_PATTERN]       // NAND 回傳 known pattern (16/32 Bytes)
     │                    // Host 取樣比對
     ▼
  [COMPARE_EYE]           // 對每個 DQ bit 調整取樣延遲
     │                    // ┌── 對 DQ[0] 掃描 delay 範圍 ──┐
     │                    // │  For delay = 0 to MAX:        │
     │                    │   發送 Read Training 命令          │
     │                    │   檢查比對 pattern 正確率          │
     │                    │   記錄 pass/fail 邊界              │
     │                    │ ← 最佳點 = (左邊界 + 右邊界)/2    │
     │                    └────────────────────────────────┘
     │
     ▼
  [ADJUST_VREFQ]          // 調整 Host 內部 VrefQ (6-bit code)
     │                    // 重新發送 Read Training 命令
     │                    // 掃描 VrefQ 找出最佳眼圖高度
     ▼
  [VERIFY]                // 使用最佳 per-bit delay + VrefQ
     │                    // 若 PASS → 完成
     │                    // 若 FAIL → 回到 ADJUST_VREFQ (iteration)
     ▼
  [COMPLETE]              // Read Training 完成
     │
     ▼
  [NEXT_LUN / IDLE]
```

**命令序列 (Conventional Protocol)**:
```
Host→NAND:  CMD 62h
Host→NAND:  ADDR (5 cycles: row + column)    // 目標 LUN
Host→NAND:  CMD E0h (data output start)
NAND→Host:  tWHRT wait (~80ns)
NAND→Host:  Training Pattern Data (16 or 32 bytes)
Host:       比對 pattern，調整 per-bit delay + VrefQ
(重複直到最佳收斂)
```

**Read DQ Training 命令集 (ONFI 5.0)**:
| 命令 | 代碼 | 說明 |
|------|:----:|------|
| Read DQ Training | **62h** | 開始 Read DQ Training 序列 |
| Write DQ Training Tx | **63h** | 主機發送 training pattern |
| Read DQ Training Status | **64h** | 讀取 training 結果 |
| Write DQ Training Rx | **76h** | 3 地址週期定義 data pattern |
| Change Read Column | 05h→E0h | 改變讀取欄位（讀取不同 pattern 版本） |

### 10.6 Write DQ Training 詳細 FSM (Tx 與 Rx)

Write DQ Training 有兩種模式：

**Write DQ Training Tx (傳送端訓練)**:
```
  [IDLE]
     │
     ▼
  [ODT_DISABLE]           // 發送 ODT DISABLE 命令
     │                    // (Set Feature 前必須)
     ▼
  [SET_VREFQ_INTERNAL]    // Set Feature by LUN (D5h) → FA 23h
     │                    // 設定 NAND 內部 VrefQ 初始值
     ▼
  [ODT_ENABLE]            // 發送 ODT ENABLE 命令
     │
     ▼
  [SEND_TRAIN_PATTERN]    // CMD 63h + ADDR(LUN) + Data pattern
     │                    // Host 透過 DQ 發送 known pattern
     ▼
  [WAIT_tWTRN]            // tWTRN ≤ 200µs (NAND 內部 training)
     │
     ▼
  [READ_STATUS]           // CMD 70h → 檢查 SR[0] (FAIL)
     │
     ├── PASS ──→ [CHECK_MARGIN]
     │                     • 若有餘裕 → COMPLETE
     │                     • 若需優化 → 調整 per-bit write delay
     │                                 調整 VrefQ → 回到 ODT_DISABLE
     │
     └── FAIL ──→ [ADJUST_VREFQ] → ODT_DISABLE → 重試
                        │
                   (iteration max)
                        │
                        ▼
                   [TRAINING_FAILED]
```

**Write DQ Training Rx (接收端訓練，可選)**:
```
  [IDLE]
     │
     ▼
  [SEND_CMD_WRITE_RX]     // CMD 76h + ADDR(LUN) + ADDR(pattern)
     │                    // 3 個地址週期定義 data pattern 參數
     ▼
  [RECEIVE_PATTERN]       // NAND 發送已知 pattern 通過 DQ 匯流排
     │
     ▼
  [NAND_INTERNAL_TRAIN]   // NAND 調整內部 VrefQ + per-bit deskew
     │
     ▼
  [READ_STATUS]           // CMD 70h → 檢查結果
     │
     ├── PASS → [COMPLETE]  // 可跳過 Write Training Tx
     └── FAIL → [WRITE_TRAINING_TX]  // 需回落至 Tx 訓練
```

### 10.7 NV-DDR3/NV-LPDDR4 完整初始化訓練序列

根據 ONFI 5.0 Figure 4-5，初始化訓練流程如下：

```
Power-up & Configure Interface
         │
    ┌────▼────┐
    │ 低於     │         ┌─────────────────┐
    │ 800MT/s?│──Yes──→ │ 不需高速訓練     │
    └────┬────┘         │ (僅 Set Features)│
         │ No            └─────────────────┘
         ▼
 ┌──────────────┐
 │ 主機端        │
 │ ZQ Calibration│ (ECMD ECh/E8h, tZQCL=1µs, tZQCS=0.4µs)
 └──────┬───────┘
         ▼
 ┌──────────────┐
 │ NAND 端       │
 │ ZQ Calibration│ (ECMD ECh/E8h)
 └──────┬───────┘
         ▼
 ┌──────────────┐
 │ NAND DCC     │
 │ Training     │ (FA 20h 啟用, 或 CMD 18h/FEh)
 └──────┬───────┘
         ▼
 ┌──────────────┐
 │ Read DQ      │
 │ Training     │ (CMD 62h, per-bit deskew + VrefQ)
 └──────┬───────┘
         ▼
 ┌──────────────┐
 │ Write DQ     │
 │ Training Rx  │ (CMD 76h, 可選)
 │ (optional)   │
 └──────┬───────┘
         │ PASS? ──Yes──→ [OPERATION]
         │ No
         ▼
 ┌──────────────┐
 │ Write DQ     │
 │ Training Tx  │ (CMD 63h + per-bit deskew + VrefQ)
 └──────┬───────┘
         │
         ▼
 ┌──────────────┐
 │ 開始正常操作  │
 └──────────────┘
```

### 10.8 ZQ Calibration 時序參數

| 命令 | 代碼 | 說明 | tZQCAL (max) | 備註 |
|:----:|:----:|------|:-----------:|:----:|
| ZQCL (Long) | ECh | 完整校準 | **1 µs** | 初始化時執行 |
| ZQCS (Short) | E8h | 快速校準 | **0.4 µs** | 正常工作時定期更新 |

**注意**: 超過 8 個 LUN 共用一個 ZQ 電阻時，tZQCL / tZQCS 可能需增加。

**ZQ 校準狀態機**:
```
ZQ_CAL_IDLE
     │
     ▼
ZQ_START           // 發送 ZQCL/ECh 或 ZQCS/E8h
     │
     ▼
ZQ_BUSY_WAIT      // 等待 R/B_n = 0, tZQCAL 計時 (long=1µs, short=0.4µs)
     │
     ▼
ZQ_UPDATE_CODE    // 更新 PHY 的 pull-up/pull-down 驅動強度碼
     │
     ▼
ZQ_UPDATE_ODT     // 更新 ODT 終端電阻碼 (Rtt)
     │
     ▼
ZQ_COMPLETE       // R/B_n = 1, 完成
```

### 10.9 Warmup Cycle 實作細節

Warmup cycles 在 ≥800MT/s 時啟用，提供資料匯流排預充電時間：

| 配置 | 預設值 | 範圍 | 設定位置 |
|:----:|:------:|:----:|---------|
| 輸出 warmup (Read) | 2 cycles | 0~15 | FA 02h P3[7:4] |
| 輸入 warmup (Write) | 2 cycles | 0~15 | FA 02h P3[3:0] |

**操作規則**:
1. **Read warmup**: RE_t/c 觸發後，前 N 個 DQS 週期不攜帶資料
   - 第 N+1 個 DQS 正緣開始輸出第一個資料位元組
2. **Write warmup**: DQS 觸發後，前 N 個 DQS 週期不攜帶資料
   - 第 N+1 個 DQS 正緣開始取樣第一個輸入位元組
3. 若暫停後重啟資料傳輸（未退出 burst），不需重新發送 warmup
4. 若退出後重啟（ALE/CLE/CE_n 從 low→high），需重新發送 warmup
5. 適用於所有命令類型，包括 SDR 命令

**Verilog 實現**:
```verilog
// PHY 控制
reg [3:0] warmup_cnt_out;  // FA 02h P3[7:4]
reg [3:0] warmup_cnt_in;   // FA 02h P3[3:0]

// Read burst: 前 warmup_cnt_out 個 DQS 週期為 warmup
// Write burst: 前 warmup_cnt_in 個 DQS 週期為 warmup

// Data valid 信號 (給 Controller)
wire read_data_valid = (read_byte_count >= warmup_cnt_out * 2);
wire write_data_valid = (write_byte_count >= warmup_cnt_in * 2);
// *2 因為 DDR 每個週期 2 bytes
```

---

## 11. 時序模式與速度等級

### 11.1 各介面時序模式總覽

| 介面 | 時序模式 | 最大頻率 | 最大資料率 | 電壓 |
|------|---------|---------|-----------|------|
| SDR | 0~5 | 50 MHz | 50 MT/s | 1.8V/3.3V |
| NV-DDR | 0~5 | 100 MHz (DDR) | 200 MT/s | 1.8V |
| NV-DDR2 | 0~5 | 266 MHz (DDR) | 533 MT/s | 1.8V |
| NV-DDR3 | 0~19 | **1200 MHz** (DDR) | **2400 MT/s** | 1.2V/1.8V |
| NV-LPDDR4 (ONFI 5.x) | 0~19 | **1800 MHz** (DDR) | **3600 MT/s** | 1.2V |
| **ONFI 6.0 / JESD230G** | **0~n** | **2400 MHz** (DDR) | **4800 MT/s** | **1.2V** |

### 11.2 SDR 時序參數（ONFI 5.0 Table 4-70, 4-71）

| 參數 | Mode 0 (100ns) | Mode 1 (50ns) | Mode 2 (35ns) | Mode 3 (30ns) | Mode 4 (25ns) | Mode 5 (20ns) | 單位 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:----:|
| **tRC** min | 100 | 50 | 35 | 30 | 25 | 20 | ns |
| **tWC** min | 100 | 45 | 35 | 30 | 25 | 20 | ns |
| **tRP** min | 50 | 25 | 17 | 15 | 12 | 10 | ns |
| **tWP** min | 50 | 25 | 17 | 15 | 12 | 10 | ns |
| **tREA** max | 40 | 30 | 25 | 20 | 20 | 16 | ns |
| **tCEA** max | 100 | 45 | 30 | 25 | 25 | 25 | ns |
| **tDS** min | 40 | 20 | 15 | 10 | 10 | 7 | ns |
| **tDH** min | 20 | 10 | 5 | 5 | 5 | 5 | ns |
| **tALS** min | 50 | 25 | 15 | 10 | 10 | 10 | ns |
| **tALH** min | 20 | 10 | 10 | 5 | 5 | 5 | ns |
| **tCLS** min | 50 | 25 | 15 | 10 | 10 | 10 | ns |
| **tCLH** min | 20 | 10 | 10 | 5 | 5 | 5 | ns |
| **tCS** min | 70 | 35 | 25 | 25 | 20 | 15 | ns |
| **tCH** min | 20 | 10 | 10 | 5 | 5 | 5 | ns |
| **tWH** min | 30 | 15 | 15 | 10 | 10 | 7 | ns |
| **tREH** min | 30 | 15 | 15 | 10 | 10 | 7 | ns |
| **tRHW** min | 200 | 100 | 100 | 100 | 100 | 100 | ns |
| **tWHR** min | 120 | 80 | 80 | 80 | 80 | 80 | ns |
| **tIR** min | 10 | 0 | 0 | 0 | 0 | 0 | ns |
| **tAR** min | 25 | 10 | 10 | 10 | 10 | 10 | ns |
| **tCLR** min | 20 | 10 | 10 | 10 | 10 | 10 | ns |
| **tRR** min | 40 | 20 | 20 | 20 | 20 | 20 | ns |
| **tRST** max | 5000 | 500 | 500 | 500 | 500 | 500 | µs |
| **tFEAT** max | 1 | 1 | 1 | 1 | 1 | 1 | µs |
| **tITC** max | 1 | 1 | 1 | 1 | 1 | 1 | µs |
| **tWB** max | 200 | 100 | 100 | 100 | 100 | 100 | ns |
| **tADL** min | 400 | 400 | 400 | 400 | 400 | 400 | ns |
| **tCR2** min | 100 | 100 | 100 | 100 | 100 | 100 | ns |

### 11.3 NV-DDR 時序參數（ONFI 5.0 Table 4-72）

| 參數 | Mode 0 (50ns) | Mode 1 (30ns) | Mode 2 (20ns) | Mode 3 (15ns) | Mode 4 (12ns) | Mode 5 (10ns) | 單位 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:----:|
| **tCK** min | 50 | 30 | 20 | 15 | 12 | 10 | ns |
| **tAC** min/max | 3/25 | 3/25 | 3/25 | 3/25 | 3/25 | 3/25 | ns |
| **tDQSCK** min/max | 3/25 | 3/25 | 3/25 | 3/25 | 3/25 | 3/25 | ns |
| **tDQSD** min/max | 0/18 | 0/18 | 0/18 | 0/18 | 0/18 | 0/18 | ns |
| **tDQSQ** max | 5 | 2.5 | 1.7 | 1.3 | 1.0 | 0.85 | ns |
| **tQHS** max | 6 | 3 | 2 | 1.5 | 1.2 | 1.0 | ns |
| **tDS** min | 5 | 3 | 2 | 1.5 | 1.1 | 0.9 | ns |
| **tDH** min | 5 | 2.5 | 1.7 | 1.3 | 1.1 | 0.9 | ns |
| **tDQSS** min/max | 0.75/1.25 | 0.75/1.25 | 0.75/1.25 | 0.75/1.25 | 0.75/1.25 | 0.75/1.25 | tCK |
| **tDQSH** min/max | 0.4/0.6 | 0.4/0.6 | 0.4/0.6 | 0.4/0.6 | 0.4/0.6 | 0.4/0.6 | tCK/tDSC |
| **tDQSL** min/max | 0.4/0.6 | 0.4/0.6 | 0.4/0.6 | 0.4/0.6 | 0.4/0.6 | 0.4/0.6 | tCK/tDSC |
| **tDSC** min | 50 | 30 | 20 | 15 | 12 | 10 | ns |
| **tCAH** min | 10 | 5 | 4 | 3 | 2.5 | 2 | ns |
| **tCAS** min | 10 | 5 | 4 | 3 | 2.5 | 2 | ns |
| **tWPRE** min | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | tCK |
| **tWPST** min | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | tCK |
| **tRPRE** min | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | tCK |
| **tRPST** min | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | tCK |

### 11.4 NV-DDR2 / NV-DDR3 時序參數（ONFI 5.0 Table 4-73 ~ 4-76）

**Command & Address 常數參數（所有模式共用）**:

| 參數 | Min | Max | 單位 |
|------|:---:|:---:|:----:|
| tADL | 400 | — | ns |
| tAR | 10 | — | ns |
| tCAH | 5 | — | ns |
| tCAS | 5 | — | ns |
| tCALH | 5 | — | ns |
| tCALS | 15 | — | ns |
| tCEH | 20 | — | ns |
| tCH | 5 | — | ns |
| tCS | 20 | — | ns |
| tCS1 | 30 | — | ns |
| tCS2 | 40 | — | ns |
| tCHZ | — | 30 | ns |
| tCLHZ | — | 30 | ns |
| tRHW | 100 | — | ns |
| tWC | 25 | — | ns |
| tWH | 11 | — | ns |
| tWP | 11 | — | ns |
| tWHR | 80 | — | ns |
| tWTRN | — | 200 | µs |
| tFEAT | — | 1 | µs |
| tITC | — | 1 | µs |
| tRST | — | 18/30/500 | µs |
| tWB | — | 100 | ns |

**Data Input 參數（模式 0-3）**:

| 參數 | Mode 0 (30ns) | Mode 1 (25ns) | Mode 2 (15ns) | Mode 3 (12ns) | 單位 |
|------|:---:|:---:|:---:|:---:|:----:|
| tDSC(avg) min | 30 | 25 | 15 | 12 | ns |
| tDS(no training) min | 4 | 3.3 | 2.0 | 1.1 | ns |
| tDH(no training) min | 4 | 3.3 | 2.0 | 1.1 | ns |
| tDQSH min | 0.45 | 0.45 | 0.45 | 0.45 | tDSC(avg) |
| tDQSL min | 0.45 | 0.45 | 0.45 | 0.45 | tDSC(avg) |
| tDIPW min | 0.31 | 0.31 | 0.31 | 0.31 | tDSC(avg) |

**Data Input 參數（模式 4-7）**:

| 參數 | Mode 4 (10ns) | Mode 5 (7.5ns) | Mode 6 (6ns) | Mode 7 (5ns) | 單位 |
|------|:---:|:---:|:---:|:---:|:----:|
| tDSC(avg) min | 10 | 7.5 | 6 | 5 | ns |
| tDS_tight(no training) min | 0.7 | 0.5 | 0.4 | 0.35 | ns |
| tDH_tight(no training) min | 0.7 | 0.5 | 0.4 | 0.35 | ns |
| tDS_relaxed min | 0.9 | 0.75 | 0.55 | 0.40 | ns |
| tDH_relaxed min | 0.9 | 0.75 | 0.55 | 0.40 | ns |
| tDS+tDH(with training) | — | — | — | — | ns |

**Data Input 參數（模式 8-11）**:

| 參數 | Mode 8 (3.75ns) | Mode 9 (3ns) | Mode 10 (2.5ns) | Mode 11 (1.875ns) | 單位 |
|------|:---:|:---:|:---:|:---:|:----:|
| tDSC(avg) min | 3.75 | 3 | 2.5 | 1.875 | ns |
| tDS_tight(no training) min | 0.30 | 0.24 | 0.20 | 0.190 | ns |
| tDH_tight(no training) min | 0.30 | 0.24 | 0.20 | 0.190 | ns |
| tDS+tDH(with training) | — | — | — | 0.300 | ns |
| tDQS2DQ(training) min/max | — | — | — | -0.200/0.200 | ns |
| tDQ2DQ(training) max | — | — | — | 0.100 | ns |

**Data Input 參數（模式 12-15, NV-DDR3）**:

| 參數 | Mode 12 (1.667ns) | Mode 13 (1.5ns) | Mode 14 (1.364ns) | Mode 15 (1.25ns) | 單位 |
|------|:---:|:---:|:---:|:---:|:----:|
| 頻率 | 600 MHz | ~667 MHz | ~733 MHz | 800 MHz | |
| tDSC(avg) min | 1.667 | 1.5 | 1.364 | 1.25 | ns |
| tDS_tight(no training) | 0.175 | — | — | — | ns |
| tDS+tDH(with training) | 0.266 | 0.266 | 0.266 | 0.266 | ns |
| tDQS2DQ(training) min/max | -0.200/0.200 | -0.200/0.200 | -0.200/0.200 | -0.200/0.200 | ns |
| tDQ2DQ(training) max | 0.100 | 0.100 | 0.100 | 0.100 | ns |
| tDQSH min | 0.45 | 0.448 | 0.445 | 0.444 | tDSC(avg) |

**Data Input 參數（模式 16-19, NV-DDR3）**:

| 參數 | Mode 16 (1.111ns) | Mode 17 (1ns) | Mode 18 (0.909ns) | Mode 19 (0.833ns) | 單位 |
|------|:---:|:---:|:---:|:---:|:----:|
| 頻率 | 900 MHz | 1000 MHz | 1100 MHz | 1200 MHz | |
| tDSC(avg) min | 1.111 | 1 | 0.909 | 0.833 | ns |
| tDIVW1 max | 0.48 | 0.48 | 0.48 | 0.48 | UI |
| tDIVW2 max | 0.30 | 0.30 | 0.30 | 0.30 | UI |
| tDQS2DQ(training) min/max | -0.200/0.200 | -0.200/0.200 | -0.200/0.200 | -0.200/0.200 | ns |
| tDQ2DQ(training) max | 0.100 | 0.100 | 0.100 | 0.100 | ns |

**Data Output 參數**:

| 參數 | Mode 0-3 | Mode 4-7 | Mode 8-11 | Mode 12-15 | Mode 16-19 | 單位 |
|------|:-------:|:-------:|:---------:|:---------:|:---------:|:----:|
| tDQSQ max | 2.5~1.0 | 0.8~0.4 | 0.350~0.188 | 0.167~0.250* | 0.250* | ns |
| tRC(avg) min | 30~12 | 10~5 | 3.75~1.875 | 1.667~1.25 | 1.111~0.833 | ns |
| tQH min | 0.37 | 0.37 | 0.37 | 0.37 | — | tRC(avg) |
| tDVWp(per pin) min | — | — | 0.535(M11) | 0.475~0.356 | 0.317~0.237 | ns |

> *Mode 12+: tDQSQ becomes a centered window (± value), not a max magnitude

### 11.5 NV-LPDDR4 時序參數（ONFI 5.0 Table 4-77 ~ 4-80）

**Command & Address 常數參數**：與 NV-DDR2/3 完全相同（同一張表 4-77 = 4-73）

**Data Input 參數（模式 0-11）**：與 NV-DDR2/3 的 tDIVW1/tDIVW2 取代 tDS_tight/tDH_tight

| 參數 | Mode 0-3 | Mode 4-7 | Mode 8-11 | 單位 |
|------|:-------:|:-------:|:---------:|:----:|
| tDIVW1 max | 0.48 | 0.48 | 0.48 | UI |
| tDIVW2 max | 0.30 | 0.30 | 0.30 | UI |
| tDIPW min | 0.31 | 0.31 | 0.31~0.33 | tDSC(avg) |
| tDQSH min | 0.45 | 0.45 | 0.45 | tDSC(avg) |
| tDQSL min | 0.45 | 0.45 | 0.45 | tDSC(avg) |
| tDQS2DQ(training) | — | — | -0.200/0.200(M11) | ns |

**Data Input 參數（模式 12-19, NV-LPDDR4 高速）**:

| 參數 | Mode 12 (1.667ns) | Mode 13 (1.5ns) | Mode 14 (1.364ns) | Mode 15 (1.25ns) | 單位 |
|------|:---:|:---:|:---:|:---:|:----:|
| 頻率 | 600 MHz | ~667 MHz | ~733 MHz | 800 MHz | |
| tDSC(avg) min | 1.667 | 1.5 | 1.364 | 1.25 | ns |
| tDIVW1 max | 0.48 | 0.48 | 0.48 | 0.48 | UI |
| tDIVW2 max | 0.30 | 0.30 | 0.30 | 0.30 | UI |
| tDIPW min | 0.33 | 0.33 | 0.33 | 0.33 | tDSC(avg) |
| tDQS2DQ(training) | -0.200/0.200 | -0.200/0.200 | -0.200/0.200 | -0.200/0.200 | ns |
| tDQ2DQ(training) max | 0.100 | 0.100 | 0.100 | 0.100 | ns |
| tDQSH min | 0.45 | 0.448 | 0.445 | 0.444 | tDSC(avg) |

**NV-LPDDR4 特殊參數**:
- **tDIVW1 / tDIVW2**: DQ Rx Mask 定義（取代傳統 tDS+tDH），限界為 UI=0.5×tDSC
- **CH_ODT (Channel ODT)**: 需透過 FA 22h 設定（150Ω / 100Ω / 75Ω / 60Ω / 50Ω / 40Ω / 30Ω）
- **VrefQ 訓練**: 透過 FA 23h 設定內部 VrefQ，步進 1.5% VccQ

### 11.6 速度演進圖

```
MT/s
4800 │                                   ● ONFI 6.0 / JESD230G
     │
3600 │                          ● ONFI 5.x (NV-LPDDR4)
     │
2400 │                 ● NV-DDR3 Mode 19
     │
1600 │        ● NV-DDR3 Mode 15
1200 │    ● NV-DDR3 Mode 14
 800 │  ● NV-DDR3 Mode 12
 533 │ ● NV-DDR2 Mode 11
 400 │● NV-DDR2 Mode 10
 200 │● NV-DDR / NV-DDR2 Mode 5
  50 │● SDR Mode 5
     └────────────────────────────────────────
     2006          2014  2021 2024
```

> NV-LPDDR4 使用 LTT (Low Tolerance Termination) 技術降低讀取功耗
> ONFI 6.0 / JESD230G 支援到 4800 MT/s，需 FFE + PI-LTT
> NV-DDR3 Mode 12+ 需要 DCC 訓練、ZQ 校準、Read/Write DQ Training

### 11.7 時序圖關鍵關係說明（ONFI 5.0 §4.20）

以下依介面類型整理 Verilog 設計時需掌握的關鍵信號關係：

**SDR 介面 (WE_n as clock)**:
| 操作 | 關鍵信號 | 時序參數 |
|------|---------|---------|
| Command Latch | CLE=1, WE_n↓, CE_n↓前置 | tCLS/tCLH, tCS/tCH |
| Address Latch | ALE=1, WE_n↓ | tALS/tALH, tDS/tDH |
| Data Input | ALE=0, CLE=0, WE_n↓ | tDS/tDH, tWP (最小脈衝寬度) |
| Data Output | RE_n↓ (read enable) | tRC (30ns min→EDO mode), tCEA, tCOH |
| Read Status | 70h → tWHR → RE_n | 可連續讀取 (RE_n 保持 low) |

**NV-DDR 介面 (CLK as clock)**:
| 操作 | 關鍵信號 | 時序參數 |
|------|---------|---------|
| Command Cycle | CLE=1, CLK↑ | tCAD, tCAS/tCAH, tCALS/tCALH |
| Address Cycle | ALE=1, CLK↑ | tCAD, tCAS/tCAH |
| Data Input | W/R_n=1, DQS 源同步 | tDQSH/tDQSL, tDSS/tDSH, tWPST |
| Data Output | W/R_n=0, 設備驅動 DQS | tDQSCK, tDQSD, tDVW, tQH, tDQSQ |
| CLK Stopped | 進資料輸入後可停止 CLK | tDPZ (重啟), tWPRE/tWPST |
| W/R_n 轉換 | 匯流排擁有權切換 | tDQSD (host→device), tDQSHZ (device→host) |

**NV-DDR2/3/LPDDR4 介面**:
| 操作 | 關鍵信號 | 時序參數 |
|------|---------|---------|
| Command Cycle | CLE=1, **差分**(RE_t/c) | 同 NV-DDR (tCAD, tCAS) |
| Data Input (training 前) | DQS 源同步 | tDS+tDH 或 tDIVW1+tDIVW2, tDQS2DQ, tDQ2DQ |
| Data Input (training 後) | per-bit 延遲調整後 | tDIVW1/tDIVW2 (Rx mask), 無 tDS/tDH |
| Data Output | RE_t/c 觸發 | tCALR/tCALR2, tRPRE/tRPRE2, tDQSQ, tQH, tDVWd, tDVWp |
| DQ Rx Mask (>1600MT/s) | VDIVW=180~200mV | 取代傳統 VIH/VIL 定義 |
| ODT 時序 | DQS 高電位觸發 | tCALQS/tCALQS2 (輸入), tCALR/tCALR2 (輸出) |

**所有介面共享的時序要點**:
- 命令發出後等待 R/B_n: tWB (busy 延遲，通常 <100ns)
- 命令間隙: tCAD (最小週期時間，見各 mode 參數表)
- 寫保護: WP_n 轉換後需閒置 tWW 時間
- 多平面操作的 bus 時間: tADL, tCCS, tRHW, tWHR (取最長的作為 governing parameter)

---

## 12. Signal Integrity 技術

### 12.1 關鍵 SI 技術演進

| 技術 | 從版本 | 解決問題 | 實現成本 |
|------|--------|---------|---------|
| **ODT** (On-Die Termination) | NV-DDR2 | 阻抗匹配、減少反射 | 類比電路 + 校準 |
| **Differential Signaling** | NV-DDR2 | 雜訊抑制 (DQS_t/c, RE_t/c) | 額外 pin |
| **ZQ Calibration** | NV-DDR2 | PVT 變異下的 ODT 精度 | 外部電阻 + 校準 FSM |
| **DCC** (Duty Cycle Correction) | NV-DDR3 | 高速時脈 duty 失真 | 數位校正邏輯 |
| **Read/Write DQ Training** | NV-DDR3 | DQS-DQ 對齊 | 訓練 FSM + 延遲線 |
| **DBI** (Data Bus Inversion) | NV-LPDDR4 | 降低功耗/SSN | 額外 pin + 編碼邏輯 |
| **VrefQ Calibration** | NV-LPDDR4 | 最佳化參考電壓 | 訓練 FSM |
| **DFE** (Decision Feedback Equalizer) | **ONFI 5.1+** | 消除 post-symbol ISI | 數位濾波器 + 訓練 |
| **Asymmetric DQS** | ONFI 5.1+ | 改善讀取/寫入時序餘裕 | 可調 DQS 延遲 |
| **SCA Training** | **ONFI 5.2+** | CA 匯流排對齊 | 額外訓練 FSM |
| **FFE** (Feed-Forward Equalizer) | **ONFI 6.0** | 預先補償高頻通道損失 | TX 端 FIR 濾波器 |
| **PI-LTT** (Power Isolated LTT) | **ONFI 6.0** | 進一步降低讀取功耗 | 隔離電源域 |

### 12.2 ODT Configuration Matrix（ONFI 5.0 Table 5-11）

ODT Configure 命令 (E2h) 使用 4 個 data byte 設定 Volume-level ODT：

**Byte 0 (M0) — Matrix 0**:
| Bit 7 | Bit 6 | Bit 5 | Bit 4 | Bit 3 | Bit 2 | Bit 1 | Bit 0 |
|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|
| V7 | V6 | V5 | V4 | V3 | V2 | V1 | V0 |

**Byte 1 (M1) — Matrix 1**:
| Bit 7 | Bit 6 | Bit 5 | Bit 4 | Bit 3 | Bit 2 | Bit 1 | Bit 0 |
|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|
| V7 | V6 | V5 | V4 | V3 | V2 | V1 | V0 |

- Matrix 中每個 bit 對應一個 Volume (V0~V7)
- Bit=1: 該 LUN 作為此 Volume 的終端器

**Byte 2 (Rtt1) — Termination 值（NV-DDR2/3）**:
| 編碼 | Rtt |
|:----:|:---:|
| 0h | ODT disabled |
| 1h | 300 Ω |
| 2h | 150 Ω |
| 3h | 100 Ω |
| 4h | 75 Ω |
| 5h | 60 Ω |
| 6h | 50 Ω |

**Byte 2 (Rtt1) — Termination 值（NV-LPDDR4）**:
| 編碼 | Rtt |
|:----:|:---:|
| 0h | ODT disabled |
| 1h | 300 Ω |
| 2h | 240 Ω |
| 3h | 200 Ω |
| 4h | 150 Ω |
| 5h | 120 Ω |
| 6h | 100 Ω |
| 7h | 85 Ω |
| 8h | 75 Ω |

- **Byte 3 (Rtt2)**：格式與 Byte 2 相同（預留第二組終端值）

### 12.3 ZQ Calibration 序列

```
ZQCL (ECh) ──→ ZQ Calibration Long（完整校準，tZQCAL ≈ 1µs）
ZQCS (E8h) ──→ ZQ Calibration Short（快速更新，tZQCAL ≈ 1µs）
     │
     ├─ 1. 開始 ZQ 校準狀態機
     ├─ 2. 比較外部參考電阻 (RZQ) 與內部複製電路
     ├─ 3. 更新驅動強度碼 → PHY pull-up/pull-down
     ├─ 4. 更新 ODT 碼 → Rtt 值
     └─ 5. 完成，R/B_n = 1
```

### 12.4 對數位設計工程師的提醒

- **ODT/ZQ 校準**：需要狀態機控制校準序列，更新阻抗碼到 PHY
- **DQ Training**：需要實現訓練 pattern 產生/檢查，以及 per-bit 延遲調整
- **DCC Training**：可以透過 Set Feature (FA 20h) 或專用命令 (CMD 18h) 觸發
- **Write DQ Training (TX side)**: CMD 76h + 3 address cycles（定義 data pattern）
- **Write DQ Training (RX side)**: CMD 76h + LUN address + 3 address cycles
- **DFE**：若 ONFI 5.1+ 設計，需了解 DFE 權重更新演算法（LMS 適應性濾波器）
- **SCA 訓練**：全新的訓練序列，需獨立於傳統資料訓練

---

## 13. 電氣規格與 DC 特性（ONFI 5.0 §2.13）

### 13.1 建議 DC 操作條件

| 參數 | 符號 | 最小 | 典型 | 最大 | 單位 |
|------|:----:|:----:|:----:|:----:|:----:|
| Vcc 電源 (3.3V 元件) | VCC | 2.7 | 3.3 | 3.6 | V |
| Vcc 電源 (2.5V 元件) | VCC | 2.35 | 2.5 | 2.75 | V |
| Vcc 電源 (1.8V 元件) | VCC | 1.7 | 1.8 | 1.95 | V |
| VccQ 3.3V I/O | VCCQ | 2.7 | 3.3 | 3.6 | V |
| VccQ 1.8V I/O (NV-DDR/NV-DDR2) | VCCQ | 1.7 | 1.8 | 1.95 | V |
| VccQ 1.2V I/O (NV-DDR3/NV-LPDDR4) | VCCQ | 1.14 | 1.2 | 1.26 | V |
| Vpp 外部電源 | VPP | 10.8 | 12.0 | 13.2 | V |

**注意**: VccQ ≤ Vcc (含 power-on ramp)。電源 AC noise ≤ ±3%。

### 13.2 電流消耗

| 參數 | 符號 | 條件 | 典型 | 最大 | 單位 |
|------|:----:|------|:----:|:----:|:----:|
| Array read current | ICC1 | 每 active LUN | — | 100 | mA |
| Array program current | ICC2 | 每 active LUN | — | 100 | mA |
| Array erase current | ICC3 | 每 active LUN | — | 100 | mA |
| I/O burst read | ICC4R | ≤200/≤400/≤800/≥800 MT/s | — | 50/100/135/180 | mA |
| I/O burst write | ICC4W | 同上 | — | 50/100/135/180 | mA |
| Bus idle | ICC5 | — | — | 15 | mA |
| Standby (per LUN) | ISB | CE_n=VccQ-0.2V | — | 100 | µA |
| Staggered power-up | IST1 | CE_n=VccQ-0.2V | — | 10 | mA |

### 13.3 DC 輸入/輸出電壓規格

**VccQ=3.3V (SDR/NV-DDR)**:
| 參數 | 符號 | 最小 | 最大 | 單位 |
|------|:----:|:----:|:----:|:----:|
| DC Input high | VIH(DC) | 0.7×VccQ | VccQ+0.3 | V |
| AC Input high | VIH(AC) | 0.8×VccQ | Note | V |
| DC Input low | VIL(DC) | -0.3 | 0.3×VccQ | V |
| AC Input low | VIL(AC) | Note | 0.2×VccQ | V |
| Output high (SDR only) | VOH | 0.67×VccQ | — | V |
| Output low (SDR only) | VOL | — | 0.4 | V |

**VccQ=1.8V (NV-DDR2 — SSTL 信令)**:
| 參數 | 符號 | 最小 | 最大 | 單位 |
|------|:----:|:----:|:----:|:----:|
| DC Input high (SSTL) | VIH.SSTL(DC) | VREFQ+125 | VccQ+300 | mV |
| AC Input high (SSTL) | VIH.SSTL(AC) | VREFQ+250 | Note | mV |
| DC Input low (SSTL) | VIL.SSTL(DC) | -300 | VREFQ-125 | mV |
| AC Input low (SSTL) | VIL.SSTL(AC) | Note | VREFQ-250 | mV |

**VccQ=1.2V (NV-DDR3 — SSTL w/ VREFQ)**:
| 參數 | 符號 | Mode 0-16 | Mode 17-19 | 單位 |
|------|:----:|:---------:|:---------:|:----:|
| DC Input high w/ VREFQ | VIH.SSTL(DC) | VREFQ+100 | VREFQ+80 | mV |
| AC Input high w/ VREFQ | VIH.SSTL(AC) | VREFQ+150 | VREFQ+100 | mV |
| DC Input low w/ VREFQ | VIL.SSTL(DC) | VREFQ-100 | VREFQ-80 | mV |
| AC Input low w/ VREFQ | VIL.SSTL(AC) | VREFQ-150 | VREFQ-100 | mV |
| DQ Rx Mask Voltage total | VDIVW.SSTL | — | 200/180* | mV |
| Rx AC pulse amplitude pk-pk | VIHL.SSTL(AC) | 220 | — | mV |

*Mode 15-16: 200mV, Mode 17-19: 180mV

**VccQ=1.2V (NV-LPDDR4 — LTT 信令)**:
| 參數 | 符號 | 最小 | 最大 | 單位 |
|------|:----:|:----:|:----:|:----:|
| DC Input high (unterminated) | VIH.UNTERM(DC) | 0.5×VccQ | VccQ | mV |
| DC Input low (LTT) | VIL.LTT(DC) | VssQ | Vcent_DQ-80 | mV |
| DC Input high (LTT) | VIH.LTT(DC) | Vcent_DQ+80 | VccQ | mV |
| DQ Rx Mask Voltage total | VDIVW.LTT | — | 160 | mV |
| Rx AC pulse amplitude pk-pk | VIHL.LTT(AC) | 200 | — | mV |

### 13.4 VREFQ 規格

| 參數 | 符號 | NV-DDR3 | NV-LPDDR4 | 單位 |
|------|:----:|:-------:|:---------:|:----:|
| 外部 VREFQ(DC) | VREFQ(DC) | 0.49~0.51×VccQ | — | V |
| VREFQ AC noise | — | ±1% VccQ | ±1% VccQ | V |
| 最小 internal VREFQ 範圍上限 | VREFQHI | 0.55×VccQ | 0.40×VccQ | V |
| 最小 internal VREFQ 範圍下限 | VREFQLO | 0.45×VccQ | 160mV from VssQ | V |
| Internal VREFQ 容差 | VREFQ.TOL | ±1.75% VccQ | ±1.75% VccQ | V |

### 13.5 差動信號單端要求

| 參數 | NV-DDR2 | NV-DDR3 | NV-LPDDR4 | 單位 |
|------|:-------:|:-------:|:---------:|:----:|
| VSEH(AC) min (RE_t, DQS_t) | VccQ/2+250 | VIH.SSTL(AC) | VREFQ+100 | mV |
| VSEL(AC) max | VccQ/2-250 | VIL.SSTL(AC) | VREFQ-100 | mV |

### 13.6 Absolute Maximum Ratings

| 供電組合 | VCC max | VCCQ max | VIN max |
|---------|:-------:|:--------:|:-------:|
| 3.3V/3.3V | 4.6V | 4.6V | 4.6V |
| 3.3V/1.8V | 4.6V | 2.4V | 2.4V |
| 3.3V/1.2V | 4.6V | 1.5V | 1.5V |
| 1.8V/1.8V | 2.4V | 2.4V | 2.4V |

### 13.7 BGA 封裝腳位對照（ONFI 5.0 §2.5, §2.7, §2.8）

**BGA-132 / BGA-152 信號映射 (Table 2-3)**:
| 信號群 | 信號 | Dir | BGA-132 ball | BGA-152 ball |
|:------:|------|:---:|:-----------:|:-----------:|
| Ready/Busy | R/B0_0_n, R/B0_1_n, R/B1_0_n, R/B1_1_n | O | 2 組×2 | 2 組×2 |
| Read Enable | RE_0/1_n(t), RE_0/1_c | I | 差動對×2 | 差動對×2 |
| Write/Read | W/R_0/1_n | I | per ch | per ch |
| CE | CE[3:0]_[0:1]_n | I | 8 組 | 8 組 |
| 電源 | Vcc, VccQ, Vss, VssQ | P | D7, D2, D5 | D7, D2, D5 |
| VREFQ | VREFQ_0/1 | I | O | O |
| VDDi/Vpp | VDDi, Vpp | P | K10, K7 | K11, K8 |
| 控制 | CLE, ALE, WE_n, CLK, WP_n | I | 各 x2 ch | 各 x2 ch |
| Data | IO[7:0]_0/1 | I/O | ch0 & ch1 | ch0 & ch1 |
| DQS | DQS_0/1_t, DQS_0/1_c | I/O | 差動對×2 | 差動對×2 |
| ZQ | ZQ_0/1 | A | 每 ch | 每 ch |
| DBI | DBI_0/1 (NV-LPDDR4) | I/O | 每 ch | 每 ch |

**BGA-178 / BGA-154 / BGA-146 (Table 2-6)**: 高密度封裝，支援 4 組 8-bit data bus + 4 CE/ch。
- BGA-178 為全 pinout 參考，BGA-154 與 BGA-146 為子集
- 差動信號要求：NV-LPDDR4 必須使用差動 DQS_t/c 和 RE_t/c
- ZQ ball 數量: BGA-132/152 每 channel 1 個, BGA-178+ 每 channel 1 個
- DBI ball: NV-LPDDR4 獨佔, NV-DDR2/3 為 NC

**獨立資料匯流排 (Independent Data Buses)**:
- BGA-100/LGA-52 支援 2 組獨立 8-bit bus
- BGA-272/252 支援 4 組獨立 8-bit bus
- BGA-316 支援 4 組獨立 8-bit bus (16 或 32 CE_n)

**CE_n 與 R/B_n 對應關係**:
| 配置 | R/B_n / CE_n 對應 |
|------|------------------|
| 2 R/B_n per ch | R/B0 = CE0/2/4/6, R/B1 = CE1/3/5/7 |
| 1 R/B_n per ch | R/B0 = CE0~7 (所有 CE 共享) |
| 2 R/B_n + 1 CE per ch | R/B0 = CE0, R/B1 = CE1 |

---

## 14. Verilog 實現建議

### 14.1 參考資源

1. **Open-source ONFI Controller (Verilog)**:
   - `cjhonlyone/NandFlashController` (⭐104, AXI, NFC_Phy*/Command*/Atom*, **no configurable timing LUT**)
   - `arunjeevaraj/onfi_controller` (PHY/MEM_CTRL 分層, Wishbone, **最佳 PHY 架構參考**)
   - `thesourcerer8/nand_controller` (OpenCores port, 8628B buffer, 17-instruction, ONFI 4.0-limited, VHDL origin)
   - `nbstrong/nand_avalon` (Avalon MM variant of OpenCores)

2. **Arasan 商用 IP 參考 (業界標竿)**:
   - **ONFI 5.0 PHY IP**: PLL+DLL 組合, 78ps 解析度, ±200ps per-bit deskew, 支援 SDR/NV-DDR/NV-DDR2/NV-DDR3/NV-LPDDR4 TX/RX, 內建訓練 FSM + ZQ Cal + DFE/FFE
   - **ONFI 5.0 Controller IP**: AXI3/AXI4 + DMA, BCH ECC (4b~60b/512B~60b/1024B), 多 bank 排程, 命令佇列
   - **ONFI 4.2 PHY**: 支援 NV-DDR3 800MHz, 合成式 PLL/DLL (RTL 可交付, 非硬體 IP)

3. **M31 ONFI Multi-PHY (商用 PHY IP)**:
   - 支援 ONFI 6.0 4800Mbps, CTT(NV-DDR3)/LTT(NV-LPDDR4)/PI-LTT
   - 8-bit data blocks × 8 CE/channel, PLL/DLL, TX FFE + RX DFE
   - 低功耗模式、動態頻率調整、DFT/BIST

4. **Micron Design Guide (TN-29-83)**: 驅動強度/ODT 選擇指南, 樹狀拓撲 layout 指南, per-channel 長度匹配建議 (±5mm DQ trace, ±0.1mm stub)

5. **Per-bit Deskew Training 專利 (CN118609619B)**: 每 bit 獨立延遲線 + 窗口掃描演算法, step length 加速, configurable repetition count 抗雜訊

### 14.2 建議的實現起點

```
專案初期架構討論：
  確定目標 ONFI 版本 → 決定支援模式 → 模組劃分

0. ★ 若目標是 ONFI 6.0 / JESD230G（最新，2026 年主流）：
   ├─ SCA 協議引擎（含 SCA mode pin 偵測、pin assignment 切換）
   ├─ Conventional Protocol 引擎（向下相容 ONFI 1.0~5.2）
   ├─ NV-LPDDR4 PHY（4800 MT/s, 含 DFE/FFE/PI-LTT）
   ├─ 支援 DBI / ZQ Calibration / DCC / VrefQ
   └─ 完整訓練套件：SCA CA Training + DQ Training + DFE Taps

1. 若目標是 ONFI 5.2：
   ├─ SCA 協議引擎（無 mode pin，透過 Set Features 啟用）
   ├─ SDR/NV-DDR/NV-DDR2/3 支援（向下相容）
   └─ NV-LPDDR4 PHY（3600 MT/s, 含 DFE/DBI）

2. 若目標是 ONFI 5.0/5.1：
   ├─ 傳統協議引擎（成熟設計）
   ├─ NV-LPDDR4 PHY（含 DFE/DBI）
   └─ 預留 SCA 擴充介面

3. 若目標是 ONFI 4.2：
   ├─ 傳統協議引擎（成熟設計）
   └─ NV-DDR3 PHY（含 ZQ/DCC/DQ Training）
```

### 14.3 關鍵的設計決策

| 決策 | 考量 |
|------|------|
| **PHY 整合 vs. 獨立** | 整合：latency 低但彈性低；獨立：可換不同 foundry PHY |
| **DLL 架構** | Master-Slave DLL 常用於 DQS 對齊（如 Arasan 78ps 解析度） |
| **命令佇列深度** | SCA 模式下需要更大深度以利用並行性 |
| **DMA 設計** | Scatter-Gather DMA 可支援不連續頁面傳輸 |
| **通道數** | 4/8 通道 x 8-bit 常見，單片可達 ~4GB/s |
| **ECC** | BCH / LDPC 可選（Block Abstracted NAND 可由設備處理） |

### 14.4 Verilog Coding 重點提醒

```verilog
// ===== 1. 時脈域交叉 (CDC) 處理 =====
// Host CLK domain ↔ Controller CLK domain ↔ PHY CLK domain
// SCA CA_CLK 可能是獨立時脈域

// ===== 2. 狀態機編碼 =====
// 主協議狀態機建議使用 3 段式 FSM
// 訓練狀態機使用 1 段式 (控制導向)

// ===== 3. 參數化設計 =====
// 通道數、CE 數、timing mode 應為可配置參數
// 不同速度等級的時序計數器應使用 lookup table

// ===== 4. 除錯介面 =====
// 預留內部狀態觀測點 (command trace, FSM state)
// PHY BIST 支援

// ===== 5. PHY 介面規範 =====
// 定義清楚的 TX/RX 介面 (data + strobe + training handshake)
// 延遲線控制為 per-bit 可調
```

### 14.5 驗證策略

```
1. 單元驗證 (Module-level):
   ├─ 各模式狀態機測試
   ├─ 命令解碼/序列產生測試
   └─ 訓練演算法測試

2. 整合驗證 (Controller + PHY model):
   ├─ 使用 ONFI VIP (Truechip/Cadence 等)
   ├─ 或 Free Model Foundry NAND flash model
   ├─ 支援 Icarus Verilog / Verilator / Vivado
   └─ 檢查協議合規性 (timing checkers, assertions)

3. FPGA 原型驗證:
   ├─ 實際連接 NAND flash 晶片
   └─ 測試讀/寫/抹除/壞塊管理

4. 覆蓋率分析:
   ├─ 所有命令序列覆蓋
   ├─ 所有時序模式覆蓋
   ├─ 錯誤處理路徑覆蓋
   └─ SCA 並行場景覆蓋 (5.2)
```

---

## 15. 參考資源

### 官方資源
- **ONFI 官方網站**: https://www.onfi.org/（遭 Cloudflare 阻擋，建議從 Wayback Machine 或 JEDEC 取得）
- **ONFI Specs (Wayback Machine)**: https://web.archive.org/web/20250126112523/https://onfi.org/specs.html（可下載 ONFI 1.0~5.2 規格，但 5.1/5.2 PDF 被截斷為 1MB）
- **JEDEC JESD230G 下載**: https://www.jedec.org/standards-documents/docs/jesd230g（需註冊，免費）
- **JEDEC JESD230G 發布新聞**: https://www.jedec.org/news/pressreleases/jedec%C2%AE-announces-enhanced-nand-flash-interface-standard-increased-speeds-and
- **Wikipedia**: https://en.wikipedia.org/wiki/Open_NAND_Flash_Interface_Working_Group
- **已下載的完整規格**:
  - ✅ ONFI 5.0 Gold (6.9MB, 完整) — 專案目錄下 `onfi_5_0_gold.pdf`
  - ⚠️ ONFI 5.2 Rev1.0 (1MB, 截斷) — Wayback Machine 限制
  - ❌ JESD230G / ONFI 6.0 — JEDEC 需註冊下載

### 技術文章
- **Cadence Blog**: ONFI 5.2 What's new (Shyam Sharma, Nov 2025)
  - https://community.cadence.com/cadence_blogs_8/b/fv/posts/onfi-5-2-what-s-new-in-open-nand-flash-interface-s-latest-5-2-standard
- **Union Memory**: NAND Flash 介面演進歷史 (Jan 2023)
  - https://en.unionmem.com/news_detail-31-20.html
- **Phison Blog**: NAND Flash 101 - Flash Device Interfaces
  - https://phisonblog.com/nand-flash-101-flash-device-interfaces-2/
- **Semi IP Hub**: ONFI 5.2 Standard Overview (Nov 2025)
  - https://semiiphub.com/pulse/expert-perspectives/onfi-5-2-standard
- **Electronic Design (KIOXIA)**: JESD230G vs 前代差異詳解 (Sep 2025)
  - https://www.electronicdesign.com/technologies/embedded/digital-ics/memory/article/55315033/kioxia-flash-memory-design-with-the-jedec-jesd230-standard
- **M31 Technology**: ONFI 6.0 I/O IP (4.8GT/s, TSMC N3P/N6/N7)
  - https://www.m31tech.com/product/onfi/
  - https://www.m31tech.com/product/onfi-phy/
- **InPsytech (Egis)**: ONFI 6400 專案 @4nm, COMPUTEX 2026
  - https://www.design-reuse.com/news/202530615-inpsytech-highlights-ucie-innovation-at-computex-with-ucie-live-demo-and-ultra-high-speed-onfi-6400-development.html
- **StorageNewsletter**: JESD230G 發布報導 (Nov 2024)
  - https://www.storagenewsletter.com/2024/11/22/jedec-jesd230g-enhanced-nand-flash-interface-standard-with-increased-speeds-and-efficiency/
- **BusinessWire**: JEDEC JESD230G 官方新聞稿 (Nov 18, 2024)
  - https://www.businesswire.com/news/home/20241118637716/en/JEDEC-Announces-Enhanced-NAND-Flash-Interface-Standard-With-Increased-Speeds-and-Efficiency

### 開源實作分析

#### 1. cjhonlyone/NandFlashController ⭐104
- **語言**: Verilog (83.7%) + C (8.7%) | **授權**: GPL-3.0
- **網址**: https://github.com/cjhonlyone/NandFlashController
- **支援**: ONFI 2.1 (NV-DDR, 非同步 SDR)
- **架構**:
  ```
  NandFlashController_Top_AXI  (AXI + AXIS 介面)
  ├── verilog-axi/              (AXI adapter 函式庫)
  ├── NFC_Command_*            (命令解碼 FSMs)
  ├── NFC_Atom_*               (原子操作: CMD/ADDR/DATA IN/DATA OUT)
  └── NFC_Phy*                 (Pin pad 驅動)
  ```
- **關鍵特點**: AXI4 完整整合、Xilinx 平台驗證、內建 DMA 傳輸
- **已知限制**: 時序參數寫死（非可配置 lookup table）、無 PHY 訓練邏輯

#### 2. arunjeevaraj/onfi_controller ⭐4
- **語言**: Verilog (69.2%) | **授權**: 未標示
- **網址**: https://github.com/arunjeevaraj/onfi_controller
- **架構**:
  - PHY / MEM_CTRL 抽象分離（模組化設計）
  - MEM_CTRL: 命令 FIFO、多命令排程
  - PHY: 信號層驅動
  - Host 介面: Wishbone + DMA
- **驗證**: 導向式 Verilog testbench + Icarus/Vivado 仿真
- **Make 命令**: `make lint` (Verilator), `make sim_vivado/onfi_tb.v`, `make sim/onfi_tb.fst`
- **關鍵特點**: PHY/MEM_CTRL 分層架構值得參考

#### 3. thesourcerer8/nand_controller (OpenCores 移植)
- **語言**: Verilog (從 VHDL 移植) | **授權**: LGPL
- **網址**: https://github.com/thesourcerer8/nand_controller
- **原始 OpenCores 專案**: https://opencores.org/projects/nand_controller
- **支援**: ONFI 4.0（x8/x16 自動偵測）、Avalon MM 介面
- **內部緩衝區架構**:
  | 緩衝區 | 大小 | 用途 |
  |--------|:----:|------|
  | JEDEC ID Buffer | 5 B | 快取 READ ID 結果（加速 12 倍） |
  | ONFI Parameter Page Buffer | 256 B | 存放解析後的參數頁 |
  | Data Page Buffer | **8628 B** | 最大頁面緩衝（支援最大頁面大小） |
  | Address Buffer | 5 B | 當前頁面位址 |
- **指令集**: 17 條控制器指令（NAND_RESET ~ CTRL_SET_CURRENT_ADDRESS_BYTE）
- **關鍵特點**: 最成熟的開源 ONFI 控制器、8K+ 頁面緩衝、參數頁自動解析

#### 4. nbstrong/nand_avalon
- **語言**: Verilog (69.7%) + VHDL (18.3%) + SystemVerilog (10.3%)
- **網址**: https://github.com/nbstrong/nand_avalon
- **分支**: master (ONFI 控制器), extension_module (ONFI + 擴充模組)
- **基於**: OpenCores nand_controller 改進版，新增 Avalon MM 精細控制

#### 5. 其他相關專案
- **gyd111/NAND-Flash-controller** (Verilog, ⭐10): MT29F128G 專用，ONFI 2.2 async SDR only
- **manjushpv/Design-and-Verification-of-Nand-Flash-Memory-Controller** (Verilog, ⭐21): Samsung K9F1G08R0A，SystemVerilog UVM 驗證
- **raiyyanfaisal09/RTL_NAND_Flash_controller** (Verilog, ⭐18): 簡化版 NAND 控制器
- **IIT Madras Thesis** (BSV → Verilog): https://eescholars.iitm.ac.in/sites/default/files/eethesis/ee13m074.pdf

### 中文技術資源

| 來源 | 內容 | 關聯性 |
|------|------|--------|
| **CSDN** NAND Flash 控制器系列 | 多篇關於 FPGA 實現 NAND 控制器的文章，涵蓋命令序列、時序控制 | Medium |
| **知乎** ONFI 協定討論 | 少量技術討論，主要為產業新聞 | Low |
| **iT邦幫忙** NAND Flash 基礎 | 以 SPI/NOR 為主，ONFI 內容有限 | Low |
| **Union Memory 中文版** | NAND Flash 介面演進歷史（同英文版） | Medium |
| **Phison Blog** NAND Flash 101 | 快閃設備介面介紹（可切換中文） | Medium |

### 商用 IP 供應商

#### ONFI 6.0 (JESD230G)
- **M31 Technology**: ONFI 6.0 I/O IP / PHY @ 4.8GT/s TSMC N3P/N6/N7
  - https://www.m31tech.com/product/onfi/
  - https://www.m31tech.com/product/onfi-phy/
- **InPsytech (Egis)**: ONFI 6400 PHY @ 6400MT/s @4nm（開發中）
  - https://www.design-reuse.com/news/202530615-inpsytech-highlights-ucie-innovation-at-computex.html
  - EGIS ONFI 6.0 4800MT/s PHY IP
- **Cadence**: ONFI 5.2 / 6.0 VIP (Memory Models)
  - https://www.cadence.com/en_US/home/tools/system-design-and-verification/verification-ip/simulation-vip/memory-models/flash/onfi.html

#### ONFI 5.0
- **Arasan Chip Systems**: ONFI 5.0 Controller + PHY
  - https://www.arasan.com/product/onfi-5-0-controller-ip/
  - https://www.arasan.com/product/onfi-5-0-phy/

#### ONFI 3.x / 4.x
- **Mobiveil**: Enterprise Flash Controller (ONFI 3.x)
  - https://semiiphub.com/ip/onfi-flash-controller-ip-7836
- **Truechip**: ONFI 5.0 Verification IP
  - https://semiiphub.com/ip/onfi-5-0-verification-ip-21137

---

> **版權聲明**: 本文件為技術重點整理，ONFI 規格之完整內容請以 ONFI 工作小組官方發布文件為準。
> 本報告參考來源包括 Wikipedia、Cadence Blog、Union Memory、Phison Blog、Arasan 產品文件、GitHub 開源專案等公開資訊。
