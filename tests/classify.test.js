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
