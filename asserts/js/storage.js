export const STORAGE_KEY = 'goodnight.v1';
const speeds = [0.75, 1, 1.25, 1.5, 2];
const fresh = () => ({ version: 1, favorites: [], settings: { speed: 1, autoNext: true } });
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value);

export function normalizeState(raw) {
    const state = fresh();
    if (!raw || raw.version !== 1) return state;
    state.favorites = Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter(safeId))] : [];
    if (speeds.includes(raw.settings?.speed)) state.settings.speed = raw.settings.speed;
    if (typeof raw.settings?.autoNext === 'boolean') state.settings.autoNext = raw.settings.autoNext;
    return state;
}

export class PreferencesStorage {
    constructor(backend, onError = () => {}) {
        this.backend = backend; this.onError = onError; this.warned = false;
        try {
            const raw = JSON.parse(backend?.getItem(STORAGE_KEY) || 'null');
            this.state = normalizeState(raw);
        } catch { this.state = fresh(); this.report(); }
    }
    report() { if (!this.warned) { this.warned = true; this.onError('收藏或设置暂时无法保存。'); } }
    commit() {
        try {
            if (!this.backend) throw new Error('Storage unavailable');
            this.backend.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch { this.report(); }
    }
    toggleFavorite(bookId) {
        if (!safeId(bookId)) return;
        const set = new Set(this.state.favorites);
        if (set.has(bookId)) set.delete(bookId); else set.add(bookId);
        this.state.favorites = [...set]; this.commit();
    }
    setSettings(patch) {
        this.state.settings = normalizeState({ ...this.state, settings: { ...this.state.settings, ...patch } }).settings;
        this.commit();
    }
    clear() { this.state = fresh(); this.commit(); }
}
