export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export class Player extends EventTarget {
    constructor(audio) {
        super(); this.audio = audio; this.track = null; this.book = null;
        this.request = 0; this.pending = false; this.message = ''; this.error = false;
        for (const event of ['loadedmetadata', 'durationchange', 'seeked', 'pause']) {
            audio.addEventListener(event, () => this.emit());
        }
        audio.addEventListener('timeupdate', () => { this.emit(); this.updateMediaPosition(); });
        audio.addEventListener('playing', () => {
            if (!this.track || audio.paused || audio.ended || audio.error || audio.readyState < 2) return;
            this.pending = false; this.status();
        });
        audio.addEventListener('ended', () => {
            if (!this.track || !audio.ended) return;
            ++this.request; this.pending = false; this.status(); this.emit('ended');
        });
        audio.addEventListener('error', () => {
            if (!this.track?.src || !audio.error) return;
            ++this.request; this.pending = false; this.status(this.mediaError(), true);
        });
    }
    emit(type = 'change') {
        this.dispatchEvent(new Event(type));
        if (type !== 'change') this.dispatchEvent(new Event('change'));
        this.updateMediaState();
    }
    status(message = '', error = false) { this.message = message; this.error = error; this.emit(); }
    mediaError() {
        switch (this.audio.error?.code) {
            case 2: return '音频加载失败，请检查网络后点击播放重试。';
            case 3: return '音频无法解码，请检查音频文件后重试。';
            case 4: return '音频不存在或格式不支持，请检查资源后重试。';
            default: return '播放中断，请点击播放重试。';
        }
    }
    select(book, track) {
        ++this.request; this.pending = false;
        this.track = null; this.audio.pause();
        this.book = book; this.track = track || null;
        this.audio.removeAttribute('src');
        if (track?.src) this.audio.src = track.src;
        this.audio.load(); this.status(); this.updateMetadata();
    }
    async play() {
        if (!this.track?.src || this.pending || !this.audio.paused) return;
        const token = ++this.request;
        if (this.audio.error) this.audio.load();
        if (this.audio.ended) this.audio.currentTime = 0;
        this.pending = true; this.status();
        try {
            await this.audio.play();
            if (token !== this.request) return;
            this.pending = false; this.emit();
        } catch (error) {
            if (token !== this.request) return;
            this.pending = false;
            if (error.name !== 'AbortError') this.status(error.name === 'NotAllowedError' ? '浏览器暂未允许播放，请再次点击播放。' : this.mediaError(), true);
            else this.status();
        }
    }
    pause() { ++this.request; this.pending = false; this.audio.pause(); this.status(); }
    toggle() { if (this.pending || !this.audio.paused) this.pause(); else return this.play(); }
    seek(time) {
        if (!this.track || this.audio.error || !Number.isFinite(time) || !Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
        this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration)); this.emit();
    }
    setSpeed(speed) {
        this.audio.defaultPlaybackRate = speed;
        this.audio.playbackRate = speed;
        this.updateMediaPosition();
    }
    get state() {
        const a = this.audio;
        return {
            playing: !this.pending && a.readyState >= 2 && !a.paused && !a.ended && !a.error, pending: this.pending,
            currentTime: Number.isFinite(a.currentTime) ? a.currentTime : 0,
            duration: Number.isFinite(a.duration) ? a.duration : 0,
            error: this.error || !!a.error, message: this.message
        };
    }
    updateMetadata() {
        if (!globalThis.navigator?.mediaSession || !globalThis.MediaMetadata || !this.book) return;
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.track?.label || this.book.title, artist: this.book.author, album: this.book.title,
                artwork: this.book.cover ? [{ src: this.book.cover }] : []
            });
        } catch { /* Browser may not accept metadata artwork. */ }
    }
    updateMediaState() {
        if (!globalThis.navigator?.mediaSession) return;
        const state = !this.track ? 'none' : this.state.playing ? 'playing' : 'paused';
        if (navigator.mediaSession.playbackState !== state) navigator.mediaSession.playbackState = state;
    }
    updateMediaPosition() {
        if (!globalThis.navigator?.mediaSession?.setPositionState || !this.state.duration) return;
        try { navigator.mediaSession.setPositionState({ duration: this.state.duration, playbackRate: this.audio.playbackRate, position: Math.min(this.state.currentTime, this.state.duration) }); } catch { /* Optional API. */ }
    }
}

const endCounts = new Map();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const audio = document.getElementById('audioPlayer');

audio?.addEventListener('ended', () => {
    if (reduceMotion.matches) return;
    const key = `chapter_loop_count_${audio.currentSrc || audio.src}`;
    let previous = endCounts.get(key);
    if (previous === undefined) {
        previous = 0;
        try {
            const value = Number(localStorage.getItem(key));
            if (Number.isInteger(value) && value >= 0 && value < 3) previous = value;
        } catch { /* Keep the session count when storage is unavailable. */ }
    }
    const count = previous + 1, next = count % 3;
    endCounts.set(key, next);
    try { localStorage.setItem(key, String(next)); } catch { /* Session count remains available. */ }
    if (count < 3) playStars(count === 1 ? 15 : 45);
    else playMeteors(35);
});

function playStars(count) {
    const container = effectContainer();
    for (let i = 0; i < count; i++) {
        const star = document.createElement('div');
        star.className = 'falling-star';
        star.textContent = ['⭐', '✨', '🌟'][Math.floor(Math.random() * 3)];
        star.style.left = `${Math.random() * 100}vw`;
        star.style.animationDuration = `${Math.random() * 2 + 1.5}s`;
        star.style.animationDelay = `${Math.random() * .8}s`;
        container.append(star);
    }
    setTimeout(() => container.remove(), 4500);
}

function playMeteors(count) {
    const container = effectContainer();
    for (let i = 0; i < count; i++) {
        const meteor = document.createElement('div');
        meteor.className = 'meteor';
        meteor.style.left = `${Math.random() * 120 - 10}vw`;
        meteor.style.top = `${-Math.random() * 200}px`;
        meteor.style.animationDuration = `${Math.random() + .8}s`;
        meteor.style.animationDelay = `${Math.random() * 2}s`;
        container.append(meteor);
    }
    setTimeout(() => container.remove(), 4500);
}

function effectContainer() {
    const container = document.createElement('div');
    container.className = 'star-container';
    container.setAttribute('aria-hidden', 'true');
    document.body.append(container);
    return container;
}
