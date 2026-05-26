# showip — Dual-Stack Connection Inspector + Speedtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single self-contained Docker container that serves a sleek dark webpage on port 80 which tells the visitor whether they connected over IPv4 or IPv6, shows their IP and User-Agent, and runs a full download/upload/ping/jitter speedtest.

**Architecture:** A multi-stage Docker image builds the LibreSpeed Go backend (`librespeed-go`, pinned to v1.1.6) and serves our own custom dark frontend from its `assets_path`. The backend natively provides the speedtest endpoints (`/garbage`, `/empty`) and a `/getIP` endpoint that returns the exact remote address of the incoming connection. The frontend classifies that address as IPv4/IPv6 client-side. The proven `speedtest.js` measurement client and its worker are copied directly out of the pinned backend source, guaranteeing they match the backend.

**Tech Stack:** Go (LibreSpeed backend, built in-image), vanilla HTML/CSS/JS frontend, LibreSpeed `speedtest.js` client, Docker multi-stage build, Node's built-in test runner for the one piece of pure logic (IP classification).

---

## File Structure

```
showip/
  Dockerfile                 # multi-stage: build librespeed-go v1.1.6, assemble custom frontend
  .dockerignore              # keep docs/ and tests/ out of build context
  settings.toml              # backend config: port 80, assets path, telemetry off
  docker-compose.yml         # convenience runner mapping host 80
  assets/                    # our custom frontend (served by the backend)
    index.html               # page structure: hero + UA panel + speedtest section
    style.css                # dark theme
    classify.js              # pure IP -> {protocol, ip} classifier (browser global + Node export)
    app.js                   # getIP fetch, UA parse, render, speedtest wiring
    # speedtest.js + speedtest_worker.js are copied in by the Dockerfile from the backend source
  tests/
    classify.test.js         # node:test unit tests for classify.js
  README.md                  # run instructions + host IPv6 prerequisite
```

**Responsibilities:**
- `classify.js` — the only non-trivial logic; isolated so it can be unit-tested in Node and reused in the browser.
- `app.js` — DOM glue and side effects (fetch, render, speedtest lifecycle). No pure logic that needs testing lives here.
- `settings.toml` / `Dockerfile` / `docker-compose.yml` — packaging and runtime, verified by container smoke tests.

**Port decision:** The container runs the backend on port 80 internally (runs as root, the same model the official nginx image uses). `docker run -p 80:80` exposes it on the host's port 80. The README notes the unprivileged alternative (internal 8989 + `-p 80:8989`) for hardened deployments.

---

## Task 1: IP classifier with unit tests (TDD)

**Files:**
- Create: `assets/classify.js`
- Test: `tests/classify.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/classify.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { classifyIp } = require("../assets/classify.js");

test("plain IPv4 is classified as IPv4", () => {
  assert.deepStrictEqual(classifyIp("203.0.113.7"), { protocol: "IPv4", ip: "203.0.113.7" });
});

test("global IPv6 is classified as IPv6", () => {
  assert.deepStrictEqual(classifyIp("2001:db8::1"), { protocol: "IPv6", ip: "2001:db8::1" });
});

test("IPv6 loopback is classified as IPv6", () => {
  assert.deepStrictEqual(classifyIp("::1"), { protocol: "IPv6", ip: "::1" });
});

test("IPv4-mapped IPv6 is normalized to IPv4", () => {
  assert.deepStrictEqual(classifyIp("::ffff:203.0.113.7"), { protocol: "IPv4", ip: "203.0.113.7" });
});

test("bracketed IPv6 is unwrapped", () => {
  assert.deepStrictEqual(classifyIp("[2001:db8::1]"), { protocol: "IPv6", ip: "2001:db8::1" });
});

test("surrounding whitespace is trimmed", () => {
  assert.deepStrictEqual(classifyIp("  198.51.100.4  "), { protocol: "IPv4", ip: "198.51.100.4" });
});

test("empty or non-string input is unknown", () => {
  assert.deepStrictEqual(classifyIp(""), { protocol: "unknown", ip: "" });
  assert.deepStrictEqual(classifyIp(null), { protocol: "unknown", ip: "" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: FAIL — `Cannot find module '../assets/classify.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `assets/classify.js`:

