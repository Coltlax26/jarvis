"use strict";

const $ = (id) => document.getElementById(id);
let inApp = false;

const api = async (url, opts = {}) => {
  const r = await fetch(url, {
    method: opts.body ? "POST" : "GET",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch { /* non-json */ }
  if (r.status === 401 && inApp && url.startsWith("/api/") && url !== "/api/me") {
    location.reload();
  }
  return { status: r.status, ok: r.ok, data };
};

const two = (n) => String(n).padStart(2, "0");
const fmtTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};
const fmtWhen = (iso) => {
  const d = new Date(iso), diff = d.getTime() - Date.now();
  const abs = Math.abs(diff), mins = Math.round(abs / 60000);
  if (mins < 1) return diff < 0 ? "just now" : "any moment";
  if (mins < 60) return diff < 0 ? `${mins}m ago` : `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return diff < 0 ? `${hrs}h ago` : `in ${hrs}h`;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const JARVIS_MARK = '<img src="/jarvis-mark.png" alt="J" />';

/* ---------------- theme ---------------- */
let tz = undefined;
function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  root.dataset.theme = theme.mode === "light" ? "light" : "hud";
  if (theme.accent) root.style.setProperty("--accent", theme.accent);
  if (theme.background) {
    const bg = $("bg-image");
    bg.style.backgroundImage = `url("${theme.background}")`;
    bg.dataset.fit = theme.backgroundFit || "watermark";
    bg.classList.add("show");
  }
  if (theme.logo) {
    const img = document.createElement("img");
    img.src = theme.logo;
    img.className = "brand-logo";
    document.querySelector(".brand").appendChild(img);
  }
  if (theme.brand) $("who").textContent = theme.brand;
}

/* ---------------- boot / login ---------------- */
const boot = $("boot");
const loginScreen = $("login-screen");
const loginForm = $("login-form");
const loginMsg = $("login-msg");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.className = "login-msg";
  loginMsg.textContent = "Authenticating…";
  const { status, data } = await api("/login", { body: { password: $("pw").value } });
  if (status === 200) {
    loginMsg.className = "login-msg ok";
    loginMsg.textContent = "✓ " + (data.message || "Access granted");
    setTimeout(() => enterApp(data.user && data.user.name, data.user && data.user.theme), 600);
  } else {
    loginMsg.className = "login-msg err";
    loginMsg.textContent = data.error || "Wrong password";
    $("pw").select();
  }
});

async function start() {
  const me = await api("/api/me");
  setTimeout(() => boot.classList.add("gone"), 900);
  setTimeout(() => boot.remove(), 1500);
  if (me.status === 200 && me.data.name) {
    tz = me.data.tz;
    enterApp(me.data.name, me.data.theme);
  } else {
    setTimeout(() => { loginScreen.hidden = false; }, 900);
  }
}

let greeted = false;
async function enterApp(name, theme) {
  applyTheme(theme);
  loginScreen.classList.add("gone");
  boot.classList.add("gone");
  $("app").hidden = false;
  inApp = true;

  if (!name || !theme) {
    const me = await api("/api/me");
    name = name || (me.data && me.data.name);
    theme = theme || (me.data && me.data.theme);
    tz = tz || (me.data && me.data.tz);
    applyTheme(theme);
  }
  if (name && !theme?.brand) $("who").textContent = name;
  if (name && !greeted) {
    greeted = true;
    bubble(`Hello ${name}. Systems are online. What can I do for you?`, "jarvis");
  }

  startClock();
  connectStream();
  refreshOverview();
  setInterval(refreshOverview, 8000);
  setTimeout(() => loginScreen.remove(), 500);
}

/* ---------------- logout ---------------- */
const logoutConfirm = $("logout-confirm");
$("logout-btn").addEventListener("click", () => { logoutConfirm.hidden = false; });
$("logout-cancel").addEventListener("click", () => { logoutConfirm.hidden = true; });
$("logout-yes").addEventListener("click", async () => {
  await api("/logout", { body: {} });
  location.reload();
});
logoutConfirm.addEventListener("click", (e) => { if (e.target === logoutConfirm) logoutConfirm.hidden = true; });

/* ---------------- tabs ---------------- */
$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
  const view = btn.dataset.view;
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
});

/* ---------------- clock ---------------- */
function startClock() {
  const tick = () => {
    const now = new Date();
    const opts = tz ? { timeZone: tz } : {};
    const t = now.toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit", hour12: true });
    const d = now.toLocaleDateString("en-US", { ...opts, weekday: "short", month: "short", day: "numeric" }).toUpperCase();
    $("clock-time").textContent = t;
    $("clock-date").textContent = d;
    $("today-time").textContent = t;
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------------- chat ---------------- */
const log = $("log");
let thinkingEl = null;

function bubble(text, who) {
  if (who === "jarvis") {
    const row = document.createElement("div");
    row.className = "msg-row";
    const av = document.createElement("span");
    av.className = "javatar";
    av.innerHTML = JARVIS_MARK;
    const el = document.createElement("div");
    el.className = "msg jarvis";
    el.textContent = text;
    row.append(av, el);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  const el = document.createElement("div");
  el.className = "msg " + who;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
function showThinking(label) {
  clearThinking();
  thinkingEl = document.createElement("div");
  thinkingEl.className = "thinking";
  thinkingEl.innerHTML = '<span class="spin"></span><span></span>';
  thinkingEl.lastChild.textContent = label || "Processing…";
  log.appendChild(thinkingEl);
  log.scrollTop = log.scrollHeight;
}
function clearThinking() {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
}

const composer = $("composer");
const textEl = $("text");
textEl.addEventListener("input", () => {
  textEl.style.height = "auto";
  textEl.style.height = Math.min(textEl.scrollHeight, 150) + "px";
});
textEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); }
});
composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = textEl.value.trim();
  if (!text) return;
  bubble(text, "me");
  textEl.value = "";
  textEl.style.height = "auto";
  $("send").disabled = true;
  showThinking("Processing…");
  const { status, data } = await api("/api/message", { body: { text } });
  clearThinking();
  if (status === 200) bubble(data.reply, "jarvis");
  else bubble("Error: " + (data.error || status), "err");
  $("send").disabled = false;
  refreshOverview();
});

/* ---------------- live link ---------------- */
let sseOk = false;
let pollOk = false;
function paintLink() {
  const el = $("link-dot"), txt = $("link-text");
  if (sseOk) { el.classList.add("live"); txt.textContent = "live"; }
  else if (pollOk) { el.classList.add("live"); txt.textContent = "connected"; }
  else { el.classList.remove("live"); txt.textContent = "offline"; }
}
function setLink(live) { sseOk = live; paintLink(); }
function setState(s) {
  const pill = $("state-pill");
  pill.className = "pill" + (s === "working" ? " working" : s === "waiting_on_you" ? " waiting" : "");
  pill.textContent = s === "working" ? "working" : s === "waiting_on_you" ? "waiting on you" : "idle";
}

function connectStream() {
  const es = new EventSource("/api/stream");
  es.addEventListener("hello", () => setLink(true));
  es.addEventListener("ping", () => setLink(true));
  es.addEventListener("activity", (ev) => {
    const e = JSON.parse(ev.data);
    pushEvent(e);
    if (e.kind === "turn_start" || e.kind === "thinking" || e.kind === "tool_run") setState("working");
    if (e.kind === "thinking") showThinking(e.text);
    if (e.kind === "tool_run") showThinking(e.text + "…");
    if (e.kind === "tool_held") { showThinking("Queued for your approval…"); refreshOverview(); }
    if (e.kind === "turn_end" || e.kind === "error") { setState("idle"); clearThinking(); }
    if (e.kind === "turn_end" && e.surface && e.surface !== "web") bubble(e.text, "jarvis");
  });
  es.onerror = () => {
    setLink(false);
    if (es.readyState === EventSource.CLOSED) setTimeout(connectStream, 5000);
  };
}

/* ---------------- activity feed ---------------- */
const feed = $("feed");
const EVT_ICON = {
  turn_start: "◈", thinking: "◇", tool_run: "▸", tool_held: "❚❚", tool_rejected: "✕",
  reply: "✓", turn_end: "✓", error: "!", message_in: "◈", action_run: "▸",
  action_held: "❚❚", action_approved: "✓", action_rejected: "✕", reminder_sent: "◔",
};
function eventRow(e) {
  const row = document.createElement("div");
  row.className = "evt k-" + e.kind;
  const when = e.at || e.createdAt;
  row.innerHTML = '<div class="ic"></div><div class="body"><div class="t"></div><div class="meta"></div></div>';
  row.querySelector(".ic").textContent = EVT_ICON[e.kind] || "•";
  row.querySelector(".t").textContent = e.text || e.summary || e.kind;
  row.querySelector(".meta").textContent = (e.surface ? e.surface + " · " : "") + (when ? fmtTime(when) : "");
  return row;
}
function pushEvent(e) {
  feed.prepend(eventRow(e));
  while (feed.children.length > 120) feed.lastChild.remove();
}

/* ---------------- overview poll ---------------- */
async function refreshOverview() {
  const { ok, data } = await api("/api/overview");
  pollOk = ok;
  paintLink();
  if (!ok) return;
  if (data.tz && !tz) tz = data.tz;
  if (!thinkingEl) setState(data.status);

  // today strip
  const t = data.today || {};
  $("today-date").textContent = t.date || "—";
  $("today-reminders").textContent = (t.reminders || []).length;
  const appr = $("today-approvals");
  appr.textContent = t.pendingCount || 0;
  appr.className = "v" + (t.pendingCount ? " warn" : "");
  $("today-brief").textContent = buildBrief(t);

  // pending
  const pl = $("pending-list");
  pl.innerHTML = "";
  $("pending-count").textContent = data.pending.length;
  $("badge-tasks").textContent = data.pending.length || "";
  if (!data.pending.length) pl.innerHTML = '<div class="empty">Nothing waiting on you.</div>';
  for (const p of data.pending) pl.appendChild(pendingCard(p));

  // reminders
  const rl = $("reminder-list");
  rl.innerHTML = "";
  $("reminder-count").textContent = data.reminders.length;
  if (!data.reminders.length) rl.innerHTML = '<div class="empty">No reminders scheduled.</div>';
  for (const r of data.reminders) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = '<div class="card-head"><span class="tier">◔ reminder</span><span class="when"></span></div><div class="summary"></div>';
    el.querySelector(".when").textContent = fmtWhen(r.deliverAt);
    el.querySelector(".summary").textContent = r.body;
    rl.appendChild(el);
  }

  // recently done
  const dl = $("done-list");
  dl.innerHTML = "";
  const done = (data.activity || [])
    .filter((a) => ["action_run", "action_approved", "action_rejected", "reminder_sent"].includes(a.kind))
    .slice(0, 10);
  if (!done.length) dl.innerHTML = '<div class="empty">Nothing yet.</div>';
  for (const a of done) dl.appendChild(eventRow(a));

  // memory
  const ml = $("memory-list");
  ml.innerHTML = "";
  $("memory-count").textContent = data.memories.length;
  if (!data.memories.length) ml.innerHTML = '<div class="empty">Jarvis has not saved anything yet.</div>';
  for (const m of data.memories) {
    const el = document.createElement("div");
    el.className = "mem";
    el.innerHTML = '<div class="c"></div><div class="when"></div>';
    el.querySelector(".c").textContent = m.content;
    el.querySelector(".when").textContent = fmtWhen(m.createdAt);
    ml.appendChild(el);
  }

  if (!feed.dataset.seeded && data.activity) {
    feed.dataset.seeded = "1";
    for (const a of [...data.activity].reverse()) pushEvent(a);
  }
}

function buildBrief(t) {
  const parts = [];
  const rem = (t.reminders || []).length;
  if (rem) parts.push(`${rem} reminder${rem > 1 ? "s" : ""} today`);
  if (t.pendingCount) parts.push(`${t.pendingCount} thing${t.pendingCount > 1 ? "s" : ""} need${t.pendingCount > 1 ? "" : "s"} your approval`);
  if (!parts.length) return "Nothing scheduled today. Ask me anything.";
  return "Today: " + parts.join(" · ") + ".";
}

function pendingCard(p) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML =
    '<div class="card-head"><span class="tier t' + p.tier + '">tier ' + p.tier + '</span>' +
    '<span class="name"></span><span class="when"></span></div>' +
    '<div class="summary"></div>' +
    '<div class="actions"><button class="approve">Approve</button><button class="reject">Reject</button></div>';
  el.querySelector(".name").textContent = p.actionName;
  el.querySelector(".when").textContent = fmtWhen(p.createdAt);
  el.querySelector(".summary").textContent = p.summary || "(no summary)";
  el.querySelector(".approve").addEventListener("click", async () => {
    el.querySelector(".actions").innerHTML = "<span class='empty'>Approving…</span>";
    await api("/api/pending/" + p.id + "/approve", { body: {} });
    refreshOverview();
  });
  el.querySelector(".reject").addEventListener("click", async () => {
    await api("/api/pending/" + p.id + "/reject", { body: {} });
    refreshOverview();
  });
  return el;
}

start();
