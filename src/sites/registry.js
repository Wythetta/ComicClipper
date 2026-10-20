// registry.js - 網站規則登錄表
// 每個網站一個檔案（例如 sites/acgn.js），呼叫 ComicSites.register(...) 註冊，並加進 manifest.json 的 background.scripts。
//
// 規則的介面：
// {
//   id:        'acgn',                       // 唯一代號
//   name:      'ACGN 漫畫',                  // 顯示名稱
//   match(url)            → boolean          // 這個網址是否屬於此網站
//   referer:   'https://…/',                 // 下載圖片時帶的 Referer（防盜連）
//   direction: 'rtl' | 'ltr',                // 預設翻頁方向，日漫為 rtl
//   limits:    { concurrency, delayMs },     // 選填：網站會封鎖太快的請求時，限制同時下載數與間隔
//
//   parseSeries(doc, url) → {                // doc：作品頁的 Document（已設好 <base>）
//     title, author, cover,                  // author、cover 可省略
//     volumes: [{ title, url, group }],      // 依閱讀順序排列；group 選填（例如「單行本」「單話」），下載頁會分頁籤顯示
//   }
//   async getPages(volume, ctx) → [圖片網址…] // 依頁序排列
//     ctx.fetchDocument(url) → Document      // 會自動判斷 Big5／GBK 等編碼
//     ctx.fetchText(url)     → string
// }

const ComicSites = {
  list: [],

  register(site) {
    this.list.push(site);
  },

  find(url) {
    return this.list.find(site => {
      try { return site.match(url); } catch (_) { return false; }
    }) || null;
  },
};