```js
// Classify a remote address string into { protocol, ip }.
// protocol is "IPv4", "IPv6", or "unknown". ip is the cleaned address.
function classifyIp(raw) {
  if (typeof raw !== "string") return { protocol: "unknown", ip: "" };
  let ip = raw.trim();
  if (ip === "") return { protocol: "unknown", ip: "" };
  // Unwrap a bracketed IPv6 literal: [2001:db8::1] -> 2001:db8::1
  ip = ip.replace(/^\[/, "").replace(/\]$/, "");
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is really an IPv4 connection.
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) return { protocol: "IPv4", ip: mapped[1] };
  if (ip.includes(":")) return { protocol: "IPv6", ip };
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return { protocol: "IPv4", ip };
  return { protocol: "unknown", ip };
}

// Export for Node tests; harmless no-op in the browser (module is undefined there).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { classifyIp };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/`
Expected: PASS — all 7 tests pass (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add assets/classify.js tests/classify.test.js
git commit -m "feat: add IP protocol classifier with tests"
```

---

## Task 2: Backend config (settings.toml)

**Files:**
- Create: `settings.toml`

- [ ] **Step 1: Write the config**

Create `settings.toml`:

```toml
# showip backend config for librespeed-go.
# Bind all interfaces (both IPv4 and IPv6) on port 80.
bind_address=""
listen_port=80
proxyprotocol_port=0
server_lat=0
server_lng=0
ipinfo_api_key=""

# Serve our custom frontend instead of the embedded default UI.
assets_path="/app/assets"

# No telemetry/stats: keeps the container fully self-contained, no DB, no result PNGs.
statistics_password="disabled"
redact_ip_addresses=false
database_type="none"

enable_tls=false
enable_http2=false
```

- [ ] **Step 2: Verify TOML is well-formed**

Run: `python3 -c "import tomllib; tomllib.load(open('settings.toml','rb')); print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add settings.toml
git commit -m "feat: add librespeed-go backend config"
```

---

## Task 3: Frontend markup (index.html)

**Files:**
- Create: `assets/index.html`

- [ ] **Step 1: Write the page**

Create `assets/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>showip — connection inspector</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="wrap">
    <section id="hero" class="hero hero--unknown">
      <div class="hero__label">You are connected over</div>
      <div id="protocol" class="hero__protocol">…</div>
      <button id="ip" class="hero__ip" type="button" title="Click to copy">checking…</button>
      <div id="copied" class="hero__copied" aria-live="polite"></div>
    </section>

    <section class="panel">
      <h2 class="panel__title">Your browser</h2>
      <div class="kv"><span class="kv__k">Browser</span><span id="ua-browser" class="kv__v">—</span></div>
      <div class="kv"><span class="kv__k">OS</span><span id="ua-os" class="kv__v">—</span></div>
      <details class="ua-raw">
        <summary>Raw User-Agent</summary>
        <code id="ua-raw"></code>
      </details>
    </section>

    <section class="panel">
      <h2 class="panel__title">Speedtest</h2>
      <div class="meters">
        <div class="meter"><span class="meter__k">Download</span><span id="dl" class="meter__v">—</span><span class="meter__u">Mbps</span></div>
        <div class="meter"><span class="meter__k">Upload</span><span id="ul" class="meter__v">—</span><span class="meter__u">Mbps</span></div>
        <div class="meter"><span class="meter__k">Ping</span><span id="ping" class="meter__v">—</span><span class="meter__u">ms</span></div>
        <div class="meter"><span class="meter__k">Jitter</span><span id="jitter" class="meter__v">—</span><span class="meter__u">ms</span></div>
      </div>
      <button id="start" class="btn" type="button">Start speedtest</button>
    </section>
  </main>

  <!-- LibreSpeed client (copied in by the Dockerfile from the pinned backend source) -->
  <script src="speedtest.js"></script>
  <script src="classify.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add assets/index.html
git commit -m "feat: add frontend markup"
```

---

## Task 4: Dark theme (style.css)

**Files:**
- Create: `assets/style.css`

- [ ] **Step 1: Write the styles**

Create `assets/style.css`:

```css
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --border: #21262d;
  --text: #e6edf3;
  --muted: #8b949e;
  --v4: #f0a020;   /* amber for IPv4 */
  --v6: #2dd4bf;   /* cyan/green for IPv6 */
  --unknown: #6e7681;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
}

.wrap {
  max-width: 680px;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.hero {
  text-align: center;
  padding: 2.5rem 1.5rem;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--panel);
  transition: border-color .3s, box-shadow .3s;
}
.hero--v4 { border-color: var(--v4); box-shadow: 0 0 40px -12px var(--v4); }
.hero--v6 { border-color: var(--v6); box-shadow: 0 0 40px -12px var(--v6); }

.hero__label { color: var(--muted); text-transform: uppercase; letter-spacing: .12em; font-size: .8rem; }

.hero__protocol {
  font-size: clamp(2.5rem, 12vw, 4.5rem);
  font-weight: 800;
  margin: .25rem 0 .5rem;
  line-height: 1;
}
.hero--v4 .hero__protocol { color: var(--v4); }
.hero--v6 .hero__protocol { color: var(--v6); }
.hero--unknown .hero__protocol { color: var(--unknown); }

