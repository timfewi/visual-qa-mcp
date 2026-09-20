import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PNG } from "pngjs";

export type FixtureMode = "broken" | "clean";

export interface FixtureSite {
  readonly url: string;
  setMode(mode: FixtureMode): void;
  close(): Promise<void>;
}

const TINY_PNG = (() => {
  const png = new PNG({ width: 8, height: 8 });
  for (let index = 0; index < 64; index += 1) {
    png.data[index * 4] = 20;
    png.data[index * 4 + 1] = 120;
    png.data[index * 4 + 2] = 200;
    png.data[index * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
})();

/** A deliberately imperfect page used to prove the capture and rule pipeline. */
function brokenPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fixture (needs work)</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; }
    h2 { font-size: 28px; margin: 16px; }
    .wide { width: 900px; height: 120px; background: #eef; }
    .fine { font-size: 9px; margin-left: 16px; }
    .low-contrast { color: #c8c8c8; background: #ffffff; margin-left: 16px; }
    .tiny-button { width: 16px; height: 16px; padding: 0; border: 1px solid #333; background: #fff; }
  </style>
</head>
<body>
  <h2>Fixture heading</h2>
  <div class="wide" data-testid="wide-block"></div>
  <p class="fine">Legalese that is too small to read comfortably for most people.</p>
  <p class="low-contrast">Hard to read text.</p>
  <img src="/missing.png" alt="broken asset">
  <img src="/logo.png" alt="logo">
  <button class="tiny-button"></button>
  <div role="button" tabindex="0" style="width:180px;height:36px;border:1px solid #333;margin:8px 16px">Act</div>
  <script>console.error('fixture console error');</script>
</body>
</html>`;
}

function cleanPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fixture (clean)</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #111; background: #fff; }
    h1 { font-size: 32px; margin: 16px; }
    p { margin: 16px; max-width: 60ch; }
    button { min-width: 120px; min-height: 44px; margin: 16px; font-size: 16px; }
  </style>
</head>
<body>
  <h1>Fixture heading</h1>
  <p>A short paragraph that fits comfortably inside the viewport at every supported width.</p>
  <button type="button">Primary action</button>
  <img src="/logo.png" alt="logo" width="8" height="8">
</body>
</html>`;
}

/** Start a local HTTP fixture site on a loopback port. */
export async function startFixtureSite(): Promise<FixtureSite> {
  let mode: FixtureMode = "broken";

  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = request.url ?? "/";
    if (url === "/logo.png") {
      response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      response.end(TINY_PNG);
      return;
    }
    if (url === "/ok" || url.startsWith("/ok?")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(cleanPage());
      return;
    }
    if (url === "/csp" || url.startsWith("/csp?")) {
      // A strict policy that blocks inline scripts, as sent by hardened sites.
      // The collector and axe-core must be injected in a way this does not block.
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "script-src 'self'",
      });
      response.end(cleanPage());
      return;
    }
    if (url === "/" || url.startsWith("/?")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(mode === "broken" ? brokenPage() : cleanPage());
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server did not bind to a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    setMode: (next) => {
      mode = next;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
