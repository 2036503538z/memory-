const STORAGE_KEY = "our-archive-entries-v1";
const VOICE_STORAGE_KEY = "our-archive-voices-v1";
const relationshipStart = new Date("2024-02-17T00:00:00");
const anniversaryMonth = 1;
const anniversaryDay = 17;
const photoBucket = "memory-photos";
const voiceBucket = "memory-voices";
const memoryPages = Array.isArray(window.MEMORY_PAGES) ? window.MEMORY_PAGES : [];
const cloudConfig = window.SUPABASE_CONFIG || {};
const cloudReady = Boolean(window.supabase && cloudConfig.url && cloudConfig.anonKey);
const publicConfig = window.PUBLIC_API_CONFIG || {};
const publicApiReady = Boolean(publicConfig.enabled && publicConfig.baseUrl !== undefined);
const publicApiBase = String(publicConfig.baseUrl || "").replace(/\/$/, "");
const OWNER_TOKENS_KEY = "our-archive-owner-tokens-v1";
const PUBLIC_AUTH_TOKEN_KEY = "our-archive-public-session-v1";

const defaultEntries = [
  { id: "sample-1", title: "雨天也要出门", date: "2025-10-02", mood: "soft", body: "本来只想在家里躺着，最后还是一起走去了街角。雨停之后，路面把灯光照得很亮。", image: "assets/memory-05.jpg", hideDate: false },
  { id: "sample-2", title: "把晚风带回家", date: "2025-07-18", mood: "bright", body: "在河边坐了很久，聊了很多以后。回家的路上，你说下次还要来。", image: "assets/memory-02.jpg", hideDate: false },
  { id: "sample-3", title: "三周年", date: "2025-05-21", mood: "wild", body: "三年快乐。谢谢你让普通的日子，慢慢变成了我最想收藏的东西。", image: "assets/memory-03.jpg", hideDate: false }
];

const moodLabels = { soft: "柔软", bright: "明亮", slow: "慢一点", wild: "有点疯狂" };
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

let entries = [];
let editingId = null;
let pendingPhoto = null;
let pendingPhotoFile = null;
let memoryIndex = 0;
let isBookTransitioning = false;
let currentBookPageId = null;
let voiceEntries = [];
let voiceRecorder = null;
let voiceStream = null;
let voiceChunks = [];
let voiceStopTimer = null;
let lastCalendarDay = "";
let supabaseClient = null;
let cloudSession = null;
let authMode = "login";
let publicAuthToken = localStorage.getItem(PUBLIC_AUTH_TOKEN_KEY) || document.cookie.match(/(?:^|;\s*)site_session=([^;]+)/)?.[1] || "";

function loadOwnerTokens() {
  try {
    const stored = JSON.parse(localStorage.getItem(OWNER_TOKENS_KEY));
    return stored && typeof stored === "object" ? stored : {};
  } catch { return {}; }
}

function saveOwnerToken(kind, id, token) {
  if (!id || !token) return;
  const tokens = loadOwnerTokens();
  tokens[`${kind}:${id}`] = token;
  localStorage.setItem(OWNER_TOKENS_KEY, JSON.stringify(tokens));
}

function ownerToken(kind, id) {
  return loadOwnerTokens()[`${kind}:${id}`] || "";
}

function publicApiUrl(path) {
  return `${publicApiBase}${path}`;
}

async function publicApiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (publicAuthToken && !headers.has("authorization")) headers.set("authorization", `Bearer ${publicAuthToken}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(publicApiUrl(path), { ...options, headers });
  let payload = null;
  try { payload = await response.json(); } catch { payload = {}; }
  if (response.status === 401 && path !== "/api/auth/login") {
    publicAuthToken = "";
    localStorage.removeItem(PUBLIC_AUTH_TOKEN_KEY);
    showPublicLock();
  }
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function showPublicLock() {
  const lock = $("#publicLock");
  if (!lock || !publicApiReady) return;
  lock.hidden = false;
  document.body.classList.add("is-public-locked");
}

function hidePublicLock() {
  const lock = $("#publicLock");
  if (!lock) return;
  lock.hidden = true;
  document.body.classList.remove("is-public-locked");
}

async function ensurePublicAuth() {
  if (!publicApiReady) return true;
  if (!publicAuthToken) {
    showPublicLock();
    return false;
  }
  try {
    await publicApiFetch("/api/auth/session");
    hidePublicLock();
    return true;
  } catch {
    return false;
  }
}

function loadLocalEntries() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) ? stored : defaultEntries;
  } catch { return defaultEntries; }
}

function saveLocalEntries() { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()} / ${String(date.getMonth() + 1).padStart(2, "0")} / ${String(date.getDate()).padStart(2, "0")}`;
}

