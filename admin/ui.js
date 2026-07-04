// Shared UI helpers for all admin screens. Rendering goes through these so
// HTML-escaping is the default and cannot be forgotten: every value is
// escaped unless explicitly wrapped with raw().

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

export function raw(html) { return { html }; }

function toHtml(value) {
  if (value && typeof value === 'object' && 'html' in value) return value.html;
  return escapeHtml(value);
}

export function dataTable({ columns, rows, emptyText = 'Keine Einträge.' }) {
  if (!rows.length) return emptyState(emptyText);
  return `<div class="table-wrap"><table>
    <thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) =>
      `<tr>${columns.map((c) => `<td>${toHtml(c.render(row))}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table></div>`;
}

export function selectOptions(items, getValue, getLabel, selected) {
  return items.map((it) => {
    const v = String(getValue(it));
    const sel = v === String(selected ?? '') ? ' selected' : '';
    return `<option value="${escapeHtml(v)}"${sel}>${escapeHtml(getLabel(it))}</option>`;
  }).join('');
}

export function emptyState(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

export function loading() {
  return '<div class="empty loading-state">Laden…</div>';
}

let toastTimer = null;
export function showToast(message, { type = 'success' } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = `toast toast--${type}`;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (type === 'success') {
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  } else {
    el.onclick = () => { el.hidden = true; };
  }
}

export function confirmDelete(message) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn--ghost" data-cancel>Abbrechen</button>
          <button type="button" class="btn btn--danger" data-confirm>Löschen</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const done = (result) => { wrap.remove(); resolve(result); };
    wrap.querySelector('[data-cancel]').onclick = () => done(false);
    wrap.querySelector('[data-confirm]').onclick = () => done(true);
    wrap.onclick = (e) => { if (e.target === wrap) done(false); };
  });
}
