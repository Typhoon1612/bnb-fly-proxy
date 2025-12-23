# BNB Fly Proxy (Spot & Futures Price)

Endpoints:
- /price?symbol=BNBUSDT
- /futures-price?symbol=BNBUSDT

Auth:
- Header: X-Proxy-Key: <your-secret>
- or query: ?key=<your-secret>

Deploy on Fly.io:
1) Install flyctl (Windows MSI installer) and login.
2) In this folder:
   fly launch --name bnb-fly-<yourname> --region sin --no-deploy
   fly secrets set PROXY_API_KEY=<your-strong-secret>
   fly deploy

Then test:
https://<your-app>.fly.dev/price?symbol=BNBUSDT&key=<your-strong-secret>
