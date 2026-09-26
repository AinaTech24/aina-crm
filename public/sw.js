/*
 * Kill-switch service worker. This app does NOT use a service worker.
 *
 * Why this file exists anyway: a service worker belongs to the ORIGIN, not the
 * project. A browser that once ran a different app on the same origin (another
 * project on localhost:3000, a prototype, a rebranded clone) can keep an old
 * worker installed that answers every request from its cache. That is what
 * happened on 2026-09-26: a browser kept showing the dashboard as it was on
 * 16 September — old layout, old theme, no Quick Add — while the server was
 * sending the current one, and it "switched back" by itself after each reload.
 *
 * The browser re-checks the worker's script (this URL) on navigation. When that
 * check got a 404, the old worker stayed installed indefinitely. When it gets
 * THIS script instead, the browser installs it, and it:
 *   1. activates immediately rather than waiting for every tab to close,
 *   2. deletes every Cache Storage entry on the origin (all written by the old
 *      worker — this app creates none),
 *   3. unregisters itself, so the next load has no worker at all,
 *   4. reloads open tabs so they fetch the current app from the server.
 *
 * It has no fetch handler, so while it lives requests go straight to network.
 * Nothing in the app registers it: a browser without a stale registration never
 * requests this file, so ordinary users are unaffected.
 *
 * Served un-authenticated: src/middleware.ts excludes every *.js path.
 * If the app ever adopts a real service worker, replace this file.
 */

self.addEventListener("install", () => {
  // Waiting for every controlled tab to close is exactly what let the stale
  // page come back after an unregister, so do not wait.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
      } catch (_) {
        /* not fatal — cleanup below does not depend on it */
      }

      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));

      await self.registration.unregister();

      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) {
        try {
          client.navigate(client.url);
        } catch (_) {
          /* a tab that cannot be steered reloads clean on its next visit */
        }
      }
    })()
  );
});
