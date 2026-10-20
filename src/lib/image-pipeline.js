// image-pipeline.js - 下載後的圖片處理：判斷格式、跨頁拆分、縮圖、灰階、轉 JPEG
// 原則：能不重新壓縮就不重新壓縮。一般 JPEG、尺寸沒超過螢幕、不需拆頁時，原檔直接放進 PDF。

(function (root) {
  /** 由檔頭判斷圖片格式 */
  function sniffType(b) {
    if (b.length < 12) return null;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'avif'; // ftyp（AVIF/HEIF）
    if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
    return null;
  }

  /**
   * 讀取 JPEG 的 SOF 標記：寬、高、色版數，以及是否為 baseline 編碼。
   * 只有 baseline（SOF0/SOF1）會原檔嵌入；progressive 等其他編碼重新壓縮，避免 Kindle 顯示不出來。
   */
  function readJpegInfo(b) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }                          // 填充位元組
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        return {
          height: (b[i + 5] << 8) | b[i + 6],
          width: (b[i + 7] << 8) | b[i + 8],
          components: b[i + 9],
          baseline: marker === 0xc0 || marker === 0xc1,
        };
      }
      if (marker === 0xda || marker === 0xd9) return null;             // 掃描資料開始前都沒有 SOF
      i += 2 + len;
    }
    return null;
  }

  /** 等比縮小到長邊 ≤ maxLong、短邊 ≤ maxShort，不放大 */
  function fitScale(w, h, maxLong, maxShort) {
    return Math.min(1, maxLong / Math.max(w, h), maxShort / Math.min(w, h));
  }

  function toGrayscale(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
  }

  /** 畫出 source 的 (sx, sw) 區段並縮放到 dw×dh；縮小超過一半時分段縮，避免鋸齒 */
  function drawScaled(bitmap, sx, sw, sh, dw, dh) {
    let src = bitmap, srcX = sx, srcW = sw, srcH = sh;
    while (srcW / 2 >= dw && srcH / 2 >= dh) {
      const hw = Math.round(srcW / 2), hh = Math.round(srcH / 2);
      const step = new OffscreenCanvas(hw, hh);
      const sctx = step.getContext('2d');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(src, srcX, 0, srcW, srcH, 0, 0, hw, hh);
      src = step; srcX = 0; srcW = hw; srcH = hh;
    }
    const canvas = new OffscreenCanvas(dw, dh);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';                 // 透明背景（PNG）填白
    ctx.fillRect(0, 0, dw, dh);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, srcX, 0, srcW, srcH, 0, 0, dw, dh);
    return { canvas, ctx };
  }

  /**
   * 處理一張下載的圖片，回傳 PDF 頁面陣列（跨頁拆開時是兩頁）
   * @param {Uint8Array} bytes
   * @param {object} opts
   * @param {number} opts.maxLong / opts.maxShort  螢幕解析度（Kindle Scribe：2480 / 1860）
   * @param {boolean} opts.splitSpreads  橫向跨頁拆成兩頁
   * @param {boolean} opts.rtl           右翻：拆頁時右半頁在前
   * @param {boolean} opts.grayscale     轉灰階
   * @param {number} opts.quality        重新壓縮時的 JPEG 品質（0–1）
   * @returns {Promise<Array<{bytes: Uint8Array, width: number, height: number, components: number}>>}
   */
  async function processImage(bytes, opts) {
    const type = sniffType(bytes);
    if (!type) throw new Error('不是可辨識的圖片格式');

    const info = type === 'jpeg' ? readJpegInfo(bytes) : null;
    if (info && info.baseline && (info.components === 1 || info.components === 3) &&
        !(opts.splitSpreads && info.width > info.height) &&
        !(opts.grayscale && info.components === 3) &&
        fitScale(info.width, info.height, opts.maxLong, opts.maxShort) === 1) {
      return [{ bytes, width: info.width, height: info.height, components: info.components }];
    }

    const bitmap = await createImageBitmap(new Blob([bytes]));
    try {
      const { width: w, height: h } = bitmap;
      const halfL = Math.floor(w / 2);
      let slices = [{ sx: 0, sw: w }];
      if (opts.splitSpreads && w > h) {
        const left = { sx: 0, sw: halfL };
        const right = { sx: halfL, sw: w - halfL };
        slices = opts.rtl ? [right, left] : [left, right];
      }

      const pages = [];
      for (const { sx, sw } of slices) {
        const scale = fitScale(sw, h, opts.maxLong, opts.maxShort);
        const dw = Math.max(1, Math.round(sw * scale));
        const dh = Math.max(1, Math.round(h * scale));
        const { canvas, ctx } = drawScaled(bitmap, sx, sw, h, dw, dh);
        if (opts.grayscale) toGrayscale(ctx, dw, dh);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: opts.quality });
        const out = new Uint8Array(await blob.arrayBuffer());
        const outInfo = readJpegInfo(out);
        pages.push({ bytes: out, width: dw, height: dh, components: outInfo ? outInfo.components : 3 });
      }
      return pages;
    } finally {
      bitmap.close();
    }
  }

  const api = { sniffType, readJpegInfo, fitScale, processImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImagePipeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
