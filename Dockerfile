# ---- Build the LibreSpeed Go backend (pinned) ----
# Pin the build stage to the native BUILDPLATFORM and cross-compile to the target.
# Without this, multi-arch builds run the Go toolchain under QEMU emulation, which
# makes downloading/compiling heavy deps (e.g. modernc sqlite -> bigfft) painfully
# slow. CGO is disabled, so cross-compilation is native-speed and needs no emulation.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
RUN apk add --no-cache git
ARG SPEEDTEST_GO_REF=v1.1.6
WORKDIR /src
RUN git clone --depth 1 --branch ${SPEEDTEST_GO_REF} https://github.com/librespeed/speedtest-go.git .
ENV CGO_ENABLED=0
ARG TARGETOS TARGETARCH
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags "-w -s" -trimpath -buildvcs=false -o /out/speedtest .

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
