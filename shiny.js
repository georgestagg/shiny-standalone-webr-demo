import('http://webr.r-wasm.org/latest/webr.mjs').then(async ({ WebR }) => {
  let webSocketHandleCounter = 0;
  let webSocketRefs = {};

  // Create a proxy WebSocket class to intercept WebSocket API calls inside the
  // Shiny iframe and forward the messages to webR over the communication channel.
  class WebSocketProxy {
    url;
    handle;
    bufferedAmount;
    readyState;
    constructor(_url) {
      this.url = _url
      this.handle = webSocketHandleCounter++;
      this.bufferedAmount = 0;
      this.shelter = null;
      webSocketRefs[this.handle] = this; 

      // Trigger the WS onOpen callbacks
      webR.evalRVoid(`
        onWSOpen <- options('webr_httpuv_onWSOpen')[[1]]
        if (!is.null(onWSOpen)) {
          onWSOpen(
            ${this.handle},
            list(
              handle = ${this.handle}
            )
          )
        }
      `)

      setTimeout(() => {
        this.readyState = 1;
        this.onopen()
      }, 0);
    }

    async send(msg) {
      // Intercept WS message and send it via the webR channel
      webR.evalRVoid(`
        onWSMessage <- options('webr_httpuv_onWSMessage')[[1]]
        if (!is.null(onWSMessage)) {
          onWSMessage(${this.handle}, FALSE, '${msg}')
        }
      `)
    }
  }

  // Initialise webR with a local package repo
  const webR = new WebR();
  await webR.init();
  console.log("webR init OK");

  // Read webR channel for events
  (async () => {
    for (;;) {
      const output = await webR.read();
      switch (output.type) {
      case 'stdout':
        document.getElementById('out').append(output.data + '\n');
        document.getElementById('console').scrollTop = 
        document.getElementById('console').scrollHeight;
        break;
      case 'stderr':
        document.getElementById('out').append(output.data + '\n');
        document.getElementById('console').scrollTop = 
        document.getElementById('console').scrollHeight;
        break;
      case '_webR_httpuv_TcpResponse':
        const registration = await navigator.serviceWorker.getRegistration();
        registration.active.postMessage({
          type: "wasm-http-response",
          uuid: output.uuid,
          response: output.data,
        });
        break;
      case '_webR_httpuv_WSResponse':
        const event = { data: output.data.message };
        webSocketRefs[output.data.handle].onmessage(event);
        break;
      }
    }
  })();

  // Upload file to webR filesystem
  async function fetchToWebR(url, path) {
    const req = await fetch(url);
    const data = await req.arrayBuffer();
    await webR.FS.writeFile(path, new Uint8Array(data));
  }

  // Register service worker
  const registration = await navigator.serviceWorker.register('./httpuv-serviceworker.js');
  await navigator.serviceWorker.ready;
  window.addEventListener('beforeunload', async () => {
    await registration.unregister();
  });
  console.log("service worker registered");

  // Setup shiny app on webR VFS
  await webR.FS.mkdir('/home/web_user/app');
  await webR.FS.mkdir('/home/web_user/app/www');
  await fetchToWebR('app/ui.R', '/home/web_user/app/ui.R');
  await fetchToWebR('app/server.R', '/home/web_user/app/server.R');

  // Install and run shiny
  await webR.evalRVoid(`webr::install("shiny", repos="${window.location.href}/repo/")`);
  webR.writeConsole(`
    library(shiny)
    options(shiny.trace = TRUE)
    runApp('app', display.mode = 'showcase')
  `);

  // Setup listener for service worker messages
  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data.type === 'wasm-http-fetch') {
      var url = new URL(event.data.url);
      var pathname = url.pathname.replace(/.*\/__wasm__\/([0-9a-fA-F-]{36})/,"");
      var query = url.search.replace(/^\?/, '');
      webR.evalRVoid(`
        onRequest <- options("webr_httpuv_onRequest")[[1]]
        if (!is.null(onRequest)) {
          onRequest(
            list(
              PATH_INFO = "${pathname}",
              REQUEST_METHOD = "${event.data.method}",
              UUID = "${event.data.uuid}",
              QUERY_STRING = "${query}"
            )
          )
        }
      `);
    }
  });

  // Register with service worker and get our client ID
  const clientId = await new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('message', function listener(event) {
      if (event.data.type === 'registration-successful') {
        navigator.serviceWorker.removeEventListener('message', listener);
        resolve(event.data.clientId);
      }
    });
    registration.active.postMessage({type: "register-client"});
  });
  console.log('I am client: ', clientId);
  console.log("serviceworker proxy is ready");

  // Load the WASM httpuv hosted page in an iframe
  let iframe = document.createElement('iframe');
  iframe.id = 'app';
  iframe.src = `./__wasm__/${clientId}/`;
  iframe.frameBorder = '0';
  iframe.style.position = 'fixed';
  iframe.style.top = 0;
  iframe.style.left = 0;
  iframe.style.right = 0;
  iframe.style.width = '100%';
  iframe.style.height = '80%';
  document.body.appendChild(iframe);
  // Install the websocket proxy for chatting to httpuv
  iframe.contentWindow.WebSocket = WebSocketProxy;

  // Hide the loading div
  document.getElementById('loading').style.display = "none";
});
