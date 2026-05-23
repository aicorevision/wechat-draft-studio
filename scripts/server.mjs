#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 4178);

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const DRAFT_ADD_URL = "https://api.weixin.qq.com/cgi-bin/draft/add";
const DRAFT_BATCHGET_URL = "https://api.weixin.qq.com/cgi-bin/draft/batchget";
const DRAFT_GET_URL = "https://api.weixin.qq.com/cgi-bin/draft/get";
const DRAFT_UPDATE_URL = "https://api.weixin.qq.com/cgi-bin/draft/update";
const DRAFT_DELETE_URL = "https://api.weixin.qq.com/cgi-bin/draft/delete";
const UPLOAD_BODY_IMG_URL = "https://api.weixin.qq.com/cgi-bin/media/uploadimg";
const UPLOAD_MATERIAL_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material";

let runtimeCredentials = loadCredentials();
let cachedToken;

function loadCredentials() {
  const env = {};
  for (const file of [
    path.join(rootDir, ".env"),
    path.join(os.homedir(), ".wechat-draft-studio", ".env")
  ]) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[line.slice(0, eq).trim()] = value;
    }
  }
  return {
    appId: process.env.WECHAT_APP_ID || env.WECHAT_APP_ID || "",
    appSecret: process.env.WECHAT_APP_SECRET || env.WECHAT_APP_SECRET || ""
  };
}

function assertCredentials() {
  if (!runtimeCredentials.appId || !runtimeCredentials.appSecret) {
    throw new Error("Missing WECHAT_APP_ID or WECHAT_APP_SECRET.");
  }
}

async function parseWechatResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`WeChat returned non-JSON response: ${text.slice(0, 240)}`);
  }
  if (!response.ok) throw new Error(`WeChat HTTP ${response.status}: ${text.slice(0, 240)}`);
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`WeChat API error ${data.errcode}: ${data.errmsg || "unknown error"}`);
  }
  return data;
}

async function getAccessToken() {
  assertCredentials();
  const now = Date.now();
  if (cachedToken?.appId === runtimeCredentials.appId && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(runtimeCredentials.appId)}&secret=${encodeURIComponent(runtimeCredentials.appSecret)}`;
  const data = await parseWechatResponse(await fetch(url));
  if (!data.access_token) throw new Error("WeChat did not return access_token.");
  cachedToken = {
    appId: runtimeCredentials.appId,
    token: data.access_token,
    expiresAt: now + 7000 * 1000
  };
  return data.access_token;
}

async function postWechat(url, body) {
  const token = await getAccessToken();
  return parseWechatResponse(await fetch(`${url}?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }));
}

function mimeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  return "image/jpeg";
}

async function uploadImage(file, kind) {
  const token = await getAccessToken();
  const form = new FormData();
  const blob = new Blob([file.buffer], { type: file.type || mimeFor(file.filename) });
  form.append("media", blob, file.filename);
  const url = kind === "cover" ? UPLOAD_MATERIAL_URL : UPLOAD_BODY_IMG_URL;
  const data = await parseWechatResponse(await fetch(`${url}?type=image&access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    body: form
  }));
  if (data.url) data.url = data.url.replace(/^http:\/\//i, "https://");
  return data;
}

function normalizeArticle(article) {
  const isNewspic = article.article_type === "newspic";
  const normalized = {
    article_type: article.article_type || "news",
    title: article.title || "",
    author: article.author || undefined,
    digest: article.digest || undefined,
    content: article.content || "",
    content_source_url: article.content_source_url || undefined,
    need_open_comment: article.need_open_comment ?? 1,
    only_fans_can_comment: article.only_fans_can_comment ?? 0
  };
  if (isNewspic) {
    normalized.image_info = article.image_info;
  } else {
    normalized.thumb_media_id = article.thumb_media_id;
  }
  if (!normalized.title.trim()) throw new Error("Title is required.");
  if (!normalized.content.trim()) throw new Error("Content is required.");
  if (!isNewspic && !normalized.thumb_media_id) {
    throw new Error("Normal article drafts require thumb_media_id. Upload a cover first or keep the original cover.");
  }
  return normalized;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function readMultipart(req) {
  const contentType = req.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) throw new Error("Missing multipart boundary.");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const parts = body.toString("binary").split(`--${boundary}`);
  for (const part of parts) {
    if (!part.includes("Content-Disposition")) continue;
    const name = part.match(/name="([^"]+)"/)?.[1];
    const filename = part.match(/filename="([^"]*)"/)?.[1];
    if (name !== "file" || !filename) continue;
    const type = part.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || mimeFor(filename);
    const start = part.indexOf("\r\n\r\n");
    if (start < 0) continue;
    const raw = part.slice(start + 4).replace(/\r\n$/u, "");
    return {
      filename: path.basename(filename),
      type,
      buffer: Buffer.from(raw, "binary")
    };
  }
  throw new Error("No file field found.");
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, rawPath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, {
        hasAppId: Boolean(runtimeCredentials.appId),
        hasAppSecret: Boolean(runtimeCredentials.appSecret)
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/credentials") {
      const body = await readJson(req);
      runtimeCredentials = {
        appId: String(body.appId || "").trim(),
        appSecret: String(body.appSecret || "").trim()
      };
      cachedToken = undefined;
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/drafts") {
      const offset = Number(url.searchParams.get("offset") || 0);
      const count = Number(url.searchParams.get("count") || 20);
      sendJson(res, 200, await postWechat(DRAFT_BATCHGET_URL, { offset, count, no_content: 0 }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/draft") {
      sendJson(res, 200, await postWechat(DRAFT_GET_URL, { media_id: url.searchParams.get("media_id") }));
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/api/draft") {
      const body = await readJson(req);
      sendJson(res, 200, await postWechat(DRAFT_DELETE_URL, { media_id: body.media_id }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/draft/update") {
      const body = await readJson(req);
      sendJson(res, 200, await postWechat(DRAFT_UPDATE_URL, {
        media_id: body.media_id,
        index: body.index || 0,
        articles: normalizeArticle(body.article)
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/draft/add") {
      const body = await readJson(req);
      sendJson(res, 200, await postWechat(DRAFT_ADD_URL, { articles: [normalizeArticle(body.article)] }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/upload/body-image") {
      sendJson(res, 200, await uploadImage(await readMultipart(req), "body"));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/upload/cover") {
      sendJson(res, 200, await uploadImage(await readMultipart(req), "cover"));
      return;
    }
    sendJson(res, 404, { error: "Unknown API route." });
  } catch (error) {
    sendError(res, error);
  }
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/")) {
    void handleApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`WeChat Draft Studio running at http://127.0.0.1:${port}`);
});
