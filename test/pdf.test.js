// 執行：node --test test/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDFWriter } = require('../src/lib/pdf-writer.js');
const { sniffType, readJpegInfo } = require('../src/lib/image-pipeline.js');

const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)));

test('sniffType 由檔頭判斷格式', () => {
  assert.equal(sniffType(fixture('page-rgb.jpg')), 'jpeg');
  assert.equal(sniffType(fixture('spread.png')), 'png');
  assert.equal(sniffType(new Uint8Array(16)), null);
});

test('readJpegInfo 讀出尺寸、色版與編碼方式', () => {
  assert.deepEqual(readJpegInfo(fixture('page-rgb.jpg')), { width: 120, height: 170, components: 3, baseline: true });
  assert.deepEqual(readJpegInfo(fixture('page-gray.jpg')), { width: 120, height: 170, components: 1, baseline: true });
  assert.equal(readJpegInfo(fixture('page-progressive.jpg')).baseline, false);
});

async function buildPdf() {
  const pdf = new PDFWriter({ title: '生存遊戲 第01卷', author: '作者', rtl: true });
  for (const name of ['page-rgb.jpg', 'page-gray.jpg']) {
    const bytes = fixture(name);
    pdf.addJpegPage({ bytes, ...readJpegInfo(bytes) });
  }
  return Buffer.from(await pdf.toBlob().arrayBuffer());
}

test('PDF 交叉參照表的位置都指向正確的物件', async () => {
  const buf = await buildPdf();
  const text = buf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));

  const startxref = parseInt(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1], 10);
  assert.ok(text.startsWith('xref\n', startxref));
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(startxref));
  assert.equal(Number(first), 0);
  assert.equal(Number(count), 3 + 2 * 3 + 1);   // free 項目 + Catalog/Pages/Info + 每頁 3 個物件

  const entries = text.slice(startxref).split('\n').slice(2, 2 + Number(count));
  entries.forEach((line, id) => {
    assert.equal(line.length + 1, 20, `xref 第 ${id} 項必須是 20 位元組`);
    if (id === 0) return;
    const offset = parseInt(line.slice(0, 10), 10);
    assert.ok(text.startsWith(`${id} 0 obj\n`, offset), `物件 ${id} 的位置錯誤`);
  });
});

test('PDF 內容：頁數、色彩空間、右翻與中文書名', async () => {
  const text = (await buildPdf()).toString('latin1');
  assert.match(text, /\/Type \/Pages \/Count 2 /);
  assert.match(text, /\/ColorSpace \/DeviceRGB/);
  assert.match(text, /\/ColorSpace \/DeviceGray/);
  assert.match(text, /\/Direction \/R2L/);
  // UTF-16BE：「生」= U+751F
  assert.match(text, /\/Title <FEFF751F/);
});

test('每頁高度一致，寬度依圖片比例', async () => {
  const text = (await buildPdf()).toString('latin1');
  const boxes = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.equal(boxes.length, 2);
  for (const [w, h] of boxes) {
    assert.equal(h, 792);
    assert.ok(Math.abs(w - 792 * 120 / 170) < 0.01);
  }
});

test('JPEG 原檔原封不動嵌入 PDF', async () => {
  const buf = await buildPdf();
  const jpeg = Buffer.from(fixture('page-rgb.jpg'));
  assert.ok(buf.indexOf(jpeg) > 0);
});

test('沒有頁面時拒絕產生 PDF', () => {
  assert.throws(() => new PDFWriter().toBlob(), /沒有任何頁面/);
});
