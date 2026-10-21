import { loadLibrary, adjacentTrack } from './library.js';
import { PreferencesStorage } from './storage.js';
import { Player } from './player.js';
import { SleepTimer } from './timer.js';
import { UI, byId } from './ui.js';

const DEFAULT_BOOK_ID = '01-MaoYu';
export const player = new Player(byId('audioPlayer'));
export const timer = new SleepTimer();
let library = { books: [], errors: [] }, loading = false;
let backend, storageWarning = '';
try { backend = localStorage; } catch { /* Storage access can be disabled. */ }
export const storage = new PreferencesStorage(backend, message => { storageWarning = message; });

const ui = new UI({
    view: view => { ui.show(view); renderLibrary(); },
    book: id => { selectBook(id); ui.show('home'); },
    track: id => selectTrack(id, true),
    togglePlay: () => { if (!timer.check()) player.toggle(); },
    step: direction => stepTrack(direction),
    favorite: () => {
        if (!player.book) return;
        storage.toggleFavorite(player.book.id); ui.updateFavorite(player.book, storage); renderLibrary();
        if (storageWarning) ui.notice(storageWarning, true);
    },
    seek: ratio => player.seek(ratio * player.state.duration),
    filterBooks: renderLibrary,
    filterChapters: () => { ui.renderChapters(player.book); updatePlayback(); },
    settings: patch => {
        storage.setSettings(patch); applySettings();
        if (storageWarning) ui.notice(storageWarning, true);
    },
    timer: value => {
        if (value === 'track') timer.setTrackEnd();
        else if (value === 'chapter') timer.setChapterEnd();
        else if (value === null) timer.cancel();
        else timer.setMinutes(value);
    },
    retry: initialize,
    clear: () => {
        player.pause(); timer.cancel(); storage.clear(); applySettings();
        ui.updateFavorite(player.book, storage); renderLibrary();
        if (storageWarning) ui.notice(storageWarning, true);
    }
});

function updatePlayback() { ui.updatePlayback(player); }
function renderLibrary() { ui.renderLibrary(library.books, storage, player.book?.id, library.errors); }
function applySettings() { player.setSpeed(storage.state.settings.speed); ui.updateSettings(storage.state.settings); }

function selectBook(id) {
    const book = library.books.find(entry => entry.id === id);
    if (!book || player.book?.id === id) return;
    player.select(book, book.tracks.find(track => track.src));
    applySettings(); ui.renderBook(book, storage); updatePlayback(); renderLibrary();
}

function selectTrack(id, autoplay = false) {
    const track = player.book?.tracks.find(entry => entry.id === id && entry.src);
    if (!track) return;
    if (player.track?.id !== id) {
        player.select(player.book, track); applySettings();
    }
    if (autoplay && !timer.check()) player.play();
}
function stepTrack(direction) {
    const track = player.book && player.track && adjacentTrack(player.book, player.track.id, direction);
    if (track) selectTrack(track.id, true);
}

player.addEventListener('change', updatePlayback);
player.addEventListener('ended', () => {
    const next = adjacentTrack(player.book, player.track.id, 1);
    if (timer.trackEnded(!next || next.chapterId !== player.track.chapterId)) return;
    if (storage.state.settings.autoNext && next) selectTrack(next.id, true);
});
timer.addEventListener('change', () => ui.updateTimer(timer));
timer.addEventListener('expire', () => player.pause());
document.addEventListener('visibilitychange', () => timer.check());
window.addEventListener('pageshow', () => timer.check());

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

async function initialize() {
    if (loading) return;
    loading = true; byId('retryLibraryBtn').disabled = true;
    try {
        library = await loadLibrary();
        const active = library.books.find(book => book.id === player.book?.id);
        const current = active?.tracks.find(track => track.id === player.track?.id && track.src === player.track.src);
        if (active && current) {
            player.book = active; player.track = current; ui.renderBook(active, storage); updatePlayback();
        } else {
            const book = library.books.find(entry => entry.id === DEFAULT_BOOK_ID) || library.books[0];
            player.select(null, null);
            if (book) selectBook(book.id);
            else { ui.renderBook(null, storage); ui.show('shelf'); }
        }
        ui.notice(storageWarning || '', !!storageWarning); renderLibrary();
    } catch (error) {
        library.errors = [{ id: '书架', error: error.name === 'AbortError' ? '加载超时，请重试' : error.message }];
        if (!player.book) { ui.renderBook(null, storage); player.status('书架加载失败，请在书架中重新加载。', true); }
        ui.notice('书架加载失败，请检查网络后重试。', true); ui.show('shelf'); renderLibrary();
    } finally { loading = false; byId('retryLibraryBtn').disabled = false; }
}

ui.updateTimer(timer); applySettings(); installMediaControls();
export const ready = initialize();
