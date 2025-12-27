import "dotenv/config";
import express from "express";
import crypto from "crypto";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 8080;

const PROXY_API_KEY = process.env.PROXY_API_KEY || "";
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || "";
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET || "";

// =====================
// CORS
// =====================
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type,X-Proxy-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// =====================
// Auth
// =====================
function checkAuth(req, res) {
  const key = req.header("X-Proxy-Key") || req.query.key;
  if (!PROXY_API_KEY || key !== PROXY_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// =====================
// Utils
// =====================
function hmac(message, secret) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

function getDayRange(dateStr) {
  // Interpret `dateStr` as a date in configured timezone and return
  // UTC epoch ms for start/end of that local day. Default is Malaysia (UTC+8).
  const tzOffsetHours = Number(process.env.TIMEZONE_OFFSET_HOURS ?? 8);
  const sign = tzOffsetHours >= 0 ? "+" : "-";
  const absOffset = Math.abs(tzOffsetHours);
  const hh = String(Math.floor(absOffset)).padStart(2, "0");
  const mm = String(
    Math.round((absOffset - Math.floor(absOffset)) * 60)
  ).padStart(2, "0");
  const offsetStr = `${sign}${hh}:${mm}`;

  const startIso = `${dateStr}T00:00:00${offsetStr}`;
  const endIso = `${dateStr}T23:59:59${offsetStr}`;

  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return { start, end };
}

// =====================
// PRICE (SPOT)
// =====================
app.get("/price", async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const symbol = (req.query.symbol || "BNBUSDT").toUpperCase();
    const r = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(
        symbol
      )}`
    );
    const txt = await r.text();
    const data = JSON.parse(txt);
    if (!r.ok)
      return res.status(r.status).json({ error: "binance_error", data });
    res.json({ type: "spot", symbol, price: Number(data.price) });
  } catch (e) {
    res.status(500).json({ error: "proxy_exception", message: String(e) });
  }
});

// =====================
// PRICE (FUTURES)
// =====================
app.get("/futures-price", async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const symbol = (req.query.symbol || "BNBUSDT").toUpperCase();
    const r = await fetch(
      `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(
        symbol
      )}`
    );
    const txt = await r.text();
    const data = JSON.parse(txt);
    if (!r.ok)
      return res.status(r.status).json({ error: "binance_error", data });
    res.json({ type: "futures", symbol, price: Number(data.price) });
  } catch (e) {
    res.status(500).json({ error: "proxy_exception", message: String(e) });
  }
});

// =====================
// BALANCE (SPOT)
// =====================
app.get("/balance", async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET)
    return res.status(400).json({ error: "missing_binance_keys" });

  try {
    const qs = `recvWindow=5000&timestamp=${Date.now()}`;
    const signature = hmac(qs, BINANCE_API_SECRET);

    const r = await fetch(
      `https://api.binance.com/api/v3/account?${qs}&signature=${signature}`,
      { headers: { "X-MBX-APIKEY": BINANCE_API_KEY } }
    );

    const data = await r.json();
    if (!r.ok)
      return res.status(r.status).json({ error: "binance_error", data });

    const bnb = (data.balances || []).find((b) => b.asset === "BNB") || {
      free: "0",
      locked: "0",
    };
    const free = Number(bnb.free || 0);
    const locked = Number(bnb.locked || 0);

    res.json({ asset: "BNB", free, locked, total: free + locked });
  } catch (e) {
    res.status(500).json({ error: "proxy_exception", message: String(e) });
  }
});

// =====================
// BALANCE (FUTURES)
// =====================
app.get("/futures-balance", async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET)
    return res.status(400).json({ error: "missing_binance_keys" });

  try {
    const qs = `recvWindow=5000&timestamp=${Date.now()}`;
    const signature = hmac(qs, BINANCE_API_SECRET);

    const r = await fetch(
      `https://fapi.binance.com/fapi/v2/balance?${qs}&signature=${signature}`,
      { headers: { "X-MBX-APIKEY": BINANCE_API_KEY } }
    );

    const data = await r.json();
    if (!r.ok)
      return res.status(r.status).json({ error: "binance_error", data });
    res.json({ balances: data });
  } catch (e) {
    res.status(500).json({ error: "proxy_exception", message: String(e) });
  }
});

