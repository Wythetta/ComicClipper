# 📚 ComicClipper — 漫畫整冊下載成 PDF（Firefox 擴充功能）

在漫畫網站的作品頁選擇要下載的冊數，擴充功能會逐冊下載圖片、每冊組成一個 PDF，
再用 Send to Kindle 傳到 Kindle 閱讀。輸出針對 **Kindle Scribe（10.2 吋）** 調整。

---

## 🚀 安裝

1. 開啟 `about:debugging#/runtime/this-firefox`
2. 點「**載入暫用附加元件**」→ 選擇 `firefox-extension-comic.zip`
3. 更新版本時，把新的 zip 覆蓋到同一個位置，再按「**重新載入**」（先移除會清掉下載紀錄與設定）

---

## 📖 使用方法

1. 打開漫畫的**作品頁**（列出所有冊數的那一頁）
2. 點工具列上的 ComicClipper 圖示 →「**開啟下載頁**」
3. 在下載頁選擇冊數：
   - **全選／全不選／選未下載**
   - **範圍**：輸入 `1-5, 8, 12-15` 後按「套用」（或 Enter）
   - **Shift＋點選**：一次勾選一整段
   - 下載過的冊會顯示「已下載 日期」，下次打開時預設只勾還沒下載的
   - 網站把作品分成「單行本／單話／番外篇」等區時，會顯示**分頁籤**；選取工具列、範圍與 Shift＋點選只作用在目前的分頁籤，其他分頁籤的勾選會保留（這類作品預設不勾任何一冊）
4. 確認**作者**：會帶入網站上的作者，網站沒有提供時可以自己填；改過的作者會記住，下次打開同一部作品自動帶入
5. 選擇翻頁方向（日漫選「右翻」）與其他選項，按「**開始下載**」
6. 每冊會依序顯示進度；失敗的冊會顯示原因，下載結束後自動勾選，按一下就能重試

下載進行時可以關掉下載頁，工作會在背景繼續；從工具列圖示可以回到進度頁。

檔案存在 **下載／ComicClipper／作品名／**，檔名例如 `生存遊戲 第01卷.pdf`（數字補零，Kindle 書庫才會照順序排）。

---

## 📱 傳到 Kindle

1. 打開 [Send to Kindle](https://www.amazon.com/sendtokindle) 網頁版（或電腦版 App）
2. 拖曳 PDF 上傳，**不要**選擇轉換成 Kindle 格式
3. 網頁版／App 單檔上限 200MB；一冊通常 20–50MB

> 用 Email 寄送的上限只有 50MB（Gmail 附件實際約 18MB），所以建議用網頁版上傳。也可以用 USB 直接把 PDF 複製到 Kindle 的 `documents` 資料夾。

---

## 🖼️ 圖片處理

| 情況 | 處理方式 |
|---|---|
| 一般 JPEG、尺寸不超過螢幕 | **原檔直接放進 PDF**，不重新壓縮，畫質零損失 |
| 超過 Kindle Scribe 解析度（1860×2480） | 等比縮小（只縮小不放大） |
| WebP、PNG、漸進式 JPEG 等 | 轉成一般 JPEG |
| 橫向跨頁 | 拆成兩頁；右翻時右半頁在前（可關閉） |
| 轉灰階（選項，預設關閉） | 檔案較小，但每張圖都要重新壓縮 |

PDF 每頁高度一致、沒有白邊，書名與作者會寫進 PDF 資訊欄位（Kindle 書庫會顯示）。

> **已知限制**：Kindle 上的 PDF 一律往左翻，無法設定右翻；頁序是正確的，只是翻頁手勢和日漫習慣相反。

---

## 🌐 支援的網站

| 網站 | 狀態 |
|---|---|
| comic.acgn.cc（動漫戲說） | ✅ 可用（頁面結構參考 [ComicCrawler](https://github.com/eight04/ComicCrawler) 的 acgn 模組，MIT 授權） |
| www／tw.manhuagui.com（漫畫櫃，含鏡像站 mhgui.com） | 🧪 已完成，待實測（解碼方式參考 [Mihon 擴充](https://github.com/keiyoushi/extensions-source) 的 manhuagui，Apache-2.0） |

- **動漫戲說**：
  - 標題含「暫缺」的冊沒有內容，不會出現在清單中。
  - 作者從作品頁的「作者：」欄位抓取；抓不到時在下載頁自己填。
- **漫畫櫃**：
  - 圖片清單藏在壓縮過的程式碼裡，擴充功能直接解碼，不會執行網站的程式。
  - 網站會暫時封鎖下載太快的 IP，所以固定最多同時 2 張、每張間隔 0.6 秒。
  - 成人作品需要先在網站上任選一話打開、按下「已滿 18 歲」確認，才能下載。

### 新增網站

每個網站一個檔案，放在 `src/sites/`，介面說明在 [`src/sites/registry.js`](src/sites/registry.js)：

- `parseSeries(doc, url)`：從作品頁取出書名、作者、封面與冊數清單
- `getPages(volume, ctx)`：取出一冊所有圖片的網址（`ctx.fetchDocument` 會自動處理 Big5／GBK 編碼）
- 選填：冊數加上 `group` 會分頁籤顯示；`limits` 可限制同時下載數與間隔
- 共用工具：`LZString.decompressFromBase64`、`Unpacker.unpack`（還原 packer 壓縮的程式碼，不執行它）

寫好後把檔案加進 `src/manifest.json` 的 `background.scripts`。

---

## 🛠️ 開發

```bash
node --test 'test/*.test.js'   # 單元測試（範圍解析、檔名、JPEG 解析、PDF 結構、LZString、packer 還原）
./build.sh                     # 把 src/ 打包成 firefox-extension-comic.zip
```

---

## 🔒 隱私

- 所有處理都在瀏覽器本機完成，不會傳送任何資料到第三方伺服器
- 只會連線到漫畫網站本身與其圖片伺服器
- 下載紀錄與設定存在瀏覽器本機（`storage.local`）
