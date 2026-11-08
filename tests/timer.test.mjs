import test from 'node:test';
import assert from 'node:assert/strict';
import { SleepTimer } from '../asserts/js/timer.js';

function setup() {
    let now = 0;
    const scheduled = new Map();
    let nextHandle = 1;
    const timer = new SleepTimer({
        now: () => now,
        schedule: callback => {
            const handle = nextHandle++;
            scheduled.set(handle, callback);
            return handle;
        },
        unschedule: handle => scheduled.delete(handle)
    });
    return {
        timer,
        advance(ms) { now += ms; },
        tick() { for (const callback of scheduled.values()) callback(); },
        scheduled
    };
}

test('minute timers count down and expire once', () => {
    const { timer, advance } = setup();
    const events = [];
    timer.addEventListener('expire', () => events.push('expire'));
    timer.setMinutes(15);
    assert.equal(timer.mode, 'time');
    assert.equal(timer.remaining(), 900);
    advance(15 * 60 * 1000);
    assert.equal(timer.check(), true);
    assert.equal(timer.mode, null);
    assert.equal(events.length, 1);
});

test('track and chapter timers end at the requested boundary', () => {
    const { timer } = setup();
    timer.setTrackEnd();
    assert.equal(timer.trackEnded(false), true);
    assert.equal(timer.mode, null);

    timer.setChapterEnd();
    assert.equal(timer.trackEnded(false), false);
    assert.equal(timer.mode, 'chapter');
    assert.equal(timer.trackEnded(true), true);
    assert.equal(timer.mode, null);
});

test('scheduled timers are replaced and can be cancelled', () => {
    const { timer, advance, tick, scheduled } = setup();
    timer.setMinutes(15);
    timer.setMinutes(30);
    const deadline = 30 * 60 * 1000;
    assert.equal(timer.selectedMinutes, 30);
    assert.equal(timer.remaining(), deadline / 1000);
    advance(deadline);
    tick();
    assert.equal(timer.mode, null);
    assert.equal(scheduled.size, 0);

    timer.setMinutes(15);
    timer.cancel(false);
    assert.equal(timer.mode, null);
    assert.equal(scheduled.size, 0);
});

test('invalid minute values are ignored', () => {
    const { timer } = setup();
    timer.setMinutes(20);
    assert.equal(timer.mode, null);
});
