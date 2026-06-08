---
name: twse_api
description: 查詢台灣股市資訊。此 Skill 包含獲取 TWSE 股市相關數據的流程和方法。
license: opencode
compatibility: opencode
---
# 台灣股市資訊查詢 Skill (TWSE API)

## 功能概述
此 Skill 旨在提供一套標準化的流程，用於從台灣證券交易所 (TWSE) 相關的公開 API 獲取股票、指數、歷史行情等資訊。它將處理 API 請求的建立、數據解析和結果的標準化輸出。

## 使用指南
*   **目的**: 獲取 TWSE 數據（如日收盤價、即時報價等）。
*   **核心方法**: 應使用 `webfetch` 或 `exa_web_search_exa` 進行 URL 請求，並根據 API 類型 (如 `STOCK_DAY` 或 `getStockInfo.jsp`) 調整 URL 參數。
*   **實作提示**: 數據通常以 JSON 或 CSV 格式回傳。推薦使用 Python 的 `requests` 庫結合 `json` 或 `pandas` 處理。

## 內部流程 (流程圖)
1.  **定義目標**: 確認所需數據類型（歷史/即時/財務）。
2.  **建構 URL**: 根據 API 文檔 (如 `twse.com.tw` 或 `mis.twse.com.tw`) 構建正確的請求 URL。
3.  **數據獲取**: 使用 `webfetch` 獲取內容。
4.  **數據解析**: 判斷回傳格式（JSON/CSV），並使用對應工具解析結構化資料。
5.  **結果輸出**: 以簡潔、易讀的格式呈現數據。