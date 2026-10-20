// downloader.js - 選擇要下載的冊數、設定輸出選項、顯示下載進度

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const seriesUrl = params.get('url') || '';
const tabId = params.has('tabId') ? Number(params.get('tabId')) : null;

let data = null;            // loadSeries 的結果：series、downloaded、settings…
let job = null;             // 背景頁目前的工作（可能是別部作品）
const selected = new Set(); // 勾選的冊（以網址識別）
const rows = new Map();     // 網址 → 列表元素
let lastClicked = -1;       // Shift＋點選用（目前分頁籤內的位置）
let updateSeq = 0;          // 收到幾次進度通知
let groups = [];            // 區名（單行本、單話…）；只有一區時不顯示分頁籤
let activeGroup = '';

const multiGroup = () => groups.length > 1;
/** 目前分頁籤裡的冊；選取工具列、範圍與 Shift＋點選都只作用在這些冊 */
const groupVolumes = () => (multiGroup() ? data.series.volumes.filter(v => v.group === activeGroup) : data.series.volumes);

const ACTIVE = ['waiting', 'listing', 'downloading', 'packing'];

async function send(msg) {
  const res = await browser.runtime.sendMessage(msg);
  if (!res?.ok) throw new Error(res?.error || '背景程式沒有回應');
  return res.data;
}

const runningHere = () => job?.status === 'running' && job.seriesUrl === seriesUrl;
const busyElsewhere = () => job?.status === 'running' && job.seriesUrl !== seriesUrl;

// ── 畫面 ──────────────────────────────────────────────────

function renderSeries() {
  const { series, site, device } = data;
  document.title = `${series.title} - ComicClipper`;
  $('seriesTitle').textContent = series.title;
  const counts = multiGroup()
    ? groups.map(g => `${g || '其他'} ${series.volumes.filter(v => v.group === g).length}`).join('、')
    : `共 ${series.volumes.length} 冊`;
  $('seriesMeta').textContent = [series.author, site.name, counts].filter(Boolean).join(' · ');
  if (series.cover) {
    $('cover').src = series.cover;
    $('cover').hidden = false;
    $('cover').addEventListener('error', () => { $('cover').hidden = true; });
  }
  document.querySelector(`input[name=direction][value=${data.direction === 'ltr' ? 'ltr' : 'rtl'}]`).checked = true;
  $('optSplit').checked = data.settings.splitSpreads;
  $('optGray').checked = data.settings.grayscale;
  $('deviceNote').textContent = `輸出尺寸：${device}（圖片只縮小不放大；一般 JPEG 直接放進 PDF，不重新壓縮）`;
}

function renderGroupTabs() {
  if (!multiGroup()) return;
  const nav = $('groupTabs');
  for (const g of groups) {
    const btn = document.createElement('button');
    btn.className = 'group-tab';
    btn.dataset.group = g;
    btn.append(g || '其他');
    const count = document.createElement('span');
    count.className = 'count';
    btn.append(count);
    btn.addEventListener('click', () => {
      activeGroup = g;
      lastClicked = -1;
      $('rangeError').hidden = true;
      refresh();
    });
    nav.append(btn);
  }
  nav.hidden = false;
}

