// dm5.js - 動漫屋 www.dm5.com（鏡像站 dm5.cn）
// 作品頁範例：https://www.dm5.com/manhua-lieren/
//
// 作品頁依實際頁面（2026-10）；閱讀頁參考 Mihon 的 dm5 擴充（Apache-2.0，https://github.com/keiyoushi/extensions-source）
// 與 ComicCrawler 的 dm5 模組（MIT，https://github.com/eight04/ComicCrawler）：
//   作品頁：書名、作者、封面在 .banner_detail_form；各區（连载、番外…）的分頁籤是 .detail-list-title > a.block，
//           onclick 指向該區的 ul#detail-list-select-N；「展开全部章节」收起來的話在巢狀的 ul.chapteritem 裡。
//           清單預設由新到舊，排序鈕顯示目前的順序（倒序／正序）；「连载」區常把單行本（第N卷）和單話混在一起
//   閱讀頁：條漫的圖片直接在 #barChapter img.load-src[data-src]；
//           其他的用頁面上的 DM5_CID、DM5_MID、DM5_VIEWSIGN_DT、DM5_VIEWSIGN 向該話底下的 chapterfun.ashx 逐頁要網址，
//           回應是 packer 壓縮的程式碼，還原後圖片網址為 pix + pvalue[i] + 查詢字串；一次會給這一頁和下一頁
//   chapterfun.ashx 和圖片都要帶這一話的網址當 Referer

const DM5_VOLUME = /^第\s*\d+(\.\d+)?\s*卷/;

