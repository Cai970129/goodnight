export class SleepTimer extends EventTarget {
    constructor({ now = () => Date.now(), schedule = fn => setInterval(fn, 1000), unschedule = handle => clearInterval(handle) } = {}) {
        super(); this.now = now; this.schedule = schedule; this.unschedule = unschedule;
        this.mode = null; this.deadline = null; this.handle = null; this.selectedMinutes = null;
    }
    notify(type) { this.dispatchEvent(new Event(type)); }
    setMinutes(minutes) {
        if (![15, 30].includes(minutes)) return;
        this.cancel(false); this.mode = 'time'; this.selectedMinutes = minutes; this.deadline = this.now() + minutes * 60000;
        this.handle = this.schedule(() => this.check()); this.notify('change');
    }
    setTrackEnd() { this.cancel(false); this.mode = 'track'; this.notify('change'); }
    setChapterEnd() { this.cancel(false); this.mode = 'chapter'; this.notify('change'); }
    cancel(notify = true) {
        if (this.handle !== null) this.unschedule(this.handle);
        this.handle = null; this.mode = null; this.deadline = null; this.selectedMinutes = null;
        if (notify) this.notify('change');
    }
    expire() { this.cancel(false); this.notify('expire'); this.notify('change'); return true; }
    check() {
        if (this.mode === 'time' && this.now() >= this.deadline) return this.expire();
        this.notify('change'); return false;
    }
    trackEnded(isChapterEnd) {
        if (this.check()) return true;
        if (this.mode === 'track' || (this.mode === 'chapter' && isChapterEnd)) return this.expire();
        return false;
    }
    remaining() { return this.mode === 'time' ? Math.max(0, Math.ceil((this.deadline - this.now()) / 1000)) : null; }
}