function renderVolumes() {
  const list = $('volumeList');
  data.series.volumes.forEach((vol) => {
    const li = document.createElement('li');
    li.className = 'vol';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('click', (e) => onToggle(vol, box.checked, e.shiftKey));

    const title = document.createElement('span');
    title.className = 'vol-title';
    title.textContent = vol.title;
    title.addEventListener('click', (e) => { if (!box.disabled) onToggle(vol, !box.checked, e.shiftKey); });

    const badge = document.createElement('span');
    badge.className = 'vol-badge';

    const status = document.createElement('div');
    status.className = 'vol-status';

    li.append(box, title, badge, status);
    list.append(li);
    rows.set(vol.url, { li, box, badge, status });
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function renderStatus(row, v) {
  const el = row.status;
  el.className = 'vol-status';
  el.replaceChildren();
  if (!v) return;
  switch (v.status) {
    case 'waiting': el.textContent = '等待中'; break;
    case 'listing': el.textContent = '讀取頁面清單…'; break;
    case 'downloading': {
      const bar = document.createElement('div');
      bar.className = 'progress';
      const fill = document.createElement('div');
      fill.style.width = `${v.total ? Math.round(v.done / v.total * 100) : 0}%`;
      bar.append(fill);
      el.append(`下載中 ${v.done} / ${v.total} 張`, bar);
      break;
    }
    case 'packing': el.textContent = '製作 PDF…'; break;
    case 'done': {
      el.classList.add('done');
      el.append(`✓ 已存檔：${v.path.split(/[\\/]/).pop()}`);
      if (v.downloadId != null) {
        const btn = document.createElement('button');
        btn.className = 'link-btn';
        btn.textContent = '在資料夾中顯示';
        btn.addEventListener('click', () => send({ type: 'showFile', downloadId: v.downloadId }).catch(() => {}));
        el.append(btn);
      }
      break;
    }
    case 'failed':
      el.classList.add('failed');
      el.textContent = `✗ ${v.error}`;
      break;
    case 'cancelled': el.textContent = '已取消'; break;
  }
}

function refresh() {
  const locked = runningHere() || busyElsewhere();
  const jobVols = new Map((job?.seriesUrl === seriesUrl ? job.volumes : []).map(v => [v.url, v]));

  for (const vol of data.series.volumes) {
    const row = rows.get(vol.url);
    const isChecked = selected.has(vol.url);
    row.li.hidden = multiGroup() && vol.group !== activeGroup;
    row.box.checked = isChecked;
    row.box.disabled = locked;
    row.li.classList.toggle('checked', isChecked);
    const when = data.downloaded[vol.url];
    row.badge.textContent = when ? `已下載 ${formatDate(when)}` : '';
    row.badge.hidden = !when;
    renderStatus(row, jobVols.get(vol.url));
  }

  for (const tab of $('groupTabs').children) {
    const inGroup = data.series.volumes.filter(v => v.group === tab.dataset.group);
    const picked = inGroup.filter(v => selected.has(v.url)).length;
    tab.classList.toggle('active', tab.dataset.group === activeGroup);
    tab.querySelector('.count').textContent = picked ? `${picked}／${inGroup.length}` : String(inGroup.length);
  }

  for (const id of ['btnAll', 'btnNone', 'btnNew', 'btnRange', 'rangeInput', 'optSplit', 'optGray']) $(id).disabled = locked;
  document.querySelectorAll('input[name=direction]').forEach(r => { r.disabled = locked; });

  $('busyNote').hidden = !busyElsewhere();
  if (busyElsewhere()) $('busyNote').textContent = `「${job.title}」正在下載，完成後才能開始新的下載。`;

  $('btnStart').hidden = runningHere();
  $('btnCancel').hidden = !runningHere();
  $('btnStart').disabled = locked || selected.size === 0;
  $('btnStart').textContent = `開始下載（${selected.size} 冊）`;

  if (runningHere()) {
    const finished = job.volumes.filter(v => !ACTIVE.includes(v.status)).length;
    $('summary').textContent = `正在下載第 ${Math.min(finished + 1, job.volumes.length)} / ${job.volumes.length} 冊`;
  } else if (job?.seriesUrl === seriesUrl && job.status !== 'running') {
    const done = job.volumes.filter(v => v.status === 'done').length;
    const failed = job.volumes.filter(v => v.status === 'failed').length;
    $('summary').textContent = `上次下載：完成 ${done} 冊` + (failed ? `、失敗 ${failed} 冊（已勾選，可直接重試）` : '') +
      (job.status === 'cancelled' ? '（已取消）' : '');
  } else {
    $('summary').textContent = `已選 ${selected.size} 冊`;
  }
}

// ── 選擇 ──────────────────────────────────────────────────

function onToggle(vol, checked, shiftKey) {
  const vols = groupVolumes();
  const index = vols.indexOf(vol);
  const [from, to] = shiftKey && lastClicked >= 0
    ? [Math.min(lastClicked, index), Math.max(lastClicked, index)]
    : [index, index];
  for (let i = from; i <= to; i++) {
    if (checked) selected.add(vols[i].url);
    else selected.delete(vols[i].url);
  }
  lastClicked = index;
  refresh();
}

/** 重新選取目前分頁籤裡的冊，其他分頁籤的選取不變 */
function selectWhere(predicate) {
  groupVolumes().forEach((v, i) => {
    if (predicate(v, i)) selected.add(v.url);
    else selected.delete(v.url);
  });
  refresh();
}

function applyRange() {
  $('rangeError').hidden = true;
  const total = groupVolumes().length;
  try {
    const picked = ComicUtil.parseRange($('rangeInput').value, total);
    if (!picked.length) throw new Error(`沒有符合的冊數（共 ${total} 冊）`);
    const set = new Set(picked);
    selectWhere((_v, i) => set.has(i + 1));
  } catch (e) {
    $('rangeError').textContent = e.message;
    $('rangeError').hidden = false;
  }
}

// ── 下載 ──────────────────────────────────────────────────

async function start() {
  $('btnStart').disabled = true;
  const seqBefore = updateSeq;
  try {
    const started = await send({
      type: 'startJob',
      seriesUrl,
      series: data.series,
      volumeUrls: data.series.volumes.filter(v => selected.has(v.url)).map(v => v.url),
      direction: document.querySelector('input[name=direction]:checked').value,
      settings: { splitSpreads: $('optSplit').checked, grayscale: $('optGray').checked },
    });
    if (updateSeq === seqBefore) job = started;   // 進度通知比回應先到時，以通知為準
  } catch (e) {
    $('summary').textContent = `❌ ${e.message}`;
    $('btnStart').disabled = false;
    return;
  }
  refresh();
}

function onJobUpdate(next) {
  const wasRunning = runningHere();
  job = next;
  updateSeq++;
  if (job?.seriesUrl === seriesUrl) {
    const now = new Date().toISOString();
    for (const v of job.volumes) {
      if (v.status === 'done' && !data.downloaded[v.url]) data.downloaded[v.url] = now;
    }
    // 工作結束：改成勾選還沒完成的冊，按一下就能重試
    if (wasRunning && !runningHere()) {
      selected.clear();
      job.volumes.filter(v => v.status !== 'done').forEach(v => selected.add(v.url));
    }
  }
  refresh();
}

// ── 初始化 ────────────────────────────────────────────────

async function init() {
  if (!seriesUrl) throw new Error('缺少作品網址，請從作品頁點擴充功能圖示開啟');
  [data, job] = await Promise.all([
    send({ type: 'loadSeries', url: seriesUrl, tabId }),
    send({ type: 'getJob' }),
  ]);

  groups = [...new Set(data.series.volumes.map(v => v.group))];
  const jobHere = job?.seriesUrl === seriesUrl;
  activeGroup = jobHere && groups.includes(job.volumes[0]?.group) ? job.volumes[0].group : groups[0];

  renderSeries();
  renderGroupTabs();
  renderVolumes();

  if (runningHere()) {
    job.volumes.forEach(v => selected.add(v.url));
  } else if (tabId == null && jobHere) {
    job.volumes.filter(v => v.status !== 'done').forEach(v => selected.add(v.url));
  } else if (!multiGroup()) {
    // 預設勾選還沒下載過的冊；分成多區時（例如單行本＋上百話）預設不勾，由使用者挑選
    data.series.volumes.forEach(v => { if (!data.downloaded[v.url]) selected.add(v.url); });
  }

  $('btnAll').addEventListener('click', () => selectWhere(() => true));
  $('btnNone').addEventListener('click', () => selectWhere(() => false));
  $('btnNew').addEventListener('click', () => selectWhere(v => !data.downloaded[v.url]));
  $('btnRange').addEventListener('click', applyRange);
  $('rangeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyRange(); });
  $('btnStart').addEventListener('click', start);
  $('btnCancel').addEventListener('click', () => send({ type: 'cancelJob' }).catch(() => {}));
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'jobUpdate') onJobUpdate(msg.job);
  });

  $('loading').hidden = true;
  $('app').hidden = false;
  $('footer').hidden = false;
  refresh();
}

init().catch(e => {
  $('loading').hidden = true;
  $('loadError').textContent = `❌ ${e.message}`;
  $('loadError').hidden = false;
});
