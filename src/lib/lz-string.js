// lz-string.js - LZString.decompressFromBase64（只實作解壓縮）
// 演算法與 lz-string（MIT，https://github.com/pieroxy/lz-string）相同；漫畫櫃用它壓縮冊數清單與圖片資料。

(function (root) {
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const BASE64_INDEX = Object.fromEntries([...BASE64].map((ch, i) => [ch, i]));

  /** 每個輸入字元帶 bitsPerChar 個位元，由高位往低位讀 */
  function decompress(length, bitsPerChar, valueAt) {
    const dict = [0, 1, 2];
    let dictSize = 4;
    let enlargeIn = 4;
    let numBits = 3;
    let val = valueAt(0);
    let position = 1 << (bitsPerChar - 1);
    let index = 1;

    const readBits = (n) => {
      let bits = 0;
      for (let power = 1, i = 0; i < n; i++, power <<= 1) {
        if (val & position) bits |= power;
        position >>= 1;
        if (position === 0) {
          position = 1 << (bitsPerChar - 1);
          val = valueAt(index++);
        }
      }
      return bits;
    };

    let w;
    switch (readBits(2)) {
      case 0: w = String.fromCharCode(readBits(8)); break;
      case 1: w = String.fromCharCode(readBits(16)); break;
      default: return '';
    }
    dict[3] = w;
    const out = [w];

    for (;;) {
      if (index > length) return '';
      let code = readBits(numBits);
      if (code === 0 || code === 1) {
        dict[dictSize++] = String.fromCharCode(readBits(code === 0 ? 8 : 16));
        code = dictSize - 1;
        if (--enlargeIn === 0) enlargeIn = 1 << numBits++;
      } else if (code === 2) {
        return out.join('');
      }

      let entry;
      if (code < dictSize && dict[code] !== undefined) entry = dict[code];
      else if (code === dictSize) entry = w + w.charAt(0);
      else return null;                                   // 資料損毀
      out.push(entry);
      dict[dictSize++] = w + entry.charAt(0);
      if (--enlargeIn === 0) enlargeIn = 1 << numBits++;
      w = entry;
    }
  }

  function decompressFromBase64(input) {
    if (input == null) return '';
    if (input === '') return null;
    return decompress(input.length, 6, i => BASE64_INDEX[input.charAt(i)] ?? 0);
  }

  const api = { decompressFromBase64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LZString = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
