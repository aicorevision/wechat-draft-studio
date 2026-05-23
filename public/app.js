const state = {
  drafts: [],
  total: 0,
  offset: 0,
  mediaId: "",
  index: 0,
  sourceMode: false,
  lastAiText: "",
  article: {
    article_type: "news",
    title: "",
    author: "",
    digest: "",
    content: "<p>在这里编辑微信公众号文章正文。</p>",
    need_open_comment: 1,
    only_fans_can_comment: 0
  }
};

const $ = (id) => document.getElementById(id);
const draftList = $("draftList");
const editor = $("editor");
const sourceEditor = $("sourceEditor");
const tabs = $("articleTabs");
const statusBox = $("status");

function setStatus(message) {
  statusBox.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function run(label, task) {
  setStatus(label);
  try {
    const result = await task();
    setStatus("完成");
    return result;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || "";
}

function getHtml() {
  return state.sourceMode ? sourceEditor.value : editor.innerHTML;
}

function setHtml(html) {
  editor.innerHTML = html || "";
  sourceEditor.value = html || "";
}

function updateStats() {
  const html = getHtml();
  $("wordCount").textContent = `${stripHtml(html).length} 字`;
  $("imageCount").textContent = `${(html.match(/<img\b/gi) || []).length} 图`;
}

function timeText(ts) {
  return ts ? new Date(ts * 1000).toLocaleString() : "";
}

function validateBeforeSave(article) {
  if (!article.title) return "标题不能为空。";
  if (article.title.length > 64) return "标题超过 64 字。";
  if (!stripHtml(article.content)) return "正文不能为空。";
  if ((article.digest || "").length > 120) return "摘要超过 120 字。";
  if ((article.author || "").length > 16) return "作者超过 16 字。";
  if (article.content_source_url && !/^https?:\/\//i.test(article.content_source_url)) return "原文链接必须以 http:// 或 https:// 开头。";
  if (article.article_type !== "newspic" && !article.thumb_media_id) return "请先上传封面，或保留原草稿封面。";
  return "";
}

function syncArticleFromForm() {
  state.article = {
    ...state.article,
    title: $("titleInput").value.trim(),
    author: $("authorInput").value.trim(),
    digest: $("digestInput").value.trim(),
    content_source_url: $("sourceInput").value.trim(),
    content: getHtml().trim(),
    need_open_comment: $("commentInput").checked ? 1 : 0,
    only_fans_can_comment: $("fansInput").checked ? 1 : 0
  };
  updateStats();
  return state.article;
}

function renderArticle(article) {
  state.article = {
    article_type: article.article_type || "news",
    title: article.title || "",
    author: article.author || "",
    digest: article.digest || "",
    content: article.content || "<p></p>",
    content_source_url: article.content_source_url || "",
    thumb_media_id: article.thumb_media_id || "",
    image_info: article.image_info,
    need_open_comment: article.need_open_comment ?? 1,
    only_fans_can_comment: article.only_fans_can_comment ?? 0
  };
  $("titleInput").value = state.article.title;
  $("authorInput").value = state.article.author;
  $("digestInput").value = state.article.digest;
  $("sourceInput").value = state.article.content_source_url;
  $("coverInfo").value = state.article.thumb_media_id || "";
  $("commentInput").checked = state.article.need_open_comment === 1;
  $("fansInput").checked = state.article.only_fans_can_comment === 1;
  setHtml(state.article.content);
  updateStats();
}

function filteredDrafts() {
  const q = $("searchInput").value.trim().toLowerCase();
  if (!q) return state.drafts;
  return state.drafts.filter((draft) => {
    const items = draft.content?.news_item || [];
    return items.some((item) => `${item.title || ""} ${item.digest || ""} ${stripHtml(item.content || "")}`.toLowerCase().includes(q));
  });
}

function renderDrafts() {
  $("totalCount").textContent = `共 ${state.total} 篇`;
  draftList.innerHTML = "";
  for (const draft of filteredDrafts()) {
    const first = draft.content?.news_item?.[0] || {};
    const row = document.createElement("button");
    row.className = `draft-row${draft.media_id === state.mediaId ? " active" : ""}`;
    row.innerHTML = "<strong></strong><span></span><small></small>";
    row.querySelector("strong").textContent = first.title || "未命名草稿";
    row.querySelector("span").textContent = stripHtml(first.digest || first.content || "").slice(0, 86);
    row.querySelector("small").textContent = timeText(draft.update_time);
    row.addEventListener("click", () => openDraft(draft.media_id, 0, draft));
    draftList.appendChild(row);
  }
  $("prevBtn").disabled = state.offset <= 0;
  $("nextBtn").disabled = state.offset + 20 >= state.total;
}

function renderTabs(draft) {
  tabs.innerHTML = "";
  const items = draft?.content?.news_item || [];
  if (items.length <= 1) return;
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = index === state.index ? "selected" : "";
    button.textContent = `${index + 1}. ${item.title || "文章"}`;
    button.addEventListener("click", () => openDraft(draft.media_id, index, draft));
    tabs.appendChild(button);
  });
}

async function refresh(offset = state.offset) {
  const data = await run("正在读取草稿箱...", () => api(`/api/drafts?offset=${offset}&count=20`));
  if (!data) return;
  state.drafts = data.item || [];
  state.total = data.total_count || 0;
  state.offset = offset;
  renderDrafts();
  if (!state.mediaId && state.drafts[0]) openDraft(state.drafts[0].media_id, 0, state.drafts[0]);
}

async function openDraft(mediaId, index = 0, cachedDraft) {
  if (stripHtml(getHtml()) && state.mediaId && !confirm("当前编辑内容可能未保存，确定切换草稿吗？")) return;
  state.mediaId = mediaId;
  state.index = index;
  renderDrafts();
  renderTabs(cachedDraft);
  const cached = cachedDraft?.content?.news_item?.[index];
  if (cached?.content) {
    renderArticle(cached);
    return;
  }
  const data = await run("正在打开草稿...", () => api(`/api/draft?media_id=${encodeURIComponent(mediaId)}`));
  if (data?.news_item?.[index]) renderArticle(data.news_item[index]);
}

async function uploadFile(file, endpoint) {
  if (!file) return undefined;
  if (file.size > 10 * 1024 * 1024) {
    setStatus("图片超过 10MB，请压缩后再上传。");
    return undefined;
  }
  const form = new FormData();
  form.append("file", file);
  return run("正在上传图片...", () => api(endpoint, { method: "POST", body: form }));
}

async function insertBodyImage(file) {
  const uploaded = await uploadFile(file, "/api/upload/body-image");
  if (!uploaded?.url) return;
  editor.focus();
  document.execCommand("insertHTML", false, `<figure><img src="${uploaded.url}" style="max-width:100%;height:auto;" /><figcaption>图片说明</figcaption></figure>`);
  syncArticleFromForm();
}

async function uploadCover(file) {
  const uploaded = await uploadFile(file, "/api/upload/cover");
  if (!uploaded?.media_id) return;
  state.article.thumb_media_id = uploaded.media_id;
  $("coverInfo").value = uploaded.media_id;
}

async function updateDraft() {
  if (!state.mediaId) {
    setStatus("请先选择一个草稿。");
    return;
  }
  const article = syncArticleFromForm();
  const validation = validateBeforeSave(article);
  if (validation) {
    setStatus(validation);
    return;
  }
  if (!confirm("确定更新微信草稿箱中的当前草稿吗？更新前会自动保存本地快照。")) return;
  const result = await run("正在更新微信草稿...", () => api("/api/draft/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: state.mediaId, index: state.index, article })
  }));
  if (result?.snapshot) setStatus(`已更新，更新前快照：${result.snapshot}`);
  refresh(state.offset);
}

