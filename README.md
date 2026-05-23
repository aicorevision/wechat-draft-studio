# 微信公众号草稿工作台

一个独立的本地 Web GUI，用来读取、修改、删除和上传微信公众号草稿箱文章。它不依赖任何文章生成 Skill，只直接调用微信公众号官方草稿箱 API。

## 功能

- 读取草稿箱列表，支持分页和本页搜索。
- 打开指定草稿，编辑标题、作者、摘要、原文链接、留言设置和正文。
- 支持富文本编辑和 HTML 源码编辑切换。
- 上传正文图片到 `media/uploadimg` 并插入正文。
- 上传封面图到 `material/add_material` 并写入 `thumb_media_id`。
- 更新已有草稿，更新前自动保存本地快照。
- 上传当前内容为新草稿。
- 删除草稿，删除前要求输入“删除”，并自动保存本地快照。
- AI 辅助润色、压缩、扩写、标题建议、摘要建议和结构检查。

## 运行要求

- Node.js 22 或更新版本。
- 已认证且具备草稿箱接口权限的微信公众号。
- 当前机器出口 IP 已加入微信公众号后台 API 白名单。

## 本地配置

```bash
cd tools/wechat-draft-studio
cp .env.example .env
```

在本地 `.env` 写入：

```bash
WECHAT_APP_ID=你的 AppID
WECHAT_APP_SECRET=你的 AppSecret
```

`.env` 已被 `.gitignore` 忽略，不要提交。

## 启动

```bash
npm start
```

打开：

```text
http://127.0.0.1:4178
```

Windows、macOS、Linux 都使用同一套命令。

## AI 配置

默认使用 OpenAI 兼容接口，适合接 APINK 或其他中转网关：

```bash
WECHAT_DRAFT_AI_MODE=openai-compatible
WECHAT_DRAFT_AI_BASE_URL=https://你的网关/v1
WECHAT_DRAFT_AI_API_KEY=你的 AI Key
WECHAT_DRAFT_AI_MODEL=你的模型名
```

也可以接本地命令，例如 `codex` 或 `claude` 的 CLI 包装脚本：

```bash
WECHAT_DRAFT_AI_MODE=command
WECHAT_DRAFT_AI_COMMAND=/path/to/your-ai-command
```

命令模式会从 stdin 收到 JSON：

```json
{"action":"polish","text":"...","prompt":"..."}
```

stdout 返回润色结果即可。

## 验证

语法检查：

```bash
npm run check
```

真实接口烟测会创建一个测试草稿、上传图片、更新、读取列表，最后删除测试草稿：

```bash
npm start
npm run smoke
```

烟测只删除它自己创建的测试草稿。

## 本地数据

更新和删除前的快照保存在：

```text
.local/snapshots/
```

该目录已被忽略，不会提交到仓库。
