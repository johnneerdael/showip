# showip

A single Docker container that hosts a sleek dark webpage telling visitors whether
they connected over **IPv4** or **IPv6**, showing their IP and browser, plus a full
download / upload / ping / jitter **speedtest**.

The detection is authoritative and **proxy-proof**: the backend reports the exact
remote address of the socket it actually terminates (`/getIP`) and deliberately
**ignores** forwarding headers (`X-Forwarded-For`, `X-Real-IP`, etc.). The page
classifies that address client-side — no guessing, and no way for an upstream proxy
to make an IPv6 connection look like IPv4.

The backend is a tiny self-contained Go server (standard library only — no external
dependencies, no database, no outbound calls of any kind).

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

The backend implements only what this tool needs:

- `GET /getIP` — returns the socket peer IP as JSON (`{"processedString": "..."}`),
  ignoring forwarding headers.
- `GET /garbage?ckSize=<MiB>` — random data stream for the download test.
- `GET|POST /empty` — drained, empty 200, for the ping and upload tests.
- everything else — static files from `/app/assets`.

There is no telemetry, no database, and no IP-geolocation / `ipinfo.io` lookup of any
kind. The only network traffic is between the visitor's browser and this container.

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

### Behind a reverse proxy / SWG / cloud access layer?

By design the page reports **the connection the server itself terminates**, not what
an upstream proxy claims. If something (nginx, Traefik, Cloudflare, a Secure Web
Gateway, an AWS/NPA access endpoint, etc.) sits in front and re-originates the
connection, the container's real peer is that proxy — so the page shows the proxy's
address and protocol, which is the IP/protocol the server actually sees.

This is intentional: it's why an IPv6-only host now correctly shows **IPv6** even
when the proxy reached *you* over IPv4 and forwarded an `X-Forwarded-For: <your-v4>`
header (which earlier versions wrongly trusted). For an end-to-end view of *your*
client, point showip at a host the client can reach **directly**, without an
intermediary.

### Bridge network alternative (not recommended for detection)

You *can* enable IPv6 on the docker daemon (`/etc/docker/daemon.json`:
`{ "ipv6": true, "ip6tables": true, "fixed-cidr-v6": "fd00::/80" }`, then restart
docker), but NATed IPv6 still masquerades the source to the gateway, so detection
remains unreliable. Host networking is the correct approach for this tool.

## Running on a different port

The backend listens on port 80 by default. Override it (e.g. to run unprivileged)
with the `PORT` environment variable, and map it:

```bash
docker run -d -e PORT=8080 -p 80:8080 showip
```

`ASSETS_PATH` (default `/app/assets`) controls where static files are served from.

## Configuration

The frontend lives in `assets/`. The speedtest measurement client
(`speedtest.js` / `speedtest_worker.js`) is the LibreSpeed client (LGPL-3.0),
vendored into `assets/`. The backend is `server.go` (Go standard library only).

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
# -> {"processedString":"127.0.0.1","rawIspInfo":""}
```
