import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 8080;

const PROXY_API_KEY      = process.env.PROXY_API_KEY || "";
const BINANCE_API_KEY    = process.env.BINANCE_API_KEY || "";
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

function getDayRangeUTC(dateStr) {
  const start = new Date(dateStr + "T00:00:00Z").getTime();
  const end   = new Date(dateStr + "T23:59:59Z").getTime();
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
      `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`
    );
    const txt = await r.text();
    const data = JSON.parse(txt);
    if (!r.ok) return res.status(r.status).json({ error: "binance_error", data });
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
      `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`
    );
    const txt = await r.text();
    const data = JSON.parse(txt);
    if (!r.ok) return res.status(r.status).json({ error: "binance_error", data });
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
    if (!r.ok) return res.status(r.status).json({ error: "binance_error", data });

    const bnb = (data.balances || []).find(b => b.asset === "BNB") || { free: "0", locked: "0" };
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
    if (!r.ok) return res.status(r.status).json({ error: "binance_error", data });
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

    const { start, end } = getDayRangeUTC(date);

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
    let futuresVolume = 0;
    if (Array.isArray(futTrades)) {
      for (const t of futTrades) {
        futuresVolume += Number(t.quoteQty || 0);
      }
    }

    res.json({
      date,
      spotHedgeVolumeUSDT: Number(spotVolume.toFixed(2)),
      futuresHedgeVolumeUSDT: Number(futuresVolume.toFixed(2))
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
      "/hedge-volume?date=YYYY-MM-DD"
    ]
  });
});

app.listen(PORT, () => {
  console.log("BNB fly proxy listening on", PORT);
});



