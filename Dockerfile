# ---- Build the showip backend (stdlib-only, no external Go deps) ----
# Build on the native BUILDPLATFORM and cross-compile to the target arch so
# multi-arch builds never run the Go toolchain under QEMU emulation.
FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY server.go ./
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags "-w -s" -trimpath -o /out/showip .

# ---- Runtime image ----
FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/showip /app/showip
COPY assets/ /app/assets/
EXPOSE 80
CMD ["/app/showip"]
