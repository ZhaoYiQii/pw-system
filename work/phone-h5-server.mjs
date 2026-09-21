/**
 * 真机走查专用：把 H5 产物托管到**局域网**（默认 0.0.0.0:3101），并把 /api 反代到本机 API。
 *
 * 为什么需要它：默认静态服务只绑 127.0.0.1，手机连不上；而 H5 产物按同源调用 `/api/*`，
 * 所以必须在同一台机器上把 /api 反代给后端。
 *
 * 用法（仓库根目录）：
 *   node work/phone-h5-server.mjs
 * 可覆盖：PHONE_H5_PORT（默认 3101）、PHONE_API_PORT（默认 3300）、PHONE_H5_ROOT（默认 apps/mobile/dist）
 */
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root =
  process.env.PHONE_H5_ROOT ?? path.join(here, "..", "apps", "mobile", "dist");
const apiPort = Number(process.env.PHONE_API_PORT ?? 3300);
const listenPort = Number(process.env.PHONE_H5_PORT ?? 3101);

const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

createServer((req, res) => {
  const url = decodeURIComponent(String(req.url).split("?")[0]);
  // H5 按同源调用后端：把 /api 反代到本机 API。
  if (url.startsWith("/api/")) {
    const proxied = httpRequest(
      {
        host: "127.0.0.1",
        port: apiPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on("error", () => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "api proxy error" }));
    });
    req.pipe(proxied);
    return;
  }
  const candidate =
    url === "/" ? path.join(root, "index.html") : path.join(root, url);
  readFile(candidate, (err, buf) => {
    if (!err) {
      res.writeHead(200, {
        "content-type":
          types[path.extname(candidate)] ?? "application/octet-stream",
      });
      res.end(buf);
      return;
    }
    // H5 单页路由回退
    readFile(path.join(root, "index.html"), (err2, html) => {
      if (err2) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    });
  });
}).listen(listenPort, "0.0.0.0", () =>
  console.log(
    `phone h5 up on 0.0.0.0:${listenPort} (root=${root}) -> api 127.0.0.1:${apiPort}`,
  ),
);