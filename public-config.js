// GitHub Pages 使用 Supabase 作为共享后端，不调用 Cloudflare Worker API。
// 本地预览和 GitHub Pages 都由 app.js 根据 supabase-config.js 选择模式。
window.PUBLIC_API_CONFIG = {
  enabled: false,
  baseUrl: ""
};
