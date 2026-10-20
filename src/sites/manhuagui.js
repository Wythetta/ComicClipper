// manhuagui.js - 漫畫櫃 www／tw.manhuagui.com（鏡像站 mhgui.com）
// 作品頁範例：https://www.manhuagui.com/comic/1759/
//
// 頁面結構參考 Mihon 的 manhuagui 擴充（Apache-2.0，https://github.com/keiyoushi/extensions-source）
// 與 ComicCrawler 的 seemh 模組（MIT，https://github.com/eight04/ComicCrawler）：
//   作品頁：各區（單行本、單話、番外篇…）的標題在 <h4>，清單在 [id^=chapter-list-] 內的 <a href="/comic/作品/話.html">
//           成人作品的清單以 LZString 壓縮後放在 #__VIEWSTATE
//   閱讀頁：圖片清單在 packer 壓縮的程式碼裡，字典再經 LZString 壓縮；
//           還原後是 SMH.imgData({files, path, sl: {e, m}})，圖片網址為 圖片伺服器 + path + 檔名 + ?e=…&m=…
//   網站會封鎖請求太快的 IP（Mihon 預設：主站每 10 秒 10 次、圖片伺服器每秒 4 次）

const MANHUAGUI_ADULT = '這部作品需要先在漫畫櫃網站上確認已滿 18 歲（任選一話打開並按確認）後再下載';

/** 元素本身的文字，不含子元素（例如 <span>第01卷<i>180p</i></span> → 第01卷） */
function manhuaguiOwnText(el) {
  return [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
}

/** 同一區的話數依標題中的數字排成由舊到新；有標題沒數字時，只在整體是由新到舊時反轉 */
function manhuaguiSortGroup(items) {
  const nums = items.map(v => { const m = /\d+(\.\d+)?/.exec(v.title); return m ? parseFloat(m[0]) : null; });
  if (nums.every(n => n !== null)) {
    return items.map((v, i) => [v, nums[i], i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(x => x[0]);
  }
  const numbered = nums.filter(n => n !== null);
  return numbered.length >= 2 && numbered[0] > numbered[numbered.length - 1] ? items.slice().reverse() : items;
}

ComicSites.register({
  id: 'manhuagui',
  name: '漫畫櫃',
  match: (url) => /^https?:\/\/(www\.|tw\.)?(manhuagui|mhgui)\.com\/comic\/\d+/i.test(url),
  referer: 'https://www.manhuagui.com/',
  imageHost: 'https://i.hamreus.com',
  direction: 'rtl',
  limits: { concurrency: 2, delayMs: 600 },

  parseSeries(doc, url) {
    const cid = /\/comic\/(\d+)/.exec(url)[1];
    const chapterPath = new RegExp(`/comic/${cid}/\\d+\\.html$`);

    // 成人作品：清單壓縮在 #__VIEWSTATE，畫面上只有提示
    let root = doc;
    const hasList = doc.querySelector('[id^="chapter-list-"] a[href]');
    const viewState = doc.querySelector('#__VIEWSTATE')?.getAttribute('value');
    if (!hasList && viewState) {
      const html = LZString.decompressFromBase64(viewState);
      if (!html) throw new Error('成人作品的冊數清單解壓縮失敗');
      root = new DOMParser().parseFromString(html, 'text/html');
    }

    const groups = new Map();   // 區名 → 該區的冊數
    let section = '';
    const seen = new Set();
    for (const el of root.querySelectorAll('h4, [id^="chapter-list-"] a[href]')) {
      if (el.tagName === 'H4') {
        section = (el.querySelector('span') || el).textContent.trim();
        continue;
      }
      let link;
      try { link = new URL(el.getAttribute('href'), url); } catch (_) { continue; }
      if (!chapterPath.test(link.pathname) || seen.has(link.href)) continue;
      const span = el.querySelector('span');
      const title = (el.getAttribute('title') || (span ? manhuaguiOwnText(span) : el.textContent)).trim();
      if (!title) continue;
      seen.add(link.href);
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push({ title, url: link.href, group: section });
    }

    const authorLabel = [...doc.querySelectorAll('span')].find(s => /漫[画畫]作者/.test(s.firstChild?.textContent || ''));
    const cover = doc.querySelector('p.hcover > img')?.getAttribute('src');
    return {
      title: (doc.querySelector('.book-title h1') || doc.querySelector('h1'))?.textContent.trim() || '',
      author: authorLabel ? [...authorLabel.querySelectorAll('a')].map(a => a.textContent.trim()).join('、') : '',
      cover: cover ? new URL(cover, url).href : '',
      volumes: [...groups.values()].flatMap(manhuaguiSortGroup),
    };
  },

  async getPages(volume, ctx) {
    const doc = await ctx.fetchDocument(volume.url);
    const packed = [...doc.querySelectorAll('script:not([src])')]
      .map(s => s.textContent)
      .find(text => /function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)/.test(text));
    if (!packed) {
      if (doc.querySelector('#erroraudit_show')) throw new Error(MANHUAGUI_ADULT);
      throw new Error('閱讀頁找不到圖片資料，網站可能改版了');
    }

    const code = Unpacker.unpack(packed, LZString.decompressFromBase64);
    const start = code ? code.indexOf('{') : -1;
    const end = code ? code.lastIndexOf('}') : -1;
    if (start < 0 || end < start) throw new Error('圖片資料解析失敗，網站可能改版了');
    const data = JSON.parse(code.slice(start, end + 1));
    if (!Array.isArray(data.files) || !data.files.length) throw new Error('閱讀頁沒有任何圖片');

    return data.files.map((file) => {
      const img = new URL((data.path || '') + file, this.imageHost);
      if (data.sl) img.search = new URLSearchParams({ e: data.sl.e ?? '', m: data.sl.m ?? '' }).toString();
      return img.href;
    });
  },
});
