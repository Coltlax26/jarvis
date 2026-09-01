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
  // Session expired mid-use (e.g. server redeployed) — send back to login.
  if (r.status === 401 && inApp && url.startsWith("/api/") && url !== "/api/me") {
    location.reload();
  }
  return { status: r.status, ok: r.ok, data };
};
const fmtTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};
const fmtWhen = (iso) => {
  const d = new Date(iso), now = Date.now(), diff = d.getTime() - now;
  const abs = Math.abs(diff), mins = Math.round(abs / 60000);
  if (mins < 1) return diff < 0 ? "just now" : "any moment";
  if (mins < 60) return diff < 0 ? `${mins}m ago` : `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return diff < 0 ? `${hrs}h ago` : `in ${hrs}h`;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/* ---------------- login ---------------- */
const loginScreen = $("login-screen");
const loginForm = $("login-form");
const loginMsg = $("login-msg");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.className = "login-msg";
  loginMsg.textContent = "Checking…";
  const { status, data } = await api("/login", { body: { password: $("pw").value } });
  if (status === 200) {
    loginMsg.className = "login-msg ok";
    loginMsg.textContent = "✓ " + (data.message || "Connected");
    const name = data.user && data.user.name;
    setTimeout(() => enterApp(name), 550);
  } else {
    loginMsg.className = "login-msg err";
    loginMsg.textContent = data.error || "Wrong password";
    $("pw").select();
  }
});

async function boot() {
  const { status, data } = await api("/api/me");
  if (status === 200 && data.name) enterApp(data.name);
}

let greeted = false;
async function enterApp(name) {
  loginScreen.classList.add("gone");
  $("app").hidden = false;
  if (!name) {
    const me = await api("/api/me");
    name = me.data && me.data.name;
  }
  if (name) {
    $("who").textContent = name;
    if (!greeted) {
      greeted = true;
      bubble("Hello " + name + "! What can I do for you?", "jarvis");
    }
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
logoutConfirm.addEventListener("click", (e) => {
  if (e.target === logoutConfirm) logoutConfirm.hidden = true;
});

/* ---------------- tabs ---------------- */
$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
  const view = btn.dataset.view;
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
});

/* ---------------- clock ---------------- */
const started = Date.now();
function startClock() {
  const tick = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    $("clock").textContent = (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------------- chat ---------------- */
const log = $("log");
let thinkingEl = null;

// Arc-reactor style "J" mark for Jarvis messages.
const JARVIS_MARK =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<circle cx="12" cy="12" r="10" stroke="#57e3ff" stroke-width="1.4" opacity="0.55"/>' +
  '<circle cx="12" cy="12" r="6" stroke="#57e3ff" stroke-width="1.4"/>' +
  '<circle cx="12" cy="12" r="2.3" fill="#57e3ff"/>' +
  '<path d="M12 2.2v3M12 18.8v3M2.2 12h3M18.8 12h3" stroke="#57e3ff" stroke-width="1.4" stroke-linecap="round"/>' +
  "</svg>";

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
  thinkingEl.lastChild.textContent = label || "Thinking…";
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
  showThinking("Thinking…");
  const { status, data } = await api("/api/message", { body: { text } });
  clearThinking();
  if (status === 200) bubble(data.reply, "jarvis");
  else bubble("Error: " + (data.error || status), "err");
  $("send").disabled = false;
  refreshOverview();
});

/* ---------------- live stream (SSE) ---------------- */
let sseOk = false;
let pollOk = false;
function paintLink() {
  // "live" = SSE connected. "connected" = SSE down but polling works (still
  // functional, just no instant updates). "offline" = nothing is reaching us.
  const el = $("link-dot");
  const txt = $("link-text");
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
    // EventSource auto-retries; if it stays broken, reconnect fresh after a bit.
    if (es.readyState === EventSource.CLOSED) {
      setTimeout(connectStream, 5000);
    }
  };
}

/* ---------------- activity feed ---------------- */
const feed = $("feed");
const EVT_ICON = {
  turn_start: "💬", thinking: "…", tool_run: "⚙", tool_held: "⏸", tool_rejected: "⛔",
  reply: "✓", turn_end: "✓", error: "⚠", message_in: "💬", action_run: "⚙",
  action_held: "⏸", action_approved: "✅", action_rejected: "⛔", reminder_sent: "🔔",
};
function eventRow(e) {
  const row = document.createElement("div");
  row.className = "evt k-" + e.kind;
  const when = e.at || e.createdAt;
  row.innerHTML =
    '<div class="ic"></div><div class="body"><div class="t"></div><div class="meta"></div></div>';
  row.querySelector(".ic").textContent = EVT_ICON[e.kind] || "•";
  row.querySelector(".t").textContent = e.text || e.summary || e.kind;
  row.querySelector(".meta").textContent =
    (e.surface ? e.surface + " · " : "") + (when ? fmtTime(when) : "");
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
  $("model").textContent = data.model || "—";
  if (!thinkingEl) setState(data.status);

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
    el.innerHTML = '<div class="card-head"><span class="tier">🔔 reminder</span><span class="when"></span></div><div class="summary"></div>';
    el.querySelector(".when").textContent = fmtWhen(r.deliverAt);
    el.querySelector(".summary").textContent = r.body;
    rl.appendChild(el);
  }

  // recently done (from activity)
  const dl = $("done-list");
  dl.innerHTML = "";
  const done = (data.activity || []).filter((a) =>
    ["action_run", "action_approved", "action_rejected", "reminder_sent"].includes(a.kind)
  ).slice(0, 10);
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

  // seed activity feed once
  if (!feed.dataset.seeded && data.activity) {
    feed.dataset.seeded = "1";
    for (const a of [...data.activity].reverse()) pushEvent(a);
  }
}

function pendingCard(p) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML =
    '<div class="card-head"><span class="tier t' + p.tier + '">tier ' + p.tier + '</span>' +
    '<span class="name" style="font-weight:600;font-size:12.5px"></span>' +
    '<span class="when"></span></div>' +
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

boot();
