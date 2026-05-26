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

### Pull the prebuilt image from GHCR

Published automatically by CI (see below):

```bash
docker run -d --name showip -p 80:80 ghcr.io/<owner>/showip:latest
```

Replace `<owner>` with the GitHub user/org the repo lives under.

## Self-contained — no external calls

The container makes **no outbound network calls**:

- Telemetry and the stats database are disabled (`telemetry_level=none`,
  `database_type="none"`) — no result PNGs, no stored data.
- `server_lat`/`server_lng` are set non-zero in `settings.toml` so the backend does
  **not** phone `ipinfo.io` at startup to geolocate itself.
- The frontend disables the speedtest client's ISP/geo enrichment
  (`getIp_ispInfo=false`), so the `/getIP` request never triggers an `ipinfo.io`
  lookup either.

The only network traffic is between the visitor's browser and this container.

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

Backend behavior is controlled by `settings.toml`. The frontend lives in `assets/`.
The speedtest engine (`speedtest.js` / `speedtest_worker.js`) is copied from the
pinned LibreSpeed Go backend (v1.1.6) at build time so client and server always
match.

## Development

Run the IP classifier unit tests without Docker:

```bash
node --test tests/classify.test.js
```

## Troubleshooting

**On Docker Desktop for macOS/Windows the page shows a wrong/unexpected IP.**
Docker Desktop runs containers inside a Linux VM and NATs published-port traffic, so
the container sees a gateway/proxy address rather than your real client IP — the
reported protocol may also be skewed to IPv4. This is a Docker Desktop networking
artifact, not a bug in showip. On a native Linux host (`-p 80:80`) the container
sees the true client address. You can confirm the detection mechanism locally with:

```bash
docker exec <container> wget -qO- http://127.0.0.1/getIP
# -> {"processedString":"127.0.0.1 - localhost IPv4 access", ...}
```