function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parseResponses(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function normalizedEntry(entry) {
  const image = entry.image || "";
  return {
    id: entry.id,
    title: entry.title || "未命名的一页",
    body: entry.body || "",
    date: entry.date || entry.memory_date || entry.created_at?.slice(0, 10) || "",
    mood: entry.mood || "soft",
    image,
    imagePath: entry.imagePath || entry.image_path || "",
    hideDate: entry.hideDate ?? entry.hide_date ?? Boolean(image || entry.image_path),
    createdAt: entry.createdAt || entry.created_at || "",
    kind: entry.kind || entry.entryType || entry.entry_type || "diary",
    unlockDate: entry.unlockDate || entry.unlock_date || "",
    responses: parseResponses(entry.responses)
  };
}

function isCapsuleUnlocked(entry, today = localDateValue()) {
  return entry.kind !== "capsule" || Boolean(entry.unlockDate && entry.unlockDate <= today);
}

function renderResponses(entry) {
  if (!entry.responses.length) {
    return `<div class="entry-replies"><button class="entry-action entry-reply-button" type="button" data-action="reply">回应</button><form class="reply-form" hidden><select name="replyAuthor" aria-label="回应的人"><option value="甜甜">甜甜</option><option value="炜炜">炜炜</option></select><input name="replyBody" type="text" maxlength="120" required placeholder="写下一句回应" /><button type="submit">写下</button></form></div>`;
  }
  return `<div class="entry-replies">${entry.responses.map((reply) => `<p><strong>${escapeHtml(reply.author || "我们")}</strong><span>${escapeHtml(reply.body || "")}</span></p>`).join("")}<button class="entry-action entry-reply-button" type="button" data-action="reply">回应</button><form class="reply-form" hidden><select name="replyAuthor" aria-label="回应的人"><option value="甜甜">甜甜</option><option value="炜炜">炜炜</option></select><input name="replyBody" type="text" maxlength="120" required placeholder="写下一句回应" /><button type="submit">写下</button></form></div>`;
}

function renderEntries() {
  const list = $("#entriesList");
  const sorted = [...entries].map(normalizedEntry).sort((a, b) => (b.createdAt || b.date || "").localeCompare(a.createdAt || a.date || ""));
  $("#entryCount").textContent = String(sorted.length).padStart(2, "0");
  $("#entriesCountLabel").textContent = `${String(sorted.length).padStart(2, "0")} 页`;
  if (!sorted.length) {
    list.innerHTML = '<p class="entries-empty">还没有记录，先写下这一页吧。</p>';
    renderMemoryRituals();
    return;
  }
  list.innerHTML = sorted.map((entry) => {
    const isLocked = entry.kind === "capsule" && !isCapsuleUnlocked(entry);
    const imageMarkup = isLocked
      ? '<div class="entry-card-image entry-card-image--capsule" aria-label="时间胶囊尚未打开">锁</div>'
      : (entry.image ? `<img class="entry-card-image" src="${entry.image}" alt="${escapeHtml(entry.title)}" loading="lazy" />` : '<div class="entry-card-image entry-card-image--empty">没有照片</div>');
    const dateMarkup = isLocked
      ? `<div class="entry-capsule-date">${formatDate(entry.unlockDate)} 打开</div>`
      : (!entry.image && !entry.hideDate && entry.date ? `<div class="entry-card-date">${formatDate(entry.date)}</div>` : "");
    const kindMarkup = entry.kind === "capsule" ? '<span class="entry-kind-label">时间胶囊</span>' : "";
    const bodyMarkup = isLocked
      ? '<p class="entry-capsule-copy">这句话和照片会留到约定的那天。</p>'
      : `<p>${escapeHtml(entry.body)}</p>${renderResponses(entry)}`;
    const canManage = !publicApiReady || Boolean(ownerToken("entry", entry.id));
    const actionsMarkup = canManage ? `<div class="entry-card-actions">
        <button class="entry-action" type="button" data-action="edit">编辑</button>
        <button class="entry-action" type="button" data-action="delete">删除</button>
      </div>` : "";
    return `
    <article class="entry-card" data-entry-id="${escapeHtml(entry.id)}">
      ${imageMarkup}
      <div>
        ${dateMarkup}
        ${kindMarkup}
        <h3>${escapeHtml(entry.title)}</h3>
        ${bodyMarkup}
        <span class="entry-card-mood">${moodLabels[entry.mood] || "记录"}</span>
      </div>
      ${actionsMarkup}
    </article>
  `;
  }).join("");
  renderMemoryRituals();
}

const importantDates = [
  { month: 2, day: 17, label: "在一起纪念日" },
  { month: 9, day: 6, label: "甜甜的生日" },
  { month: 10, day: 19, label: "炜炜的生日" }
];

function daysUntil(date, target) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.ceil((target - start) / 86400000);
}

function renderMemoryRituals(now = new Date()) {
  const rituals = $("#memoryRituals");
  if (!rituals) return;
  const today = localDateValue(now);
  const monthDay = today.slice(5);
  const remembered = entries
    .map(normalizedEntry)
    .filter((entry) => isCapsuleUnlocked(entry, today) && entry.date && entry.date.slice(5) === monthDay && entry.date.slice(0, 4) < today.slice(0, 4))
    .sort((a, b) => b.date.localeCompare(a.date));
  const echo = remembered[0];
  $("#onThisDayTitle").textContent = echo ? echo.title : "把今天也留住。";
  $("#onThisDayBody").textContent = echo ? `${echo.date.slice(0, 4)} 年的今天，你们写下了这一页。` : "未来的同一天，会从这里回来。";

  const celebration = importantDates.find((item) => `${String(item.month).padStart(2, "0")}-${String(item.day).padStart(2, "0")}` === monthDay);
  rituals.dataset.celebration = celebration ? "true" : "false";
  if (celebration) {
    $("#anniversaryMomentTitle").textContent = `今天是${celebration.label}。`;
    $("#anniversaryMomentBody").textContent = "把今天留成一张新的照片、一段声音，或者一句只属于你们的话。";
    return;
  }

  const next = importantDates
    .map((item) => ({ ...item, date: new Date(now.getFullYear(), item.month - 1, item.day) }))
    .map((item) => item.date < new Date(now.getFullYear(), now.getMonth(), now.getDate()) ? { ...item, date: new Date(now.getFullYear() + 1, item.month - 1, item.day) } : item)
    .sort((a, b) => a.date - b.date)[0];
  const remaining = daysUntil(now, next.date);
  $("#anniversaryMomentTitle").textContent = `${next.label}还有 ${remaining} 天。`;
  $("#anniversaryMomentBody").textContent = `${next.date.getFullYear()} / ${String(next.date.getMonth() + 1).padStart(2, "0")} / ${String(next.date.getDate()).padStart(2, "0")}`;
}