// =====================
// 🔥 HEDGE VOLUME (NEW)
// =====================
app.get("/hedge-volume", async (req, res) => {
  if (!checkAuth(req, res)) return;
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET)
    return res.status(400).json({ error: "missing_binance_keys" });

  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: "missing_date" });

    const { start, end } = getDayRange(date);

    // -------- SPOT TRADES --------
    const spotQs = `startTime=${start}&endTime=${end}&timestamp=${Date.now()}`;
    const spotSig = hmac(spotQs, BINANCE_API_SECRET);

    const spotResp = await fetch(
      `https://api.binance.com/api/v3/myTrades?${spotQs}&signature=${spotSig}`,
      { headers: { "X-MBX-APIKEY": BINANCE_API_KEY } }
    );

    const spotTrades = await spotResp.json();
    let spotVolume = 0;
    if (Array.isArray(spotTrades)) {
      for (const t of spotTrades) {
        spotVolume += Number(t.quoteQty || 0);
      }
    }

    // -------- FUTURES TRADES --------
    const futQs = `startTime=${start}&endTime=${end}&timestamp=${Date.now()}`;
    const futSig = hmac(futQs, BINANCE_API_SECRET);

    const futResp = await fetch(
      `https://fapi.binance.com/fapi/v1/userTrades?${futQs}&signature=${futSig}`,
      { headers: { "X-MBX-APIKEY": BINANCE_API_KEY } }
    );

    const futTrades = await futResp.json();
    console.log(futTrades);
    let futuresVolume = 0;
    if (Array.isArray(futTrades)) {
      for (const t of futTrades) {
        futuresVolume += Number(t.quoteQty || 0);
      }
    }

    res.json({
      date,
      spotHedgeVolumeUSDT: Number(spotVolume.toFixed(2)),
      futuresHedgeVolumeUSDT: Number(futuresVolume.toFixed(2)),
    });
  } catch (e) {
    res.status(500).json({ error: "proxy_exception", message: String(e) });
  }
});

// =====================
app.get("/", (req, res) => {
  res.json({
    ok: true,
    routes: [
      "/price",
      "/futures-price",
      "/balance",
      "/futures-balance",
      "/hedge-volume?date=YYYY-MM-DD",
    ],
  });
});

app.listen(PORT, () => {
  console.log("BNB fly proxy listening on", PORT);
});

// =====================
// Keep-alive ping (to prevent Render from sleeping)
// Configure the target URL with SELF_PING_URL (recommended). Falls back
// to `http://localhost:${PORT}` when not set. Disable by setting
// KEEP_ALIVE=false.
const KEEP_ALIVE = (process.env.KEEP_ALIVE || "true") !== "false";
const SELF_PING_URL = process.env.SELF_PING_URL || `http://localhost:${PORT}`;
const PING_INTERVAL_MS = Number(process.env.PING_INTERVAL_MS) || 14 * 60 * 1000; // 14 minutes

async function keepAlivePing() {
  if (!KEEP_ALIVE) return;
  try {
    const res = await axios.get(SELF_PING_URL, { timeout: 10_000 });
    console.log(`keepAlive: pinged ${SELF_PING_URL} -> ${res.status}`);
  } catch (err) {
    if (err && err.response) {
      console.warn(
        `keepAlive: ping ${SELF_PING_URL} returned ${err.response.status}`
      );
    } else {
      console.warn(
        `keepAlive: ping ${SELF_PING_URL} failed: ${err.message || err}`
      );
    }
  }
}

// Start immediate ping and then schedule recurring pings every 14 minutes
if (KEEP_ALIVE) {
  // initial ping after a brief delay to allow server to fully start
  setTimeout(keepAlivePing, 5_000);
  setInterval(keepAlivePing, PING_INTERVAL_MS);
}

// const BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;

// try {
//   const res = await axios.get(`${BASE_URL}/hedge-volume`, {
//     params: { date: "2025-12-23" },
//     headers: {
//       Authorization: "Bearer YOUR_TOKEN",
//       "X-Proxy-Key": PROXY_API_KEY || "YOUR_PROXY_KEY",
//     },
//   });

//   console.log(res.data);
// } catch (e) {
//   console.error("Sample request failed:", e.message || e);
// }
