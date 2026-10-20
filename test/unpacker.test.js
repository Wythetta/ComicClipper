// 執行：node --test 'test/*.test.js'
// fixtures 由參考版 lz-string 壓縮、以 packer 演算法產生，並實際執行驗證過結果

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decompressFromBase64 } = require('../src/lib/lz-string.js');
const { unpack, readStringLiteral } = require('../src/lib/unpacker.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('LZString.decompressFromBase64 與參考版 lz-string 的壓縮結果一致', () => {
  for (const { input, base64 } of JSON.parse(fixture('lz-string.json'))) {
    assert.equal(decompressFromBase64(base64), input);
  }
  assert.equal(decompressFromBase64(null), '');
  assert.equal(decompressFromBase64(''), null);
});

test('readStringLiteral 處理跳脫字元', () => {
  const src = "'a\\'b\\\\c\\x41\\u4e2d'rest";   // 原始碼文字：'a\'b\\c\x41中'rest
  assert.deepEqual(readStringLiteral(src, 0), ["a'b\\cA中", src.indexOf('rest')]);
  assert.deepEqual(readStringLiteral(`"say 'hi'"`, 0), ["say 'hi'", 10]);
});

const expected = JSON.parse(fixture('packed-expected.json'));
const extractJson = (code) => JSON.parse(code.slice(code.indexOf('{'), code.lastIndexOf('}') + 1));

test('還原字典經 LZString 壓縮的 packer（漫畫櫃的寫法）', () => {
  const code = unpack(fixture('packed-lz.js'), decompressFromBase64);
  assert.match(code, /^SMH\.imgData\(/);
  assert.deepEqual(extractJson(code), expected);
});

test('還原一般 packer（字典以 .split 切開）', () => {
  assert.deepEqual(extractJson(unpack(fixture('packed-plain.js'))), expected);
});

test('字典經過壓縮但沒有給解壓縮函式時清楚報錯', () => {
  assert.throws(() => unpack(fixture('packed-lz.js')), /LZString/);
});

test('沒有 packer 時回傳 null', () => {
  assert.equal(unpack('var x = 1;'), null);
});
