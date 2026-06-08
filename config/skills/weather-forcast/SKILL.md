---
name: weather-forcast
description: 使用openmeteo api 查詢天氣資訊，提供即時和預測數據。
license: proprietary
compatibility: opencode
---

# Skill: weather-forcast

# 描述
此 Skill 專門用於透過外部天氣 API (如 openmeteo) 獲取特定地點的即時天氣、未來預報、氣候數據等。它將複雜的天氣數據查詢過程抽象化，讓 Agent 能夠輕鬆地將天氣資訊納入決策流程中。

# 用途
當 Agent 或使用者需要以下資訊時，應啟動此 Skill：
- "查詢某地天氣"
- "今天的天氣如何"
- "未來一週的天氣預報"
- "天氣預測"

# 參數要求 (Parameter Requirements)
為確保查詢準確性，此 Skill 必須要求使用者提供以下關鍵參數。若參數缺失，應啟動【自主補完流程】。
1. **地點 (Location)**: 查詢的城市或地理座標。
   - *自動補完*: 若僅提供地名，應先進行內部搜尋或座標轉換。
2. **時間範圍 (Timeframe)**: 查詢的類型 (e.g., today, 7-days, hourly)。
   - *自動補完*: 若未指定，預設為 `today`。
3. **詳細資訊 (Details)**: 需要的特定天氣數據 (e.g., temperature, rainfall, wind speed)。
   - *自動補完*: 若未指定，預設載入「全量專業模板」。

# 核心流程 (Core Workflow)
1. **接收請求**: 接收來自使用者或上層 Agent 的天氣查詢請求。
2. **智能參數解析與補完**: 
   - 檢查是否包含 Location 和 Timeframe。
   - 若缺失關鍵參數，執行自動化補全（如地名轉經緯度、預設時間範圍）。
3. **API 呼叫**: 使用後端工具 (例如 `websearch` 或專用天氣 API) 呼叫 openmeteo 服務。
4. **結果解析**: 接收並解析 API 返回的 JSON/數據結構。
5. **結構化輸出報告**: 將數據轉換為包含「摘要」、「數據表」、「趨勢分析」與「專家建議」的專業格式。

# 限制與注意事項
- **API Key**: 需確保系統已配置有效的天氣 API 金鑰。
- **自主性**: 優先嘗試自動補完參數，而非要求使用者提供，除非資訊嚴重不足。
- **錯誤處理**: 若 API 呼叫失敗或地點無效，必須回報友善且具體的錯誤訊息。
