# showip — Dual-Stack Connection Inspector + Speedtest

**Date:** 2026-05-26
**Status:** Approved design

## Purpose

A single Docker container that hosts a webpage on port 80. When visited, the page
tells the user whether their connection arrived over **IPv4** or **IPv6**, shows the
client IP and parsed User-Agent, and provides a full download/upload/ping/jitter
speedtest. The page uses a sleek dark design with the IPv4/IPv6 status as the hero
element.

## Scope

In scope:
- Authoritative IPv4 vs IPv6 detection of the current connection.
- Display of the client IP and User-Agent (browser/OS + raw string).
- Full speedtest: download, upload, ping, jitter.
- Sleek dark, responsive UI.
- Single self-contained container, no external API calls.

Out of scope:
- Geo/ISP lookup (explicitly dropped — keeps the container self-contained).
- Reverse DNS / PTR lookups.
- Active dual-stack reachability testing (testing both protocols via separate
  hostnames). The page reports only the protocol the request arrived on.
- Host-level IPv6 networking configuration (documented as a prerequisite, not
  performed by the image).

## Architecture

A single container running the **LibreSpeed Go backend** (`librespeed-go`), a single
static binary (~20 MB) listening on port 80. It serves both:

1. **Custom static frontend** — our own `index.html`, CSS, and JS.
2. **Speedtest backend endpoints** implemented natively by the binary:
   - `garbage` — random payload stream for the download test.
   - `empty` — upload sink, also used for ping/jitter.
   - `getIP` — returns the remote address of the incoming TCP connection.

No PHP runtime, no external services.

## Connection-type detection

The frontend calls the `getIP` endpoint. The backend reports the remote address of
the incoming connection. Classification happens client-side:

- Address contains `:` → **IPv6**
- Dotted-quad `a.b.c.d` → **IPv4**
- IPv4-mapped IPv6 (`::ffff:1.2.3.4`) → normalized to the embedded IPv4 and shown
  as **IPv4**.

This is authoritative: it is the address the connection was actually made on, not a
heuristic.

## UI

Dark palette (approx. `#0d1117` background), system font stack, responsive.

- **Hero card:** protocol shown large with a color accent (green/cyan for IPv6,
  amber for IPv4). Client IP beneath it with copy-to-clipboard.
- **Info panel:** parsed User-Agent (browser + OS) plus the raw UA string.
- **Speedtest section:** Start button, animated gauge, and Download / Upload / Ping
  / Jitter readouts driven by LibreSpeed's `speedtest.js` client and
  `speedtest_worker.js`.

## File layout

```
showip/
  Dockerfile            # builds/pulls librespeed-go, installs custom assets
  assets/
    index.html
    style.css
    app.js              # getIP fetch + UA parse + speedtest wiring
    speedtest.js        # LibreSpeed client library
    speedtest_worker.js # LibreSpeed measurement worker
  docker-compose.yml    # optional convenience runner
  README.md             # run instructions + host IPv6 prerequisite
```

(Exact backend asset/config mechanism — flags vs config file vs mounted assets dir —
to be confirmed against current librespeed-go docs during implementation.)

## Deployment prerequisite (documented, not handled by image)

The image is protocol-agnostic; it reports whichever protocol the request arrived
on. For users to reach it over **both** IPv4 and IPv6, the Docker **host** must:

- Have IPv6 enabled (kernel + Docker daemon `ipv6`/`ip6tables` settings, or host
  networking).
- Publish the container on an IPv6 address as well as IPv4.
- Have DNS serving both A and AAAA records for the hostname.

The README will give exact `docker run` / compose flags and call out this host
requirement.

## Testing

1. Build the image.
2. `curl http://<host>/backend/getIP` over IPv4, and over IPv6 if the host has it,
   confirm the returned address and that classification logic maps it correctly.
3. Load the page in a browser; confirm hero shows the right protocol + IP, UA panel
   populates, and a speedtest run completes with all four metrics.
```
