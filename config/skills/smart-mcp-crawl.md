---
description: 爬蟲、SPA 逆向工程、API 參數探索。用 pw_browser 攔截真實瀏覽器請求，不再手動猜參數
---

# Smart MCP 爬蟲 / SPA 逆向 Skill

## 核心原則

**不要手動猜 API 參數。讓瀏覽器告訴你。**

## 呼叫慣例

```
Core 工具：直接呼叫 smart_grep(), smart_think(), ...
Standard 工具：smart_smart_run({tool:"工具名", args:{...}})
```

## 工具速查

| 工具 | 呼叫方式 | 用途 |
|------|---------|------|
| `smart_grep(pattern, ...)` | **直接** `smart_grep(...)` | 搜尋 main.js 找 API endpoints |
| `smart_think(thought)` | **直接** `smart_think(...)` | 輕量推理決策 |
| `exa_crawl` | `smart_smart_run({tool:"exa_crawl", args:{urls, clean, markdown}})` | 第一線爬取 SSR HTML |
| `pw_browser` | `smart_smart_run({tool:"pw_browser", args:{command, url, code}})` | 瀏覽器自動化 + JS 攔截 |
| `research` | `smart_smart_run({tool:"research", args:{url, depth}})` | 深度研究 URL 內容 |
| `exa_search` | `smart_smart_run({tool:"exa_search", args:{command:"search", query}})` | 搜尋網路資料 |

## SPA API 逆向流程（修正版）

```
Step 1: 取得 SSR HTML
  smart_smart_run({
    tool:"exa_crawl",
    args:{urls:"https://example.com/", clean:true, markdown:true}
  })
  → 找出 injectJson、pConfig、SEO meta

Step 2: 搜尋 JS chunk 找 API 架構
  smart_grep(pattern:"md5|sign|api|/v3/|axios", include:"main.js")
  → 發現 API endpoints、簽名演算法、路由表

Step 3: 用 pw_browser 開啟 SPA + 攔截 API
  // 先 navigate 到目標頁
  smart_smart_run({
    tool:"pw_browser",
    args:{command:"navigate", url:"https://example.com/play/xxxx"}
  })
  
  // 等待 SPA 載入完成後，執行 JS 擷取攔截的 API 呼叫
  smart_smart_run({
    tool:"pw_browser",
    args:{
      command:"run_code",
      code: "JSON.stringify(window.__apiCalls)"
    }
  })

Step 4: 分析攔截到的 exact URL + 參數
  → 直接用真實瀏覽器產生的參數，0 誤差

Step 5: 用 research 深入研究 chunk
  smart_smart_run({
    tool:"research",
    args:{url:"https://example.com/main.js", depth:"quick"}
  })
```

## 爬蟲錯誤降級

```
爬取失敗 → 依序嘗試：
  1st: exa_crawl with fetchOnly:true
  2nd: exa_crawl with noCache:true  
  3rd: exa_crawl with crawlee:true（反爬蟲）
  4th: pw_browser navigate + snapshot（終極方案）
```

## 實戰：iyf.tv 逆向（已驗證）

```
// 1. 取得 SSR HTML → 發現 injectJson.pConfig（簽名金鑰）
smart_smart_run({tool:"exa_crawl", args:{urls:"https://www.iyf.tv/", clean:true, markdown:true}})

// 2. 搜尋 main.js → 發現簽名演算法
smart_grep(pattern:"md5|sign", include:"main.js")

// 3. 用 pw_browser 攔截 play API 真實參數（非手動猜測！）
smart_smart_run({tool:"pw_browser", args:{command:"navigate", url:"https://www.iyf.tv/play/L5zn9CEFcj5"}})
// → 攔截到: cinema=1&id=KEY&a=1&usersign=1&region=GL.&device=1&isMasterSupport=1
// → 比手動猜節省 2 小時 + 40 次 API 呼叫
```
