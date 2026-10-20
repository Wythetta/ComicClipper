// 執行：node --test test/

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRange, sanitizeFilename, leadingNumberWidth, padVolumeNumber, withRetry } = require('../src/lib/util.js');

test('parseRange 解析單冊、區間與全形符號', () => {
  assert.deepEqual(parseRange('1-5, 8, 12-15', 15), [1, 2, 3, 4, 5, 8, 12, 13, 14, 15]);
  assert.deepEqual(parseRange('3，1～2、3', 15), [1, 2, 3]);
  assert.deepEqual(parseRange('5-3', 15), [3, 4, 5]);
});

test('parseRange 忽略超出範圍的冊數', () => {
  assert.deepEqual(parseRange('14-20', 15), [14, 15]);
  assert.deepEqual(parseRange('0', 15), []);
  assert.deepEqual(parseRange('', 15), []);
});

test('parseRange 格式錯誤時指出哪一段', () => {
  assert.throws(() => parseRange('1-5, abc', 15), /abc/);
});

test('sanitizeFilename 移除不合法字元', () => {
  assert.equal(sanitizeFilename('生存遊戲: 第1卷 / 上?'), '生存遊戲_ 第1卷 _ 上_');
  assert.equal(sanitizeFilename('  ..hidden.  '), 'hidden');
  assert.equal(sanitizeFilename(''), 'untitled');
});

test('padVolumeNumber 補零讓書庫排序正確', () => {
  assert.equal(padVolumeNumber('第1卷', 2), '第01卷');
  assert.equal(padVolumeNumber('第12卷', 2), '第12卷');
  assert.equal(padVolumeNumber('Vol.007 完', 3), 'Vol.007 完');
  assert.equal(padVolumeNumber('番外篇', 2), '番外篇');
  assert.equal(leadingNumberWidth('第100話'), 3);
  assert.equal(leadingNumberWidth('番外篇'), 0);
});

test('withRetry 失敗後重試，成功即回傳', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('boom');
    return 'ok';
  }, { retries: 3, baseDelay: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withRetry 用完次數後丟出最後的錯誤', async () => {
  await assert.rejects(withRetry(async () => { throw new Error('always'); }, { retries: 1, baseDelay: 1 }), /always/);
});
