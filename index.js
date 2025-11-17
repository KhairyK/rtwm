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
  let cache = "unknown";
  let bandwidth = 0;
  let online = true;
  let statusCode = 0;

  try {
    const r = await fetch("https://cdn.kyrt.my.id/");
    latency = Date.now() - start;
    statusCode = r.status;
    online = r.ok;
    cache = r.headers.get("x-nf-request-id")?.includes("cache") ? "HIT" : "MISS";

    const text = await r.text();
    bandwidth = new Blob([text]).size;
  } catch (err) {
    online = false;
    latency = -1;
    cache = "none";
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

// Render Wajib PORT dari environment
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("RTWM Running on port", PORT);
});
