# WeChat Draft Studio

Cross-platform local Web GUI for managing WeChat Official Account draft-box articles.

It is intentionally independent from any article-writing Skill. It talks to the WeChat Official Account draft APIs directly and only needs your local AppID/AppSecret at runtime.

## Features

- List draft-box articles.
- Open a selected draft and edit its title, metadata and rich HTML body visually.
- Insert local body images; images are uploaded with `media/uploadimg` when selected.
- Choose a local cover image; it is uploaded with `material/add_material`.
- Update an existing draft with `draft/update`.
- Upload the current article as a new draft with `draft/add`.
- Delete a selected draft with `draft/delete`.

## Requirements

- Node.js 22 or newer. No npm dependencies are required.
- A WeChat Official Account with developer credentials and draft-box API permission.
- Your current public IP must be in the account API whitelist.

## Setup

```bash
cd tools/wechat-draft-studio
cp .env.example .env
```

Fill `.env` locally:

```bash
WECHAT_APP_ID=your-app-id
WECHAT_APP_SECRET=your-app-secret
```

You can also enter credentials in the Settings dialog. Runtime-entered credentials are kept only in the running local process.

## Run

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4178
```

On Windows, run the same commands in PowerShell or Windows Terminal.

## Notes

- This app does not store secrets in the repository.
- Updating a normal `news` draft requires a `thumb_media_id`. If the original draft already has one, the app keeps it; otherwise choose a cover image.
- Official WeChat endpoints used by this tool include `/cgi-bin/draft/batchget`, `/cgi-bin/draft/get`, `/cgi-bin/draft/update`, `/cgi-bin/draft/delete`, `/cgi-bin/draft/add`, `/cgi-bin/media/uploadimg`, and `/cgi-bin/material/add_material`.
