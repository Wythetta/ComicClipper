// background.js - 下載工作：讀取作品頁冊數、逐冊下載圖片、組成 PDF、存到下載資料夾

// Kindle Scribe（10.2 吋，2022）螢幕解析度；圖片只縮小不放大
const DEVICE = { name: 'Kindle Scribe', maxLong: 2480, maxShort: 1860 };

const DEFAULT_SETTINGS = {
  splitSpreads: true,   // 橫向跨頁拆成兩頁
  grayscale: false,     // 轉灰階（會重新壓縮每一張圖）
  concurrency: 2,       // 同時下載張數
  delayMs: 300,         // 每張下載後的間隔，避免對網站造成負擔
  quality: 0.85,        // 需要重新壓縮時的 JPEG 品質
};

const EXT_ORIGIN = browser.runtime.getURL('');

// ── Referer（防盜連）──────────────────────────────────────
// 背景頁的 fetch 不會帶網站的 Referer，這裡替擴充功能自己發出的請求補上。
// 轉址後網址會變，但 requestId 不變，所以兩種都記。

const pendingReferers = new Map();   // 網址 → Referer
const requestReferers = new Map();   // requestId → Referer

browser.webRequest.onBeforeSendHeaders.addListener((details) => {
  if (details.tabId !== -1 || !(details.originUrl || '').startsWith(EXT_ORIGIN)) return {};
  const referer = requestReferers.get(details.requestId) || pendingReferers.get(details.url);
  if (!referer) return {};
  requestReferers.set(details.requestId, referer);
  const headers = details.requestHeaders.filter(h => !/^(referer|origin)$/i.test(h.name));
  headers.push({ name: 'Referer', value: referer });
  return { requestHeaders: headers };
}, { urls: ['<all_urls>'] }, ['blocking', 'requestHeaders']);

const forgetRequest = (details) => requestReferers.delete(details.requestId);
browser.webRequest.onCompleted.addListener(forgetRequest, { urls: ['<all_urls>'] });
browser.webRequest.onErrorOccurred.addListener(forgetRequest, { urls: ['<all_urls>'] });

// ── 網路與 HTML ───────────────────────────────────────────

async function fetchBuffer(url, { referer, signal, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  if (referer) pendingReferers.set(url, referer);
  try {
    const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { buffer: await res.arrayBuffer(), contentType: res.headers.get('content-type') || '' };
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) throw new Error('連線逾時');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    pendingReferers.delete(url);
  }
}

