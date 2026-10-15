importScripts('{{route}}{{/uv/uv.bundle.js}}');
importScripts('{{route}}{{/uv/uv.config.js}}');
importScripts(self['{{__uv$config}}'].sw || '{{route}}{{/uv/uv.sw.js}}');

const uv = new UVServiceWorker();

const blacklist = new Set();
fetch('{{route}}{{/assets/txt/blacklist.txt}}')
  .then((response) => response.text())
  .then((textData) => {
    for (const line of textData.split('\n')) {
      const domain = line.trim();
      if (!domain || domain.charCodeAt(0) === 35 /* '#' */) continue;
      blacklist.add(domain.toLowerCase());
    }
  })
  .catch(() => {});

const isBlacklistedDomain = (domain) => {
  if (!domain || blacklist.size === 0) return false;
  let host = domain.toLowerCase();
  while (host.includes('.')) {
    if (blacklist.has(host)) return true;
    host = host.slice(host.indexOf('.') + 1);
  }
  return false;
};

self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      if (uv.route(event)) {
        try {
          const hostname = new URL(
            uv.config.decodeUrl(
              new URL(event.request.url).pathname.replace(uv.config.prefix, '')
            )
          ).hostname;

          // If the domain is in the blacklist, return a 406 response code.
          if (isBlacklistedDomain(hostname))
            return new Response(new Blob(), { status: 406 });
        } catch {}
        return await uv.fetch(event);
      }

      return await fetch(event.request);
    })()
  );
});
