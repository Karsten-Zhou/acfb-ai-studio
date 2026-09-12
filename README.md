# Workers AI Chat&Draw

A streaming AI chat webapp built on **Cloudflare Workers AI**, with a **Vue 3 + shadcn-vue** frontend and a **Hono** API server.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Karsten-Zhou/acfb-ai-studio)

## Features

- **Streaming responses** — tokens are streamed over Server-Sent Events (SSE) from `@cloudflare/ai` (`AI.run(..., { stream: true })`) and bridged to a browser-friendly `text/event-stream` response.
- **Model switching** — pick from a curated catalog of Workers AI models (`shared/models.ts`) via a shadcn `Select`.
- **Reasoning effort** — control chain-of-thought depth for reasoning-oriented models.
- **Generation controls** — temperature, and top-p sliders (shadcn `Slider`).
- **Editable chat history** — edit, delete, or regenerate any message; conversations are replayed correctly.
- **Conversation sidebar** — create, switch, delete, and auto-title multiple threads.
- **Markdown rendering** — `marked` + **Shiki** with VSCode themes (`github-dark`/`github-light`) for code blocks, sanitized with DOMPurify. Unused Shiki grammars are lazy-loaded on demand and cached per message.
- **Persistence** — conversations stored in `localStorage` (client-side; D1 is wired for future server-side sync).

## Tech Stack

| Layer    | Tech                                |
| -------- | ----------------------------------- |
| Runtime  | Cloudflare Workers (Workerd)        |
| Server   | Hono + @hono/zod-validator          |
| AI       | `@cloudflare/ai` Workers AI binding |
| Frontend | Vue 3 (script setup) + Vite         |
| UI       | shadcn-vue (reka-ui) + Tailwind v4  |
| Markdown | marked, Shiki, DOMPurify            |

## Project Layout

```
server/            Hono worker (Cloudflare runtime)
  index.ts         App entry, mounts routes
  ai.ts            SSE streaming endpoint + /api/models
shared/            Shared types used by both client & server
  chat.ts          Message / Conversation / request types
  models.ts        Curated Workers AI model catalog
src/
  composables/     Vue state logic (chat store, streaming)
  lib/             Markdown renderer, utils
  components/
    chat/          Chat UI components
    ui/            shadcn-vue primitives
```

## Getting Started

You must have a Cloudflare account and be authenticated with `wrangler`.

```bash
bun install
bun run dev          # start the Vite + Workerd dev server (local AI)
bun run deploy       # build and deploy to Cloudflare
```

> `wrangler.jsonc` sets `"ai": { "remote": true }` so models run against
> Cloudflare's hosted Workers AI in local dev. To use local models, set
> `"remote": false` and configure the local gateway.

## API

### `POST /api/chat`

Streams an assistant reply as SSE.

```jsonc
// request
{
  "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "messages": [{ "role": "user", "content": "Hi" }],
  "params": { "temperature": 0.7, "topP": 0.9, "stream": true },
}
```

```jsonc
// SSE events (`data:` frames)
{ "type": "delta",  "delta": "Hello" }
{ "type": "delta",  "delta": " world" }
{ "type": "done",   "content": "Hello world" }
{ "type": "error",  "message": "..." }
```

### `GET /api/models`

Returns `{ models, default }` — the curated catalog and default model id.
