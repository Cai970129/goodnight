import test from 'node:test';
import assert from 'node:assert/strict';
import {
    HEART_LIMIT,
    HEART_RESET_MS,
    PreferencesStorage,
    STORAGE_KEY,
    normalizeState
} from '../asserts/js/storage.js';

class MemoryStorage {
    constructor(initial = {}) {
        this.values = new Map(Object.entries(initial));
    }
    get length() { return this.values.size; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

test('normalizeState sanitizes favorites, hearts, and settings', () => {
    const now = 10_000_000;
    const state = normalizeState({
        version: 1,
        favorites: ['good', '../bad', 'good', 'also_good'],
        heartCount: 99,
        heartStartedAt: now - 1,
        settings: { speed: 3, autoNext: 'yes' }
    }, now);
    assert.deepEqual(state.favorites, ['good', 'also_good']);
    assert.equal(state.heartCount, HEART_LIMIT);
    assert.equal(state.heartStartedAt, now - 1);
    assert.deepEqual(state.settings, { speed: 1, autoNext: true });
});

test('hearts expire after the reset window and reset the timer', () => {
    const backend = new MemoryStorage();
    const storage = new PreferencesStorage(backend);
    storage.addHeart(1000);
    assert.equal(storage.state.heartCount, 1);
    assert.equal(storage.state.heartStartedAt, 1000);
    assert.equal(storage.expireHearts(1000 + HEART_RESET_MS - 1), false);
    assert.equal(storage.expireHearts(1000 + HEART_RESET_MS), true);
    assert.equal(storage.state.heartCount, 0);
    assert.equal(storage.state.heartStartedAt, null);
});

test('favorites, settings, and clear persist safely', () => {
    const backend = new MemoryStorage({
        chapter_loop_count_a: '2',
        chapter_loop_count_b: '1'
    });
    const storage = new PreferencesStorage(backend);
    storage.toggleFavorite('book-one');
    storage.toggleFavorite('book-two');
    storage.toggleFavorite('book-one');
    storage.setSettings({ speed: 1.5, autoNext: false });
    assert.deepEqual(storage.state.favorites, ['book-two']);
    assert.deepEqual(storage.state.settings, { speed: 1.5, autoNext: false });
    assert.ok(backend.getItem(STORAGE_KEY));

    storage.clear();
    assert.deepEqual(storage.state.favorites, []);
    assert.equal(storage.state.settings.speed, 1);
    assert.equal(backend.getItem('chapter_loop_count_a'), null);
    assert.equal(backend.getItem('chapter_loop_count_b'), null);
});

test('storage failures fall back to an in-memory state and warn once', () => {
    let warnings = 0;
    const backend = {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
        removeItem() {},
        key() { return null; },
        length: 0
    };
    const storage = new PreferencesStorage(backend, () => { warnings += 1; });
    storage.addHeart();
    assert.equal(storage.state.heartCount, 1);
    assert.equal(warnings, 1);
});
