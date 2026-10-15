(() => {
  const swRoutes = {
      sj: ['{{route}}{{/sw.js}}', '{{route}}{{/sw-blacklist.js}}'],
      uv: ['{{route}}{{/uv/sw.js}}', '{{route}}{{/uv/sw-blacklist.js}}'],
    },
    swScope = '{{route}}{{/}}',
    uvSwScope = '{{route}}{{/uv/}}',
    swAllowedHostnames = ['localhost', '127.0.0.1'],
    wispUrl =
      (location.protocol === 'https:' ? 'wss' : 'ws') +
      '://' +
      location.host +
      '{{route}}{{/wisp/}}',
    proxyUrl = {
      tor: 'socks5h://localhost:9050',
      eu: 'socks5h://localhost:7000',
      jp: 'socks5h://localhost:7001',
    },
    transports = {
      '{{epoxy}}': '{{route}}{{/epoxy/index.mjs}}',
      '{{libcurl}}': '{{route}}{{/libcurl/index.mjs}}',
    },
    storageId = '{{hu-lts}}-storage',
    storageObject = () => JSON.parse(localStorage.getItem(storageId)) || {},
    readStorage = (name) => storageObject()[name],
    defaultMode = '{{epoxy}}';

  transports.default = transports[defaultMode];
  Object.freeze(transports);

  const getTransportSelection = () => {
    const url = transports[readStorage('Transport')] || transports.default;
    const options = { wisp: wispUrl };
    if ('string' === typeof readStorage('UseSocks5'))
      options.proxy = proxyUrl[readStorage('UseSocks5')];
    return { url, options };
  };

  const swVariant = () => (readStorage('HideAds') !== false ? 1 : 0);

  const unregisterStaleSWs = async () => {
    const expected = [swRoutes.sj[swVariant()], swRoutes.uv[swVariant()]].map(
      (sw) => new URL(sw, location.origin).pathname
    );
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      const active = registration.active;
      if (active && !expected.includes(new URL(active.scriptURL).pathname))
        await registration.unregister();
    }
  };

  const registerScramjetSW = async () => {
    if (!navigator.serviceWorker) {
      if (
        location.protocol !== 'https:' &&
        !swAllowedHostnames.includes(location.hostname)
      )
        throw new Error('Service workers cannot be registered without https.');
      throw new Error("Your browser doesn't support service workers.");
    }

    await unregisterStaleSWs();

    const sw = swRoutes.sj[swVariant()];
    console.log('Registering Scramjet service worker:', sw);
    const registration = await navigator.serviceWorker.register(sw, {
      scope: swScope,
    });

    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        const onChange = () => {
          navigator.serviceWorker.removeEventListener(
            'controllerchange',
            onChange
          );
          resolve();
        };
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          onChange,
          { once: true }
        );
        setTimeout(resolve, 5000);
      });
    }

    return registration;
  };

  const buildScramjetTransport = async () => {
    const { url, options } = getTransportSelection();
    const mod = await import(url);
    const TransportClient = mod.default;
    const transport = new TransportClient(options);
    if (typeof transport.init === 'function') await transport.init();
    return transport;
  };

  const buildFramePlugins = () => {
    if (typeof $scramjetUtils === 'undefined') return [];
    const plugins = [new $scramjetUtils.HttpCachePlugin()];

    const omniInput = document.getElementById('search-input');
    plugins.push(
      new $scramjetUtils.UrlWatcherPlugin((url) => {
        if (omniInput && document.activeElement !== omniInput)
          omniInput.value = url;
      })
    );

    plugins.push(
      new $scramjetUtils.CatchEscapedLinksPlugin((url) => {
        try {
          localStorage.setItem('{{hu-lts}}-frame-url', 'sj:' + url.href);
        } catch (e) {}
        return new URL(location.pathname + location.search, location.origin);
      })
    );

    return plugins;
  };

  const initialize = async () => {
    try {
      if (window.$invisiScramjet?.ready) {
        const existing = window.$invisiScramjet;
        const visibleFrame = document.getElementById('frame');
        if (
          visibleFrame instanceof HTMLIFrameElement &&
          existing.frame?.element !== visibleFrame
        ) {
          existing.frame = existing.controller.createFrame(visibleFrame, {
            plugins: buildFramePlugins(),
          });
        } 
        window.dispatchEvent(new Event('s-ready'));
        return;
      }

      const { url: transportUrl, options: transportOptions } =
        getTransportSelection();
      console.log('Using proxy:', transportOptions.proxy);
      console.log('Transport mode:', transportUrl);

      if (typeof BareMux !== 'undefined')
        try {
          const baremux = new BareMux.BareMuxConnection(
            '{{route}}{{/baremux/worker.js}}'
          );
          await baremux.setTransport(transportUrl, [transportOptions]);
          await navigator.serviceWorker.register(swRoutes.uv[swVariant()], {
            scope: uvSwScope,
          });
          console.log('Ultraviolet service worker registered');
        } catch (err) {
          console.warn(
            'BareMux setup failed',
            err
          );
        }

      const registration = await registerScramjetSW();

      const serviceworker =
        navigator.serviceWorker.controller ?? registration.active;
      if (!serviceworker)
        throw new Error('No service worker available for Scramjet controller');

      const { Controller } = $scramjetController;
      const { defaultConfig } = $scramjet;
      const transport = await buildScramjetTransport();
      const controller = new Controller({
        serviceworker,
        transport,
        config: {
          prefix: '{{route}}{{/scram/network/}}',
          scramjetPath: '{{route}}{{/scram/scramjet.js}}',
          wasmPath: '{{route}}{{/scram/scramjet.wasm}}',
          injectPath: '{{route}}{{/scram/controller.inject.js}}',
        },
        scramjetConfig: {
          ...defaultConfig,
          flags: {
            ...defaultConfig.flags,
            allowFailedIntercepts: true,
            allowInvalidJs: true,
          },
        },
      });

      await Promise.race([
        controller.wait(),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'Scramjet controller handshake timed out'
                )
              ),
            15000
          )
        ),
      ]);
      console.log('Scramjet controller initialized');

      const visibleFrame = document.getElementById('frame');
      let frame;
      if (visibleFrame instanceof HTMLIFrameElement) {
        frame = controller.createFrame(visibleFrame, {
          plugins: buildFramePlugins(),
        });
      } else {
        const hidden = document.createElement('iframe');
        hidden.setAttribute('aria-hidden', 'true');
        hidden.tabIndex = -1;
        hidden.style.cssText =
          'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none;';
        document.body.appendChild(hidden);
        frame = controller.createFrame(hidden);
      }

      window.$invisiScramjet = { controller, frame, ready: true };
      window.dispatchEvent(new Event('s-ready'));
    } catch (err) {
      console.error(
        'Scramjet initialization failed',
        err
      );
      window.$invisiScramjetError = err;
      window.dispatchEvent(new CustomEvent('s-error', { detail: err }));
    }
  };

  initialize();
})();