async function addDraft() {
  const article = syncArticleFromForm();
  const validation = validateBeforeSave(article);
  if (validation) {
    setStatus(validation);
    return;
  }
  const data = await run("正在上传为新草稿...", () => api("/api/draft/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ article })
  }));
  if (data?.media_id) {
    state.mediaId = data.media_id;
    setStatus(`新草稿已创建：${data.media_id}`);
    refresh(0);
  }
}

async function deleteDraft() {
  if (!state.mediaId) return;
  const title = state.article.title || state.mediaId;
  const typed = prompt(`删除前会自动保存本地快照。\n请输入“删除”确认删除草稿：${title}`);
  if (typed !== "删除") return;
  const result = await run("正在删除草稿...", () => api("/api/draft", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: state.mediaId })
  }));
  state.mediaId = "";
  renderArticle({ content: "<p></p>" });
  setStatus(result?.snapshot ? `已删除，删除前快照：${result.snapshot}` : "已删除");
  refresh(state.offset);
}

function selectedHtmlOrAll() {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed && editor.contains(selection.anchorNode)) {
    const div = document.createElement("div");
    div.appendChild(selection.getRangeAt(0).cloneContents());
    return div.innerHTML;
  }
  return getHtml();
}

async function runAi() {
  syncArticleFromForm();
  const action = $("aiAction").value;
  const data = await run("正在调用 AI...", () => api("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, html: selectedHtmlOrAll() })
  }));
  if (data?.text) {
    state.lastAiText = data.text;
    $("aiResult").value = data.text;
    $("applyAiBtn").disabled = false;
  }
}

