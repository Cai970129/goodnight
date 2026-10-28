export const STORAGE_KEY = 'goodnight.v1';
export const HEART_LIMIT = 10;
export const HEART_RESET_MS = 3 * 24 * 60 * 60 * 1000;
const speeds = [0.75, 1, 1.25, 1.5, 2];
const fresh = () => ({ version: 1, favorites: [], heartCount: 0, heartStartedAt: null, settings: { speed: 1, autoNext: true } });
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value);

export function normalizeState(raw, now = Date.now()) {
    const state = fresh();
    if (!raw || raw.version !== 1) return state;
    state.favorites = Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter(safeId))] : [];
    if (Number.isSafeInteger(raw.heartCount) && raw.heartCount >= 0) state.heartCount = Math.min(raw.heartCount, HEART_LIMIT);
    if (state.heartCount > 0) {
        state.heartStartedAt = Number.isSafeInteger(raw.heartStartedAt) && raw.heartStartedAt >= 0 && raw.heartStartedAt <= now ? raw.heartStartedAt : now;
    }
    if (speeds.includes(raw.settings?.speed)) state.settings.speed = raw.settings.speed;
    if (typeof raw.settings?.autoNext === 'boolean') state.settings.autoNext = raw.settings.autoNext;
    return state;
}

export class PreferencesStorage {
    constructor(backend, onError = () => {}) {
        this.backend = backend; this.onError = onError; this.warned = false;
        try {
            const raw = JSON.parse(backend?.getItem(STORAGE_KEY) || 'null');
            const now = Date.now();
            this.state = normalizeState(raw, now);
            if (!this.expireHearts(now) && this.state.heartCount > 0 && raw.heartStartedAt !== this.state.heartStartedAt) this.commit();
        } catch { this.state = fresh(); this.report(); }
    }
    report() { if (!this.warned) { this.warned = true; this.onError('收藏、设置或爱心进度暂时无法保存。'); } }
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
    expireHearts(now = Date.now()) {
        if (this.state.heartStartedAt === null || now - this.state.heartStartedAt < HEART_RESET_MS) return false;
        this.state.heartCount = 0; this.state.heartStartedAt = null; this.commit();
        return true;
    }
    addHeart(now = Date.now()) {
        this.expireHearts(now);
        if (this.state.heartCount >= HEART_LIMIT) return;
        if (this.state.heartCount === 0) this.state.heartStartedAt = now;
        this.state.heartCount += 1; this.commit();
    }
    setSettings(patch) {
        this.state.settings = normalizeState({ ...this.state, settings: { ...this.state.settings, ...patch } }).settings;
        this.commit();
    }
    clear() { this.state = fresh(); this.commit(); }
}
