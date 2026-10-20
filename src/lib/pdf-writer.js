// pdf-writer.js - 把 JPEG 圖片逐頁組成 PDF
// JPEG 原檔直接以 DCTDecode 嵌入，不重新壓縮；每頁尺寸等於圖片比例，沒有白邊。

(function (root) {
  const enc = new TextEncoder();

  /** PDF 文字字串：UTF-16BE 十六進位，中文書名才不會變亂碼 */
  function pdfTextString(str) {
    let hex = 'FEFF';
    for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, '0');
    return `<${hex.toUpperCase()}>`;
  }

  function pdfDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
           `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  }

  const num = (n) => String(Math.round(n * 100) / 100);

  class PDFWriter {
    /**
     * @param {object} opts
     * @param {string} opts.title   PDF 書名（Kindle 書庫會顯示）
     * @param {string} opts.author  作者（Kindle 書庫會顯示）；空字串時不寫入
     * @param {boolean} opts.rtl         右翻漫畫：寫入 /Direction /R2L
     * @param {number} opts.pageHeight   每頁高度（pt）；所有頁面同高，解析度不同的圖片放大縮小時才一致
     */
    constructor({ title = '', author = '', rtl = false, pageHeight = 792 } = {}) {
      this.title = title;
      this.author = author;
      this.rtl = rtl;
      this.pageHeight = pageHeight;
      this.parts = [];
      this.offset = 0;
      this.offsets = [];   // 物件編號 → 檔案中的位元組位置
      this.pageRefs = [];
      this.nextId = 4;     // 1 Catalog、2 Pages、3 Info，頁面物件從 4 開始

      this._push(enc.encode('%PDF-1.4\n'));
      this._push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // 二進位註解，標示檔案含二進位資料
    }

    get pageCount() { return this.pageRefs.length; }

    _push(bytes) {
      this.parts.push(bytes);
      this.offset += bytes.length;
    }

    _pushText(str) { this._push(enc.encode(str)); }

    _beginObject(id) {
      this.offsets[id] = this.offset;
      this._pushText(`${id} 0 obj\n`);
    }

    /**
     * 加入一頁
     * @param {{bytes: Uint8Array, width: number, height: number, components: number}} page
     *   components：1 = 灰階、3 = 彩色（CMYK 等其他格式請先轉成一般 JPEG）
     */
    addJpegPage({ bytes, width, height, components }) {
      if (components !== 1 && components !== 3) throw new Error(`不支援 ${components} 色版的 JPEG`);
      const pageId = this.nextId++;
      const contentId = this.nextId++;
      const imageId = this.nextId++;
      const h = this.pageHeight;
      const w = width * h / height;

      this._beginObject(pageId);
      this._pushText(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w)} ${num(h)}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
      );

      const content = `q ${num(w)} 0 0 ${num(h)} 0 0 cm /Im0 Do Q`;
      this._beginObject(contentId);
      this._pushText(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

      this._beginObject(imageId);
      this._pushText(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /${components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`
      );
      this._push(bytes);
      this._pushText('\nendstream\nendobj\n');

      this.pageRefs.push(pageId);
    }

    /** 寫入目錄、資訊與交叉參照表，回傳 PDF Blob。呼叫後不能再加頁。 */
    toBlob() {
      if (!this.pageRefs.length) throw new Error('PDF 沒有任何頁面');

      this._beginObject(1);
      this._pushText(
        `<< /Type /Catalog /Pages 2 0 R /PageLayout /SinglePage` +
        (this.rtl ? ' /ViewerPreferences << /Direction /R2L >>' : '') +
        ` >>\nendobj\n`
      );

      this._beginObject(2);
      this._pushText(
        `<< /Type /Pages /Count ${this.pageRefs.length} ` +
        `/Kids [${this.pageRefs.map(id => `${id} 0 R`).join(' ')}] >>\nendobj\n`
      );

      this._beginObject(3);
      this._pushText(
        `<< /Title ${pdfTextString(this.title)} ` +
        (this.author ? `/Author ${pdfTextString(this.author)} ` : '') +
        `/Creator (ComicClipper) /Producer (ComicClipper) /CreationDate (${pdfDate(new Date())}) >>\nendobj\n`
      );

      const size = this.nextId;
      const xrefOffset = this.offset;
      let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
      for (let id = 1; id < size; id++) {
        xref += `${String(this.offsets[id]).padStart(10, '0')} 00000 n \n`;
      }
      xref += `trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
      this._pushText(xref);

      const blob = new Blob(this.parts, { type: 'application/pdf' });
      this.parts = [];
      return blob;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { PDFWriter };
  else root.PDFWriter = PDFWriter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
