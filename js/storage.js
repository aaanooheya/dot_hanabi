const STORAGE_KEY = 'hanabi_fireworks_v1';

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveAll(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getFireworks() {
  return loadAll();
}

export function getFirework(id) {
  return loadAll().find((f) => f.id === id) || null;
}

export function saveFirework(fw) {
  const list = loadAll();
  const idx = list.findIndex((f) => f.id === fw.id);
  if (idx >= 0) list[idx] = fw;
  else list.push(fw);
  saveAll(list);
  return fw;
}

export function deleteFirework(id) {
  saveAll(loadAll().filter((f) => f.id !== id));
}

export function generateId() {
  return 'fw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
