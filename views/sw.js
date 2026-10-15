importScripts('{{route}}{{/scram/controller.sw.js}}');

self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      if ($scramjetController.shouldRoute(event))
        return $scramjetController.route(event);

      return fetch(event.request);
    })()
  );
});
