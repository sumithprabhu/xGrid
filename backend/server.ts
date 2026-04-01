import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { env } from "./src/lib/env";
import { startPriceLoop } from "./src/lib/price/loop";
import { gridCache } from "./src/lib/state/grid-cache";
import { priceCache } from "./src/lib/state/price-cache";

const dev = env.NODE_ENV !== "production";
const app = next({ dev, hostname: env.HOST, port: env.PORT });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => {
  // Next handles /api/* and page routes.
  handle(req, res);
});

const io = new Server(httpServer, {
  cors: { origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN },
});

io.on("connection", (socket) => {
  socket.emit("hello", { ok: true });
  socket.emit("price:snapshot", priceCache.snapshot());
  socket.emit("grid:snapshot", gridCache.snapshot());
});

startPriceLoop({
  intervalMs: env.PRICE_POLL_INTERVAL_MS,
  onPrice: ({ token, price, ts }) => {
    priceCache.set(token, { price, ts });
    io.emit("price:update", { token, price, ts });
  },
  onGrid: ({ token, grid, ts }) => {
    gridCache.set(token, { grid, ts });
    io.emit("grid:update", { token, grid, ts });
  },
});

httpServer.listen(env.PORT, env.HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[backend] http://${
    env.HOST === "0.0.0.0" ? "localhost" : env.HOST
  }:${env.PORT} (dev=${dev})`);
});

