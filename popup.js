// Runs inside the Etsy tab (page context, so the user's Etsy login cookies apply).
async function fetchListingsInPage(states) {
  // 1. Find the shop ID from the Shop Manager listings page.
  const html = await (await fetch('/your/shops/me/tools/listings', { credentials: 'include' })).text();
  const m = html.match(/"shop_id"\s*:\s*"?(\d+)/);
  if (!m) throw new Error('Could not find your shop ID. Make sure you are signed in to Etsy Shop Manager.');
  const shopId = m[1];

  // 2. Page through each requested status, 100 at a time.
  const out = [];
  for (const state of states) {
    for (let offset = 0; offset < 100000; offset += 100) {
      const url = `/api/v3/ajax/shop/${shopId}/listings/search?limit=100&offset=${offset}` +
                  `&sort_field=ending_date&sort_order=descending&state=${state}&language_id=0`;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) throw new Error(`Etsy returned ${r.status} for ${state} listings.`);
      const page = await r.json();
      if (!Array.isArray(page) || page.length === 0) break;
      for (const o of page) {
        out.push({
          sku: (o.product_identifiers || []).join(' | '),
          listing_id: String(o.listing_id),
          state,
          title: o.title || '',
          price: o.price || '',
          quantity: o.quantity ?? '',
          url: o.url || ''
        });
      }
      if (page.length < 100) break;
    }
  }
  return { shopId, rows: out };
}

const $ = (s) => document.querySelector(s);
const status = (msg, cls = '') => { const el = $('#status'); el.textContent = msg; el.className = cls; };

function toCsv(rows, opts, sep = ',') {
  const cols = [['SKU', 'sku'], ['Listing ID', 'listing_id'], ['Status', 'state']];
  if (opts.title) cols.push(['Title', 'title']);
  if (opts.price) cols.push(['Price', 'price']);
  if (opts.qty) cols.push(['Quantity', 'quantity']);
  if (opts.url) cols.push(['Listing URL', 'url']);
  const esc = (v) => {
    const s = String(v ?? '');
    if (sep === '\t') return s.replace(/[\t\r\n]+/g, ' ');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(c => c[0]).join(sep)];
  for (const r of rows) lines.push(cols.map(c => esc(r[c[1]])).join(sep));
  return lines.join('\r\n');
}

async function run(mode) {
  const states = [...document.querySelectorAll('input[name=state]:checked')].map(i => i.value);
  if (!states.length) return status('Tick at least one listing status.', 'err');
  const opts = {
    title: $('#col-title').checked, price: $('#col-price').checked,
    qty: $('#col-qty').checked, url: $('#col-url').checked
  };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/www\.etsy\.com\//.test(tab.url || '')) {
    return status('Switch to an etsy.com tab (signed in to your shop) first.', 'err');
  }

  $('#export').disabled = $('#copy').disabled = true;
  status('Fetching listings…');
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', func: fetchListingsInPage, args: [states]
    });
    if (!res || !res.result) throw new Error('No data returned. Reload the Etsy tab and try again.');
    const { shopId, rows } = res.result;
    const ids = new Set(rows.map(r => r.listing_id));
    const noSku = rows.filter(r => !r.sku).length;

    if (mode === 'copy') {
      await navigator.clipboard.writeText(toCsv(rows, opts, '\t'));
    } else {
      const blob = new Blob(['﻿' + toCsv(rows, opts)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `etsy_${states.join('-')}_listing_ids_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    status(`${mode === 'copy' ? 'Copied' : 'Downloaded'} ${rows.length} listings (${ids.size} unique IDs) from shop ${shopId}.` +
           (noSku ? `\n${noSku} listing(s) have no SKU.` : ''), 'ok');
  } catch (e) {
    status('Error: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    $('#export').disabled = $('#copy').disabled = false;
  }
}

$('#export').addEventListener('click', () => run('download'));
$('#copy').addEventListener('click', () => run('copy'));
