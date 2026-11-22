# CanteenQ (with backend)

Canteen crowd management for colleges and offices.

- **Customers** (students, office workers) log in, see the menu, add items to a cart, pay by QR code, get an order confirmation with a token number, and are notified when the order is ready.
- **Canteen staff** log in to a counter screen, accept orders, press Done when food is ready (the customer is notified at once), and switch menu items on or off when they run out.
- The home screen shows live crowd info: "Quiet / Busy / Rush hour" and an estimated wait, worked out from the orders being prepared.

The backend is a plain Node.js server with **no npm packages to install**.

## Quick start

You need Node.js 18 or newer (https://nodejs.org).

```
cd canteenq-fullstack
node server.js
```

Then open:

- Customers: http://localhost:3000
- Counter (staff): http://localhost:3000/counter

The default counter passcode is `1234`. To try it on phones, put them on the same Wi-Fi and open `http://<your-computer-ip>:3000`. (System notifications on phones need HTTPS, see Deploying. The in-app alerts work either way.)

Run the automatic checks with `npm test`.

## Try the full flow

1. Open the customer page, log in with any name, a 10-digit mobile number starting 6 to 9, and an ID such as `22CS104`.
2. Add items, open the cart, press Pay. A QR code appears.
3. In the default demo mode, press **I have paid**.
4. Open the counter page in another tab or phone, log in with the passcode. The new order appears with a beep.
5. Press **Accept**, then **Done**. The customer screen shows a "ready" alert straight away.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `STAFF_PASS` | `1234` | Counter passcode. **Change this before real use.** |
| `UPI_ID` | `canteen@upi` | Your canteen's UPI ID, used to build the payment QR |
| `PAYMENT_MODE` | `demo` | `demo`: the "I have paid" button confirms payment. `live`: payment is confirmed only by the webhook below |
| `WEBHOOK_SECRET` | empty | Secret for the payment webhook. The webhook is off when empty |
| `DATA_FILE` | `data/db.json` | Where orders, users and menu stock are saved |

Example: `STAFF_PASS=meal4all UPI_ID=mycanteen@okbank PORT=8080 node server.js`

To change menu items or prices, edit `DEFAULT_MENU` at the top of `server.js`. Delete `data/db.json` to reset all saved data (the saved menu replaces `DEFAULT_MENU` once the file exists).

## Taking real payments

A UPI QR code alone cannot tell your server that money arrived, so a button must never be trusted in real use. For real payments:

1. Set up a payment gateway account (for example Razorpay or Cashfree) and create a payment for each order.
2. Set `PAYMENT_MODE=live` and a long random `WEBHOOK_SECRET`.
3. Have the gateway (or a small bridge you write) call `POST /api/payments/webhook` with header `x-webhook-secret` and body `{"orderId": 103, "amount": 130}` when a payment succeeds. The server checks the amount matches the order, marks it paid, and the customer and counter screens update by themselves.
4. In production, also verify the gateway's own signature in that handler (marked with a comment in `server.js`).

I have not connected any specific gateway, since that needs your own account and keys.

## Project structure

```
canteenq-fullstack/
├── server.js          Server: API, live updates, saving, static files
├── package.json       Scripts only, no dependencies
├── public/
│   ├── index.html     Customer page
│   ├── counter.html   Counter (staff) page
│   ├── common.js      Shared helpers: API calls, QR, toasts, login form
│   ├── customer.js    Customer app logic
│   ├── counter.js     Counter app logic
│   └── styles.css     Styling (light and dark)
├── test/smoke.js      Automatic API test (npm test)
├── data/              Saved data appears here (db.json)
└── README.md
```

## API

All routes are under `/api`. Logged-in routes use the header `Authorization: Bearer <token>`.

| Route | Who | What |
|---|---|---|
| `POST /login` | anyone | Customer or staff login, returns a token |
| `POST /logout`, `GET /me` | logged in | End session, current user |
| `GET /state` | logged in | Menu, crowd info, and your orders (customers) or active orders (staff) |
| `GET /events?token=` | logged in | Live updates (Server-Sent Events) |
| `POST /orders` | customer | Create an order. The server works out the total from its own prices |
| `POST /orders/:id/pay` | customer | Demo-mode payment confirmation |
| `POST /orders/:id/cancel` | customer | Cancel an unpaid order |
| `PATCH /orders/:id/status` | staff | `preparing`, then `ready`, then `collected` |
| `PATCH /menu/:id` | staff | `{"on": true or false}` to mark an item in or out of stock |
| `POST /payments/webhook` | payment provider | Confirm payment (needs `WEBHOOK_SECRET`) |

Unpaid orders expire after 15 minutes. Logins last 7 days.

## Deploying

Any host that runs Node.js works (Render, Railway, a VPS, or a spare PC at the canteen). Set the environment variables above and start with `node server.js`. Use HTTPS (hosts like Render give you this) so phones allow system notifications.

Limits of this version, so you can plan:

- **One server only.** Data is saved in a JSON file and live updates are held in memory, so do not run several copies. Use a host with a persistent disk, or move storage to a real database (PostgreSQL, SQLite) if you grow.
- **No SMS or push when the page is closed.** The "ready" alert is shown when the customer's page is open (with a system notification if they allowed it). Reaching closed phones needs a push service or SMS provider.
- **Simple accounts.** Customers are identified by mobile number with no OTP check, so anyone could type another person's number. For real use, add OTP verification by SMS.
- **The QR code image and fonts load from the internet** (a CDN). To run fully offline, save `qrcode.min.js` into `public/` and update the `<script>` tag in `index.html`.

## What was tested

`npm test` starts the server and checks login rules, passcode rate limiting, order totals computed by the server, the payment and webhook steps, status changes, live notifications, privacy between customers, menu stock, saving to disk, and blocked file paths (18 checks, all passing when this was packaged).

The web pages were syntax-checked but not opened in a browser by me, so run through the flow once and tell me if anything looks off.
