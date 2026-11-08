import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.matchMedia = () => ({ matches: true });
globalThis.document = { getElementById: () => null };

const { Player, formatTime } = await import('../asserts/js/player.js');

class FakeAudio extends EventTarget {
    constructor() {
        super();
        this.paused = true;
        this.ended = false;
        this.error = null;
        this.readyState = 0;
        this.currentTime = 0;
        this.duration = NaN;
        this.src = '';
        this.defaultPlaybackRate = 1;
        this.playbackRate = 1;
    }
    load() { this.readyState = 0; }
    play() {
        this.paused = false;
        this.readyState = 4;
        return Promise.resolve();
    }
    pause() {
        this.paused = true;
        this.dispatchEvent(new Event('pause'));
    }
    removeAttribute() { this.src = ''; }
}

test('formatTime formats finite non-negative durations', () => {
    assert.equal(formatTime(0), '00:00');
    assert.equal(formatTime(65.9), '01:05');
    assert.equal(formatTime(Infinity), '00:00');
    assert.equal(formatTime(-1), '00:00');
});

test('waiting and stalled set buffering state until canplay clears it', () => {
    const audio = new FakeAudio();
    const player = new Player(audio);
    player.select({ title: '书', author: '作者', cover: null }, {
        id: 'part-01', title: '第 1 节', label: '第一章 · 第 1 节', src: 'audio/01.opus'
    });
    audio.paused = false;
    audio.dispatchEvent(new Event('waiting'));
    assert.equal(player.state.buffering, true);
    assert.match(player.state.message, /缓冲中/);
    audio.dispatchEvent(new Event('stalled'));
    assert.equal(player.state.buffering, true);
    audio.dispatchEvent(new Event('canplay'));
    assert.equal(player.state.buffering, false);
    assert.equal(player.state.message, '');
});

test('pause and select clear a stale buffering message', () => {
    const audio = new FakeAudio();
    const player = new Player(audio);
    player.select({ title: '书', author: '作者', cover: null }, {
        id: 'part-01', title: '第 1 节', label: '第一章 · 第 1 节', src: 'audio/01.opus'
    });
    audio.paused = false;
    audio.dispatchEvent(new Event('waiting'));
    player.pause();
    assert.equal(player.state.buffering, false);

    audio.paused = false;
    audio.dispatchEvent(new Event('waiting'));
    player.select({ title: '书', author: '作者', cover: null }, {
        id: 'part-02', title: '第 2 节', label: '第一章 · 第 2 节', src: 'audio/02.opus'
    });
    assert.equal(player.state.buffering, false);
});
