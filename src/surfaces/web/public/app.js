const log = document.getElementById("log");
const loginForm = document.getElementById("login");
const chatForm = document.getElementById("chat");

function add(text, who) {
  const el = document.createElement("div");
  el.className = "msg " + (who === "me" ? "me" : "jarvis");
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = document.getElementById("pw").value;
  const { status } = await post("/login", { password: pw });
  if (status === 200) {
    loginForm.hidden = true;
    chatForm.hidden = false;
    startPolling();
  } else {
    add("Wrong password.", "jarvis");
  }
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("text");
  const text = input.value.trim();
  if (!text) return;
  add(text, "me");
  input.value = "";
  const { status, data } = await post("/api/message", { text });
  add(status === 200 ? data.reply : "Error: " + (data.error || status), "jarvis");
});

function startPolling() {
  setInterval(async () => {
    const r = await fetch("/api/inbox");
    if (!r.ok) return;
    const { items } = await r.json();
    for (const it of items) add(it, "jarvis");
  }, 3000);
}
