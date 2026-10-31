// Some Android WebViews lack this API even when they support module workers.
if (typeof Promise.withResolvers !== 'function') {
    Object.defineProperty(Promise, 'withResolvers', {
        configurable: true, writable: true,
        value: function withResolvers() {
            let resolve, reject;
            const promise = new this((res, rej) => { resolve = res; reject = rej; });
            return { promise, resolve, reject };
        }
    });
}
