// acgn.js - comic.acgn.cc（動漫戲說）
// 作品頁範例：https://comic.acgn.cc/manhua-shengcunyouxi.htm
//
// 頁面結構參考 ComicCrawler 的 acgn 模組（MIT 授權，https://github.com/eight04/ComicCrawler）：
//   作品頁：書名在 <h3><a>，各冊連結為 <a href="view-…">（相對於作品頁），由舊到新排列
//   閱讀頁：整冊圖片都在同一頁，真正的圖片網址放在延遲載入屬性 _src
//   標題含「暫缺」的冊沒有內容

const ACGN_MISSING = /暫缺|暂缺/;

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
