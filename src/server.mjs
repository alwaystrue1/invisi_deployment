import Fastify from 'fastify';
import { createServer } from 'node:http';
import { wispurr } from 'wispurr';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import {
  config,
  serverUrl,
  pages,
  externalPages,
  flatAltPaths,
  getAltPrefix,
} from './routes.mjs';
import { tryReadFile, preloaded404 } from './templates.mjs';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';

/* Record the server's location as a URL object. */
console.log(serverUrl);

// Wisp Configuration
const wisp = new wispurr({
  port: 6001,
  logLevel: 'none',

  allowTCP: true,
  allowUDP: false,
  enableV2: true,
  enableTwisp: false,
  websocketPermessageDeflate: false,

  allowDirectIP: true,
  allowPrivateIPs: false,
  allowLoopbackIPs: true,

  parseRealIP: true,
  trustedHeaders: ['CF-Connecting-IP', 'X-Forwarded-For'],

  whitelist: {
    ports: [80, 443, 9050, 7000, 7001],
  },

  tcpBufferSize: 1048576,
  socketBufferSize: 33554432,
  pendingQueueSize: 268435456,
  bufferRemainingLength: 32768,
  tcpNoDelay: true,
  handshakeTimeoutSeconds: 10,
  passwordAuth: false,
  passwordAuthRequired: false,
  passwordUsers: {},
  trustedProxies: ['127.0.0.1'],
  nonWSResponse: 'wispurr high-throughput relay',
  maxMessageSize: 1048581,
  staticDir: '',
  bandwidthLimitKbps: 0,
  connectionsLimitPerIP: 0,
  connectionWindowSeconds: 0,

  floodProtection: {
    enabled: false,
    maxConnectsPerSourceIPPerSecond: 0,
    maxConnectsPerDestPerSecond: 0,
    maxConnectsPerDestPerMinute: 0,
    maxInFlightSyns: 0,
    maxConcurrentStreamsPerConnection: 0,
    maxConcurrentConnections: 0,
    synFloodSignature: {
      enabled: false,
      windowMs: 2000,
      minSamples: 32,
      failedHandshakeRatio: 0.75,
    },
    wsCloseAfterViolations: 0,
    logBlockedDials: false,
  },

  reputation: {
    enabled: false,
    storePath: './data/wispurr-reputation.json',
    saveIntervalSeconds: 30,
    scoreDecayPerHour: 1,
    evictAfterDays: 7,
    thresholds: { warn: 21, throttle: 51, strict: 81 },
    weights: {},
    destinationWeights: {},
  },
});

// Modify for parallel instances
wisp.start(1);

// Shutdown file path
const shutdown = fileURLToPath(
  new URL('./.shutdown', import.meta.url)
);

// Create a server factory for Wisp
const serverFactory = (handler) => {
  return createServer()
    .on('request', (req, res) => {
      handler(req, res);
    })
    .on('upgrade', (req, socket, head) => {
      if (req.url.endsWith(getAltPrefix('wisp', serverUrl.pathname))) {
        wisp.route(req, socket, head);
      }
    });
};

const app = Fastify({
  routerOptions: {
    ignoreDuplicateSlashes: true,
    ignoreTrailingSlash: true,
  },
  logger: false,
  serverFactory,
});

// IFRAME FIX: Disable Helmet's X-Frame-Options protection.
// CSP was already disabled in the original configuration.
app.register(fastifyHelmet, {
  contentSecurityPolicy: false,
  xPoweredBy: false,
  frameguard: false,
});

// Serve website pages
app.register(fastifyStatic, {
  root: fileURLToPath(
    new URL('../views/dist/pages', import.meta.url)
  ),
  prefix: serverUrl.pathname,
  decorateReply: false,
});

// Serve static asset directories
[
  'assets',
  'uv',
  'scram',
  'epoxy',
  'libcurl',
  'baremux',
].forEach((prefix) => {
  app.register(fastifyStatic, {
    root: fileURLToPath(
      new URL('../views/dist/' + prefix, import.meta.url)
    ),
    prefix: getAltPrefix(prefix, serverUrl.pathname),
    decorateReply: false,
  });
});

// Serve service workers
['sw.js', 'sw-blacklist.js'].forEach((swFile) => {
  const distName = flatAltPaths['files/' + swFile] || swFile;

  app.get(serverUrl.pathname + distName, (req, reply) => {
    reply
      .type('application/javascript')
      .header('Service-Worker-Allowed', serverUrl.pathname)
      .send(
        tryReadFile(
          '../views/dist/' + distName,
          import.meta.url
        )
      );
  });
});

/*
 * Website files are stored in /views.
 * Routes are defined in routes.mjs.
 */

const supportedTypes = {
  default: config.disguiseFiles
    ? 'image/vnd.microsoft.icon'
    : 'text/html',
  html: 'text/html',
  txt: 'text/plain',
  xml: 'application/xml',
  ico: 'image/vnd.microsoft.icon',
};

const disguise = 'ico';

