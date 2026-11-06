// Persistence: projects in localStorage, media blobs in IndexedDB.
const IDX = 'kntc.index', PK = id => 'kntc.project.' + id;

export function listProjects() {
  try { return JSON.parse(localStorage.getItem(IDX) || '[]'); } catch { return []; }
}
export function saveProject(p) {
  p.modified = Date.now();
  try {
    localStorage.setItem(PK(p.id), JSON.stringify(p));
    const idx = listProjects().filter(x => x.id !== p.id);
    idx.unshift({ id: p.id, name: p.name, aspect: p.aspect, modified: p.modified, layers: p.layers.length, kind: p.kind });
    localStorage.setItem(IDX, JSON.stringify(idx));
    if (!p.kind) localStorage.setItem('kntc.last', p.id); // templates / elements never become the project that opens next time
    return true;
  } catch (e) { console.warn('save failed', e); return false; }
}
export function loadProject(id) { try { return JSON.parse(localStorage.getItem(PK(id))); } catch { return null; } }
export function projectBytes(id) { return (localStorage.getItem(PK(id)) || '').length; }
export function lastProjectId() { return localStorage.getItem('kntc.last'); }
export function deleteProject(id) {
  localStorage.removeItem(PK(id));
  localStorage.setItem(IDX, JSON.stringify(listProjects().filter(x => x.id !== id)));
}

let dbp;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('kntc-media', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function putMedia(id, blob) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function getMedia(id) {
  const d = await db();
  return new Promise((res, rej) => { const r = d.transaction('blobs').objectStore('blobs').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
export const dataURLToBlob = async u => (await fetch(u)).blob();