/** 依 Content-Type 或 <meta charset> 解碼，中文網站常用 Big5／GBK */
function decodeHtml(buffer, contentType) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = new TextDecoder('windows-1252').decode(buffer.slice(0, 4096));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buffer);
  } catch (_) {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/** 解析 HTML，並設好 <base>，讓 a.href、img.src 等以原網址解析相對路徑 */
function parseHtml(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const existing = doc.querySelector('base[href]');
  if (existing) {
    existing.setAttribute('href', new URL(existing.getAttribute('href'), url).href);
  } else {
    const base = doc.createElement('base');
    base.setAttribute('href', url);
    doc.head.prepend(base);
  }
  return doc;
}

/** 提供給網站規則使用的工具 */
function makeSiteContext(site, signal) {
  return {
    async fetchText(url) {
      const { buffer, contentType } = await ComicUtil.withRetry(
        () => fetchBuffer(url, { referer: site.referer, signal }), { retries: 2, signal });
      return decodeHtml(buffer, contentType);
    },
    async fetchDocument(url) {
      return parseHtml(await this.fetchText(url), url);
    },
  };
}

// ── 設定與下載紀錄 ────────────────────────────────────────

async function getSettings() {
  const { settings } = await browser.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function getSeriesRecord(seriesUrl) {
  const key = `series:${seriesUrl}`;
  const data = await browser.storage.local.get(key);
  return data[key] || {};
}

async function updateSeriesRecord(seriesUrl, update) {
  const key = `series:${seriesUrl}`;
  const record = await getSeriesRecord(seriesUrl);
  await browser.storage.local.set({ [key]: update(record) });
}

// ── 讀取作品頁 ────────────────────────────────────────────

function detect(url) {
  const site = ComicSites.find(url || '');
  return {
    supported: !!site,
    siteName: site?.name || '',
    supportedSites: ComicSites.list.map(s => s.name),
  };
}

async function loadSeries({ url, tabId }) {
  const site = ComicSites.find(url);
  if (!site) throw new Error('這個網站還沒有支援');

  // 優先讀取使用者開著的分頁（已執行過網頁的 JavaScript），分頁不在了再重新下載
  let doc = null;
  if (tabId != null) {
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab.url === url) {
        const [html] = await browser.tabs.executeScript(tabId, { code: 'document.documentElement.outerHTML' });
        if (html) doc = parseHtml(html, url);
      }
    } catch (_) { /* 分頁已關閉或無法讀取 */ }
  }
  if (!doc) doc = await makeSiteContext(site).fetchDocument(url);

  const series = await site.parseSeries(doc, url);
  if (!series?.volumes?.length) throw new Error('作品頁找不到任何冊數');

  const record = await getSeriesRecord(url);
  return {
    site: { id: site.id, name: site.name },
    series: {
      title: series.title || '未命名',
      author: series.author || '',
      cover: series.cover || '',
      volumes: series.volumes.map(v => ({ title: v.title, url: v.url })),
    },
    direction: record.direction || site.direction || 'rtl',
    downloaded: record.downloaded || {},
    settings: await getSettings(),
    device: DEVICE.name,
  };
}

// ── 下載工作 ──────────────────────────────────────────────
// 同一時間只跑一個工作；一冊一冊依序處理，限制記憶體用量

let job = null;
let jobAbort = null;
let notifyTimer = null;

browser.browserAction.setBadgeBackgroundColor({ color: '#6c63ff' });

function notify(immediate = false) {
  if (notifyTimer && !immediate) return;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    browser.runtime.sendMessage({ type: 'jobUpdate', job }).catch(() => {});   // 下載頁沒開時會失敗，忽略
    const finished = job.volumes.filter(v => !['waiting', 'listing', 'downloading', 'packing'].includes(v.status)).length;
    browser.browserAction.setBadgeText({ text: job.status === 'running' ? `${finished}/${job.volumes.length}` : '' });
  }, immediate ? 0 : 250);
}

/** 平行處理（最多 limit 個），任一項失敗就停止領取新的工作 */
async function mapPool(items, limit, signal, fn) {
  const results = new Array(items.length);
  let next = 0;
  let failed = null;
  const worker = async () => {
    while (!failed && next < items.length) {
      if (signal.aborted) { failed = failed || new Error('已取消'); break; }
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        failed = failed || e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw failed;
  return results;
}

function waitForDownload(id) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (item) => {
      if (settled) return;
      if (item.state === 'complete') {
        settled = true;
        browser.downloads.onChanged.removeListener(listener);
        resolve(item);
      } else if (item.state === 'interrupted') {
        settled = true;
        browser.downloads.onChanged.removeListener(listener);
        reject(new Error(`存檔失敗：${item.error || '下載中斷'}`));
      }
    };
    const check = async () => {
      const [item] = await browser.downloads.search({ id });
      if (item) finish(item);
    };
    const listener = (delta) => { if (delta.id === id && delta.state) check(); };
    browser.downloads.onChanged.addListener(listener);
    check();   // 檔案很小時可能在掛上監聽前就已完成
  });
}

