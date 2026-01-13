# BNB Proxy (Spot & Futures Price)

Endpoints:
- /price?symbol=BNBUSDT
- /futures-price?symbol=BNBUSDT

Auth:
- Header: X-Proxy-Key: <your-secret>
- or query: ?key=<your-secret>

Deploy on Render:
1) Push this repo to GitHub/GitLab
2) Go to https://render.com and connect your repository
3) Render will auto-detect the render.yaml file
4) Set the required environment variables in the Render dashboard:
   - PROXY_API_KEY=<your-strong-secret>
   - BINANCE_API_KEY=<optional>
   - BINANCE_API_SECRET=<optional>
5) Deploy!

Then test:
https://bnb-fly-proxy.onrender.com/price?symbol=BNBUSDT&key=<your-strong-secret>

To run locally:
1) Set environment variables:
   - PROXY_API_KEY=<your-strong-secret>
   - BINANCE_API_KEY=<optional>
   - BINANCE_API_SECRET=<optional>
2) Install dependencies: npm install
3) Start server: npm start

Then test:
http://localhost:8080/price?symbol=BNBUSDT&key=<your-strong-secret>
