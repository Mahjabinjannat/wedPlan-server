<div align="center">

# 💍 WedPlan — Server (REST API)

**The secure Express.js API behind WedPlan, the wedding planning platform.**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![Stripe](https://img.shields.io/badge/Stripe-Checkout-635BFF?logo=stripe&logoColor=white)](https://stripe.com)
[![JWT](https://img.shields.io/badge/Auth-JWT_(jose)-8c2338)](https://github.com/panva/jose)

[🌐 Live Website](#-live-links) · [💻 Client Repository](#-live-links) · [🚀 Run Locally](#-run-locally)

</div>

---

## 📖 About

**WedPlan** is a role-based wedding marketplace where couples book wedding services, vendors publish and manage their services, and admins keep the platform safe.

This repository is the **Express.js server**. It provides:

- 🔎 Public service listing with search, filters and sorting
- 🔐 **JWT-protected** routes with role-based access for vendors, admins and customers
- 💳 **Stripe Checkout** and **webhook** handling for the Premium vendor plan

The Next.js frontend lives in a separate **client** repository.

---

## 🔗 Live Links

| | Link |
|---|---|
| 🌐 **Live Website** | _https://your-client-url.vercel.app_ |
| 🖥️ **Live API** | _https://your-server-url.vercel.app_ |
| 💻 **Client Repository** | https://github.com/Mahjabinjannat/wedPlan-client |
| 🖥️ **Server Repository** | https://github.com/Mahjabinjannat/wedPlan-server |

---

## 📑 Table of Contents

- [About](#-about)
- [Live Links](#-live-links)
- [Key Features](#-key-features)
- [Technology Stack](#-technology-stack)
- [API Reference](#-api-reference)
- [How Authentication Works](#-how-authentication-works)
- [Run Locally](#-run-locally)
- [Environment Variables](#-environment-variables)
- [Stripe Webhooks](#-stripe-webhooks)
- [Create an Admin](#-create-an-admin)
- [Database Collections](#-database-collections)

---

## ✨ Key Features

- 🔎 **Advanced search** across service name, description, category, location and vendor
- 🗂️ **Filters & sorting** — category, location, newest, price low → high, price high → low
- 👁️ **Public visibility rules** — only *approved* and *available* services are public; Free vendors show at most 3
- 🔐 **JWT verification middleware** — tokens signed by Better Auth, verified with `jose`; invalid or expired tokens → `401`
- 👥 **Role middlewares** — `verifyCustomer`, `verifyVendor`, `verifyAdmin` → `403` when not allowed
- 🧾 **Ownership checks** — vendors can only change their own services
- ✅ **Server-side validation** with Zod
- 📦 **Free plan limit** — max 3 active services, enforced on the server
- 💎 **Premium plan** via Stripe Checkout — activated **only** by a verified webhook
- 🧾 **Read-only transactions** — no route can edit payment records

---

## 🛠️ Technology Stack

| Area | Technology |
|---|---|
| Runtime | **Node.js** (ES modules) |
| Framework | **Express.js 5** |
| Database | **MongoDB** (native driver) |
| Authentication | **JWT** verification with **jose** (keys published by Better Auth) |
| Payments | **Stripe** Checkout + Webhooks |
| Validation | **Zod** |
| Utilities | `cors`, `dotenv`, `nodemon` (development) |

---

## 📡 API Reference

Protected routes need the header:

```
Authorization: Bearer <JWT>
```

### Public

| Method | Route | Description |
|---|---|---|
| `GET` | `/services` | List public services. Query: `search`, `category`, `location`, `sort` (`newest`, `price_asc`, `price_desc`), `limit` |
| `GET` | `/services/:id` | Service details (approved & available only) |

### Vendor 🏪

| Method | Route | Description |
|---|---|---|
| `POST` | `/vendor/services` | Create a service (status **pending** until approved) |
| `PATCH` | `/vendor/services/:id` | Update own service (goes back to **pending** for review) |
| `PATCH` | `/vendor/services/:id/availability` | Show or hide own service |
| `DELETE` | `/vendor/services/:id` | Delete own service |
| `POST` | `/payments/create-checkout-session` | Start Stripe Checkout for Premium |

### Admin 🛡️

| Method | Route | Description |
|---|---|---|
| `PATCH` | `/admin/users/:id/block` | Block or unblock a user |
| `PATCH` | `/admin/services/:id/status` | Approve, reject or move a service to pending |
| `DELETE` | `/admin/services/:id` | Delete an inappropriate service |

### Customer & Vendor 👤

| Method | Route | Description |
|---|---|---|
| `PATCH` | `/profile` | Update name, photo and business name (role & plan cannot be changed) |

### Stripe

| Method | Route | Description |
|---|---|---|
| `POST` | `/webhook` | Stripe webhook (signature verified) — activates Premium |

### Status codes

| Code | Meaning |
|---|---|
| `400` | Invalid request data |
| `401` | Missing, invalid or expired token |
| `403` | Wrong role, blocked account, or plan limit reached |
| `404` | Resource not found (or not yours) |
| `500` | Server error |

---

## 🔐 How Authentication Works

```
1. User signs in on the client        → Better Auth creates a session
2. Client asks Better Auth for a JWT  → short-lived token (signed with Better Auth's private key)
3. Client calls the API               → Authorization: Bearer <JWT>
4. verifyToken                         → checks the signature with Better Auth's public keys
                                         (CLIENT_URL/api/auth/jwks)
                                       → loads the user from MongoDB (blocked users → 403)
5. verifyVendor / verifyAdmin / ...   → checks the role (wrong role → 403)
6. Route                               → uses the user id from the token, never from the request
```

---

## 🚀 Run Locally

### Prerequisites
- **Node.js 20+** and npm
- A **MongoDB** connection string
- A **Stripe** account (test mode) and the **Stripe CLI** for local webhooks
- The **WedPlan client** (it provides login and the JWT public keys)

### 1. Clone and install

```bash
git clone https://github.com/Mahjabinjannat/wedPlan-server.git
cd wedPlan-server
npm install
```

### 2. Add environment variables

```bash
cp .env.example .env
```

Fill in the values — see [Environment Variables](#-environment-variables).

### 3. Start the server

```bash
npm run dev     # development (auto-restart with nodemon)
npm start       # production
```

The API runs on **http://localhost:8000**. Visit it to see `WedPlan server is running!`

---

## 🔑 Environment Variables

Create a `.env` file in the project root (never commit it):

| Variable | Description | Example |
|---|---|---|
| `PORT` | Server port | `8000` |
| `NODE_ENV` | Environment | `development` / `production` |
| `CLIENT_URL` | URL of the Next.js client — used for **CORS**, **Stripe redirects** and the **JWT public keys** | `http://localhost:3000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://...` |
| `DB_NAME` | Database name | `wedplanDB` |
| `STRIPE_SECRET_KEY` | Stripe **test** secret key | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |

> ⚠️ `CLIENT_URL` must match the client address exactly — `https://`, **no trailing slash**. A mismatch causes CORS errors or `401` on every protected request.

---

## 💳 Stripe Webhooks

Premium is activated **only** when Stripe sends a verified `checkout.session.completed` event — never from the frontend success page.

### Local development

Stripe cannot reach `localhost`, so forward events with the Stripe CLI (keep it running while testing):

```bash
stripe listen \
  --api-key "$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)" \
  --events checkout.session.completed,checkout.session.expired \
  --forward-to localhost:8000/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET` and restart the server.

### Production

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- **URL:** `https://your-server-url/webhook`
- **Events:** `checkout.session.completed`, `checkout.session.expired`

Set that endpoint's signing secret as `STRIPE_WEBHOOK_SECRET` on your host.

### Test card

| Field | Value |
|---|---|
| Card number | `4242 4242 4242 4242` |
| Expiry / CVC | Any future date / any 3 digits |

---

## 🛡️ Create an Admin

Admin accounts cannot be created through public sign up. Register a normal account in the client, then run:

```bash
node scripts/make-admin.js admin@example.com
```

Output: `admin@example.com is now an admin.` — sign out and back in to open the Admin dashboard.

---

## 🗄️ Database Collections

| Collection | Purpose | Key fields |
|---|---|---|
| `user` *(Better Auth)* | Accounts | `name`, `email`, `image`, `role`, `isBlocked`, `businessName`, `subscriptionPlan`, `subscriptionExpiresAt` |
| `services` | Wedding services | `vendorId`, `serviceName`, `category`, `description`, `price`, `location`, `images`, `status`, `isActive`, `createdAt` |
| `bookings` | Booking requests | `serviceId`, `vendorId`, `customerId`, `eventDate`, `eventLocation`, `message`, `status`, `createdAt` |
| `transactions` | Premium payments | `vendorId`, `plan`, `amount`, `currency`, `stripeSessionId`, `stripeSubscriptionId`, `status`, `createdAt` |

**Status values**

- Service: `pending` · `approved` · `rejected`
- Booking: `pending` · `accepted` · `rejected` · `cancelled`
- Transaction: `pending` · `paid` · `expired`

> Premium is a one-time 30-day payment, so `stripeSubscriptionId` is stored as `null`. When Premium expires, the vendor returns to the Free plan automatically.

---

## 📁 Project Structure

```
wedplan-server/
├── index.js            # Express app: middleware, routes, Stripe webhook
├── scripts/
│   └── make-admin.js   # Promote a registered user to admin
├── .env.example        # Environment variable template
└── package.json
```

---

<div align="center">

Made with ❤️ for couples planning their perfect day.

</div>
