// popup.js - 判斷目前分頁是否為支援的網站，開啟下載頁

const $ = (id) => document.getElementById(id);

async function send(msg) {
  const res = await browser.runtime.sendMessage(msg);
  if (!res?.ok) throw new Error(res?.error || '背景程式沒有回應');
  return res.data;
}

function openDownloader(params) {
  const url = browser.runtime.getURL('downloader/downloader.html') + '?' + new URLSearchParams(params);
  browser.tabs.create({ url });
  window.close();
}

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  const job = await send({ type: 'getJob' });
  if (job?.status === 'running') {
    const finished = job.volumes.filter(v => ['done', 'failed', 'cancelled'].includes(v.status)).length;
    $('jobText').textContent = `${job.title}：${finished} / ${job.volumes.length} 冊`;
    $('btnShowJob').addEventListener('click', () => openDownloader({ url: job.seriesUrl }));
    $('jobBox').hidden = false;
  }

  const info = await send({ type: 'detect', url: tab?.url || '' });
  if (info.supported) {
    $('siteName').textContent = info.siteName;
    $('btnOpen').addEventListener('click', () => openDownloader({ url: tab.url, tabId: tab.id }));
    $('supportedBox').hidden = false;
  } else {
    $('siteList').textContent = info.supportedSites.join('、');
    $('unsupportedBox').hidden = false;
  }
}

init().catch(e => {
  $('siteList').textContent = e.message;
  $('unsupportedBox').hidden = false;
});