function applyAi() {
  if (!state.lastAiText) return;
  const action = $("aiAction").value;
  if (action === "title") $("titleInput").value = state.lastAiText.split(/\r?\n/).find(Boolean)?.replace(/^\d+[.、]\s*/, "") || state.lastAiText;
  else if (action === "summary") $("digestInput").value = state.lastAiText.slice(0, 120);
  else {
    editor.focus();
    document.execCommand("insertHTML", false, state.lastAiText.replace(/\n{2,}/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>"));
  }
  syncArticleFromForm();
}

function toggleSourceMode() {
  state.sourceMode = !state.sourceMode;
  if (state.sourceMode) {
    sourceEditor.value = editor.innerHTML;
    editor.classList.add("hidden");
    sourceEditor.classList.remove("hidden");
    $("sourceBtn").classList.add("selected");
  } else {
    editor.innerHTML = sourceEditor.value;
    sourceEditor.classList.add("hidden");
    editor.classList.remove("hidden");
    $("sourceBtn").classList.remove("selected");
  }
  updateStats();
}

function openSettings() {
  $("settingsModal").classList.remove("hidden");
}

function closeSettings() {
  $("settingsModal").classList.add("hidden");
}

async function saveSettings() {
  const appId = $("appIdInput").value.trim();
  const appSecret = $("appSecretInput").value.trim();
  await run("正在保存配置...", () => api("/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, appSecret })
  }));
  $("connection").textContent = appId && appSecret ? "已使用运行时凭据连接" : "缺少凭据";
  closeSettings();
  refresh(0);
}

async function checkHealth() {
  const data = await run("正在检查微信连接...", () => api("/api/health/token"));
  if (data?.ok) setStatus("微信 access_token 获取成功。");
}

document.querySelectorAll("[data-cmd]").forEach((button) => {
  button.addEventListener("click", () => {
    document.execCommand(button.dataset.cmd, false);
    editor.focus();
  });
});

document.querySelectorAll("[data-block]").forEach((button) => {
  button.addEventListener("click", () => {
    document.execCommand("formatBlock", false, button.dataset.block);
    editor.focus();
  });
});

$("healthBtn").addEventListener("click", checkHealth);
$("refreshBtn").addEventListener("click", () => refresh(0));
$("settingsBtn").addEventListener("click", openSettings);
$("cancelSettingsBtn").addEventListener("click", closeSettings);
$("saveSettingsBtn").addEventListener("click", saveSettings);
$("prevBtn").addEventListener("click", () => refresh(Math.max(0, state.offset - 20)));
$("nextBtn").addEventListener("click", () => refresh(state.offset + 20));
$("updateBtn").addEventListener("click", updateDraft);
$("addBtn").addEventListener("click", addDraft);
$("deleteBtn").addEventListener("click", deleteDraft);
$("imageBtn").addEventListener("click", () => $("imageInput").click());
$("coverBtn").addEventListener("click", () => $("coverInput").click());
$("sourceBtn").addEventListener("click", toggleSourceMode);
$("aiBtn").addEventListener("click", runAi);
$("applyAiBtn").addEventListener("click", applyAi);
$("searchInput").addEventListener("input", renderDrafts);
$("imageInput").addEventListener("change", (event) => event.target.files?.[0] && insertBodyImage(event.target.files[0]));
$("coverInput").addEventListener("change", (event) => event.target.files?.[0] && uploadCover(event.target.files[0]));
editor.addEventListener("input", updateStats);
editor.addEventListener("blur", syncArticleFromForm);
sourceEditor.addEventListener("input", updateStats);

renderArticle(state.article);
api("/api/status").then((data) => {
  const ok = data.hasAppId && data.hasAppSecret;
  $("connection").textContent = ok ? `已连接微信配置，AI：${data.hasAi ? "已配置" : "未配置"}` : "缺少微信凭据";
  if (ok) refresh(0);
  else openSettings();
}).catch((error) => setStatus(error.message));
