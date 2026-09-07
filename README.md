# Chillax Café POS

A simple point-of-sale web app for Chillax Café: a **cashier screen** for
taking orders and printing receipts, and an **admin screen** for managing
the menu and viewing sales / best-sellers. Built as plain HTML/CSS/JS (no
build step) on top of your existing Firebase project (`chillaxpos-470c3`),
so it runs on any phone, tablet, or computer with a browser.

## 1. One-time Firebase setup (5 minutes)

Your current Firestore rules block **all** reads and writes, so the app
won't load anything until you fix this:

1. Go to the [Firebase Console](https://console.firebase.google.com/) →
   your `chillaxpos-470c3` project.
2. **Authentication → Sign-in method → Anonymous → Enable.** The app signs
   every device in anonymously (no password prompt, invisible to staff) so
   Firestore has *some* identity to check — it's what lets you lock the
   database down without needing individual staff logins.
3. **Firestore Database → Rules** → paste in the contents of
   `firestore.rules` (in this folder) → **Publish**.
4. That's it — Firestore itself (`chillaxpos-470c3.firebaseapp.com`) and
   the config in `js/firebase-config.js` are already wired up to your
   project.

## 2. Running it

**Quickest way to try it locally:** most browsers block ES module imports
from a plain `file://` page, so serve the folder over local http instead
of double-clicking the HTML files. From this folder:

```bash
npx serve .
# or: python3 -m http.server 8080
```

Then open the printed `localhost` address.

**For real use at the café**, deploy it somewhere so every device (tablet
at the counter, phone in the kitchen, your laptop at home) can reach the
same URL:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```

(Firebase Hosting is free at this scale, and `firebase.json` is already
set up for it.) Any other static host — Netlify, Vercel, GitHub Pages —
works too, since it's just static files.

## 3. Signing in

Open the site → you'll land on the PIN screen. Toggle between **Cashier**
and **Admin**, then enter the PIN.

- Default Cashier PIN: `0000`
- Default Admin PIN: `1234`

**Change these immediately** from Admin → Settings once you're set up —
anyone with the PIN and the link can use that role.

There are no individual staff accounts by design (matches how you
described the crew using it) — everyone shares the one Cashier PIN.

## 4. Cashier screen (`pos.html`)

- Browse the menu by category tab, tap an item to add it to the order.
- Milktea and Fruit Tea prompt for Medium/Large since those have two
  prices.
- Adjust quantity or remove items in the cart on the right (bottom, on
  phones).
- **"Place order & print"** saves the order to Firestore (so it shows up
  in Admin → Sales immediately) and opens the print dialog with **two
  receipts back to back on one job**: a Cashier/Customer copy with prices
  and total, then a Kitchen copy with just item names and quantities (no
  prices). Your thermal printer will cut/feed between them like any
  multi-page print job.

## 5. Admin screen (`admin.html`)

- **Sales** — total sales, order count, and average ticket for
  Today / This week / This month / All time, plus a best-sellers chart,
  a full per-item breakdown, and a recent-orders list.
- **Menu** — add categories, add/edit/delete items and prices, or mark an
  item "86'd" (temporarily unavailable) without deleting it. Every change
  shows up on the cashier screen instantly, on every device, with no app
  update needed.
- **Settings** — change the Cashier/Admin PINs.

The first time anyone opens `admin.html`, it seeds Firestore with your
current menu and prices automatically (only if the menu is still empty) —
after that, the admin panel is the source of truth.

## 6. Printer notes (58mm thermal)

`css/print.css` is sized for **58mm roll paper** (57.5mm ± 0.5mm actual
roll width, 58mm print head — matches what you specified), using a 54mm
safe printable area to allow for the printer's dead margin. Set your
thermal printer as the default printer (or select it from the print
dialog) with paper size **58mm / Roll paper / Receipt**, whichever your
printer driver calls it — most USB/Bluetooth thermal receipt printers on
Android/Windows expose a "58mm" paper size once installed.

## 7. Project files

```
index.html         Login / PIN screen
pos.html            Cashier ordering screen
admin.html          Admin dashboard
css/style.css        Shared design (colors, layout, components)
css/print.css        58mm receipt print layout
js/firebase-config.js  Your Firebase project config + anonymous sign-in
js/auth.js             PIN check, session storage, route guarding
js/seed-menu.js         Starting menu/prices (only used once, to seed)
js/pos.js               Cashier screen logic
js/admin.js              Admin screen logic
firestore.rules       Rules to paste into the Firebase Console
firebase.json         Firebase Hosting config
assets/logo.jpg       Your logo
```

## 8. Data model (for reference)

- `categories/{id}` — `{ name, order }`
- `menu/{id}` — `{ category, name, price, priceLarge|null, available, sortOrder }`
- `orders/{id}` — `{ orderNumber, items:[{menuId,name,size,unitPrice,qty}], total, cashierRole, createdAt }`
- `counters/orderNumber` — `{ value }` (auto-incrementing order number)
- `settings/pins` — `{ adminPin, staffPin }`
