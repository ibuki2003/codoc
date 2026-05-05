# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

CoDoc is an AI-assisted document editing app. Users create "projects" (documents), edit them in a textarea, and chat with an LLM that can apply unified diffs to the document via the `edit_document` tool.

## Stack

- **Backend**: Deno 2 + Hono, MongoDB, OpenAI Responses API and OpenRouter (chat completions)
- **Frontend**: React 18 + Vite + MUI, TypeScript
- **Infra**: Docker Compose (MongoDB + backend + frontend-dev/prod)

## Development

Everything runs via Docker Compose. The `.env` file holds API keys (see `.env.example`).

```bash
# Start full dev stack (backend on :8000, frontend on :5173)
docker compose --profile dev up

# Frontend type-check (no test suite)
cd frontend && npx tsc --noEmit

# Backend has no separate type-check step; Deno handles it at runtime
```

The frontend proxies `/api` → `http://backend:8000` (configured in Vite). The frontend `api.ts` uses `BASE = "/api"`.

## Architecture

### Backend (`backend/src/`)

- `main.ts` — Hono app, mounts `/projects` and `/models` routes
- `config.ts` / `config.yml` — LLM model list and system prompt; add new models in `config.yml`
- `db.ts` — MongoDB types and collection (`projects`); `Project` has `content`, `lastSyncedContent`, and `history: ConversationEntry[]`
- `llm.ts` — Provider abstraction: `run_llm()` dispatches to `run_responses_api()` (OpenAI) or `run_chat_completion()` (OpenRouter); yields `StreamItem` events
- `routes/projects.ts` — CRUD for projects
- `routes/chat.ts` — `POST /:id/chat`; builds message history via `buildMessages()`, calls `run_llm()`, streams SSE back. Detects user edits since last LLM turn by comparing `content` vs `lastSyncedContent` and inserts a `user_diff` entry.

### Frontend (`frontend/src/`)

- `api.ts` — All backend calls; `chatStream()` reads SSE and calls `onChunk` for each event
- `pages/ProjectList.tsx` — Project listing / creation
- `pages/ProjectDetail.tsx` — Split-pane: textarea editor (left) + chat (right). Autosaves content after 1.5s idle. Chat messages are reconstructed from `project.history` on load and appended locally during streaming. `document_updated` SSE chunks apply diffs to the local editor state.

### Conversation history schema

History entries in MongoDB (`history[]`):
- `{ role: "user", content }` — user chat message
- `{ role: "assistant", content, tool_calls: [{call_id, tool_name, args, result}] }` — LLM reply + any edit tool calls
- `{ role: "system", subtype: "user_diff", diff }` — user manually edited the doc between LLM turns

`lastSyncedContent` tracks the document state after the last LLM turn, used to detect and record user edits.
