/* For Monitoring Website
 * See In http://rtwm.kyrt.my.id/what-is-monitoring-website
 * MIT LICENSE
 * LICENSE Are In https://rtwm.kyrt.my.id/license
*/

import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

app.get("/monitor", async (req, res) => {
  const start = Date.now();
  let latency = 0;
  let statusCode = 0;
  let online = true;
  let cache = "UNKNOWN";
  let bandwidth = 0;

  try {
    const r = await fetch("https://cdn.kyrt.my.id/");
    latency = Date.now() - start;
    statusCode = r.status;
    online = r.ok;

    const text = await r.text();
    bandwidth = new Blob([text]).size;

    const headers = r.headers;

    // PRIORITAS 1 -> AGE
    const age = Number(headers.get("age") || 0);
    if (age > 0) {
      cache = "HIT (age)";
    } else {
      // PRIORITAS 2 — X-CACHE
      const xcache = headers.get("x-cache")?.toLowerCase() || "";
      if (xcache.includes("hit")) cache = "HIT (x-cache)";
      else if (xcache.includes("miss")) cache = "MISS (x-cache)";
      else if (xcache.includes("revalidated")) cache = "REVALIDATED";

      // PRIORITAS 3 — NF fallback
      else {
        const nf = headers.get("x-nf-request-id") || "";
        cache = nf.includes("cache") ? "HIT (nf-id)" : "MISS (nf-id)";
      }
    }

  } catch (err) {
    online = false;
    latency = -1;
    cache = "NONE";
    bandwidth = 0;
  }

  res.json({
    online,
    statusCode,
    latency,
    cache,
    bandwidth,
    timestamp: Date.now(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("RTWM Running on port", PORT);
});
