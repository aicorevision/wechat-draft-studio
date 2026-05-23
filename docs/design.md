# Design Notes

## Product Shape

The app is a focused local Web workbench:

- Left: draft-box list and pagination.
- Center: title and contenteditable article canvas.
- Right: metadata, cover, comments and destructive actions.

The layout follows an open, tool-like design style: visible controls, restrained colors, low-radius panels, direct manipulation and no landing page.

## Independence Boundary

The tool does not import or call any WeChat article assistant Skill. The only shared knowledge is the public WeChat API contract.

## Credential Handling

The app reads credentials from:

1. `WECHAT_APP_ID` and `WECHAT_APP_SECRET` environment variables.
2. Local `.env` in the app directory.
3. `~/.wechat-draft-studio/.env`.
3. Settings dialog for the current app session.

Secrets must not be committed.
