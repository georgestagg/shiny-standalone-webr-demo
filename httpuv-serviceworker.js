let wasmClientId;
let requests = {};

function promiseHandles() {
  const out = { resolve: (_) => {}, reject: (_) => {}, promise: null, };
  const promise = new Promise((resolve, reject) => {
    out.resolve = resolve;
    out.reject = reject;
  });
  out.promise = promise;
  return out;
}

function uuid() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// Modify a response so that the required CORP/COOP/COEP headers are in place
// for cross-origin isolation.
function addCoiHeaders(resp) {
  const headers = new Headers(resp.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

const handleInstall = () => {
  console.log('Service worker installed');
  self.skipWaiting();
};

const handleActivate = (event) => {
  console.log('Service worker activated');
  event.waitUntil(self.clients.claim());
};

const handleFetch = async (event) => {
  const wasmMatch = /\/__wasm__\/([0-9a-fA-F-]{36})/.exec(event.request.url);
  if (wasmMatch) {
    const wasmRequest = (async () => {
      const client = await self.clients.get(wasmMatch[1]);
      const id = uuid();
      requests[id] = promiseHandles();

      client.postMessage({
        type: "wasm-http-fetch",
        uuid: id,
        url: event.request.url,
        method: event.request.method,
        body: event.request.body,
      });

      const response = await requests[id].promise;
      const headers = Object.assign(
        { "Cross-Origin-Embedder-Policy": "require-corp" },
        Object.fromEntries(
          [...Array(response.headers.names.length).keys()].map((i) => {
            return [response.headers.names[i], response.headers.values[i].values[0]];
          })
        )
      );

      const body = response.body.type === 'raw'
        ? new Uint8Array(response.body.values)
        : response.body.values[0];
      return new Response( body, { headers } );
    })();

    event.waitUntil(wasmRequest);
    event.respondWith(wasmRequest);
    return;
  }

  // Don't add COI headers to requests for external origins
  const url = new URL(event.request.url);
  if (self.location.origin !== url.origin) return;

  event.respondWith((async () => {
    return addCoiHeaders(await fetch(event.request));
  })());
};

const handleMessage = async (event) => {
  if (event.data.type == 'register-client') {
    const clientId = event.source.id;
    const client = await self.clients.get(clientId);
    client.postMessage({
      type: "registration-successful",
      clientId,
    });
  }
  if (event.data.type == 'wasm-http-response') {
    requests[event.data.uuid].resolve(event.data.response);
  }
}

self.addEventListener('install', handleInstall);
self.addEventListener('activate', handleActivate);
self.addEventListener('fetch', handleFetch);
self.addEventListener('message', handleMessage);