function updateTogetherCounter() {
  const now = new Date();
  const today = localDateValue(now);
  const dayChanged = Boolean(lastCalendarDay && lastCalendarDay !== today);
  lastCalendarDay = today;
  const days = Math.max(0, Math.floor((now - relationshipStart) / 86400000));
  $("#daysTogether").textContent = String(days).padStart(3, "0");
  let next = new Date(now.getFullYear(), anniversaryMonth, anniversaryDay);
  if (next <= now) next = new Date(now.getFullYear() + 1, anniversaryMonth, anniversaryDay);
  $("#nextAnniversary").textContent = `${next.getFullYear()} / ${String(anniversaryMonth + 1).padStart(2, "0")} / ${String(anniversaryDay).padStart(2, "0")}`;
  $("#anniversaryCountdown").textContent = `还有 ${Math.ceil((next - now) / 86400000)} 天`;
  renderMemoryRituals(now);
  if (dayChanged) {
    renderEntries();
    refreshMemoryBook();
  }
}

function getAddedMemoryPages() {
  return entries
    .map(normalizedEntry)
    .filter((entry) => entry.image && isCapsuleUnlocked(entry) && !String(entry.id || "").startsWith("sample-"))
    .sort((a, b) => (a.createdAt || a.date || "").localeCompare(b.createdAt || b.date || ""))
    .map((entry) => ({
      id: `entry-${entry.id}`,
      type: "entry",
      image: entry.image,
      title: entry.title,
      body: entry.body
    }));
}

function getBookPages() {
  return [
    ...memoryPages.map((page, index) => ({ ...page, id: page.id || `chapter-${index + 1}`, type: "chapter" })),
    ...getAddedMemoryPages(),
    { id: "continuation", type: "continuation", title: "未完待续" }
  ];
}

function refreshMemoryBook() {
  const pages = getBookPages();
  const nextIndex = currentBookPageId === "continuation" ? pages.length - 1 : Math.min(memoryIndex, pages.length - 1);
  renderMemoryPage(nextIndex, 0);
}

