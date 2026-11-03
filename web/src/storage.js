// Слоты сохранения. На Android — файлы во внутренней памяти приложения (через AndroidStore),
// в браузере — localStorage.
const store = window.AndroidStore || null;
const PREFIX = 'rialto.save.';
export const SLOTS = ['auto', '1', '2', '3', '4', '5', '6'];

function rawSave(key, text) {
  if (store) return store.save(key, text);
  try { localStorage.setItem(PREFIX + key, text); return true; } catch (e) { return false; }
}
function rawLoad(key) {
  if (store) return store.load(key) || null;
  try { return localStorage.getItem(PREFIX + key); } catch (e) { return null; }
}
function rawDelete(key) {
  if (store) return store.remove(key);
  try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  return true;
}

export function saveGame(slot, data) {
  const payload = { v: 1, slot, savedAt: Date.now(), ...data };
  return rawSave(slot, JSON.stringify(payload));
}

export function loadGame(slot) {
  const t = rawLoad(slot);
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

export function deleteSave(slot) { return rawDelete(slot); }

export function listSaves() {
  return SLOTS.map((slot) => {
    const d = loadGame(slot);
    if (!d || !d.state) return { slot, empty: true };
    const st = d.state;
    return {
      slot, empty: false, savedAt: d.savedAt, mode: d.mode,
      players: st.players.map((p) => ({ name: p.name, color: p.color, bankrupt: p.bankrupt })),
      round: st.round, over: st.over,
    };
  });
}

export function getPref(key, def) {
  try { const v = localStorage.getItem('rialto.pref.' + key); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
}
export function setPref(key, val) {
  try { localStorage.setItem('rialto.pref.' + key, JSON.stringify(val)); } catch (e) { /* ignore */ }
}
