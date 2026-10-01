import http from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createStore, AppError } from "./store.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/style.css": ["style.css", "text/css"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
};
async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw new AppError("Request exceeds 16 KB.", 413);
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || Array.isArray(result) || typeof result !== "object")
      throw new Error();
    return result;
  } catch {
    throw new AppError("Expected a JSON object.");
  }
}
export function createApp(store) {
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (code, data) => {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      // Reject DNS rebinding and cross-origin writes. This demo intentionally binds to loopback.
      const host = req.headers.host || "";
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))
        throw new AppError("Host not allowed.", 403);
      const url = new URL(req.url, `http://${host}`);
      if (!["GET", "POST", "PATCH"].includes(req.method))
        throw new AppError("Method not allowed.", 405);
      if (["POST", "PATCH"].includes(req.method)) {
        if (req.headers.origin && req.headers.origin !== url.origin)
          throw new AppError("Cross-origin writes are not allowed.", 403);
        if (req.headers["sec-fetch-site"] === "cross-site")
          throw new AppError("Cross-site writes are not allowed.", 403);
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new AppError("Use application/json.", 415);
      }
      if (req.method === "GET" && files[url.pathname]) {
        const [file, type] = files[url.pathname];
        res.writeHead(200, {
          "Content-Type": `${type}; charset=utf-8`,
          "Cache-Control": "no-cache",
        });
        return res.end(readFileSync(path.join(root, "public", file)));
      }
      if (req.method === "GET" && url.pathname === "/api/health")
        return send(200, { status: "ok" });
      if (req.method === "GET" && url.pathname === "/api/dashboard")
        return send(200, store.snapshot());
      if (url.pathname === "/api/incidents") {
        if (req.method === "GET")
          return send(200, store.list(Object.fromEntries(url.searchParams)));
        if (req.method === "POST")
          return send(201, store.create(await body(req)));
      }
      const match = url.pathname.match(/^\/api\/incidents\/([a-f0-9-]{36})$/);
      if (match) {
        if (req.method === "GET") return send(200, store.get(match[1]));
        if (req.method === "PATCH")
          return send(200, store.update(match[1], await body(req)));
      }
      throw new AppError("Not found.", 404);
    } catch (error) {
      if (!(error instanceof AppError)) console.error(error);
      if (!res.headersSent)
        send(error instanceof AppError ? error.status : 500, {
          error:
            error instanceof AppError
              ? error.message
              : "Unexpected server error.",
        });
      else res.end();
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const dataDir = path.join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const store = createStore(path.join(dataDir, "signaldesk.sqlite"), {
    seed: process.env.SEED_DEMO !== "false",
  });
  const server = createApp(store);
  const port = Number(process.env.PORT || 4310);
  server.listen(port, "127.0.0.1", () =>
    console.log(`SignalDesk → http://127.0.0.1:${port}`),
  );
  server.on("error", (error) => {
    console.error(error.message);
    store.close();
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(() => {
        store.close();
        process.exit(0);
      }),
    );
}
