import { loadLibrary, adjacentTrack } from './library.js';
import { PreferencesStorage, HEART_RESET_MS } from './storage.js';
import { Player } from './player.js';
import { SleepTimer } from './timer.js';
import { UI, byId } from './ui.js';
import { PDFReader } from './pdf-reader.js';

// Start default images before fetching book data, after the blocking stylesheet.
document.querySelectorAll('[data-initial-src]').forEach(image => {
    image.src = image.dataset.initialSrc; image.removeAttribute('data-initial-src');
});

const DEFAULT_BOOK_ID = '01-MaoYu';
export const player = new Player(byId('audioPlayer'));
export const timer = new SleepTimer();
let library = { books: [], errors: [] }, loading = false;
let backend, storageWarning = '';
let heartTimeout;
try { backend = localStorage; } catch { /* Storage access can be disabled. */ }
export const storage = new PreferencesStorage(backend, message => { storageWarning = message; });

const ui = new UI({
    view: showView,
    read: () => {
        const chapter = player.book?.chapters.find(entry => entry.id === player.track?.chapterId);
        if (!player.book?.pdf || !chapter?.pdfPage) return;
        reader.open(player.book, chapter.pdfPage); showView('reader');
    },
    book: id => { selectBook(id); showView('home'); },
    track: selectTrack,
    togglePlay: () => { if (!timer.check()) player.toggle(); },
    step: direction => stepTrack(direction),
    heart: () => {
        storage.addHeart(); updateHeart(); showStorageWarning();
    },
    favorite: () => {
        if (!player.book) return;
        storage.toggleFavorite(player.book.id); ui.updateFavorite(player.book, storage); renderLibrary();
        showStorageWarning();
    },
    seek: ratio => player.seek(ratio * player.state.duration),
    filterBooks: renderLibrary,
    filterChapters: () => { ui.renderChapters(player.book); updatePlayback(); },
    settings: patch => {
        storage.setSettings(patch); applySettings();
        showStorageWarning();
    },
    timer: value => {
        if (value === 'track') timer.setTrackEnd();
        else if (value === 'chapter') timer.setChapterEnd();
        else if (value === null) timer.cancel();
        else timer.setMinutes(value);
    },
    retry: initialize,
    clear: () => {
        storage.clear(); applySettings(); updateHeart();
        ui.updateFavorite(player.book, storage); renderLibrary();
        showStorageWarning();
    }
});

const reader = new PDFReader(() => {
    showView('home');
    byId('readChapterBtn').focus({ preventScroll: true });
});

function showView(view) {
    if (view !== 'reader') reader.close();
    ui.show(view); renderLibrary();
}

function updateHeart() {
    clearTimeout(heartTimeout);
    storage.expireHearts(); ui.updateHeart(storage.state.heartCount);
    if (storage.state.heartStartedAt !== null) {
        heartTimeout = setTimeout(updateHeart, Math.max(0, storage.state.heartStartedAt + HEART_RESET_MS - Date.now()));
    }
}
function updatePlayback() { ui.updatePlayback(player); }
function renderLibrary() {
    if (['shelf', 'favorites'].includes(ui.view)) ui.renderLibrary(library.books, storage, player.book?.id, library.errors);
}
function applySettings() { player.setSpeed(storage.state.settings.speed); ui.updateSettings(storage.state.settings); }
function showStorageWarning() { if (storageWarning) ui.notice(storageWarning, true); }

function selectBook(id) {
    const book = library.books.find(entry => entry.id === id);
    if (!book || player.book?.id === id) return;
    player.select(book, book.tracks.find(track => track.src));
    ui.renderBook(book, storage); updatePlayback();
}

function selectTrack(id) {
    const track = player.book?.tracks.find(entry => entry.id === id && entry.src);
    if (!track) return;
    if (player.track?.id !== id) player.select(player.book, track);
    if (!timer.check()) player.play();
}
function stepTrack(direction) {
    const track = player.book && player.track && adjacentTrack(player.book, player.track.id, direction);
    if (track) selectTrack(track.id);
}

player.addEventListener('change', updatePlayback);
player.addEventListener('ended', () => {
    if (!player.book || !player.track) return;
    const next = adjacentTrack(player.book, player.track.id, 1);
    if (timer.trackEnded(!next || next.chapterId !== player.track.chapterId)) return;
    if (storage.state.settings.autoNext && next) selectTrack(next.id);
});
timer.addEventListener('change', () => ui.updateTimer(timer));
timer.addEventListener('expire', () => { ui.cancelPlayClick(); player.pause(); });
document.addEventListener('visibilitychange', () => { timer.check(); updateHeart(); });
window.addEventListener('pageshow', () => { timer.check(); updateHeart(); });
window.addEventListener('pagehide', () => clearTimeout(heartTimeout));

function installMediaControls() {
    if (!navigator.mediaSession) return;
    const handlers = {
        play: () => { if (!timer.check()) player.play(); }, pause: () => player.pause(),
        previoustrack: () => stepTrack(-1), nexttrack: () => stepTrack(1),
        seekto: details => player.seek(details.seekTime),
        seekbackward: details => player.seek(player.state.currentTime - (details.seekOffset || 10)),
        seekforward: details => player.seek(player.state.currentTime + (details.seekOffset || 10))
    };
    for (const [action, handler] of Object.entries(handlers)) {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional action. */ }
    }
}

function updateLibrary(next) {
    library = next;
    const active = library.books.find(book => book.id === player.book?.id);
    const current = active?.tracks.find(track => track.id === player.track?.id && track.src === player.track.src);
    const settled = !next.pending.length;
    const canSelect = !next.pending.includes(DEFAULT_BOOK_ID) && (next.books.length > 0 || settled);

    if (active && current) {
        if (player.book !== active) {
            player.book = active; player.track = current;
            ui.renderBook(active, storage); updatePlayback();
        }
    } else if ((!player.book || settled) && canSelect) {
        const book = library.books.find(entry => entry.id === DEFAULT_BOOK_ID) || library.books[0];
        reader.close(); player.select(null, null);
        if (book) selectBook(book.id);
        else { ui.renderBook(null, storage); ui.show('shelf'); }
    }
    ui.notice(storageWarning || '', !!storageWarning); renderLibrary();
}

async function initialize() {
    if (loading) return;
    loading = true; byId('retryLibraryBtn').disabled = true;
    try {
        await loadLibrary(undefined, undefined, updateLibrary);
    } catch (error) {
        library.errors = [{ id: '书架', error: error.name === 'AbortError' ? '加载超时，请重试' : error.message }];
        if (!player.book) { ui.renderBook(null, storage); player.status('书架加载失败，请在书架中重新加载。', true); }
        ui.notice('书架加载失败，请检查网络后重试。', true); showView('shelf');
    } finally { loading = false; byId('retryLibraryBtn').disabled = false; }
}

ui.updateTimer(timer); updateHeart(); applySettings(); installMediaControls();
export const ready = initialize();
