/**
 * app.js — MedCode Translator UI logic
 * Handles search, rendering results, bulk lookup, CSV export, clipboard.
 */

/* ── State ───────────────────────────────────────────────────── */
let lastResult = null;
let bulkData   = [];
let searchTimer = null;

/* ── DOM refs ────────────────────────────────────────────────── */
const searchInput  = document.getElementById('searchInput');
const clearBtn     = document.getElementById('clearBtn');
const resultsArea  = document.getElementById('resultsArea');
const bulkInput    = document.getElementById('bulkInput');
const bulkResults  = document.getElementById('bulkResults');
const exportBtn    = document.getElementById('exportBtn');
const toastEl      = document.getElementById('toastEl');

/* ── Helpers ─────────────────────────────────────────────────── */
function getSearchType() {
  return document.querySelector('input[name="stype"]:checked')?.value ?? 'auto';
}

function showToast(msg, duration = 2200) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), duration);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    showToast(`Copied: ${text}`);
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 1600);
  });
}

function typeEmoji(type) {
  return type === 'drug' ? '💊' : '🧬';
}

/* ── Render helpers ──────────────────────────────────────────── */
function renderLoading(term) {
  resultsArea.innerHTML = `
    <div class="loading-wrap" role="status" aria-label="Searching for ${term}">
      <div class="spinner"></div>
      <span>Looking up codes for <strong>${escHtml(term)}</strong>…</span>
    </div>`;
}

function renderNotFound(term) {
  resultsArea.innerHTML = `
    <div class="error-card">
      <h3>No codes found for "${escHtml(term)}"</h3>
      <p>The public APIs didn't return a match. Try a more specific term, or check the spelling.</p>
      <p style="font-size:13px;color:#9CA3AF;">Examples: <em>metformin</em>, <em>type 2 diabetes</em>, <em>lisinopril</em>, <em>hypertension</em></p>
    </div>`;
}

function renderResult(data) {
  lastResult = data;
  const { name, type, codes } = data;

  const headerHtml = `
    <div class="result-header">
      <div class="result-icon" aria-hidden="true">${typeEmoji(type)}</div>
      <div>
        <div class="result-name">${escHtml(name)}</div>
        <div class="result-meta">
          <span>${type === 'drug' ? 'Drug / Medication' : 'Disease / Condition'}</span>
          <span>${codes.length} code system${codes.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>`;

  const cellsHtml = codes.map(c => `
    <div class="code-cell">
      <div class="code-system-tag ${c.tagClass}">${escHtml(c.system)}</div>
      <div class="code-value">${escHtml(c.code)}</div>
      <div class="code-label">${escHtml(c.label)}</div>
      <div class="code-desc">${escHtml(c.desc)}</div>
      ${c.url ? `<a href="${escAttr(c.url)}" target="_blank" rel="noopener" style="font-size:11px;color:#0F4C81;display:inline-block;margin-top:6px;">View in registry ↗</a>` : ''}
      <button class="copy-code-btn" onclick="copyToClipboard('${escAttr(c.code)}', this)">Copy</button>
    </div>`).join('');

  const actionsHtml = `
    <div class="result-actions">
      <button class="btn-secondary" onclick="copyAllCodes()">Copy all codes</button>
      <button class="btn-secondary" onclick="exportSingleCSV()">Download CSV</button>
    </div>`;

  resultsArea.innerHTML = headerHtml + `<div class="codes-grid">${cellsHtml}</div>` + actionsHtml;
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Search ──────────────────────────────────────────────────── */
async function runSearch(term) {
  term = (term || searchInput.value).trim();
  if (!term) return;

  // update URL so it's shareable
  const url = new URL(window.location);
  url.searchParams.set('q', term);
  url.searchParams.set('type', getSearchType());
  window.history.replaceState({}, '', url);

  renderLoading(term);

  try {
    const result = await API.lookup(term, getSearchType());
    if (!result.found) {
      renderNotFound(term);
    } else {
      renderResult(result);
    }
  } catch (err) {
    console.error(err);
    resultsArea.innerHTML = `
      <div class="error-card">
        <h3>API error</h3>
        <p>Something went wrong reaching the public APIs. Check your internet connection and try again.</p>
        <p style="font-size:12px;color:#9CA3AF;">${escHtml(err.message)}</p>
      </div>`;
  }
}

function setSearch(term) {
  searchInput.value = term;
  clearBtn.style.display = 'block';
  runSearch(term);
}

/* ── Copy all ────────────────────────────────────────────────── */
function copyAllCodes() {
  if (!lastResult) return;
  const text = lastResult.codes
    .map(c => `${c.system}\t${c.code}\t${c.desc}`)
    .join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('All codes copied as TSV'));
}

