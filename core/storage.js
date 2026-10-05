// Drafts in IndexedDB. localStorage (~5 MB) can't hold a carousel's photos;
// IndexedDB stores the original Blobs directly.
//
// Draft record: { id, brandId, updatedAt, title, thumb (Blob), deck (no images), photoBlobs: {photoId: Blob} }

const DB_NAME = 'direction-generator';
const STORE = 'drafts';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('brandId', 'brandId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const res = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(res && 'result' in res ? res.result : res);
    t.onerror = () => reject(t.error);
  }));
}

/** Strip non-serialisable images from a deck; photos are stored as Blobs. */
export function serialiseDeck(deck) {
  const photos = {};
  for (const [id, p] of Object.entries(deck.photos)) {
    const { image, blob, ...rest } = p;
    photos[id] = rest;
  }
  return { ...deck, photos };
}

export function saveDraft(record) {
  return tx('readwrite', s => s.put({ ...record, updatedAt: Date.now() }));
}
export function listDrafts(brandId) {
  return tx('readonly', s => s.index('brandId').getAll(brandId));
}
export function getDraft(id) {
  return tx('readonly', s => s.get(id));
}
export function deleteDraft(id) {
  return tx('readwrite', s => s.delete(id));
}
