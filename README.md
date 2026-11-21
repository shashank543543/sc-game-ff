# SC GAMEING - Free Fire Esports Tournament Platform 🔥

A modern, mobile-friendly Free Fire and Free Fire MAX esports tournament platform built for competitive gaming, daily tournaments, secure UPI wallet management, and automated prize payouts.

---

## 🚀 Key Features

### 1. User Registration & Authentication
- **Fast Sign Up:** Name, Email, 10-digit Indian Mobile Number, Password, Free Fire In-Game Name (IGN), and Character UID.
- **₹10 Sign-Up Bonus:** Automatically credited to every new player's wallet upon registration.
- **Flexible Login:** Login with Email or 10-digit Mobile Number + Password.
- **Forgot / Reset Password:** 6-digit numeric reset verification token with automatic expiry.
- **Player Career Stats:** Tracks Total Matches Played, Booyahs (1st Place), Total Kills, and Total Cash Won.

### 2. Tournaments & Real-Time Match Operations
- **Categories & Maps:** Battle Royale & Clash Squad on Bermuda, Purgatory, Kalahari, Alpine, and Nexterra.
- **Match Modes:** Solo, Duo, and Squad with dynamic teammate entry inputs.
- **Live Countdown Timers:** Ticking clocks showing exact time until match launch.
- **Slots Tracker:** Live progress bar indicating filled vs available slots (e.g., 34/48).
- **Secure Room ID & Password Release:**
  - Masked and strictly protected from public view.
  - Automatically revealed **only to players who joined the match** (or admin) 15 minutes before match start.
  - One-click copy buttons for Room ID and Password with step-by-step custom room joining instructions.
- **Match Results & Leaderboard:** Detailed breakdown of final ranks, kills, and cash prizes won.

### 3. Payment Gateway & UPI Wallet System
- **Owner Payment Details:**
  - **UPI ID:** `6363440966@apl`
  - **Admin Email:** `shas86728@gmail.com`
- **Dynamic UPI QR Code Generation:**
  - Generates instant NPCI-compliant UPI QR codes (`upi://pay?pa=6363440966@apl&pn=SC%20GAMEING&am=...&cu=INR&tn=...`).
  - One-click payment intent links for mobile devices (Google Pay, PhonePe, Paytm, CRED, or Any UPI app).
- **Strict Server-Side Verification:**
  - Balances are never trusted from the client.
  - Players submit their 12-digit UPI Reference / UTR Number with optional screenshot proof.
  - **Anti-Duplicate Protection:** Unique constraints prevent the same UTR from ever being submitted twice.
  - Gateway webhook listener (`/api/webhook/payment-callback`) with HMAC-SHA256 signature verification.
- **Official Printable Receipts:** Professional payment and tournament receipts for every transaction.

### 4. Cash Withdrawal System
- Users can request cash withdrawals directly to any valid UPI ID (e.g. `username@okaxis`, `9876543210@paytm`).
- Minimum withdrawal limit: ₹50.
- Server immediately locks requested funds from the wallet.
- Status tracking: `PENDING`, `APPROVED`, `PAID`, or `REJECTED`.
- If an admin rejects a withdrawal with a reason (e.g. "Invalid UPI ID"), the money is **automatically refunded back** to the player's wallet!

### 5. Dedicated Admin Control Workstation (`/admin`)
- **Default Master Admin:**
  - **Email:** `shas86728@gmail.com`
  - **Password:** `Admin@SC123`
- **Dashboard Analytics:** Real-time KPI cards for Registered Users, Active Tournaments, Total Wallet Float, and Total Revenue.
- **Tournament Manager:**
  - Create, edit, and cancel tournaments with custom maps, entry fees, prize pools, 1st/2nd/3rd prizes, and per-kill bounties.
  - Publish Custom Room ID & Password in real-time.
  - Result Calculator & Auto-Payout: Enter player ranks & kills, and the server calculates and deposits cash prizes directly into winners' wallets!
  - Cancelling a tournament automatically refunds all registered players.
- **Deposit Approvals:** Review pending UPI deposits, verify UTR / screenshot proof, and 1-click approve to credit the player's wallet.
- **Withdrawal Approvals:** Review requests, enter Bank Transaction Reference / UTR, and mark as `PAID`.
- **User Management:** Search players, block/unblock, and perform manual wallet adjustments (Credit/Debit with mandatory audit reason).
- **Notices & Marquee:** Publish scrolling live alerts to the site banner.