/* ── Export single result as CSV ─────────────────────────────── */
function exportSingleCSV() {
  if (!lastResult) return;
  const rows = [['Term', 'Type', 'Code System', 'Code', 'Label', 'Description']];
  lastResult.codes.forEach(c => {
    rows.push([lastResult.name, lastResult.type, c.system, c.code, c.label, c.desc]);
  });
  downloadCSV(rows, `medcode_${lastResult.name.replace(/\s+/g,'_')}.csv`);
}

/* ── Bulk lookup ─────────────────────────────────────────────── */
async function runBulk() {
  const lines = bulkInput.value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;

  bulkData = [];
  bulkResults.innerHTML = `<div class="loading-wrap" role="status"><div class="spinner"></div><span>Looking up ${lines.length} term${lines.length !== 1 ? 's' : ''}…</span></div>`;
  exportBtn.style.display = 'none';

  for (const term of lines) {
    const result = await API.lookup(term, 'auto').catch(() => ({ found: false, term }));
    bulkData.push(result);
    renderBulkTable();
  }

  exportBtn.style.display = 'inline-block';
}

function renderBulkTable() {
  if (!bulkData.length) return;

  const rows = bulkData.map(d => {
    if (!d.found) {
      return `<tr><td>${escHtml(d.term)}</td><td colspan="5" style="color:#9CA3AF;font-size:13px;">No results found</td></tr>`;
    }
    return d.codes.map((c, i) => `
      <tr>
        ${i === 0 ? `<td rowspan="${d.codes.length}" style="vertical-align:top;font-weight:500;">${escHtml(d.name)}</td>` : ''}
        <td><span class="code-system-tag ${c.tagClass}" style="font-size:10px;">${escHtml(c.system)}</span></td>
        <td class="mono">${escHtml(c.code)}</td>
        <td style="font-size:13px;color:#6B7280;">${escHtml(c.desc)}</td>
        <td><button class="copy-code-btn" style="opacity:1;position:static;" onclick="copyToClipboard('${escAttr(c.code)}', this)">Copy</button></td>
      </tr>`).join('');
  }).join('');

  bulkResults.innerHTML = `
    <table class="bulk-table">
      <thead>
        <tr>
          <th>Term</th><th>System</th><th>Code</th><th>Description</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ── CSV export (bulk) ───────────────────────────────────────── */
function exportCSV() {
  const rows = [['Search Term', 'Matched Name', 'Type', 'Code System', 'Code', 'Label', 'Description']];
  bulkData.forEach(d => {
    if (!d.found) {
      rows.push([d.term, '', '', '', '', '', 'Not found']);
    } else {
      d.codes.forEach(c => {
        rows.push([d.term, d.name, d.type, c.system, c.code, c.label, c.desc]);
      });
    }
  });
  downloadCSV(rows, 'medcode_bulk_export.csv');
}

function downloadCSV(rows, filename) {
  const csv = rows.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Security: escape HTML ───────────────────────────────────── */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── Event listeners ─────────────────────────────────────────── */
searchInput.addEventListener('input', () => {
  clearBtn.style.display = searchInput.value ? 'block' : 'none';
  clearTimeout(searchTimer);
  if (searchInput.value.trim().length >= 2) {
    searchTimer = setTimeout(() => runSearch(), 600);
  }
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimer);
    runSearch();
  }
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearBtn.style.display = 'none';
  resultsArea.innerHTML = '';
  lastResult = null;
  const url = new URL(window.location);
  url.searchParams.delete('q');
  url.searchParams.delete('type');
  window.history.replaceState({}, '', url);
  searchInput.focus();
});

/* ── Deep link: ?q=term&type=drug ───────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  const t = params.get('type');
  if (q) {
    searchInput.value = q;
    clearBtn.style.display = 'block';
    if (t) {
      const radio = document.querySelector(`input[name="stype"][value="${t}"]`);
      if (radio) radio.checked = true;
    }
    runSearch(q);
  }
});
