# Shiny on webR demo

This repo demonstrates the deployment of a Shiny app running on webR in the browser, hosting the app bundle via Netlify. The resulting app can be seen at https://shiny-standalone-webr-demo.netlify.app.

A version of the demo hosted on GitHub Pages is also available at https://georgestagg.github.io/shiny-standalone-webr-demo/.

The webR binaries are loaded through the public CDN hosted at https://webr.r-wasm.org. A pre-compiled webR package repository (containing various R package binaries built for WebAssembly) is additionally included as part of the deployment in the `repo` directory. The packages, including Shiny, are loaded into the page once webR has been initialised. This package repository has been built using the experimental `webr-repo` scripts at https://github.com/r-wasm/webr-repo.

## How it works

The httpuv package included here is an experimental build of a [minimal httpuv shim package](https://github.com/r-wasm/httpuv), designed for running under the restrictions of WebAssembly in the browser, where there is no raw socket access. The R functions that would normally be executed when a HTTP request arrives are instead made available for use in the web page loading webR through webR's JavaScript API.

In this demo the page first loads webR, then starts a [JavaScript Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) script essentially acting like a network proxy server. Network requests under a special URL are intercepted by the service worker and forwarded to the webR session running in the page.

In webR, a Shiny app is started making use of the httpuv shim package, now listening for the forwarded requests. The resulting responses from the running shiny session are emitted as webR output messages over the usual webR communication channel.

The service worker is also listening for resulting output messages, and when they are received it responds to the associated intercepted browser network requests with responses from the running Shiny session.

Once the above has all been set up, an [`iframe` HTML element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe) is dynamically added to the page pointing to the special intercepted URL. This frame displays the client-side of the Shiny app running under webR.

Note: There are other similar ways to orchestrate this communication process. For example, [Shinylive](https://github.com/rstudio/shinylive) implements service worker communication using the [`MessagePort`](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort) API.

## Limitations

Since this technique depends on loading a service worker into the page, the standard webR [service worker communication channel](https://docs.r-wasm.org/webr/latest/communication.html) cannot be used. This is because a web page is not able to use multiple service worker scripts at the same time. The page should be served with [cross-origin isolation HTTP headers](https://docs.r-wasm.org/webr/latest/serving.html) set, so that the default (and recommended) shared array buffer channel can be used instead. In this demo, the headers are configured for hosting via Netlify in the file `netlify.toml`.

In hosting situations where it is not possible to set the required HTTP headers for Cross-Origin Isolation (for example, when hosting with GitHub Pages), the headers can alternatively be injected by the service worker instead. The service worker script in this repo has been configured to add the required HTTP headers to all responses from the same origin as the script itself, ensuring that webR is still able to be used in such situations.

## A short warning

The latest build of webR and the httpuv shim package that have been used in this demo are experimental and may be subject to change at any time. The latest version of the webR documentation can be found at https://docs.r-wasm.org/webr/latest/.
