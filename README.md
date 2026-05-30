# WeChat Draft Studio

A local web workspace for managing WeChat Official Account drafts without logging into the browser editor for every small change.

It reads, edits, uploads, updates, and deletes drafts through the official WeChat draft APIs. The app runs on your own machine, keeps credentials local, and saves snapshots before risky operations.

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green)](#requirements)
[![WeChat API](https://img.shields.io/badge/WeChat-Draft%20API-blue)](#requirements)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Why This Exists

The official editor is fine for publishing, but it is not always pleasant for repeated draft maintenance: copying HTML, updating summaries, swapping covers, checking old drafts, or making a quick structured edit.

WeChat Draft Studio keeps that work in a small local tool:

- Credentials stay in environment variables or a local `.env`.
- The browser UI is focused on draft operations, not content marketing dashboards.
- Updates and deletes create local snapshots first.
- AI assistance is optional and can use either an OpenAI-compatible API or a local command.

## Features

- List Official Account drafts with pagination and page search.
- Open an existing draft and edit title, author, digest, source URL, comment setting, and body.
- Switch between rich text editing and raw HTML source.
- Upload inline images through `media/uploadimg`.
- Upload cover images through `material/add_material`.
- Update existing drafts with a local snapshot before writing.
- Create a new draft from the current editor content.
- Delete drafts with a typed confirmation and snapshot.
- Optional AI actions: polish, shorten, expand, title ideas, summaries, and structure review.

## Requirements

- Node.js 22 or newer.
- A verified WeChat Official Account with draft API access.
- Your current outbound IP added to the WeChat API allowlist.

## Quick Start

```bash
git clone https://github.com/aicorevision/wechat-draft-studio.git
cd wechat-draft-studio
npm install
cp .env.example .env
```

Fill `.env` locally:

```bash
WECHAT_APP_ID=your-app-id
WECHAT_APP_SECRET=your-app-secret
```

Start the app:

```bash
npm start
```

Open:

```text
http://127.0.0.1:4178
```

## AI Configuration

OpenAI-compatible mode:

```bash
WECHAT_DRAFT_AI_MODE=openai-compatible
WECHAT_DRAFT_AI_BASE_URL=https://your-gateway.example/v1
WECHAT_DRAFT_AI_API_KEY=your-api-key
WECHAT_DRAFT_AI_MODEL=your-model-name
```

Command mode:

```bash
WECHAT_DRAFT_AI_MODE=command
WECHAT_DRAFT_AI_COMMAND=/path/to/your-ai-command
```

Command mode receives JSON on stdin:

```json
{"action":"polish","text":"...","prompt":"..."}
```

It should print the edited result to stdout.

## Local Data

Snapshots are written to:

```text
.local/snapshots/
```

This directory is ignored by git. It is there so that accidental updates or deletes are easier to recover from.

## Useful Commands

```bash
npm run check
```

Run a syntax check.

```bash
npm start
npm run smoke
```

Run the real API smoke test. It creates a temporary test draft, uploads an image, updates the draft, reads the list, and deletes only the test draft it created.

## Security Notes

- Never commit `.env`.
- Prefer environment variables or `~/.wechat-draft-studio/.env` for credentials.
- Do not run the app on a public interface unless you add your own access control.
- API permissions belong to your Official Account; review WeChat API access before using smoke tests.

## Star If Useful

If this saves you a few trips through the Official Account editor, a star helps other WeChat operators and technical writers find it.

## License

MIT License. See [LICENSE](LICENSE).