if (config.disguiseFiles) {
  const getActualPath = (path) =>
    path.slice(0, path.length - 1 - disguise.length);

  const shouldNotHandle = new RegExp(
    `\\.(?!html$|${disguise}$)[\\w-]+$`,
    'i'
  );

  const loaderFile = tryReadFile(
    '../views/dist/pages/misc/deobf/loader.html',
    import.meta.url,
    false
  );

  let exemptDirs = [
    'assets',
    'uv',
    'scram',
    'epoxy',
    'libcurl',
    'baremux',
    'wisp',
  ].map((dir) =>
    getAltPrefix(dir, serverUrl.pathname).slice(1, -1)
  );

  let exemptPages = [
    'login',
    'test-shutdown',
    'favicon.ico',
  ];

  for (const [key, value] of Object.entries(externalPages)) {
    if (typeof value === 'string') {
      exemptPages.push(key);
    } else {
      exemptDirs.push(key);
    }
  }

  exemptPages = exemptPages.concat(exemptDirs);

  if (pages.default === 'login') {
    exemptPages.push('');
  }

  app.addHook('preHandler', (req, reply, done) => {
    if (req.params.modified) return done();

    const reqPath = new URL(req.url, serverUrl).pathname.slice(
      serverUrl.pathname.length
    );

    if (
      shouldNotHandle.test(reqPath) ||
      exemptDirs.some((dir) => reqPath.indexOf(dir + '/') === 0) ||
      exemptPages.includes(reqPath)
    ) {
      return done();
    }

    if (!reqPath.endsWith('.' + disguise)) {
      reply.type(supportedTypes.html).send(loaderFile);
      reply.hijack();
      return done();
    } else if (
      !(reqPath in pages) &&
      !reqPath.endsWith('favicon.ico')
    ) {
      req.params.modified = true;
      req.raw.url = getActualPath(req.raw.url);

      if (req.params.path) {
        req.params.path = getActualPath(req.params.path);
      }

      if (req.params['*']) {
        req.params['*'] = getActualPath(req.params['*']);
      }

      reply.type(supportedTypes[disguise]);
      reply.header('Access-Control-Allow-Origin', 'null');
    }

    return done();
  });
}

// Main page routes
app.get(serverUrl.pathname + ':path', (req, reply) => {
  const reqPath = req.params.path;

  // Ignore automatic favicon requests
  if (reqPath === 'favicon.ico') {
    reply.send();
    return reply.hijack();
  }

  // Handle external routes
  if (reqPath in externalPages) {
    if (req.params.modified) {
      return reply
        .code(404)
        .type(supportedTypes.html)
        .send(preloaded404);
    }

    let externalRoute = externalPages[reqPath];

    if (typeof externalRoute !== 'string') {
      externalRoute = externalRoute.default;
    }

    return reply.redirect(externalRoute);
  }

  // Handle shutdown requests
  if (reqPath === 'test-shutdown' && existsSync(shutdown)) {
    console.log('InvisiProxy is shutting down.');
    wisp.stop();
    app.close();
    unlinkSync(shutdown);
    process.exitCode = 0;
  }

  // Return 404 for unknown routes
  if (reqPath && !(reqPath in pages)) {
    return reply
      .code(404)
      .type(supportedTypes.default)
      .send(preloaded404);
  }

  // Serve the requested page
  const fileName = reqPath
    ? pages[reqPath]
    : pages[pages.default];

  const type =
    supportedTypes[
      fileName.slice(fileName.lastIndexOf('.') + 1)
    ] || supportedTypes.default;

  if (req.params.modified) {
    reply.type(supportedTypes[disguise]);
  } else {
    reply.type(type);
  }

  reply.send(
    tryReadFile('../views/dist/' + fileName, import.meta.url)
  );
});

// GitHub redirect routes
app.get(serverUrl.pathname + 'github/:redirect', (req, reply) => {
  if (req.params.redirect in externalPages.github) {
    reply.redirect(externalPages.github[req.params.redirect]);
  } else {
    reply
      .code(404)
      .type(supportedTypes.default)
      .send(preloaded404);
  }
});

// Handle unmatched routes
if (serverUrl.pathname === '/') {
  app.setNotFoundHandler((req, reply) => {
    reply
      .code(404)
      .type(supportedTypes.default)
      .send(preloaded404);
  });
} else {
  // Fix serving index.html when using a URL prefix
  app.get(serverUrl.pathname, (req, reply) => {
    reply
      .type(supportedTypes.default)
      .send(
        tryReadFile(
          '../views/dist/' + pages.index,
          import.meta.url
        )
      );
  });
}

// IFRAME FIX: Remove X-Frame-Options from outgoing responses.
// Preserve the existing HistoryHide behavior.
app.addHook('onSend', (request, reply, payload, done) => {
  reply.removeHeader('X-Frame-Options');

  const cookieHeader = request.headers['cookie'] || '';

  const historyHide = cookieHeader
    .split('; ')
    .find((c) => c.startsWith('HistoryHide='))
    ?.split('=')[1];

  if (
    historyHide === 'true' &&
    request.headers['sec-fetch-dest'] === 'document'
  ) {
    reply.code(404);
  }

  done(null, payload);
});

// Start the server
app.listen({
  port: serverUrl.port,
  host: serverUrl.hostname,
});

console.log(
  `InvisiProxy is listening on port ${serverUrl.port}.`
);

console.log(
  'When hosting with a reverse proxy please ensure you are using NGINX only.\n' +
  'Caddy and Apache have security risks due to wispurr and loopbacks. ' +
  'Please configure them correctly. NGINX is recommended and used for production. ' +
  'Ports are whitelisted and security is maintained with NGINX only.'
);

if (config.disguiseFiles) {
  console.log(
    'disguiseFiles is enabled. Visit src/routes.mjs to see the entry point, ' +
    'listed within the pages variable.'
  );
}