.hero__ip {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 1.1rem;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: .4rem .75rem;
  cursor: pointer;
}
.hero__ip:hover { border-color: var(--muted); }
.hero__copied { height: 1.2rem; color: var(--muted); font-size: .85rem; margin-top: .4rem; }

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
}
.panel__title { margin: 0 0 1rem; font-size: 1rem; color: var(--muted); font-weight: 600; }

.kv { display: flex; justify-content: space-between; padding: .35rem 0; border-bottom: 1px solid var(--border); }
.kv:last-of-type { border-bottom: 0; }
.kv__k { color: var(--muted); }
.kv__v { font-weight: 600; }

.ua-raw { margin-top: .75rem; color: var(--muted); }
.ua-raw code { display: block; margin-top: .5rem; word-break: break-all; font-size: .8rem; color: var(--text); }

.meters { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.25rem; }
.meter { display: flex; flex-direction: column; align-items: center; padding: 1rem; background: var(--bg); border-radius: 10px; border: 1px solid var(--border); }
.meter__k { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; }
.meter__v { font-size: 1.8rem; font-weight: 700; margin: .25rem 0; }
.meter__u { color: var(--muted); font-size: .75rem; }

.btn {
  width: 100%;
  padding: .85rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--bg);
  background: var(--text);
  border: 0;
  border-radius: 10px;
  cursor: pointer;
}
.btn:hover { opacity: .9; }
.btn:disabled { opacity: .5; cursor: default; }
```

- [ ] **Step 2: Commit**

```bash
git add assets/style.css
git commit -m "feat: add dark theme styles"
```

---

## Task 5: Frontend logic (app.js)

**Files:**
- Create: `assets/app.js`

Depends on: `classify.js` (Task 1) exposing the global `classifyIp`, `speedtest.js` exposing the global `Speedtest` (provided at container build time), and the element IDs from `index.html` (Task 3).

- [ ] **Step 1: Write the logic**

Create `assets/app.js`:

```js
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
```

- [ ] **Step 2: Sanity-check the file parses as JS**

Run: `node --check assets/app.js`
Expected: no output, exit code 0. (This only checks syntax; `Speedtest`, `fetch`, and `document` are browser globals resolved at runtime.)

- [ ] **Step 3: Commit**

```bash
git add assets/app.js
git commit -m "feat: add frontend logic for IP detection, UA, and speedtest"
```

---

## Task 6: Docker image (Dockerfile + .dockerignore)

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write .dockerignore**

Create `.dockerignore`:

```
docs/
tests/
README.md
docker-compose.yml
.git
```

- [ ] **Step 2: Write the Dockerfile**

Create `Dockerfile`:

```dockerfile
# ---- Build the LibreSpeed Go backend (pinned) ----
FROM golang:1.23-alpine AS build
RUN apk add --no-cache git
ARG SPEEDTEST_GO_REF=v1.1.6
WORKDIR /src
RUN git clone --depth 1 --branch ${SPEEDTEST_GO_REF} https://github.com/librespeed/speedtest-go.git .
ENV CGO_ENABLED=0
RUN go build -ldflags "-w -s" -trimpath -buildvcs=false -o /out/speedtest .

# ---- Runtime image ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/speedtest /app/speedtest
COPY settings.toml /app/settings.toml
COPY assets/ /app/assets/
# Use the speedtest client that matches the pinned backend exactly.
COPY --from=build /src/web/assets/speedtest.js /app/assets/speedtest.js
COPY --from=build /src/web/assets/speedtest_worker.js /app/assets/speedtest_worker.js
EXPOSE 80
CMD ["/app/speedtest"]
```

- [ ] **Step 3: Build the image**

Run: `docker build -t showip:dev .`
Expected: build succeeds, ending with `naming to docker.io/library/showip:dev`.

- [ ] **Step 4: Verify the client files landed in the image**

Run: `docker run --rm --entrypoint ls showip:dev -1 /app/assets`
Expected: output includes `index.html`, `style.css`, `app.js`, `classify.js`, `speedtest.js`, `speedtest_worker.js`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add multi-stage Dockerfile building librespeed-go v1.1.6"
```

---

## Task 7: Compose file, container smoke test, and README

**Files:**
- Create: `docker-compose.yml`
- Create: `README.md`

- [ ] **Step 1: Write docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  showip:
    build: .
    image: showip:dev
    container_name: showip
    ports:
      - "80:80"
    restart: unless-stopped
