// app.js
// ── Slider ↔ number input sync ──────────────────────────────────────────────
function bindSliderWithInput(rangeId, numId, onChange) {
  const range = document.getElementById(rangeId);
  const num   = document.getElementById(numId);
  if (!range || !num) return;
  range.addEventListener('input', () => { num.value = range.value; if (onChange) onChange(); });
  num.addEventListener('input', () => {
    let v = parseFloat(num.value);
    const mn = parseFloat(range.min), mx = parseFloat(range.max);
    if (!isNaN(v)) { v = Math.min(mx, Math.max(mn, v)); range.value = v; }
    if (onChange) onChange();
  });
}
// ── Convenience helpers ──────────────────────────────────────────────────────
function numVal(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return isNaN(v) ? fallback : v;
}
function strVal(id, fallback = '') {
  const el = document.getElementById(id);
  return el ? el.value.trim() : fallback;
}
function isChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}
// ── Load image from data URI ─────────────────────────────────────────────────
function loadImageFromDataURI(uri) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = uri;
  });
}
// ── Toast notifications ──────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const c   = document.getElementById('alert-container');
  const div = document.createElement('div');
  div.className = 'toast' + (isError ? ' error' : '');
  div.textContent = msg;
  c.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}
// ── Transparent toggle helper ────────────────────────────────────────────────
function updateBgClass(wrapperId, transparent) {
  const el = document.getElementById(wrapperId);
  if (!el) return;
  el.classList.toggle('white-bg',              !transparent);
  el.classList.toggle('transparent-active',    transparent);
}
