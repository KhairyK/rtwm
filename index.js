/**
 * RTWM - index.js
 * RTWM - Real Time Website Monitoring (Express)
 * MIT License
 *
 * Features:
 *  - /monitor           -> checks target URL (default: process.env.TARGET_URL or https://cdn.kyrt.my.id/)
 *  - /origin-uptime     -> returns this process uptime (useful as origin uptime endpoint)
 *  - configurable via env / query params
 *
 */

import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { URL } from "url";

const app = express();
app.use(cors());

// Config (env override)
const DEFAULT_TARGET = process.env.TARGET_URL || "https://cdn.kyrt.my.id/";
const DEFAULT_ORIGIN_UPTIME_ENDPOINT = process.env.ORIGIN_UPTIME_ENDPOINT || "https://m.kyrt.my.id/origin-uptime";
const FETCH_TIMEOUT_MS = +(process.env.FETCH_TIMEOUT_MS || 8000);

// helper: format uptime in human form "1h 12m 10s"
function formatUptimeSeconds(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0s";
  const s = Math.floor(sec);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (mins || hours) parts.push(`${mins}m`); // show minutes if hours exist (or mins > 0)
  parts.push(`${secs}s`);
  return parts.join(" ");
}

// helper: compute bytes length safely
function bytesLengthFromString(str) {
  if (typeof str !== "string") return 0;
  return Buffer.byteLength(str, "utf8");
}

// helper: timeout wrapper for fetch using AbortController
async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Root info
app.get("/", (req, res) => {
  res.json({
    name: "RTWM - Real Time Website Monitoring",
    docs: "https://rtwm.kyrt.my.id/what-is-monitoring-website",
    endpoints: {
      monitor: "/monitor",
      originUptime: "/origin-uptime"
    },
    notes: "Use /monitor?target=... to override target (full URL). Use ?originUptime=... to override origin-uptime endpoint.",
    defaults: {
      target: DEFAULT_TARGET,
      originUptimeEndpoint: DEFAULT_ORIGIN_UPTIME_ENDPOINT
    }
  });
});

// origin uptime endpoint for this server (so other monitors can query origin uptime)
app.get("/origin-uptime", (req, res) => {
  const up = process.uptime();
  res.json({
    uptime: up,
    uptimeFormatted: formatUptimeSeconds(up),
    timestamp: Date.now()
  });
});

// Monitor endpoint
app.get("/monitor", async (req, res) => {
  const target = (req.query.target && String(req.query.target)) || DEFAULT_TARGET;
  const originUptimeOverride = (req.query.originUptime && String(req.query.originUptime)) || (req.query.origin_uptime && String(req.query.origin_uptime));
  const originUptimeEndpoint = originUptimeOverride || DEFAULT_ORIGIN_UPTIME_ENDPOINT;

  const out = {
    target,
    online: false,
    statusCode: 0,
    latency: -1,
    cache: "UNKNOWN",
    cacheReason: null,
    bandwidth: 0,
    uptime: process.uptime(),
    uptimeFormatted: formatUptimeSeconds(process.uptime()),
    originUptime: null,
    originUptimeFormatted: null,
    timestamp: Date.now()
  };

  // measure latency + fetch
  const start = Date.now();
  try {
    const r = await fetchWithTimeout(target, { method: "GET", redirect: "follow", cache: "no-store" }, FETCH_TIMEOUT_MS);
    out.latency = Date.now() - start;
    out.statusCode = r.status;
    out.online = !!r.ok;

    // compute bandwidth from body text length (bytes)
    const text = await r.text().catch(() => "");
    out.bandwidth = bytesLengthFromString(text);

    // headers analysis (cache detection priority)
    const headers = r.headers;

    // 1) age header
    const ageHeader = headers.get("age");
    const age = ageHeader ? Number(ageHeader) : 0;
    if (!Number.isFinite(age)) {
      // ignore
    }

    if (age > 0) {
      out.cache = "HIT";
      out.cacheReason = `age:${age}`;
    } else {
      // 2) check common cache headers (x-cache, cf-cache-status, x-nf-request-id)
      const xcache = headers.get("x-cache") || headers.get("x-cache-hits") || "";
      const cfCache = headers.get("cf-cache-status") || "";
      const xNf = headers.get("x-nf-request-id") || "";

      const xcLower = (xcache || "").toLowerCase();
      const cfLower = (cfCache || "").toLowerCase();
      const nfLower = (xNf || "").toLowerCase();

      if (cfLower.includes("hit") || xcLower.includes("hit")) {
        out.cache = "HIT";
        out.cacheReason = cfLower ? `cf:${cfCache}` : `x-cache:${xcache}`;
      } else if (cfLower.includes("revalidated") || xcLower.includes("revalidated") || xcLower.includes("stale-while-revalidate") || xcLower.includes("revalidate")) {
        out.cache = "REVALIDATED";
        out.cacheReason = cfLower ? `cf:${cfCache}` : `x-cache:${xcache}`;
      } else if (cfLower.includes("miss") || xcLower.includes("miss")) {
        out.cache = "MISS";
        out.cacheReason = cfLower ? `cf:${cfCache}` : `x-cache:${xcache}`;
      } else {
        // fallback to nf header heuristic
        if (nfLower.includes("cache") || nfLower.includes("hit")) {
          out.cache = "HIT";
          out.cacheReason = `x-nf-request-id:${xNf}`;
        } else {
          out.cache = "UNKNOWN";
          out.cacheReason = `x-nf-request-id:${xNf || "none"}`;
        }
      }
    }
  } catch (err) {
    // network / timeout / fetch error
    out.online = false;
    out.latency = -1;
    out.statusCode = 0;
    out.cache = "NONE";
    out.cacheReason = `fetch-error:${err && err.name ? err.name : "error"}`;
    out.bandwidth = 0;
  }

  // Try to fetch origin uptime (optional) - tolerant to fail
  try {
    const uRes = await fetchWithTimeout(originUptimeEndpoint, { method: "GET", redirect: "follow", cache: "no-store" }, FETCH_TIMEOUT_MS);
    if (uRes.ok) {
      const uj = await uRes.json().catch(() => null);
      if (uj && uj.uptime != null) {
        out.originUptime = Number(uj.uptime);
        if (Number.isFinite(out.originUptime)) {
          out.originUptimeFormatted = formatUptimeSeconds(out.originUptime);
        }
      } else if (typeof uj === "number") {
        out.originUptime = uj;
        out.originUptimeFormatted = formatUptimeSeconds(uj);
      } else {
        // If origin-uptime returns not JSON or missing field, ignore
      }
    } else {
      // Not ok: still include status
      out.originUptime = null;
      out.originUptimeFormatted = `unavailable (status ${uRes.status})`;
    }
  } catch (e) {
    // ignore errors; mark as unavailable
    out.originUptime = null;
    out.originUptimeFormatted = "unavailable";
  }

  // Attach human-friendly formatted uptime for this RTWM process
  out.uptimeFormatted = formatUptimeSeconds(out.uptime);

  res.json(out);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RTWM Running on port ${PORT}`);
});
