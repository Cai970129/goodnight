import { formatTime } from './player.js';
import { adjacentTrack } from './library.js';

export const byId = id => document.getElementById(id);
const trackInfo = track => !track?.src ? '音频待添加' : track.duration ? formatTime(track.duration) : '';
const text = (tag, content, className) => {
    const element = document.createElement(tag);
    element.textContent = content;
    if (className) element.className = className;
    return element;
};

export function coverElement(book) {
    const fallback = () => text('span', book.title, 'cover-fallback');
    if (!book.cover) return fallback();
    const image = document.createElement('img');
    image.src = book.cover; image.alt = `《${book.title}》封面`;
    image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
    return image;
}

export class UI {
    constructor(actions) {
        this.view = 'home'; this.category = ''; this.bannerIndex = 0;
        document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => actions.view(button.dataset.view)));
        byId('bookList').addEventListener('click', event => {
            const button = event.target.closest('[data-book-id]');
            if (button) actions.book(button.dataset.bookId);
        });
        byId('chapterList').addEventListener('click', event => {
            const button = event.target.closest('[data-track-id]');
            if (button && !button.disabled) actions.track(button.dataset.trackId);
        });
        byId('categoryFilters').addEventListener('click', event => {
            const button = event.target.closest('[data-category]');
            if (button) { this.category = button.dataset.category; actions.filterBooks(); }
        });
        byId('bookSearch').addEventListener('input', () => actions.filterBooks());
        byId('chapterSearch').addEventListener('input', () => actions.filterChapters());
        byId('playBtn').addEventListener('click', actions.togglePlay);
        byId('prevBtn').addEventListener('click', () => actions.step(-1));
        byId('nextBtn').addEventListener('click', () => actions.step(1));
        byId('likeBtn').addEventListener('click', actions.favorite);
        byId('switchBookBtn').addEventListener('click', () => actions.view('shelf'));
        byId('progressBar').addEventListener('input', event => actions.seek(Number(event.target.value) / 1000));
        for (const id of ['playerSpeed', 'settingsSpeed']) byId(id).addEventListener('change', event => actions.settings({ speed: Number(event.target.value) }));
        byId('autoNext').addEventListener('change', event => actions.settings({ autoNext: event.target.checked }));
        document.querySelectorAll('[data-minutes]').forEach(button => button.addEventListener('click', () => actions.timer(Number(button.dataset.minutes))));
        byId('trackTimerBtn').addEventListener('click', () => actions.timer('track'));
        byId('chapterTimerBtn').addEventListener('click', () => actions.timer('chapter'));
        byId('cancelTimerBtn').addEventListener('click', () => actions.timer(null));
        byId('retryLibraryBtn').addEventListener('click', actions.retry);
        byId('nextBannerBtn').addEventListener('click', () => { this.bannerIndex++; this.renderBanner(this.book); });
        byId('clearRecordsBtn').addEventListener('click', () => byId('clearDialog').showModal());
        byId('cancelClearBtn').addEventListener('click', () => byId('clearDialog').close());
        byId('confirmClearBtn').addEventListener('click', () => { byId('clearDialog').close(); actions.clear(); });
    }
    notice(message, error = false) {
        byId('notice').hidden = !message; byId('notice').textContent = message || '';
        byId('notice').dataset.error = String(error);
    }
    show(view) {
        this.view = view;
        byId('homeView').hidden = view !== 'home';
        byId('shelfView').hidden = !['shelf', 'favorites'].includes(view);
        byId('settingsView').hidden = view !== 'settings';
        document.querySelectorAll('[data-view]').forEach(button => {
            if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
        });
        byId('shelfTitle').textContent = view === 'favorites' ? '我的收藏' : '我的书架';
        byId('shelfDescription').textContent = view === 'favorites' ? '把喜欢的声音留在身边。' : '选一本书，听一段故事。';
        byId('mainContent').scrollTop = 0;
    }
    renderLibrary(books, storage, selectedId, errors = []) {
        const query = byId('bookSearch').value.trim().toLocaleLowerCase();
        const favorites = storage.state.favorites;
        const source = this.view === 'favorites' ? books.filter(book => favorites.includes(book.id)) : books;
        const categories = [...new Set(source.map(book => book.category).filter(Boolean))];
        if (!categories.includes(this.category)) this.category = '';
        const filters = byId('categoryFilters'); filters.replaceChildren();
        for (const category of ['', ...categories]) {
            const button = text('button', category || '全部'); button.dataset.category = category;
            button.setAttribute('aria-pressed', String(category === this.category)); filters.append(button);
        }
        const visible = source.filter(book => (!this.category || book.category === this.category) && `${book.title} ${book.author}`.toLocaleLowerCase().includes(query));
        const list = byId('bookList'); list.replaceChildren();
        for (const book of visible) {
            const row = document.createElement('button'); row.className = 'book-row'; row.dataset.bookId = book.id;
            row.setAttribute('aria-label', `选择《${book.title}》`);
            row.setAttribute('aria-current', String(book.id === selectedId));
            const cover = document.createElement('span'); cover.className = 'book-cover'; cover.append(coverElement(book));
            const info = document.createElement('span'); info.className = 'book-row-info';
            info.append(text('strong', `《${book.title}》`));
            const available = book.tracks.filter(track => track.src);
            const chapters = new Set(available.map(track => track.chapterId));
            info.append(text('small', `${book.author} · ${chapters.size} 章 · ${available.length} 节可收听`));
            info.append(text('small', book.description));
            row.append(cover, info); list.append(row);
        }
        byId('shelfEmpty').hidden = visible.length > 0;
        byId('shelfEmpty').textContent = query || this.category ? '没有找到符合条件的书籍。' : this.view === 'favorites' ? '还没有收藏。收听时点击爱心，把喜欢的书留下来。' : '书架暂时没有书籍。';
        byId('libraryErrors').hidden = !errors.length;
        byId('libraryErrors').replaceChildren(...errors.map(entry => text('p', `${entry.id || '书架'}：${entry.error}`)));
        byId('retryLibraryBtn').hidden = !errors.length;
    }
    renderBook(book, storage) {
        const changed = this.book?.id !== book?.id;
        this.book = book;
        if (changed) { this.bannerIndex = 0; byId('chapterSearch').value = ''; }
        byId('audioTitle').textContent = book ? `《${book.title}》` : '书架暂时没有书籍';
        byId('playerCoverContainer').replaceChildren(...(book ? [coverElement(book)] : []));
        byId('bookDetails').hidden = !book;
        byId('bookDescription').textContent = book?.description || '';
        byId('pdfLinks').hidden = !book?.pdf;
        for (const id of ['pdfOpen', 'pdfDownload']) {
            if (book?.pdf) byId(id).href = book.pdf; else byId(id).removeAttribute('href');
        }
        if (book) byId('pdfDownload').download = `${book.title}.pdf`;
        this.renderBanner(book); this.updateFavorite(book, storage);
        this.renderChapters(book);
    }
    renderBanner(book) {
        const banners = book?.banners || [];
        this.bannerIndex %= banners.length || 1;
        const data = banners[this.bannerIndex];
        const img = byId('bannerImg'); img.hidden = !data?.image;
        if (data?.image) { img.src = data.image; img.alt = `《${book.title}》配图`; }
        else img.removeAttribute('src');
        img.onerror = () => { img.hidden = true; };
        byId('bannerQuote').textContent = data?.quote || (book ? `今晚，翻开《${book.title}》` : '让故事陪你入眠。');
        byId('bannerSource').textContent = data?.source || book?.author || '';
        byId('bannerIndex').textContent = banners.length ? `${this.bannerIndex + 1} / ${banners.length}` : '';
        byId('nextBannerBtn').hidden = banners.length < 2;
    }
    renderChapters(book) {
        const list = byId('chapterList'); list.replaceChildren();
        const query = byId('chapterSearch').value.trim().toLocaleLowerCase();
        byId('chapterSearch').disabled = !book;
        byId('chapterCount').textContent = book ? `${book.chapters.length} 章` : '';
        if (!book) return;
        let matches = 0;
        for (const chapter of book.chapters) {
            const tracks = chapter.tracks.filter(track => `${chapter.title} ${track.title}`.toLocaleLowerCase().includes(query));
            if (!tracks.length && query) continue;
            matches++;
            const group = document.createElement('section'); group.className = 'chapter-group'; group.dataset.chapterId = chapter.id;
            group.append(text('h4', chapter.title));
            for (const track of tracks) {
                const button = document.createElement('button'); button.className = 'chapter-row';
                button.dataset.trackId = track.id; button.disabled = !track.src;
                button.setAttribute('aria-label', `收听 ${track.label}`);
                button.append(text('span', track.title, 'track-title'), text('span', trackInfo(track), 'chapter-state'));
                group.append(button);
            }
            if (!chapter.tracks.length) group.append(text('p', '音频待添加', 'chapter-unavailable'));
            list.append(group);
        }
        if (!matches) list.append(text('p', '没有找到符合条件的章节。', 'empty-state'));
    }
    updateFavorite(book, storage) {
        const liked = !!book && storage.state.favorites.includes(book.id);
        byId('likeBtn').disabled = !book;
        byId('likeBtn').textContent = liked ? '♥' : '♡';
        byId('likeBtn').setAttribute('aria-pressed', String(liked));
        byId('likeBtn').setAttribute('aria-label', liked ? '取消收藏本书' : '收藏本书');
    }
    updatePlayback(player) {
        const { book, track } = player, state = player.state;
        byId('audioAuthor').textContent = track ? `${book.author} · ${track.label}` : book ? `${book.author} · 音频待添加` : '请在书架中选择书籍';
        const button = byId('playBtn'); button.disabled = !track?.src;
        button.textContent = state.playing || state.pending ? '⏸' : '▶';
        button.setAttribute('aria-pressed', String(state.playing));
        button.setAttribute('aria-label', state.pending ? '取消加载' : state.playing ? '暂停' : state.error ? '重试播放' : '播放');
        byId('playerStatus').hidden = !state.error || !state.message;
        byId('playerStatus').textContent = state.error ? state.message : '';
        byId('playerStatus').dataset.error = String(state.error);
        byId('currentTime').textContent = formatTime(state.currentTime);
        byId('durationTime').textContent = formatTime(state.duration);
        byId('progressBar').disabled = !track?.src || !state.duration || state.error;
        byId('progressBar').value = state.duration ? Math.round(state.currentTime / state.duration * 1000) : 0;
        byId('progressBar').setAttribute('aria-valuetext', `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`);
        byId('prevBtn').disabled = !book || !track || !adjacentTrack(book, track.id, -1);
        byId('nextBtn').disabled = !book || !track || !adjacentTrack(book, track.id, 1);
        byId('trackTimerBtn').disabled = !track;
        byId('chapterTimerBtn').disabled = !track;
        document.querySelectorAll('[data-track-id]').forEach(row => {
            const selected = row.dataset.trackId === track?.id;
            row.setAttribute('aria-current', String(selected));
            const item = book?.tracks.find(entry => entry.id === row.dataset.trackId);
            row.querySelector('.chapter-state').textContent = trackInfo(item);
        });
    }
    updateSettings(settings) {
        byId('playerSpeed').value = String(settings.speed);
        byId('settingsSpeed').value = String(settings.speed);
        byId('autoNext').checked = settings.autoNext;
    }
    updateTimer(timer) {
        const remaining = timer.remaining();
        byId('timerStatus').textContent = timer.mode === 'track' ? '当前节结束后停止' : timer.mode === 'chapter' ? '当前章结束后停止' : remaining !== null ? `剩余 ${formatTime(remaining)}` : '';
        document.querySelectorAll('[data-minutes]').forEach(button => button.setAttribute('aria-pressed', String(timer.mode === 'time' && timer.selectedMinutes === Number(button.dataset.minutes))));
        byId('trackTimerBtn').setAttribute('aria-pressed', String(timer.mode === 'track'));
        byId('chapterTimerBtn').setAttribute('aria-pressed', String(timer.mode === 'chapter'));
        byId('cancelTimerBtn').disabled = !timer.mode;
    }
}
