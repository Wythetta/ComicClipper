// unpacker.js - 還原 Dean Edwards packer 壓縮的 JavaScript：eval(function(p,a,c,k,e,d){…}('…',62,…,'…'.split('|'),0,{}))
// 不執行任何網站程式碼：直接解析參數，再把每個代號換回字典裡的原字。
// 字典若是 LZString 壓縮（'…'['\x73\x70\x6c\x69\x63']('\x7c')，漫畫櫃的寫法），需要傳入 decompressFromBase64。

(function (root) {
  /** 從 src[i] 的引號開始讀一個 JavaScript 字串字面值，回傳 [值, 結束位置] */
  function readStringLiteral(src, i) {
    const quote = src[i];
    if (quote !== "'" && quote !== '"') throw new Error('預期是字串');
    let out = '';
    for (i++; i < src.length; i++) {
      const ch = src[i];
      if (ch === quote) return [out, i + 1];
      if (ch !== '\\') { out += ch; continue; }
      const next = src[++i];
      switch (next) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case '0': out += '\0'; break;
        case 'x': out += String.fromCharCode(parseInt(src.substr(i + 1, 2), 16)); i += 2; break;
        case 'u': out += String.fromCharCode(parseInt(src.substr(i + 1, 4), 16)); i += 4; break;
        case '\r': if (src[i + 1] === '\n') i++; break;   // 行接續
        case '\n': break;
        default: out += next;
      }
    }
    throw new Error('字串沒有結尾');
  }

  /** 代號 → 字典索引；packer 的數字用 0-9、a-z、A-Z 表示 */
  function parseRadix(word, radix) {
    let n = 0;
    for (const ch of word) {
      const c = ch.charCodeAt(0);
      const digit = c <= 57 ? c - 48 : c >= 97 ? c - 87 : c - 29;
      if (digit < 0 || digit >= radix) return -1;
      n = n * radix + digit;
    }
    return n;
  }

  /**
   * @param {string} script  含有 packer 程式碼的文字
   * @param {(s: string) => string} [decompressFromBase64]  字典為 LZString 壓縮時使用
   * @returns {string|null}  還原後的程式碼；找不到 packer 時回傳 null
   */
  function unpack(script, decompressFromBase64) {
    const fnStart = script.search(/function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/);
    if (fnStart < 0) return null;
    const call = /return\s+p\s*;?\s*\}\s*\(\s*/g;
    call.lastIndex = fnStart;
    if (!call.exec(script)) return null;

    let i = call.lastIndex;
    const skip = (re) => {
      re.lastIndex = i;
      const m = re.exec(script);
      if (!m || m.index !== i) throw new Error('packer 參數格式不符');
      i += m[0].length;
      return m;
    };

    let payload;
    [payload, i] = readStringLiteral(script, i);
    const radix = parseInt(skip(/\s*,\s*(\d+)\s*,\s*\d+\s*,\s*/y)[1], 10);
    let words;
    [words, i] = readStringLiteral(script, i);

    // 字典後面接 .split('|')（一般）或 ['…']('…')（LZString 壓縮後再切開）
    if (/^\s*\[/.test(script.slice(i, i + 10))) {
      if (!decompressFromBase64) throw new Error('字典經過 LZString 壓縮，需要解壓縮函式');
      words = decompressFromBase64(words);
      if (words == null) throw new Error('字典解壓縮失敗');
    }
    const dict = words.split('|');

    return payload.replace(/\b\w+\b/g, (word) => {
      const n = parseRadix(word, radix);
      return n >= 0 && n < dict.length && dict[n] ? dict[n] : word;
    });
  }

  const api = { unpack, readStringLiteral };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Unpacker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
