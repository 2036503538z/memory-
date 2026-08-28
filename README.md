# our archive

这是一个手机优先的回忆录网页，包含：

- 章节式照片叙事与照片放大查看
- 视频替换入口
- 在一起天数与纪念日倒计时
- 日记新增、编辑、删除
- 日记照片上传与预览
- 那年今日与重要纪念日提醒
- 双人回应与时间胶囊
- 留声页（Supabase Storage 同步录音）
- 浏览器本地保存（localStorage）
- 32 页正式回忆素材按桌面“记忆”文件名顺序翻页，末尾自动保留“未完待续”
- Supabase 数据库、照片和录音同步

## 本地预览

在 `memory-site` 目录启动一个静态服务器即可，例如：

```bash
python3 -m http.server 4174
```

然后打开 `http://localhost:4174`。

手机预览时不要使用 `localhost`。如果手机和电脑连接同一个 Wi-Fi，请打开电脑的局域网地址：

```text
http://192.168.1.19:4174
```

电脑需要保持开机，并保持本地预览服务运行；如果 macOS 弹出网络访问提示，需要允许 Python 接受传入连接。

## 发布到 GitHub Pages 并开启双人同步

当前推荐使用 GitHub Pages 托管网页、Supabase 保存共享内容。Cloudflare Worker 和 R2 不需要部署。

安全提醒：`sb_secret_...` 是服务器密钥，不能放进网页、GitHub 或聊天记录。你刚才发送的 secret key 已经暴露，请马上在 Supabase **Project Settings / API** 中撤销并重新生成。这个前端项目只需要 `sb_publishable_...`。

### 1. 配置 Supabase

1. 打开 Supabase 项目的 **Project Settings / API**。
2. 复制 **Project URL** 和 **Publishable key**（以 `sb_publishable_` 开头）。不要复制 `Secret key` 或旧版 `service_role` key。
3. 编辑 `supabase-config.js`，填入 `url` 和 `anonKey`。
4. 在 Supabase **SQL Editor** 中运行项目根目录的 `schema.sql`。它会创建日记表、录音表、私有照片/录音桶、访问策略和实时同步。

如果 SQL 执行后在 Storage 中看不到桶，请打开 Supabase 左侧 **Storage**，手动创建两个私有 bucket（Public 关闭）：`memory-photos` 和 `memory-voices`。名称必须完全一致，已有权限策略会立即生效。

两个人使用同一组 Supabase 邮箱和密码登录即可看到同一份内容。照片会上传到 Supabase Storage，文字和回应保存在数据库中。

### 2. 推送到 GitHub

把 `memory-site` 文件夹中的文件上传到 GitHub 仓库的 `main` 分支。项目已经包含 `.github/workflows/deploy-pages.yml`，每次推送会自动发布到 GitHub Pages。

首次发布时，在仓库 **Settings / Pages** 中将 **Source** 设为 **GitHub Actions**。完成后，GitHub Actions 页面会显示公开网址。

### 3. 访问和登录

打开 GitHub Pages 网址，点击“开启双人同步”，两个人用同一组 Supabase 账号登录。登录状态由 Supabase 保持，之后可以共同新增、编辑日记、上传照片和留下声音。

没有填写 `anonKey` 时，网页只使用当前设备的 localStorage，不会同步到云端。

这个版本不需要 `@supabase/server`，也不需要 `.env`。GitHub Pages 是纯前端托管，Supabase 的 publishable key 可以出现在网页配置中；任何 secret key 都只能放在受保护的服务器环境。

## 旧 Cloudflare 文件

`worker/` 目录保留了之前的 Worker 配置，但当前发布流程不使用它，也不需要开通 R2。当前 GitHub Pages 版本关闭了 `public-config.js` 的 Cloudflare API 模式。

没有填 Supabase 配置时，页面仍可以正常浏览 32 页回忆和“未完待续”页；日记、回应、时间胶囊、照片和录音只保存在当前设备。配置 Supabase 后，这些内容会同步到共同空间。

## 替换正式素材

把照片放进 `assets/`，然后修改 `index.html` 中对应的图片路径、日期和图说。视频可以在页面中点击“替换视频”临时加载；正式版本建议接入云端存储，以便两台设备共同使用。