async function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const id = await browser.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    const item = await waitForDownload(id);
    return { downloadId: id, path: item.filename };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function startJob({ seriesUrl, series, volumeUrls, direction, settings }) {
  if (job?.status === 'running') throw new Error('已有下載工作進行中，請等它完成或取消');
  const site = ComicSites.find(seriesUrl);
  if (!site) throw new Error('這個網站還沒有支援');

  const merged = { ...(await getSettings()), ...settings };
  await browser.storage.local.set({ settings: merged });
  await updateSeriesRecord(seriesUrl, r => ({ ...r, direction }));

  const wanted = new Set(volumeUrls);
  job = {
    seriesUrl,
    title: series.title,
    status: 'running',
    volumes: series.volumes.filter(v => wanted.has(v.url)).map(v => ({
      url: v.url, title: v.title, status: 'waiting', done: 0, total: 0, error: '', path: '', downloadId: null,
    })),
  };
  jobAbort = new AbortController();
  runJob(site, series, direction, merged, jobAbort.signal).catch(e => console.error('ComicClipper job error', e));
  notify(true);
  return job;
}

async function runJob(site, series, direction, settings, signal) {
  const ctx = makeSiteContext(site, signal);
  const rtl = direction === 'rtl';
  const imageOpts = {
    maxLong: DEVICE.maxLong, maxShort: DEVICE.maxShort,
    splitSpreads: settings.splitSpreads, rtl, grayscale: settings.grayscale, quality: settings.quality,
  };
  const folder = ComicUtil.sanitizeFilename(series.title);
  const padWidth = Math.max(2, ...series.volumes.map(v => ComicUtil.leadingNumberWidth(v.title)));

  for (const vol of job.volumes) {
    if (signal.aborted) { vol.status = 'cancelled'; continue; }
    try {
      vol.status = 'listing';
      notify(true);
      const urls = await site.getPages({ title: vol.title, url: vol.url }, ctx);
      if (!urls?.length) throw new Error('閱讀頁找不到任何圖片');

      vol.total = urls.length;
      vol.status = 'downloading';
      notify(true);
      const pages = await mapPool(urls, settings.concurrency, signal, async (imgUrl, i) => {
        let buffer;
        try {
          ({ buffer } = await ComicUtil.withRetry(
            () => fetchBuffer(imgUrl, { referer: site.referer, signal }), { retries: 3, signal }));
        } catch (e) {
          throw new Error(`第 ${i + 1} 頁下載失敗（${e.message}）`);
        }
        let result;
        try {
          result = await ImagePipeline.processImage(new Uint8Array(buffer), imageOpts);
        } catch (e) {
          throw new Error(`第 ${i + 1} 頁無法處理（${e.message}）`);
        }
        vol.done++;
        notify();
        if (settings.delayMs) await ComicUtil.sleep(settings.delayMs);
        return result;
      });

      vol.status = 'packing';
      notify(true);
      const bookTitle = `${series.title} ${ComicUtil.padVolumeNumber(vol.title, padWidth)}`;
      const pdf = new PDFWriter({ title: bookTitle, author: series.author, rtl });
      for (const page of pages.flat()) pdf.addJpegPage(page);
      const saved = await saveBlob(pdf.toBlob(), `ComicClipper/${folder}/${ComicUtil.sanitizeFilename(bookTitle)}.pdf`);

      vol.path = saved.path;
      vol.downloadId = saved.downloadId;
      vol.status = 'done';
      await updateSeriesRecord(job.seriesUrl, r => ({
        ...r, downloaded: { ...r.downloaded, [vol.url]: new Date().toISOString() },
      }));
    } catch (e) {
      vol.status = signal.aborted ? 'cancelled' : 'failed';
      vol.error = signal.aborted ? '' : e.message;
    }
    notify(true);
  }

  job.status = signal.aborted ? 'cancelled' : 'done';
  notify(true);
}

// ── 訊息 ──────────────────────────────────────────────────

const respond = (promise) => Promise.resolve(promise).then(
  data => ({ ok: true, data }),
  e => ({ ok: false, error: e?.message || String(e) }),
);

browser.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case 'detect':     return respond(detect(msg.url));
    case 'loadSeries': return respond(loadSeries(msg));
    case 'startJob':   return respond(startJob(msg));
    case 'cancelJob':  jobAbort?.abort(); return respond(true);
    case 'getJob':     return respond(job);
    case 'showFile':   return respond(browser.downloads.show(msg.downloadId));
  }
  return undefined;
});
