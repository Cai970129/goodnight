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

document.addEventListener('DOMContentLoaded', () => {
  const audioPlayer = document.querySelector('audio');
  
  if (audioPlayer) {
    audioPlayer.addEventListener('ended', () => {
      const chapterId = audioPlayer.getAttribute('src') || 'default_chapter';
      let storageKey = `chapter_loop_count_${chapterId}`;
      
      let currentCount = parseInt(localStorage.getItem(storageKey) || '0', 10);
      
      currentCount++;
      localStorage.setItem(storageKey, currentCount);

      if (currentCount === 1) {
        playStarAnim(15);
      } else if (currentCount === 2) {
        playStarAnim(45);
      } else if (currentCount >= 3) {
        playMeteorAnim(35);
        localStorage.setItem(storageKey, '0');
      }
    });
  }
});

function playStarAnim(count) {
  const container = createContainer();
  const icons = ['⭐', '✨', '🌟'];
  
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'falling-star';
    star.innerText = icons[Math.floor(Math.random() * icons.length)];
    star.style.left = Math.random() * 100 + 'vw';
    star.style.animationDuration = (Math.random() * 2 + 1.5) + 's';
    star.style.animationDelay = Math.random() * 0.8 + 's';
    container.appendChild(star);
  }
  removeContainer(container, 4500);
}

function playMeteorAnim(count) {
  const container = createContainer();
  for (let i = 0; i < count; i++) {
    const meteor = document.createElement('div');
    meteor.className = 'meteor';
    meteor.style.left = (Math.random() * 120 - 10) + 'vw';
    meteor.style.top = -Math.random() * 200 + 'px';
    meteor.style.animationDuration = (Math.random() * 1 + 0.8) + 's';
    meteor.style.animationDelay = Math.random() * 2 + 's';
    container.appendChild(meteor);
  }
  removeContainer(container, 4500);
}

function createContainer() {
  const container = document.createElement('div');
  container.className = 'star-container';
  document.body.appendChild(container);
  return container;
}

function removeContainer(container, time) {
  setTimeout(() => container.remove(), time);
}
