#!/usr/bin/env node
const baseUrl = process.env.WECHAT_DRAFT_STUDIO_URL || "http://127.0.0.1:4178";
import zlib from "node:zlib";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makePng(width, height) {
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const i = 1 + x * 3;
      row[i] = 47;
      row[i + 1] = 111;
      row[i + 2] = 102;
    }
    rawRows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const png = makePng(900, 500);

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function upload(path) {
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "wechat-draft-studio-smoke.png");
  return api(path, { method: "POST", body: form });
}

async function main() {
  console.log("1. 检查 access_token");
  await api("/api/health/token");

  console.log("2. 上传封面图");
  const cover = await upload("/api/upload/cover");
  if (!cover.media_id) throw new Error("封面上传未返回 media_id");

  console.log("3. 上传正文图");
  const bodyImage = await upload("/api/upload/body-image");
  if (!bodyImage.url) throw new Error("正文图上传未返回 url");

  const stamp = new Date().toISOString();
  const title = `草稿工作台自动测试 ${stamp}`;
  const article = {
    article_type: "news",
    title,
    author: "自动测试",
    digest: "这是微信公众号草稿工作台的自动测试草稿，测试完成后会删除。",
    content: `<h2>自动测试</h2><p>这是自动创建的测试草稿。</p><img src="${bodyImage.url}" />`,
    thumb_media_id: cover.media_id,
    need_open_comment: 1,
    only_fans_can_comment: 0
  };

  console.log("4. 新增草稿");
  const added = await api("/api/draft/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ article })
  });
  if (!added.media_id) throw new Error("新增草稿未返回 media_id");

  try {
    console.log("5. 拉取草稿");
    const got = await api(`/api/draft?media_id=${encodeURIComponent(added.media_id)}`);
    if (got.news_item?.[0]?.title !== title) throw new Error("拉取草稿标题不匹配");

    console.log("6. 更新草稿");
    article.title = `${title} 已更新`;
    article.content += "<p>更新接口验证通过。</p>";
    await api("/api/draft/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: added.media_id, index: 0, article })
    });

    console.log("7. 验证草稿列表");
    const list = await api("/api/drafts?offset=0&count=20");
    if (!Array.isArray(list.item)) throw new Error("草稿列表返回格式异常");
  } finally {
    console.log("8. 删除测试草稿");
    await api("/api/draft", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_id: added.media_id })
    });
  }

  console.log("全部核心功能测试通过");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