/** 元素本身的文字，不含子元素（例如 <p class="title">猎人<span>8.8分</span></p> → 猎人） */
function dm5OwnText(el) {
  return [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
}

/** 頁面內嵌程式碼裡的變數值，例如 var DM5_CID=123; 或 var DM5_VIEWSIGN="…"; */
function dm5Var(scripts, name) {
  return new RegExp(`\\b${name}\\s*=\\s*["']?([^"';]*)`).exec(scripts)?.[1].trim() ?? '';
}

const dm5Scripts = (doc) => [...doc.querySelectorAll('script:not([src])')].map(s => s.textContent).join('\n');

/**
 * 清單是否由新到舊：看排序鈕目前的狀態，沒有時看 DM5_COMIC_SORT（1 為由舊到新），
 * 都沒有就比較頭尾兩話網址的編號（/m123/ 的數字隨上架時間增加）
 */
function dm5Descending(doc, scripts, items) {
  const order = doc.querySelector('.detail-list-title a.order')?.textContent.trim();
  if (order === '倒序' || order === '正序') return order === '倒序';
  const sort = dm5Var(scripts, 'DM5_COMIC_SORT');
  if (sort) return sort !== '1';
  const id = (v) => parseInt(/\/m(\d+)/.exec(v.url)?.[1] || '0', 10);
  return items.length > 1 && id(items[0]) > id(items[items.length - 1]);
}

/** 每一話的標題都有數字時依數字排（網站偶爾把話放錯位置），否則維持原順序 */
function dm5SortByNumber(items) {
  const nums = items.map(v => /\d+(\.\d+)?/.exec(v.title));
  if (nums.some(n => !n)) return items;
  return items.map((v, i) => [v, parseFloat(nums[i][0]), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(x => x[0]);
}

/** 從還原後的 chapterfun 程式碼取出圖片網址：pix + pvalue[i] + 查詢字串（引號可能是單引號或雙引號） */
function dm5ImageUrls(code, base) {
  const pix = /\bpix\s*=\s*(['"])(.*?)\1/.exec(code)?.[2];
  const list = /\bpvalue\s*=\s*\[([^\]]*)\]/.exec(code)?.[1];
  if (pix == null || list == null) return [];
  const query = /pix\s*\+\s*pvalue\[\w+\]\s*\+\s*(['"])(.*?)\1/.exec(code)?.[2] || '';
  return [...list.matchAll(/(['"])(.*?)\1/g)].map(m => new URL(pix + m[2] + query, base).href);
}

ComicSites.register({
  id: 'dm5',
  name: '動漫屋',
  match: (url) => /^https?:\/\/(www\.|tel\.|hk\.)?dm5\.(com|cn)\/manhua-[^/?#]+/i.test(url),
  referer: 'https://www.dm5.com/',
  imageReferer: (volume) => volume.url,
  direction: 'rtl',

  parseSeries(doc, url) {
    const scripts = dm5Scripts(doc);
    const container = doc.querySelector('#chapterlistload');
    if (!container) {
      const warning = doc.querySelector('.warning-bar')?.textContent.replace(/\s+/g, ' ').trim();
      throw new Error(warning || '作品頁找不到章節清單，網站可能改版了');
    }

    // 分頁籤的 onclick 指向該區的清單，例如 titleSelect(this, 'detail-list-select', 'detail-list-select-3')
    const tabs = [...doc.querySelectorAll('.detail-list-title a.block')];
    const tabName = (a) => a.textContent.replace(/[（(]\d+[)）]/g, '').trim();
    const tabFor = (ul, i) => tabs.find(a => ul.id && (a.getAttribute('onclick') || '').includes(`'${ul.id}'`)) || tabs[i];
    const volumeGroup = /[連單]/.test(tabs.map(tabName).join('')) ? '單行本' : '单行本';

    const groups = new Map();   // 區名 → 該區的話，由舊到新
    const add = (group, items) => { if (items.length) groups.set(group, [...(groups.get(group) || []), ...items]); };
    const seen = new Set();
    [...container.children].filter(el => el.tagName === 'UL').forEach((ul, i) => {
      const tab = tabFor(ul, i);
      const items = [];
      for (const a of ul.querySelectorAll('li > a[href]')) {
        let link;
        try { link = new URL(a.getAttribute('href'), url); } catch (_) { continue; }
        if (!/^\/m\d+\/?$/.test(link.pathname) || seen.has(link.href)) continue;
        // 標題後面的（16P）是頁數，不放進檔名
        const title = (a.querySelector('p.title') || a).textContent.replace(/[（(]\d+P[)）]/gi, '').replace(/\s+/g, ' ').trim()
          || (a.getAttribute('title') || '').trim();
        if (!title) continue;
        seen.add(link.href);
        items.push({ title, url: link.href });
      }
      if (dm5Descending(doc, scripts, items)) items.reverse();

      // 同一區有單行本也有單話時，單行本另成一區，方便只選整卷，檔名補零的位數也分開算
      const section = tab ? tabName(tab) : '';
      const volumes = items.filter(v => DM5_VOLUME.test(v.title));
      if (volumes.length && volumes.length < items.length) {
        add(section, items.filter(v => !DM5_VOLUME.test(v.title)));
        add(volumeGroup, volumes);
      } else {
        add(section, items);
      }
    });

    const info = doc.querySelector('.banner_detail_form');
    const titleEl = info?.querySelector('p.title');
    const cover = info?.querySelector('.cover img')?.getAttribute('src');
    return {
      title: (titleEl && dm5OwnText(titleEl)) || dm5Var(scripts, 'DM5_COMIC_MNAME'),
      author: [...(info?.querySelectorAll('p.subtitle a') || [])].map(a => a.textContent.trim()).filter(Boolean).join('、'),
      cover: cover ? new URL(cover, url).href : '',
      volumes: [...groups].flatMap(([group, items]) => dm5SortByNumber(items).map(v => ({ ...v, group }))),
    };
  },

  async getPages(volume, ctx) {
    const doc = await ctx.fetchDocument(volume.url);
    const scripts = dm5Scripts(doc);
    const cid = dm5Var(scripts, 'DM5_CID');
    const dt = dm5Var(scripts, 'DM5_VIEWSIGN_DT');
    if (!cid || !dt) {
      const reason = doc.querySelector('.view-pay-form p.subtitle, .warning-bar')?.textContent.replace(/\s+/g, ' ').trim();
      if (reason) throw new Error(reason);
      throw new Error(cid ? '這一話缺少看圖的簽章，可能需要付費或登入' : '閱讀頁找不到圖片資料，網站可能改版了');
    }

    // 條漫：整話的圖片都在頁面上
    const inline = [...doc.querySelectorAll('#barChapter img.load-src')]
      .map(img => img.getAttribute('data-src')).filter(Boolean);
    if (inline.length) return inline.map(src => new URL(src, volume.url).href);

    const count = parseInt(dm5Var(scripts, 'DM5_IMAGE_COUNT'), 10);
    if (!(count > 0)) throw new Error('閱讀頁沒有任何圖片');
    const mid = dm5Var(scripts, 'DM5_MID');
    const sign = dm5Var(scripts, 'DM5_VIEWSIGN');
    const pages = [];
    while (pages.length < count) {
      const api = new URL('chapterfun.ashx', volume.url);
      api.search = new URLSearchParams({
        cid, page: pages.length + 1, key: '', language: 1, gtk: 6, _cid: cid, _mid: mid, _dt: dt, _sign: sign,
      }).toString();
      const code = Unpacker.unpack(await ctx.fetchText(api.href, { referer: volume.url }));
      const urls = code ? dm5ImageUrls(code, volume.url) : [];
      if (!urls.length) throw new Error(`第 ${pages.length + 1} 頁的圖片網址解析失敗，網站可能改版了`);
      pages.push(...urls.slice(0, count - pages.length));
    }
    return pages;
  },
});
