import { PassThrough, Transform } from "stream";
import * as Sentry from "@sentry/react-router";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export const handleError = (error, { request }) => {
  if (request.signal.aborted) return;
  Sentry.captureException(error);
  console.error(error);
};

async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const cleanedBody = createProductPulseHtmlCleanupStream();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          cleanedBody.pipe(body);
          pipe(cleanedBody);
        },
        onShellError(error) {
          Sentry.captureException(error);
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          Sentry.captureException(error);
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}

export default Sentry.wrapSentryHandleRequest(handleRequest);

function createProductPulseHtmlCleanupStream() {
  let pending = "";
  const tailLength = 2048;

  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString("utf8");
      if (pending.length <= tailLength) {
        callback();
        return;
      }

      const readyLength = pending.length - tailLength;
      const ready = pending.slice(0, readyLength);
      pending = pending.slice(readyLength);
      this.push(removeStrayReactRouterDollarText(ready));
      callback();
    },
    flush(callback) {
      this.push(removeStrayReactRouterDollarText(pending));
      callback();
    },
  });
}

function removeStrayReactRouterDollarText(html) {
  return html.replace(
    /(^|>)(\s*)\$(\s*)(?=<script(?:\s[^>]*)?>\s*window\.__reactRouterContext\.streamController\.close\(\);\s*<\/script>)/g,
    "$1$2",
  );
}
