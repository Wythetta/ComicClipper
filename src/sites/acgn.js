// acgn.js - comic.acgn.cc（動漫戲說）
// 作品頁範例：https://comic.acgn.cc/manhua-shengcunyouxi.htm
//
// 頁面結構參考 ComicCrawler 的 acgn 模組（MIT 授權，https://github.com/eight04/ComicCrawler）：
//   作品頁：書名在 <h3><a>，各冊連結為 <a href="view-…">（相對於作品頁），由舊到新排列
//   閱讀頁：整冊圖片都在同一頁，真正的圖片網址放在延遲載入屬性 _src
//   標題含「暫缺」的冊沒有內容
//   作者：ComicCrawler 沒有抓，這裡找頁面上的「作者：」標籤（找不到時可以在下載頁自己填）

const ACGN_MISSING = /暫缺|暂缺/;

/**
 * 找「作者：名字」，名字可能和標籤在同一段文字，或在下一個元素（<a>、<td>…）裡。
 * 各段文字以 \0 隔開後再比對，所以標籤與名字分屬不同元素也找得到。
 */
function acgnAuthor(doc) {
  const texts = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(node.parentElement?.tagName)) texts.push(node.textContent);
  }
  for (const m of texts.join('\0').matchAll(/(?:原作|作者)[\s\0]*[:：][\s\0]*([^\0\n|｜]+)/g)) {
    // 同一段文字裡接著其他欄位時切掉，例如「作者：某某　狀態：連載中」
    const name = m[1].split(/\s{2,}|\s+\S{1,4}[:：]/)[0].trim();
    if (name && name.length <= 40 && !/[:：]/.test(name)) return name;   // 有冒號表示作者欄是空的，抓到了下一個欄位
  }
  return '';
}

ComicSites.register({
  id: 'acgn',
  name: '動漫戲說 ACGN',
  match: (url) => /^https?:\/\/comic\.acgn\.cc\//i.test(url),
  referer: 'https://comic.acgn.cc/',
  direction: 'rtl',

  parseSeries(doc, url) {
    const title = doc.querySelector('h3 > a')?.textContent.trim() || doc.title.trim();

    // 同一冊出現多次時以最後一次為準：「最新一冊」「開始閱讀」等捷徑通常在完整清單之前
    const byUrl = new Map();
    for (const a of doc.querySelectorAll('a[href]')) {
      let link;
      try { link = new URL(a.getAttribute('href'), url); } catch (_) { continue; }
      const volTitle = a.textContent.trim();
      if (!/\/view-[^/]+$/i.test(link.pathname) || !volTitle) continue;
      byUrl.delete(link.href);
      byUrl.set(link.href, { title: volTitle, url: link.href });
    }
    const volumes = [...byUrl.values()].filter(v => !ACGN_MISSING.test(v.title));

    const cover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
    return {
      title,
      author: acgnAuthor(doc),
      cover: cover ? new URL(cover, url).href : '',
      volumes,
    };
  },

  async getPages(volume, ctx) {
    const doc = await ctx.fetchDocument(volume.url);
    const urls = [...doc.querySelectorAll('[_src]')]
      .map(el => el.getAttribute('_src').trim())
      .filter(Boolean)
      .map(src => new URL(src, volume.url).href);
    return [...new Set(urls)];
  },
});
