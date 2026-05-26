// showip — a tiny self-contained backend for the dual-stack connection inspector.
//
// It reports the protocol/IP of the connection THIS server actually terminates
// (the socket peer), deliberately ignoring X-Forwarded-For / X-Real-IP / etc., so
// that behind a proxy it shows the real connection to the server rather than the
// proxy's view of the client. It also implements the LibreSpeed speedtest backend
// endpoints (garbage/empty) so the bundled speedtest.js client works unchanged.
package main

import (
	"crypto/rand"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
)

func main() {
	port := getenv("PORT", "80")
	assets := getenv("ASSETS_PATH", "/app/assets")

	mux := http.NewServeMux()
	for _, p := range []string{"/getIP", "/backend/getIP", "/getIP.php", "/backend/getIP.php"} {
		mux.HandleFunc(p, getIP)
	}
	for _, p := range []string{"/garbage", "/backend/garbage", "/garbage.php", "/backend/garbage.php"} {
		mux.HandleFunc(p, garbage)
	}
	for _, p := range []string{"/empty", "/backend/empty", "/empty.php", "/backend/empty.php"} {
		mux.HandleFunc(p, empty)
	}
	mux.Handle("/", http.FileServer(http.Dir(assets)))

	log.Printf("showip listening on :%s, serving assets from %s", port, assets)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// peerIP returns the IP of the socket peer, normalizing IPv4-mapped IPv6.
// It intentionally does NOT consult forwarding headers.
func peerIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return strings.TrimPrefix(host, "::ffff:")
}

// getIP returns the peer IP as JSON, matching the shape the LibreSpeed client
// expects (data.processedString). No ISP/geo enrichment — fully offline.
func getIP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"processedString": peerIP(r),
		"rawIspInfo":      "",
	})
}

// garbage streams ckSize MiB of random data for the download test.
func garbage(w http.ResponseWriter, r *http.Request) {
	ck := 4
	if v := r.URL.Query().Get("ckSize"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			ck = n
		}
	}
	if ck < 1 {
		ck = 1
	}
	if ck > 1024 {
		ck = 1024
	}

	// One random 1 MiB block, repeated — same approach as LibreSpeed's garbage.php.
	block := make([]byte, 1024*1024)
	if _, err := rand.Read(block); err != nil {
		http.Error(w, "rand failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Description", "File Transfer")
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=random.dat")
	w.Header().Set("Content-Transfer-Encoding", "binary")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")

	for i := 0; i < ck; i++ {
		if _, err := w.Write(block); err != nil {
			return // client aborted (expected when the timed test ends)
		}
	}
}

// empty drains the request body and returns an empty 200. Used for both the
// upload test (POST) and the ping/jitter test (GET).
func empty(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, r.Body)
	_ = r.Body.Close()
	w.Header().Set("Content-Length", "0")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.WriteHeader(http.StatusOK)
}