```

- [ ] **Step 2: Run the container**

Run:
```bash
docker rm -f showip-test 2>/dev/null; docker run -d --name showip-test -p 8080:80 showip:dev
sleep 2
```
Expected: prints a container ID; `sleep` gives the backend time to start. (Host port 8080 is used for the test to avoid needing root on the dev machine; real deployments map 80.)

- [ ] **Step 3: Smoke-test the endpoints**

Run:
```bash
echo "--- index ---"; curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:8080/
echo "--- getIP ---"; curl -fsS http://localhost:8080/getIP
echo "--- assets ---"; curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:8080/speedtest.js
echo "--- garbage (1 chunk) ---"; curl -fsS -o /dev/null -w "%{http_code} %{size_download} bytes\n" "http://localhost:8080/garbage?ckSize=1"
```
Expected:
- index returns `200`
- getIP returns JSON containing `processedString` with an IP (e.g. `{"processedString":"172.17.0.1", ...}`)
- speedtest.js returns `200`
- garbage returns `200` with a non-zero byte count

- [ ] **Step 4: Verify classification end-to-end**

Run:
```bash
IP=$(curl -fsS http://localhost:8080/getIP | python3 -c "import sys,json; print(json.load(sys.stdin)['processedString'])")
echo "server saw: $IP"
node -e "const {classifyIp}=require('./assets/classify.js'); console.log(classifyIp(process.argv[1]));" "$IP"
```
Expected: prints the IP the backend observed and a `{ protocol: 'IPv4'|'IPv6', ip: ... }` object that matches it (over plain localhost/Docker bridge this is typically IPv4).

- [ ] **Step 5: Tear down the test container**

Run: `docker rm -f showip-test`
Expected: prints `showip-test`.

- [ ] **Step 6: Write README.md**

Create `README.md`:

````markdown
# showip

A single Docker container that hosts a sleek dark webpage telling visitors whether
they connected over **IPv4** or **IPv6**, showing their IP and browser, plus a full
download / upload / ping / jitter **speedtest**.

The detection is authoritative: the backend reports the exact remote address of the
incoming connection (`/getIP`), and the page classifies it client-side — no guessing.

## Run

With Docker:

```bash
docker build -t showip .
docker run -d --name showip -p 80:80 showip
```

Or with Compose:

```bash
docker compose up -d --build
```

Then visit `http://<host>/`.

## IPv6 — important host prerequisite

The image is protocol-agnostic: it simply reports whichever protocol a request
arrives on. For visitors to actually reach it over **both** IPv4 and IPv6, the
**Docker host** must provide both:

1. **Enable IPv6 in the Docker daemon** (`/etc/docker/daemon.json`):
   ```json
   { "ipv6": true, "ip6tables": true, "fixed-cidr-v6": "fd00::/80" }
   ```
   then `systemctl restart docker`. (Or run with `--network host` on an
   IPv6-enabled host.)
2. **Publish on an IPv6 address** — `-p 80:80` binds both families on dual-stack
   hosts; verify with `ss -tlnp | grep :80`.
3. **DNS** — the hostname needs both an `A` (IPv4) and `AAAA` (IPv6) record so
   clients can choose either path.

Without host IPv6, the page still works perfectly over IPv4 — it will simply always
report IPv4.

## Running unprivileged

Binding port 80 inside the container needs root. To run the backend as a non-root
user, change `listen_port` in `settings.toml` to `8989` and map it:

```bash
docker run -d -p 80:8989 showip
```

## Configuration

Backend behavior is controlled by `settings.toml` (telemetry is off and no database
is used, keeping the container fully self-contained). The frontend lives in
`assets/`. The speedtest engine (`speedtest.js` / `speedtest_worker.js`) is copied
from the pinned LibreSpeed Go backend (v1.1.6) at build time so client and server
always match.

## Development

Run the IP classifier unit tests without Docker:

```bash
node --test tests/
```
````

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml README.md
git commit -m "feat: add compose file and README with IPv6 host setup"
```

---

## Self-Review Notes

- **Spec coverage:** IPv4/IPv6 detection (Tasks 1, 5) · client IP display + copy (Tasks 3, 5) · User-Agent panel (Tasks 3, 5) · full down/up/ping/jitter speedtest (Tasks 3, 5, backend via Task 6) · sleek dark UI (Tasks 3, 4) · single self-contained container, no external calls (Tasks 2, 6 — `database_type="none"`, `telemetry_level="none"`, no geo) · host IPv6 documented as prerequisite (Task 7 README). All spec sections map to tasks.
- **No external calls:** geo intentionally omitted; the only network the page makes is to its own backend (`getIP`, `garbage`, `empty`).
- **Type consistency:** `classifyIp` returns `{ protocol, ip }` everywhere it is used (Tasks 1 and 5). Element IDs in `index.html` (`hero`, `protocol`, `ip`, `copied`, `ua-browser`, `ua-os`, `ua-raw`, `dl`, `ul`, `ping`, `jitter`, `start`) exactly match those referenced in `app.js`. Speedtest parameter keys (`url_dl`, `url_ul`, `url_ping`, `url_getIp`, `telemetry_level`) and callback fields (`dlStatus`, `ulStatus`, `pingStatus`, `jitterStatus`) match the LibreSpeed client API. Endpoint paths (`getIP`, `garbage`, `empty`) match the backend routes.
```
