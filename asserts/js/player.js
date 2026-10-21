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
        navigator.mediaSession.playbackState = !this.track ? 'none' : this.state.playing ? 'playing' : 'paused';
    }
    updateMediaPosition() {
        if (!globalThis.navigator?.mediaSession?.setPositionState || !this.state.duration) return;
        try { navigator.mediaSession.setPositionState({ duration: this.state.duration, playbackRate: this.audio.playbackRate, position: Math.min(this.state.currentTime, this.state.duration) }); } catch { /* Optional API. */ }
    }
}
