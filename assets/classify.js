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
