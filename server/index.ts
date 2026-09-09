import { Hono } from "hono";
import chat from "./chat";
import draw from "./draw";
import sync from "./sync";

const app = new Hono<{ Bindings: Env }>();

const api = new Hono<{ Bindings: Env }>();
api.get("/health", (c) => c.json({ ok: true }));
api.route("/chat", chat);
api.route("/draw", draw);
api.route("/sync", sync);

app.route("/api", api);

export default app;