function setBookImage(image, source, title) {
  image.dataset.fallbackTried = "false";
  image.onerror = () => {
    if (image.dataset.fallbackTried === "true") return;
    const fallback = String(source || "").replace(/^assets\/chapters\//, "");
    if (!fallback || fallback === source) return;
    image.dataset.fallbackTried = "true";
    image.src = fallback;
  };
  image.src = source;
  image.alt = title;
}

function renderMemoryPage(nextIndex = memoryIndex, direction = 1) {
  const pages = getBookPages();
  if (!pages.length) return;
  const targetIndex = Math.max(0, Math.min(nextIndex, pages.length - 1));
  if (targetIndex === memoryIndex && direction !== 0) return;

  const updatePage = () => {
    memoryIndex = targetIndex;
    const page = pages[memoryIndex];
    const isContinuation = page.type === "continuation";
    const book = $(".memory-book");
    const stage = $("#bookStage");
    book.dataset.layout = isContinuation ? "end" : String(memoryIndex % 4);
    book.dataset.pageType = page.type;
    stage.dataset.direction = direction < 0 ? "back" : "forward";
    currentBookPageId = page.id;
    $("#bookPhoto").hidden = isContinuation;
    $("#continuationArt").hidden = !isContinuation;
    $("#bookPhotoIndex").hidden = isContinuation;
    $(".book-copy").hidden = isContinuation;
    if (!isContinuation) {
      setBookImage($("#bookPhoto"), page.image, page.title);
      $("#bookPhotoIndex").textContent = String(memoryIndex + 1).padStart(2, "0");
    }
    $("#bookProgress").textContent = `${String(memoryIndex + 1).padStart(2, "0")} / ${String(pages.length).padStart(2, "0")}`;
    $("#bookTitle").textContent = page.title;
    $("#bookNote").textContent = page.type === "entry" ? page.body : "";
    $("#bookNote").hidden = page.type !== "entry" || !page.body;
    $$('[data-memory-prev]').forEach((button) => { button.disabled = memoryIndex === 0; });
    $$('[data-memory-next]').forEach((button) => { button.disabled = memoryIndex === pages.length - 1; });
  };

  if (direction === 0) {
    updatePage();
    return;
  }

  if (isBookTransitioning) return;
  isBookTransitioning = true;
  const stage = $("#bookStage");
  stage.classList.remove("is-entering");
  stage.classList.add("is-leaving");

  window.setTimeout(() => {
    updatePage();
    stage.classList.remove("is-leaving");
    window.requestAnimationFrame(() => {
      stage.classList.add("is-entering");
      window.setTimeout(() => {
        stage.classList.remove("is-entering");
        isBookTransitioning = false;
      }, 560);
    });
  }, 320);
}

function initMemoryBook() {
  renderMemoryPage(0, 0);
  const advance = (step) => renderMemoryPage(memoryIndex + step, step);
  $$('[data-memory-next]').forEach((button) => button.addEventListener("click", () => advance(1)));
  $$('[data-memory-prev]').forEach((button) => button.addEventListener("click", () => advance(-1)));
  $(".book-photo-wrap").addEventListener("click", () => advance(1));
  $("#bookStage").addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") { event.preventDefault(); advance(1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); advance(-1); }
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setFormStatus(message, isError = false) {
  const status = $("#formStatus");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function selectedEntryKind() {
  return $('input[name="entryType"]:checked')?.value || "diary";
}

function updateEntryTypeFields(kind = selectedEntryKind()) {
  const isCapsule = kind === "capsule";
  $("#entryDateLabel").textContent = isCapsule ? "开启日期" : "日期（可选）";
  $("#entryDate").required = isCapsule;
  if (isCapsule) $("#entryDate").min = localDateValue(new Date(Date.now() + 86400000));
  else $("#entryDate").removeAttribute("min");
  $("#entryForm").dataset.kind = kind;
}

function resetForm({ keepStatus = false } = {}) {
  $("#entryForm").reset();
  $('input[name="entryType"][value="diary"]').checked = true;
  updateEntryTypeFields("diary");
  $("#entryDate").value = "";
  $("#formMode").textContent = `${String(entries.length + 1).padStart(2, "0")} / ${String(entries.length + 1).padStart(2, "0")}`;
  $(".save-button span:first-child").textContent = "保存这一页";
  if (!keepStatus) setFormStatus("");
  pendingPhoto = null;
  pendingPhotoFile = null;
  $("#photoPreview").hidden = true;
  $("#photoPreviewImage").removeAttribute("src");
  editingId = null;
}

async function uploadPhoto(file) {
  if (!supabaseClient || !cloudSession || !file) return null;
  const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${cloudSession.user.id}/${crypto.randomUUID()}.${extension || "jpg"}`;
  const { error } = await supabaseClient.storage.from(photoBucket).upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return path;
}

async function removeCloudFile(bucket, path) {
  if (!supabaseClient || !cloudSession || !path) return;
  const { error } = await supabaseClient.storage.from(bucket).remove([path]);
  if (error) throw error;
}

async function signedPhotoUrl(path) {
  if (!supabaseClient || !path) return "";
  const { data, error } = await supabaseClient.storage.from(photoBucket).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) throw error;
  return data?.signedUrl || "";
}

async function uploadVoice(file) {
  if (!supabaseClient || !cloudSession || !file) return null;
  const path = `${cloudSession.user.id}/${crypto.randomUUID()}.webm`;
  const { error } = await supabaseClient.storage.from(voiceBucket).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "audio/webm" });
  if (error) throw error;
  return path;
}

async function signedVoiceUrl(path) {
  if (!supabaseClient || !path) return "";
  const { data, error } = await supabaseClient.storage.from(voiceBucket).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) throw error;
  return data?.signedUrl || "";
}

async function loadCloudEntries() {
  if (!supabaseClient || !cloudSession) return;
  const { data, error } = await supabaseClient.from("entries").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  entries = await Promise.all((data || []).map(async (entry) => normalizedEntry({ ...entry, image: entry.image_path ? await signedPhotoUrl(entry.image_path) : "" })));
  renderEntries();
  refreshMemoryBook();
}

async function loadCloudVoices() {
  if (!supabaseClient || !cloudSession) return;
  const { data, error } = await supabaseClient.from("voices").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  voiceEntries = await Promise.all((data || []).map(async (voice) => ({
    id: voice.id,
    author: voice.author,
    audioPath: voice.audio_path,
    audio: await signedVoiceUrl(voice.audio_path),
    createdAt: voice.created_at
  })));
  renderVoiceEntries();
}

async function addEntryResponse(entryId, author, body) {
  const entry = entries.find((item) => String(item.id) === String(entryId));
  if (!entry) return;
  const current = normalizedEntry(entry);
  const responses = [...current.responses, { id: `reply-${Date.now()}`, author, body, createdAt: new Date().toISOString() }];
  if (publicApiReady) {
    await publicApiFetch(`/api/entries/${encodeURIComponent(entryId)}/replies`, { method: "POST", body: JSON.stringify({ author, body }) });
    await loadPublicEntries();
    return;
  }
  if (cloudSession && supabaseClient) {
    const result = await supabaseClient.from("entries").update({ responses }).eq("id", entry.id);
    if (result.error) throw result.error;
    await loadCloudEntries();
    return;
  }
  entries = entries.map((item) => String(item.id) === String(entryId) ? { ...item, responses } : item);
  saveLocalEntries();
  renderEntries();
}

function updateCloudButton() {
  const button = $("#cloudOpen");
  if (publicApiReady) {
    button.textContent = "双人同步 · 已开启";
    button.classList.add("is-connected");
  } else if (cloudSession) {
    button.textContent = "已同步 · 退出";
    button.classList.add("is-connected");
  } else if (cloudReady) {
    button.textContent = "开启双人同步 ↗";
    button.classList.remove("is-connected");
  } else {
    button.textContent = "设置双人同步 ↗";
    button.classList.remove("is-connected");
  }
}

function openAuth() { $("#authModal").hidden = false; $("#authEmail").focus(); }
function closeAuth() { $("#authModal").hidden = true; $("#authStatus").textContent = ""; }

function updateAuthMode() {
  const signup = authMode === "signup";
  $("#authTitle").innerHTML = signup ? "创建我们的<br /><em>共同空间。</em>" : "让两个人<br /><em>写在同一页。</em>";
  $("#authCopy").textContent = signup ? "创建一组只属于你们的账号。之后两个人都用这组账号登录，就能共同记录。" : "两个人使用同一组专属账号登录，照片和文字会同步到同一份回忆里。";
  $("#authSubmitLabel").textContent = signup ? "创建并同步" : "登录并同步";
  $("#authSwitch").textContent = signup ? "已经有账号？直接登录" : "还没有账号？创建一个";
}

async function initCloud() {
  updateCloudButton();
  if (publicApiReady) {
    initPublicAuth();
    if (!(await ensurePublicAuth())) return;
    try { await loadPublicEntries(); await loadPublicVoices(); } catch (error) { setFormStatus(`公开空间读取失败：${error.message}`, true); }
    window.setInterval(async () => {
      if (!(await ensurePublicAuth())) return;
      try { await loadPublicEntries(); await loadPublicVoices(); } catch (error) { console.error(error); }
    }, 15000);
    return;
  }
  if (!cloudReady) return;
  supabaseClient = window.supabase.createClient(cloudConfig.url, cloudConfig.anonKey);
  const { data } = await supabaseClient.auth.getSession();
  cloudSession = data.session;
  updateCloudButton();
  if (cloudSession) {
    try { await loadCloudEntries(); await loadCloudVoices(); } catch (error) { setFormStatus(`同步读取失败：${error.message}`, true); }
  }
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    cloudSession = session;
    updateCloudButton();
    if (!session) return;
    closeAuth();
    try { await loadCloudEntries(); await loadCloudVoices(); } catch (error) { setFormStatus(`同步读取失败：${error.message}`, true); }
  });
  supabaseClient.channel("shared-space-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, async () => {
      if (!cloudSession) return;
      try { await loadCloudEntries(); } catch (error) { console.error(error); }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "voices" }, async () => {
      if (!cloudSession) return;
      try { await loadCloudVoices(); } catch (error) { console.error(error); }
    })
    .subscribe();
}

function initPublicAuth() {
  const form = $("#publicAuthForm");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  if (!publicAuthToken) showPublicLock();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("#publicAuthPassword").value;
    const status = $("#publicAuthStatus");
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    status.textContent = "正在打开回忆录……";
    status.classList.remove("is-error");
    try {
      const result = await publicApiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password }), headers: { "content-type": "application/json" } });
      publicAuthToken = result.token || "";
      if (!publicAuthToken) throw new Error("没有收到登录凭证。");
      localStorage.setItem(PUBLIC_AUTH_TOKEN_KEY, publicAuthToken);
      document.cookie = `site_session=${encodeURIComponent(publicAuthToken)}; Max-Age=${30 * 86400}; Path=/; Secure; SameSite=Lax`;
      $("#publicAuthPassword").value = "";
      hidePublicLock();
      await loadPublicEntries();
      await loadPublicVoices();
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message || "密码不正确。";
      status.classList.add("is-error");
    } finally { submit.disabled = false; }
  });
}

async function loadPublicEntries() {
  const payload = await publicApiFetch("/api/entries");
  entries = Array.isArray(payload.entries) ? payload.entries.map(normalizedEntry) : [];
  renderEntries();
  refreshMemoryBook();
}

async function loadPublicVoices() {
  const payload = await publicApiFetch("/api/voices");
  voiceEntries = Array.isArray(payload.voices) ? payload.voices : [];
  renderVoiceEntries();
}

function initAuth() {
  $("#cloudOpen").addEventListener("click", async () => {
    if (publicApiReady) {
      $("#diary").scrollIntoView({ behavior: "smooth" });
      window.setTimeout(() => $("#entryTitle").focus({ preventScroll: true }), 500);
      return;
    }
    if (cloudSession && supabaseClient) { await supabaseClient.auth.signOut(); return; }
    openAuth();
  });
  $("#authClose").addEventListener("click", closeAuth);
  $("#authModal").addEventListener("click", (event) => { if (event.target === $("#authModal")) closeAuth(); });
  $("#authSwitch").addEventListener("click", () => { authMode = authMode === "login" ? "signup" : "login"; updateAuthMode(); });
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    const status = $("#authStatus");
    if (!cloudReady || !supabaseClient) { status.textContent = "先在 supabase-config.js 填入项目地址和 publishable key。"; status.classList.add("is-error"); return; }
    status.classList.remove("is-error");
    status.textContent = "正在连接共同空间……";
    const result = authMode === "signup" ? await supabaseClient.auth.signUp({ email, password }) : await supabaseClient.auth.signInWithPassword({ email, password });
    if (result.error) { status.textContent = result.error.message; status.classList.add("is-error"); return; }
    status.textContent = authMode === "signup" ? "账号已创建。如果邮箱验证开启，请先查收验证邮件。" : "登录成功，正在打开共同记录。";
  });
  updateAuthMode();
}

function initDiary() {
  entries = loadLocalEntries();
  renderEntries();
  refreshMemoryBook();
  updateEntryTypeFields("diary");
  $$('input[name="entryType"]').forEach((input) => input.addEventListener("change", () => updateEntryTypeFields()));
  $("#entryPhoto").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setFormStatus("这张照片超过 4MB，请换一张小一点的。", true); event.target.value = ""; return; }
    try {
      pendingPhotoFile = file;
      pendingPhoto = await readFileAsDataUrl(file);
      $("#photoPreviewImage").src = pendingPhoto;
      $("#photoPreview").hidden = false;
      setFormStatus("照片已经准备好了。" );
    } catch { setFormStatus("照片读取失败，请重试。", true); }
  });
  $("#removePhoto").addEventListener("click", () => {
    pendingPhoto = null; pendingPhotoFile = null; $("#entryPhoto").value = ""; $("#photoPreview").hidden = true; $("#photoPreviewImage").removeAttribute("src");
  });
  $("#entryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") || "").trim();
    const body = String(formData.get("body") || "").trim();
    if (!title || !body) return;
    const kind = String(formData.get("entryType") || "diary");
    const existing = editingId ? entries.find((entry) => entry.id === editingId) : null;
    const hasPhoto = Boolean(pendingPhoto || existing?.image || existing?.imagePath);
    const selectedDate = String(formData.get("date") || "");
    if (kind === "capsule" && (!selectedDate || selectedDate <= localDateValue())) {
      setFormStatus("时间胶囊需要选择明天或更晚的开启日期。", true);
      return;
    }
    const date = kind === "capsule" ? "" : (selectedDate || localDateValue());
    const unlockDate = kind === "capsule" ? selectedDate : "";
    const wasEditing = Boolean(editingId);
    const button = $(".save-button");
    button.disabled = true;
    setFormStatus(publicApiReady || cloudSession ? "正在同步这一页……" : "正在保存这一页……");
    try {
      if (publicApiReady) {
        const payload = new FormData();
        payload.set("title", title);
        payload.set("body", body);
        payload.set("mood", String(formData.get("mood") || "soft"));
        payload.set("entryType", kind);
        payload.set("date", kind === "capsule" ? "" : date);
        payload.set("unlockDate", unlockDate);
        if (pendingPhotoFile) payload.set("photo", pendingPhotoFile);
        const path = editingId ? `/api/entries/${encodeURIComponent(editingId)}` : "/api/entries";
        const headers = editingId ? { "x-owner-token": ownerToken("entry", editingId) } : {};
        const result = await publicApiFetch(path, { method: editingId ? "PATCH" : "POST", headers, body: payload });
        if (result.entry) {
          if (!editingId && result.ownerToken) saveOwnerToken("entry", result.entry.id, result.ownerToken);
          entries = editingId ? entries.map((entry) => entry.id === result.entry.id ? normalizedEntry(result.entry) : entry) : [normalizedEntry(result.entry), ...entries];
          renderEntries();
          refreshMemoryBook();
        }
        await loadPublicEntries();
      } else if (cloudSession && supabaseClient) {
        let imagePath = existing?.imagePath || "";
        if (pendingPhotoFile) imagePath = await uploadPhoto(pendingPhotoFile);
        const payload = {
          title,
          body,
          mood: String(formData.get("mood") || "soft"),
          entry_type: kind,
          memory_date: date || null,
          unlock_date: unlockDate || null,
          image_path: imagePath || null,
          hide_date: hasPhoto,
          responses: normalizedEntry(existing || {}).responses
        };
        const result = editingId ? await supabaseClient.from("entries").update(payload).eq("id", editingId) : await supabaseClient.from("entries").insert(payload);
        if (result.error) throw result.error;
        if (editingId && pendingPhotoFile && existing?.imagePath && existing.imagePath !== imagePath) await removeCloudFile(photoBucket, existing.imagePath);
        await loadCloudEntries();
      } else {
        const nextEntry = normalizedEntry({
          id: editingId || `entry-${Date.now()}`,
          title,
          body,
          date,
          mood: String(formData.get("mood") || "soft"),
          image: pendingPhoto || existing?.image || "",
          hideDate: hasPhoto,
          kind,
          unlockDate,
          responses: normalizedEntry(existing || {}).responses,
          createdAt: existing?.createdAt || new Date().toISOString()
        });
        entries = editingId ? entries.map((entry) => entry.id === editingId ? nextEntry : entry) : [nextEntry, ...entries];
        saveLocalEntries();
        renderEntries();
        refreshMemoryBook();
      }
      resetForm({ keepStatus: true });
      setFormStatus(wasEditing ? "这一页已经更新。" : (kind === "capsule" ? "时间胶囊已经封存。" : (publicApiReady || cloudSession ? "这一页已经同步给所有人。" : "这一页已经收进回忆录。")));
    } catch (error) { setFormStatus(`保存失败：${error.message || "请重试"}`, true); }
    finally { button.disabled = false; }
  });
  $("#entriesList").addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    const card = event.target.closest("[data-entry-id]");
    if (!action || !card) return;
    const entry = entries.find((item) => item.id === card.dataset.entryId);
    if (!entry) return;
    if (action === "reply") {
      const form = card.querySelector(".reply-form");
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector('input[name="replyBody"]').focus();
      return;
    }
    if (action === "delete") {
      if (!window.confirm("确定要删除这一页吗？")) return;
      try {
        if (publicApiReady) {
          await publicApiFetch(`/api/entries/${encodeURIComponent(entry.id)}`, { method: "DELETE", headers: { "x-owner-token": ownerToken("entry", entry.id) } });
          await loadPublicEntries();
        } else if (cloudSession && supabaseClient) {
          if (entry.imagePath) await removeCloudFile(photoBucket, entry.imagePath);
          const result = await supabaseClient.from("entries").delete().eq("id", entry.id);
          if (result.error) throw result.error;
          await loadCloudEntries();
        } else {
          entries = entries.filter((item) => item.id !== entry.id); saveLocalEntries(); renderEntries(); refreshMemoryBook();
        }
      } catch (error) { setFormStatus(`删除失败：${error.message}`, true); }
      return;
    }
    const current = normalizedEntry(entry);
    editingId = current.id;
    $("#entryTitle").value = current.title;
    $(`input[name="entryType"][value="${current.kind}"]`).checked = true;
    updateEntryTypeFields(current.kind);
    $("#entryDate").value = current.kind === "capsule" ? current.unlockDate : current.date;
    $("#entryMood").value = current.mood;
    $("#entryBody").value = current.body;
    pendingPhoto = current.image || null;
    pendingPhotoFile = null;
    if (pendingPhoto) { $("#photoPreviewImage").src = pendingPhoto; $("#photoPreview").hidden = false; }
    $(".save-button span:first-child").textContent = "更新这一页";
    $("#formMode").textContent = "编辑中";
    $("#entryForm").scrollIntoView({ behavior: "smooth", block: "center" });
    $("#entryTitle").focus({ preventScroll: true });
  });
  $("#entriesList").addEventListener("submit", async (event) => {
    const form = event.target.closest(".reply-form");
    if (!form) return;
    event.preventDefault();
    const card = form.closest("[data-entry-id]");
    const body = String(new FormData(form).get("replyBody") || "").trim();
    const author = String(new FormData(form).get("replyAuthor") || "甜甜");
    if (!card || !body) return;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await addEntryResponse(card.dataset.entryId, author, body);
      setFormStatus("回应已经留在这一页。" );
    } catch (error) { setFormStatus(`回应保存失败：${error.message || "请重试"}`, true); }
    finally { button.disabled = false; }
  });
}

function loadVoiceEntries() {
  try {
    const stored = JSON.parse(localStorage.getItem(VOICE_STORAGE_KEY));
    return Array.isArray(stored) ? stored : [];
  } catch { return []; }
}

function saveVoiceEntries() {
  localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(voiceEntries));
}

function setVoiceStatus(message, isError = false) {
  const status = $("#voiceStatus");
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function renderVoiceEntries() {
  const list = $("#voiceList");
  if (!voiceEntries.length) {
    list.innerHTML = '<p class="voice-empty">还没有留下声音。</p>';
    return;
  }
  list.innerHTML = voiceEntries.map((voice) => `
    <div class="voice-item" data-voice-id="${escapeHtml(voice.id)}">
      <span>${escapeHtml(voice.author || "我们")}</span>
      <audio controls preload="metadata" src="${escapeHtml(voice.audio)}"></audio>
      ${(!publicApiReady || ownerToken("voice", voice.id)) ? '<button class="voice-delete" type="button" aria-label="删除这段录音">删除</button>' : ""}
    </div>
  `).join("");
}

function resetVoiceRecorder() {
  if (voiceStopTimer) window.clearTimeout(voiceStopTimer);
  voiceStopTimer = null;
  if (voiceStream) voiceStream.getTracks().forEach((track) => track.stop());
  voiceStream = null;
  voiceRecorder = null;
  voiceChunks = [];
  $("#voiceRecord").disabled = false;
  $("#voiceRecord").setAttribute("aria-pressed", "false");
  $("#voiceRecord").textContent = "开始录音";
  $("#voiceStop").disabled = true;
}

function stopVoiceRecording() {
  if (voiceRecorder?.state === "recording") voiceRecorder.stop();
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setVoiceStatus("当前浏览器不支持录音。", true);
    return;
  }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    voiceRecorder = new MediaRecorder(voiceStream);
    voiceRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) voiceChunks.push(event.data); });
    voiceRecorder.addEventListener("stop", async () => {
      const blob = new Blob(voiceChunks, { type: voiceRecorder?.mimeType || "audio/webm" });
      if (blob.size > 2 * 1024 * 1024) {
        setVoiceStatus("这段录音超过 2MB，请录短一点。", true);
        resetVoiceRecorder();
        return;
      }
      try {
        if (publicApiReady) {
          const payload = new FormData();
          payload.set("author", $("#voiceAuthor").value);
          payload.set("audio", new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" }));
          const result = await publicApiFetch("/api/voices", { method: "POST", body: payload });
          if (result.voice) {
            saveOwnerToken("voice", result.voice.id, result.ownerToken);
            voiceEntries = [result.voice, ...voiceEntries];
            renderVoiceEntries();
          }
          setVoiceStatus("声音已经同步给所有人。" );
        } else if (cloudSession && supabaseClient) {
          const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
          const audioPath = await uploadVoice(file);
          const result = await supabaseClient.from("voices").insert({ author: $("#voiceAuthor").value, audio_path: audioPath }).select().single();
          if (result.error) throw result.error;
          await loadCloudVoices();
          setVoiceStatus("声音已经同步给两个人。" );
        } else {
          const audio = await readFileAsDataUrl(blob);
          voiceEntries = [{ id: `voice-${Date.now()}`, author: $("#voiceAuthor").value, audio }, ...voiceEntries];
          saveVoiceEntries();
          renderVoiceEntries();
          setVoiceStatus("声音已经留在这里。" );
        }
      } catch { setVoiceStatus("录音保存失败，请重试。", true); }
      resetVoiceRecorder();
    }, { once: true });
    voiceRecorder.start();
    $("#voiceRecord").disabled = true;
    $("#voiceRecord").setAttribute("aria-pressed", "true");
    $("#voiceRecord").textContent = "正在录音";
    $("#voiceStop").disabled = false;
    setVoiceStatus("正在录音，最长 60 秒。" );
    voiceStopTimer = window.setTimeout(stopVoiceRecording, 60000);
  } catch { resetVoiceRecorder(); setVoiceStatus("没有获得麦克风权限。", true); }
}

function initVoicePage() {
  voiceEntries = loadVoiceEntries();
  renderVoiceEntries();
  $("#voiceRecord").addEventListener("click", startVoiceRecording);
  $("#voiceStop").addEventListener("click", stopVoiceRecording);
  $("#voiceList").addEventListener("click", (event) => {
    const button = event.target.closest(".voice-delete");
    if (!button) return;
    const item = button.closest("[data-voice-id]");
    if (!item || !window.confirm("确定删除这段录音吗？")) return;
    (async () => {
      try {
        if (publicApiReady) {
          await publicApiFetch(`/api/voices/${encodeURIComponent(item.dataset.voiceId)}`, { method: "DELETE", headers: { "x-owner-token": ownerToken("voice", item.dataset.voiceId) } });
          await loadPublicVoices();
        } else if (cloudSession && supabaseClient) {
          const voice = voiceEntries.find((entry) => entry.id === item.dataset.voiceId);
          if (voice?.audioPath) await removeCloudFile(voiceBucket, voice.audioPath);
          const result = await supabaseClient.from("voices").delete().eq("id", item.dataset.voiceId);
          if (result.error) throw result.error;
          await loadCloudVoices();
        } else {
          voiceEntries = voiceEntries.filter((voice) => voice.id !== item.dataset.voiceId);
          saveVoiceEntries();
          renderVoiceEntries();
        }
      } catch (error) { setVoiceStatus(`删除失败：${error.message || "请重试"}`, true); }
    })();
  });
}

function initVideo() {
  const video = $("#memoryVideo");
  const empty = $("#videoEmpty");
  $("#videoUpload").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    video.src = URL.createObjectURL(file); video.load(); empty.classList.add("has-source"); video.play().catch(() => {});
  });
}

function initLightbox() {
  const lightbox = $("#lightbox");
  const image = $("#lightboxImage");
  const caption = $("#lightboxCaption");
  const close = () => { lightbox.hidden = true; document.body.classList.remove("is-lightbox-open"); image.removeAttribute("src"); };
  $$(".photo-trigger").forEach((trigger) => trigger.addEventListener("click", () => { image.src = trigger.dataset.image; image.alt = trigger.querySelector("img")?.alt || "回忆照片"; caption.textContent = trigger.dataset.caption || ""; lightbox.hidden = false; document.body.classList.add("is-lightbox-open"); }));
  $("#lightboxClose").addEventListener("click", close);
  lightbox.addEventListener("click", (event) => { if (event.target === lightbox) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !lightbox.hidden) close(); });
}

function initScrollLinks() {
  $$('[data-scroll-diary]').forEach((button) => button.addEventListener("click", () => { $("#diary").scrollIntoView({ behavior: "smooth" }); window.setTimeout(() => $("#entryTitle").focus({ preventScroll: true }), 650); }));
  $$('[data-scroll-story]').forEach((button) => button.addEventListener("click", () => { $("#story").scrollIntoView({ behavior: "smooth" }); renderMemoryPage(0, 0); }));
}

function initReveal() {
  const revealItems = $$(".reveal");
  if (!("IntersectionObserver" in window)) { revealItems.forEach((item) => item.classList.add("is-visible")); return; }
  const observer = new IntersectionObserver((items, instance) => { items.forEach((item) => { if (!item.isIntersecting) return; item.target.classList.add("is-visible"); instance.unobserve(item.target); }); }, { threshold: .12 });
  revealItems.forEach((item) => observer.observe(item));
}

updateTogetherCounter();
window.setInterval(updateTogetherCounter, 60000);
initMemoryBook();
initDiary();
initVoicePage();
initVideo();
initLightbox();
initScrollLinks();
initAuth();
initCloud();
initReveal();
