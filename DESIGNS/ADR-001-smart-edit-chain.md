# ADR-001: smart_edit_chain 複合編輯工具

## 狀態

Accepted

## 背景

多檔案批次編輯常需連續呼叫 smart_fast_apply N 次，每次都是獨立 MCP 呼叫。
這導致：
- Token 浪費（N 次參數序列化）
- 延遲累積（N 次 round-trip）
- 無法原子化（部分成功部分失敗）

## 決策

新增 `smart_edit_chain` 工具：
- 接受 `chain: [{file, search, replace}, ...]` 陣列
- 一次 MCP 呼叫完成 N 個編輯
- 共享檔案讀取（同一檔案只讀一次）
- 原子 rollback（預設全部成功或全部還原）
- 自動辨識編輯格式（search-replace / block-diff / sed / hashline）

## 替代方案

1. **維持 N 次 smart_fast_apply** → 無法原子化，overhead 高
2. **git-patch 批量** → 依賴 git，非 MCP 原生
3. **單一大型 diff** → 衝突處理複雜

## 影響

- ✅ 顯著降低批次編輯的 token 消耗（40-60%）
- ✅ 原子 rollback 防止部分更新
- ✅ 向下相容（smart_fast_apply 仍可用）
- ⚠️ 需要 server 重啟載入新 plugin
