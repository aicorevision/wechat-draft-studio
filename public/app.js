const state = {
  drafts: [],
  total: 0,
  offset: 0,
  mediaId: "",
  index: 0,
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
    setStatus("Done");
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

function timeText(ts) {
  return ts ? new Date(ts * 1000).toLocaleString() : "";
}

function syncArticleFromForm() {
  state.article = {
    ...state.article,
    title: $("titleInput").value.trim(),
    author: $("authorInput").value.trim(),
    digest: $("digestInput").value.trim(),
    content_source_url: $("sourceInput").value.trim(),
    content: editor.innerHTML.trim(),
    need_open_comment: $("commentInput").checked ? 1 : 0,
    only_fans_can_comment: $("fansInput").checked ? 1 : 0
  };
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
  editor.innerHTML = state.article.content;
}

function renderDrafts() {
  $("totalCount").textContent = `${state.total} total`;
  draftList.innerHTML = "";
  for (const draft of state.drafts) {
    const first = draft.content?.news_item?.[0] || {};
    const row = document.createElement("button");
    row.className = `draft-row${draft.media_id === state.mediaId ? " active" : ""}`;
    row.innerHTML = `
      <strong></strong>
      <span></span>
      <small></small>
    `;
    row.querySelector("strong").textContent = first.title || "(untitled)";
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
    button.textContent = `${index + 1}. ${item.title || "Article"}`;
    button.addEventListener("click", () => openDraft(draft.media_id, index, draft));
    tabs.appendChild(button);
  });
}

async function refresh(offset = state.offset) {
  const data = await run("Loading drafts...", () => api(`/api/drafts?offset=${offset}&count=20`));
  if (!data) return;
  state.drafts = data.item || [];
  state.total = data.total_count || 0;
  state.offset = offset;
  renderDrafts();
  if (!state.mediaId && state.drafts[0]) openDraft(state.drafts[0].media_id, 0, state.drafts[0]);
}

async function openDraft(mediaId, index = 0, cachedDraft) {
  state.mediaId = mediaId;
  state.index = index;
  renderDrafts();
  renderTabs(cachedDraft);
  const cached = cachedDraft?.content?.news_item?.[index];
  if (cached?.content) {
    renderArticle(cached);
    return;
  }
  const data = await run("Opening draft...", () => api(`/api/draft?media_id=${encodeURIComponent(mediaId)}`));
  if (data?.news_item?.[index]) renderArticle(data.news_item[index]);
}

async function uploadFile(file, endpoint) {
  const form = new FormData();
  form.append("file", file);
  return run("Uploading image...", () => api(endpoint, { method: "POST", body: form }));
}

async function insertBodyImage(file) {
  const uploaded = await uploadFile(file, "/api/upload/body-image");
  if (!uploaded?.url) return;
  editor.focus();
  document.execCommand(
    "insertHTML",
    false,
    `<figure><img src="${uploaded.url}" style="max-width:100%;height:auto;" /><figcaption>图片说明</figcaption></figure>`
  );
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
    setStatus("Select a draft first.");
    return;
  }
  const article = syncArticleFromForm();
  await run("Updating WeChat draft...", () => api("/api/draft/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: state.mediaId, index: state.index, article })
  }));
  refresh(state.offset);
}

async function addDraft() {
  const article = syncArticleFromForm();
  const data = await run("Uploading new draft...", () => api("/api/draft/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ article })
  }));
  if (data?.media_id) {
    state.mediaId = data.media_id;
    refresh(0);
  }
}

async function deleteDraft() {
  if (!state.mediaId) return;
  if (!confirm(`Delete draft "${state.article.title || state.mediaId}"?`)) return;
  await run("Deleting draft...", () => api("/api/draft", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: state.mediaId })
  }));
  state.mediaId = "";
  renderArticle({ content: "<p></p>" });
  refresh(state.offset);
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
  await run("Saving credentials...", () => api("/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, appSecret })
  }));
  $("connection").textContent = appId && appSecret ? "Connected by runtime credentials" : "Credentials required";
  closeSettings();
  refresh(0);
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
$("imageInput").addEventListener("change", (event) => event.target.files?.[0] && insertBodyImage(event.target.files[0]));
$("coverInput").addEventListener("change", (event) => event.target.files?.[0] && uploadCover(event.target.files[0]));
editor.addEventListener("blur", syncArticleFromForm);

renderArticle(state.article);
api("/api/status").then((data) => {
  const ok = data.hasAppId && data.hasAppSecret;
  $("connection").textContent = ok ? "Connected by local credentials" : "Credentials required";
  if (ok) refresh(0);
  else openSettings();
}).catch((error) => setStatus(error.message));
