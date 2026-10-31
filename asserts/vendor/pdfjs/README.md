PDF.js 6.4.299, distributed by Mozilla under the Apache License 2.0.
Source: https://github.com/mozilla/pdf.js/releases/tag/v6.4.299
Package: pdfjs-dist@6.4.299 (npm).

The minified browser module and worker use the official legacy/build variants
for browsers without the newest JavaScript APIs. Runtime filenames stay stable;
the application uses a matching build query to refresh both modules together.
Application-owned pdf-compat.js and pdf-worker.js add a guarded
Promise.withResolvers shim to the page and worker without modifying this bundle.
Browser support: https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions

Only the minified legacy browser module, worker and supporting CMaps, fonts, WebAssembly
and ICC profiles are included. Source maps and the general-purpose viewer are
omitted. See LICENSE and licenses in each supporting directory.
