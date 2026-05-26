// ---- Hero: detect and render IPv4 vs IPv6 ----
function renderConnection(rawIp) {
  const { protocol, ip } = classifyIp(rawIp);
  const hero = document.getElementById("hero");
  const protoEl = document.getElementById("protocol");
  const ipEl = document.getElementById("ip");

  hero.classList.remove("hero--v4", "hero--v6", "hero--unknown");
  if (protocol === "IPv4") { hero.classList.add("hero--v4"); protoEl.textContent = "IPv4"; }
  else if (protocol === "IPv6") { hero.classList.add("hero--v6"); protoEl.textContent = "IPv6"; }
  else { hero.classList.add("hero--unknown"); protoEl.textContent = "Unknown"; }

  ipEl.textContent = ip || "unavailable";
  ipEl.dataset.ip = ip || "";
}

function loadIp() {
  fetch("getIP", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => renderConnection(data.processedString || ""))
    .catch(() => renderConnection(""));
}

// Copy IP to clipboard on click.
function wireCopy() {
  const ipEl = document.getElementById("ip");
  const copied = document.getElementById("copied");
  ipEl.addEventListener("click", () => {
    const ip = ipEl.dataset.ip;
    if (!ip) return;
    navigator.clipboard.writeText(ip).then(() => {
      copied.textContent = "Copied!";
      setTimeout(() => { copied.textContent = ""; }, 1500);
    });
  });
}

// ---- User-Agent panel ----
function parseUA(ua) {
  let browser = "Unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "Unknown OS";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return { browser, os };
}

function renderUA() {
  const ua = navigator.userAgent;
  const { browser, os } = parseUA(ua);
  document.getElementById("ua-browser").textContent = browser;
  document.getElementById("ua-os").textContent = os;
  document.getElementById("ua-raw").textContent = ua;
}

// ---- Speedtest ----
function fmt(v) {
  if (v === undefined || v === null || v === "" || v === "Fail") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function wireSpeedtest() {
  const startBtn = document.getElementById("start");
  const s = new Speedtest();
  s.setParameter("url_dl", "garbage");
  s.setParameter("url_ul", "empty");
  s.setParameter("url_ping", "empty");
  s.setParameter("url_getIp", "getIP");
  s.setParameter("telemetry_level", "none");

  s.onupdate = (data) => {
    document.getElementById("dl").textContent = fmt(data.dlStatus);
    document.getElementById("ul").textContent = fmt(data.ulStatus);
    document.getElementById("ping").textContent = fmt(data.pingStatus);
    document.getElementById("jitter").textContent = fmt(data.jitterStatus);
  };
  s.onend = () => {
    startBtn.disabled = false;
    startBtn.textContent = "Run again";
  };

  startBtn.addEventListener("click", () => {
    startBtn.disabled = true;
    startBtn.textContent = "Testing…";
    ["dl", "ul", "ping", "jitter"].forEach((id) => { document.getElementById(id).textContent = "…"; });
    s.start();
  });
}

// ---- Boot ----
window.addEventListener("DOMContentLoaded", () => {
  loadIp();
  wireCopy();
  renderUA();
  wireSpeedtest();
});
