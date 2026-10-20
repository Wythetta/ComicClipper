// acgn.js - comic.acgn.cc
// 作品頁範例：https://comic.acgn.cc/manhua-shengcunyouxi.htm
//
// TODO：解析規則需要實際頁面的 HTML 樣本（作品頁＋任一冊的閱讀頁）才能撰寫，
// 收到樣本前先只認得網址，使用時會顯示「尚未完成」。

const ACGN_NOT_READY = 'ACGN 的解析規則還沒完成：需要作品頁與閱讀頁的 HTML 樣本';

ComicSites.register({
  id: 'acgn',
  name: 'ACGN 漫畫',
  match: (url) => /^https?:\/\/comic\.acgn\.cc\//i.test(url),
  referer: 'https://comic.acgn.cc/',
  direction: 'rtl',

  parseSeries(_doc, _url) {
    throw new Error(ACGN_NOT_READY);
  },

  async getPages(_volume, _ctx) {
    throw new Error(ACGN_NOT_READY);
  },
});
