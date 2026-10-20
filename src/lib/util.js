// util.js - 共用小工具（背景頁、下載頁與 Node 測試共用）

(function (root) {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * 解析範圍字串，例如 "1-5, 8, 12-15"，回傳 1 起算的編號陣列（已排序、不重複）。
   * 超出 1..max 的編號會被忽略；格式錯誤的片段丟出錯誤，讓使用者知道哪裡打錯。
   */
  function parseRange(text, max) {
    const picked = new Set();
    const parts = String(text || '').split(/[,，、\s]+/).filter(Boolean);
    for (const part of parts) {
      const m = /^(\d+)(?:\s*[-~～－]\s*(\d+))?$/.exec(part);
      if (!m) throw new Error(`看不懂「${part}」，範圍請寫成像 1-5, 8`);
      let from = parseInt(m[1], 10);
      let to = m[2] ? parseInt(m[2], 10) : from;
      if (from > to) [from, to] = [to, from];
      for (let i = Math.max(1, from); i <= Math.min(max, to); i++) picked.add(i);
    }
    return [...picked].sort((a, b) => a - b);
  }

  /** 檔名／資料夾名稱去掉作業系統不允許的字元 */
  function sanitizeFilename(name) {
    const clean = String(name || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 120)
      .trim();
    return clean || 'untitled';
  }

  /** 標題中第一個數字的位數（沒有數字回傳 0） */
  function leadingNumberWidth(title) {
    const m = /\d+/.exec(String(title || ''));
    return m ? String(parseInt(m[0], 10)).length : 0;
  }

  /**
   * 把標題中第一個數字補零到指定位數，例如 ("第1卷", 2) → "第01卷"。
   * Kindle 書庫依名稱排序，不補零的話「第10卷」會排在「第2卷」前面。
   */
  function padVolumeNumber(title, width) {
    return String(title || '').replace(/\d+/, d => String(parseInt(d, 10)).padStart(width, '0'));
  }

  /** 失敗時等待後重試（等待時間逐次加倍）；signal 中止時立刻停止 */
  async function withRetry(fn, { retries = 3, baseDelay = 1000, signal } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw new Error('已取消');
      try {
        return await fn(attempt);
      } catch (e) {
        lastError = e;
        if (signal?.aborted) throw new Error('已取消');
        if (attempt < retries) await sleep(baseDelay * 2 ** attempt);
      }
    }
    throw lastError;
  }

  const api = { sleep, parseRange, sanitizeFilename, leadingNumberWidth, padVolumeNumber, withRetry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ComicUtil = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
