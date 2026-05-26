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
docker run -d --name showip -p 80:80 ghcr.io/johnneerdael/showip:latest
```

Or with Compose (pulls the published image, no local build):

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

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

## IPv6 — use host networking (important)

**If the page only ever reports IPv4, this is why.** With Docker's default bridge
network and published ports (`-p 80:80`), `docker-proxy` NATs every incoming
connection. The container then sees the connection coming from the IPv4 docker
gateway — so even genuine IPv6 visitors are reported as IPv4, and IPv6 clients may
not reach the port at all. The original protocol is destroyed at the NAT layer.

The fix is **host networking** (Linux only), which lets the backend bind the host's
real interfaces (`0.0.0.0:80` and `[::]:80`) and see the true client address:

```bash
docker run -d --name showip --network host ghcr.io/johnneerdael/showip:latest
```

or with the provided compose file:

```bash
docker compose -f docker-compose.host.yml up -d
```

The host still needs to actually have IPv6:

1. **A routable IPv6 address** on the host and a firewall that allows tcp/80.
2. **DNS** — the hostname needs both an `A` (IPv4) and `AAAA` (IPv6) record so
   clients can choose either path.

Verify the host is listening on both families: `ss -tlnp | grep ':80'` should show
both a `0.0.0.0:80` and a `[::]:80` (or `*:80`) line.

### Behind a reverse proxy?

If a proxy (nginx, Traefik, Caddy, Cloudflare) terminates the connection, the
container sees the *proxy's* IP. The backend already honours forwarding headers in
this order: `CF-Connecting-IPv6`, `Client-IP`, `X-Real-IP`, `X-Forwarded-For`.
Make sure your proxy sets one of these to the real client address, e.g. for nginx:
`proxy_set_header X-Real-IP $remote_addr;` (and connect to the backend over the same
protocol the client used).

### Bridge network alternative (not recommended for detection)

You *can* enable IPv6 on the docker daemon (`/etc/docker/daemon.json`:
`{ "ipv6": true, "ip6tables": true, "fixed-cidr-v6": "fd00::/80" }`, then restart
docker), but NATed IPv6 still masquerades the source to the gateway, so detection
remains unreliable. Host networking is the correct approach for this tool.

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