### 6. 24/7 Live Chat Customer Service & Esports Support Desk 🎧
- **Player Floating Widget:** Accessible 24/7 across mobile and desktop with pulsing neon launcher and unread counter badges.
- **Real-Time 2-Way Socket.IO Messaging:** Instant delivery between players and tournament administrators without page refreshes.
- **Smart 24/7 Automated Support Bot:**
  - Instantly answers frequent questions regarding UPI deposits & UTR approvals.
  - Clarifies Custom Room ID and Password release timing (15 mins before start).
  - Guides players on minimum withdrawal limits and processing times.
  - Explains anti-cheat and mobile-only fair play tournament rules.
- **Interactive Audio Chimes:** Built-in Web Audio synthesis chimes when new messages or replies arrive.
- **Dedicated Admin Control Desk (`/admin` → Live Support):**
  - Live conversation queue with search, filter (All, Open, Resolved), and unread badges.
  - Player profile inspector: view in-game IGN, UID, contact details, and current wallet balance.
  - 1-click canned responses for quick support replies (UTR approved, Room details, Withdrawal confirmed, etc.).
  - Ticket resolution and automatic reopening when a player sends a follow-up.

---

## 🛠️ Technology Stack

- **Frontend:** HTML5, CSS3, Tailwind CSS, FontAwesome 6, Google Fonts (Rajdhani & Inter), Vanilla JavaScript (SPA architecture).
- **Backend:** Node.js + Express.js.
- **Real-Time:** Socket.IO for instant room releases and live match status sync.
- **Database:**
  - **Supabase / PostgreSQL** for cloud production deployment.
  - **Native SQLite fallback** for instant zero-config local development and offline running.
- **Authentication:** JSON Web Tokens (JWT) & Bcrypt password hashing.
- **Deployment:** Vercel (`vercel.json`) & Render (`render.yaml`).

---

## ⚙️ Quick Start Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` (pre-configured with owner credentials):
```env
PORT=5000
ADMIN_EMAIL=shas86728@gmail.com
ADMIN_PASSWORD=Admin@SC123
ADMIN_UPI=6363440966@apl
JWT_SECRET=sc_gameing_super_secure_jwt_secret_key_2026_ff_tournament_platform
```

### 3. Run Automated End-to-End Tests
Verify every feature (registration, dynamic UPI QR, UTR deduplication, admin approval, joining tournament, room release, results calculation, and withdrawals):
```bash
npm test
```

### 4. Start the Application
```bash
npm start
```
- **Player Website:** [http://localhost:5000](http://localhost:5000)
- **Admin Console:** [http://localhost:5000/admin](http://localhost:5000/admin)

---

## 🗄️ Supabase PostgreSQL Setup (Production)

To connect this platform to Supabase:
1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in Supabase and run the provided SQL script:
   `supabase_schema.sql`
3. Copy your Supabase PostgreSQL connection string from **Project Settings > Database > Connection String (URI)** and paste it in `.env`:
   ```env
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
   ```
4. Restart the server. The database adapter will automatically connect to Supabase PostgreSQL!

---

## 🌐 Deploy to Vercel & Render

### Render (Recommended for full WebSockets & Long-running Node.js)
1. Fork or push this repository to GitHub.
2. In Render, select **New Web Service** and link your repository.
3. Render will automatically detect `render.yaml` or you can specify:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add environment variables: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_UPI`, `JWT_SECRET`, `DATABASE_URL`.

### Vercel
1. Install Vercel CLI or import repository on [vercel.com](https://vercel.com).
2. The project includes a pre-configured `vercel.json` routing both serverless API endpoints and static assets.
3. Set your environment variables in the Vercel Dashboard.

---

## 🛡️ Security Best Practices Implemented

- **Atomic Wallet Deductions:** Database transactions prevent race conditions and overdrafts.
- **Idempotent Payment Handling:** Unique constraints on UTR numbers and transaction IDs.
- **Room Credentials Secrecy:** Only authenticated and verified participants of a specific match receive the room credentials.
- **Brute-Force & Rate Limiting:** Strict rate limits on `/api/auth/` and financial transaction endpoints.
- **SQL Injection & XSS Protection:** Parameterized queries across all database drivers and Helmet security headers.

---

## 🏆 Default Admin Credentials
- **Portal URL:** `/admin`
- **Email:** `shas86728@gmail.com`
- **Password:** `Admin@SC123`
- **Merchant UPI:** `6363440966@apl`
