#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, ".local");
const snapshotDir = path.join(dataDir, "snapshots");
const port = Number(process.env.PORT || 4178);

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const DRAFT_ADD_URL = "https://api.weixin.qq.com/cgi-bin/draft/add";
const DRAFT_BATCHGET_URL = "https://api.weixin.qq.com/cgi-bin/draft/batchget";
const DRAFT_GET_URL = "https://api.weixin.qq.com/cgi-bin/draft/get";
const DRAFT_UPDATE_URL = "https://api.weixin.qq.com/cgi-bin/draft/update";
const DRAFT_DELETE_URL = "https://api.weixin.qq.com/cgi-bin/draft/delete";
const UPLOAD_BODY_IMG_URL = "https://api.weixin.qq.com/cgi-bin/media/uploadimg";
const UPLOAD_MATERIAL_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material";

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

let runtimeCredentials = loadCredentials();
let cachedToken;

fs.mkdirSync(snapshotDir, { recursive: true });

function loadEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
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
  return env;
}

function loadCredentials() {
  const env = {
    ...loadEnvFile(path.join(rootDir, ".env")),
    ...loadEnvFile(path.join(os.homedir(), ".wechat-draft-studio", ".env"))
  };
  return {
    appId: process.env.WECHAT_APP_ID || env.WECHAT_APP_ID || "",
    appSecret: process.env.WECHAT_APP_SECRET || env.WECHAT_APP_SECRET || ""
  };
}

function assertCredentials() {
  if (!runtimeCredentials.appId || !runtimeCredentials.appSecret) {
    throw new Error("缺少 WECHAT_APP_ID 或 WECHAT_APP_SECRET。");
  }
}

function wechatErrorHint(code, message = "") {
  const hints = {
    40001: "AppSecret 可能不正确，或 AppID/AppSecret 不匹配。",
    40013: "AppID 不合法。",
    40164: "当前机器出口 IP 未加入微信公众号后台 IP 白名单。",
    45009: "接口调用次数达到上限，请稍后再试。",
    48001: "公众号未获得该接口权限，需认证公众号并开启相关能力。",
    88000: "草稿箱接口可能未开通或账号类型不支持。"
  };
  return hints[code] ? `${message} ${hints[code]}` : message;
}

async function parseWechatResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`微信返回了非 JSON 响应：${text.slice(0, 240)}`);
  }
  if (!response.ok) throw new Error(`微信 HTTP ${response.status}：${text.slice(0, 240)}`);
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`微信接口错误 ${data.errcode}：${wechatErrorHint(data.errcode, data.errmsg || "未知错误")}`);
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
  if (!data.access_token) throw new Error("微信没有返回 access_token。");
  cachedToken = { appId: runtimeCredentials.appId, token: data.access_token, expiresAt: now + 7000 * 1000 };
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

function validateImage(file) {
  if (!file?.buffer?.length) throw new Error("图片文件为空。");
  if (file.buffer.length > MAX_IMAGE_BYTES) throw new Error("图片超过 10MB，请压缩后再上传。");
  const allowed = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"]);
  if (!allowed.has(file.type)) throw new Error(`不支持的图片类型：${file.type}`);
}

async function uploadImage(file, kind) {
  validateImage(file);
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

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeContent(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+=["'][^"']*["']/gi, "")
    .replace(/javascript:/gi, "");
}

function validateArticle(article) {
  const title = String(article.title || "").trim();
  const content = sanitizeContent(article.content || "");
  const digest = String(article.digest || "").trim();
  const author = String(article.author || "").trim();
  const source = String(article.content_source_url || "").trim();
  const plain = stripHtml(content);

  if (!title) throw new Error("标题不能为空。");
  if (title.length > 64) throw new Error("标题超过 64 个字符。");
  if (!plain) throw new Error("正文不能为空。");
  if (content.length > 900_000) throw new Error("正文 HTML 过大，请拆分或压缩样式。");
  if (digest.length > 120) throw new Error("摘要超过 120 个字符。");
  if (author.length > 16) throw new Error("作者超过 16 个字符。");
  if (source && !/^https?:\/\//i.test(source)) throw new Error("原文链接必须以 http:// 或 https:// 开头。");
}

function normalizeArticle(article) {
  validateArticle(article);
  const isNewspic = article.article_type === "newspic";
  const normalized = {
    article_type: article.article_type || "news",
    title: String(article.title || "").trim(),
    author: String(article.author || "").trim() || undefined,
    digest: String(article.digest || "").trim() || undefined,
    content: sanitizeContent(article.content || ""),
    content_source_url: String(article.content_source_url || "").trim() || undefined,
    need_open_comment: article.need_open_comment ?? 1,
    only_fans_can_comment: article.only_fans_can_comment ?? 0
  };
  if (isNewspic) {
    normalized.image_info = article.image_info;
  } else {
    normalized.thumb_media_id = article.thumb_media_id;
  }
  if (!isNewspic && !normalized.thumb_media_id) {
    throw new Error("普通图文必须有封面 thumb_media_id。请先上传封面，或保留原草稿封面。");
  }
  return normalized;
}

async function readLimited(req, limit = MAX_JSON_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("请求体过大。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buffer = await readLimited(req);
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString("utf-8"));
  } catch {
    throw new Error("请求 JSON 格式不正确。");
  }
}

function indexOfBuffer(buffer, search, start = 0) {
  return buffer.indexOf(search, start);
}

async function readMultipart(req) {
  const contentType = req.headers["content-type"] || "";
  const boundaryValue = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundaryValue) throw new Error("缺少 multipart boundary。");
  const body = await readLimited(req, MAX_IMAGE_BYTES + 1024 * 1024);
  const boundary = Buffer.from(`--${boundaryValue}`);
  let pos = indexOfBuffer(body, boundary);
  while (pos !== -1) {
    const next = indexOfBuffer(body, boundary, pos + boundary.length);
    if (next === -1) break;
    const part = body.subarray(pos + boundary.length + 2, next - 2);
    const headerEnd = indexOfBuffer(part, Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const header = part.subarray(0, headerEnd).toString("utf-8");
      const name = header.match(/name="([^"]+)"/)?.[1];
      const filename = header.match(/filename="([^"]*)"/)?.[1];
      if (name === "file" && filename) {
        return {
          filename: path.basename(filename),
          type: header.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || mimeFor(filename),
          buffer: part.subarray(headerEnd + 4)
        };
      }
    }
    pos = next;
  }
  throw new Error("没有找到 file 字段。");
}

function snapshotName(mediaId, action) {
  const clean = String(mediaId || "new").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${new Date().toISOString().replace(/[:.]/g, "-")}_${action}_${clean}.json`;
}

function saveSnapshot(mediaId, action, payload) {
  const file = path.join(snapshotDir, snapshotName(mediaId, action));
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  return path.relative(rootDir, file);
}

async function snapshotDraft(mediaId, action) {
  if (!mediaId) return undefined;
  const draft = await postWechat(DRAFT_GET_URL, { media_id: mediaId });
  return saveSnapshot(mediaId, action, draft);
}

function aiConfig() {
  const env = { ...loadEnvFile(path.join(rootDir, ".env")), ...process.env };
  return {
    mode: env.WECHAT_DRAFT_AI_MODE || "openai-compatible",
    command: env.WECHAT_DRAFT_AI_COMMAND || "",
    baseUrl: env.WECHAT_DRAFT_AI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: env.WECHAT_DRAFT_AI_API_KEY || env.OPENAI_API_KEY || "",
    model: env.WECHAT_DRAFT_AI_MODEL || env.OPENAI_MODEL || "gpt-4.1-mini"
  };
}

function aiPrompt(action, text) {
  const tasks = {
    polish: "润色这段微信公众号文章，保持事实不变，提升表达清晰度、专业度和中文可读性。",
    shorten: "压缩这段微信公众号文章，保留核心信息，减少重复和空话。",
    expand: "扩写这段微信公众号文章，补足逻辑衔接和必要解释，不要编造事实。",
    title: "为这篇微信公众号文章生成 8 个中文标题，兼顾专业性、点击意愿和克制表达。",
    summary: "为这篇微信公众号文章生成 3 个 120 字以内的摘要。",
    structure: "检查这篇微信公众号文章结构，给出可直接执行的章节调整建议。"
  };
  return `${tasks[action] || tasks.polish}\n\n要求：只输出改写结果或建议，不要解释你的身份。\n\n原文：\n${text}`;
}

function runCommandAi(config, payload) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = config.command.split(/\s+/).filter(Boolean);
    if (!cmd) {
      reject(new Error("未配置 WECHAT_DRAFT_AI_COMMAND。"));
      return;
    }
    const child = execFile(cmd, args, { timeout: 120_000, maxBuffer: 6 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve({ text: stdout.trim() });
    });
    child.stdin?.end(JSON.stringify(payload));
  });
}

async function runOpenAiCompatible(config, payload) {
  if (!config.apiKey) throw new Error("未配置 WECHAT_DRAFT_AI_API_KEY 或 OPENAI_API_KEY。");
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: "你是严谨的中文微信公众号编辑，擅长工程技术文章润色。" },
        { role: "user", content: payload.prompt }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || `AI HTTP ${response.status}`);
  return { text: data.choices?.[0]?.message?.content?.trim() || "" };
}

async function runAi(body) {
  const text = stripHtml(body.html || body.text || "");
  if (!text) throw new Error("没有可润色的文本。");
  if (text.length > 30_000) throw new Error("文本过长，请选中单章或单段后再润色。");
  const config = aiConfig();
  const payload = { action: body.action || "polish", text, prompt: aiPrompt(body.action || "polish", text) };
  return config.mode === "command" ? runCommandAi(config, payload) : runOpenAiCompatible(config, payload);
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
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
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml"
  }[path.extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      const config = aiConfig();
      sendJson(res, 200, {
        hasAppId: Boolean(runtimeCredentials.appId),
        hasAppSecret: Boolean(runtimeCredentials.appSecret),
        aiMode: config.mode,
        hasAi: config.mode === "command" ? Boolean(config.command) : Boolean(config.apiKey)
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/credentials") {
      const body = await readJson(req);
      runtimeCredentials = { appId: String(body.appId || "").trim(), appSecret: String(body.appSecret || "").trim() };
      cachedToken = undefined;
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health/token") {
      await getAccessToken();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/drafts") {
      const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
      const count = Math.min(20, Math.max(1, Number(url.searchParams.get("count") || 20)));
      sendJson(res, 200, await postWechat(DRAFT_BATCHGET_URL, { offset, count, no_content: 0 }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/draft") {
      const mediaId = url.searchParams.get("media_id");
      if (!mediaId) throw new Error("缺少 media_id。");
      sendJson(res, 200, await postWechat(DRAFT_GET_URL, { media_id: mediaId }));
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/api/draft") {
      const body = await readJson(req);
      if (!body.media_id) throw new Error("缺少 media_id。");
      const snapshot = await snapshotDraft(body.media_id, "delete");
      sendJson(res, 200, { ...(await postWechat(DRAFT_DELETE_URL, { media_id: body.media_id })), snapshot });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/draft/update") {
      const body = await readJson(req);
      if (!body.media_id) throw new Error("缺少 media_id。");
      const snapshot = await snapshotDraft(body.media_id, "before-update");
      sendJson(res, 200, {
        ...(await postWechat(DRAFT_UPDATE_URL, {
          media_id: body.media_id,
          index: Number(body.index || 0),
          articles: normalizeArticle(body.article)
        })),
        snapshot
      });
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
    if (req.method === "POST" && url.pathname === "/api/ai") {
      sendJson(res, 200, await runAi(await readJson(req)));
      return;
    }
    sendJson(res, 404, { error: "未知接口。" });
  } catch (error) {
    sendError(res, error);
  }
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/")) void handleApi(req, res);
  else serveStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`微信公众号草稿工作台已启动：http://127.0.0.1:${port}`);
});
