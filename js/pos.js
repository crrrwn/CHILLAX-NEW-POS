import { db, authReady } from "./firebase-config.js";
import { requireRole, logout } from "./auth.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  runTransaction,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const session = requireRole(["staff", "admin"]);
document.getElementById("logout-btn").addEventListener("click", logout);
document.getElementById("role-pill").textContent =
  session.role === "admin" ? "Admin" : "Cashier";
if (session.role !== "admin") {
  document.getElementById("admin-link").classList.add("hidden");
}

const menuPane = document.getElementById("item-grid");
const tabsEl = document.getElementById("category-tabs");
const cartItemsEl = document.getElementById("cart-items");
const cartTotalEl = document.getElementById("cart-total");
const checkoutBtn = document.getElementById("checkout-btn");
const toastEl = document.getElementById("toast");

let menuByCategory = new Map(); // category -> [items]
let categoryOrder = [];
let activeCategory = null;
let cart = []; // {id, name, price, qty, size}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

function peso(n) {
  return "₱" + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

/* ---------------- Menu (live) ---------------- */

async function listenMenu() {
  await authReady;

  onSnapshot(query(collection(db, "categories"), orderBy("order")), (snap) => {
    categoryOrder = snap.docs.map((d) => d.data().name);
    if (!activeCategory && categoryOrder.length) activeCategory = categoryOrder[0];
    renderTabs();
    renderGrid();
  });

  onSnapshot(query(collection(db, "menu"), orderBy("sortOrder")), (snap) => {
    menuByCategory = new Map();
    snap.forEach((d) => {
      const item = { id: d.id, ...d.data() };
      const list = menuByCategory.get(item.category) || [];
      list.push(item);
      menuByCategory.set(item.category, list);
    });
    if (!activeCategory && menuByCategory.size) {
      activeCategory = [...menuByCategory.keys()][0];
    }
    renderTabs();
    renderGrid();
  });
}

function renderTabs() {
  const cats = categoryOrder.length ? categoryOrder : [...menuByCategory.keys()];
  tabsEl.innerHTML = "";
  cats.forEach((cat) => {
    const btn = document.createElement("button");
    btn.textContent = cat;
    btn.className = cat === activeCategory ? "active" : "";
    btn.addEventListener("click", () => {
      activeCategory = cat;
      renderTabs();
      renderGrid();
    });
    tabsEl.appendChild(btn);
  });
}

function renderGrid() {
  const items = (menuByCategory.get(activeCategory) || []).slice();
  menuPane.innerHTML = "";
  if (!items.length) {
    menuPane.innerHTML = `<p style="opacity:.6;padding:20px;">No items in this category yet.</p>`;
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("button");
    card.className = "item-card" + (item.available === false ? " unavailable" : "");
    card.disabled = item.available === false;
    const priceLabel = item.priceLarge
      ? `${peso(item.price)} / ${peso(item.priceLarge)}`
      : peso(item.price);
    card.innerHTML = `
      <span class="name">${escapeHtml(item.name)}</span>
      <span class="price">${priceLabel}</span>
      ${item.available === false ? '<span class="badge-unavail">86’d — unavailable</span>' : ""}
    `;
    card.addEventListener("click", () => onItemTap(item));
    menuPane.appendChild(card);
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/* ---------------- Cart ---------------- */

function onItemTap(item) {
  if (item.priceLarge) {
    openSizeModal(item);
  } else {
    addToCart(item, null, item.price);
  }
}

function addToCart(item, size, unitPrice) {
  const key = item.id + (size || "");
  const existing = cart.find((l) => l.key === key);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      key,
      menuId: item.id,
      name: item.name,
      size,
      unitPrice,
      qty: 1,
    });
  }
  renderCart();
}

function renderCart() {
  cartItemsEl.innerHTML = "";
  if (!cart.length) {
    cartItemsEl.innerHTML = `<div class="cart-empty">Tap a menu item to start an order.</div>`;
  }
  let total = 0;
  cart.forEach((line) => {
    const lineTotal = line.unitPrice * line.qty;
    total += lineTotal;
    const row = document.createElement("div");
    row.className = "cart-line";
    row.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(line.name)}</div>
        ${line.size ? `<div class="size">Size: ${line.size}</div>` : ""}
        <div class="unit">${peso(line.unitPrice)} each</div>
      </div>
      <div class="qty-control">
        <button data-act="dec">−</button>
        <span>${line.qty}</span>
        <button data-act="inc">+</button>
      </div>
      <div class="line-total">${peso(lineTotal)}</div>
      <button class="remove-btn" data-act="remove" title="Remove">✕</button>
    `;
    row.querySelector('[data-act="inc"]').addEventListener("click", () => {
      line.qty += 1;
      renderCart();
    });
    row.querySelector('[data-act="dec"]').addEventListener("click", () => {
      line.qty -= 1;
      if (line.qty <= 0) cart = cart.filter((l) => l.key !== line.key);
      renderCart();
    });
    row.querySelector('[data-act="remove"]').addEventListener("click", () => {
      cart = cart.filter((l) => l.key !== line.key);
      renderCart();
    });
    cartItemsEl.appendChild(row);
  });
  cartTotalEl.textContent = peso(total);
  checkoutBtn.disabled = cart.length === 0;
}

/* ---------------- Size modal (Milktea / Fruit Tea M-L) ---------------- */

const modalRoot = document.getElementById("modal-root");

function openSizeModal(item) {
  let size = "M";
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-sheet">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="size-options">
          <button data-size="M" class="selected">Medium · ${peso(item.price)}</button>
          <button data-size="L">Large · ${peso(item.priceLarge)}</button>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-block" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary btn-block" id="modal-add">Add to order</button>
        </div>
      </div>
    </div>
  `;
  const sizeBtns = modalRoot.querySelectorAll("[data-size]");
  sizeBtns.forEach((b) =>
    b.addEventListener("click", () => {
      size = b.dataset.size;
      sizeBtns.forEach((x) => x.classList.toggle("selected", x === b));
    }),
  );
  modalRoot.querySelector("#modal-cancel").addEventListener("click", closeModal);
  modalRoot.querySelector("#modal-add").addEventListener("click", () => {
    const unitPrice = size === "L" ? item.priceLarge : item.price;
    addToCart(item, size, unitPrice);
    closeModal();
  });
}

function closeModal() {
  modalRoot.innerHTML = "";
}

/* ---------------- Checkout + print ---------------- */

async function nextOrderNumber() {
  const counterRef = doc(db, "counters", "orderNumber");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = (snap.exists() ? snap.data().value : 0) + 1;
    tx.set(counterRef, { value: next });
    return next;
  });
}

checkoutBtn.addEventListener("click", async () => {
  if (!cart.length) return;
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "Placing order…";
  try {
    await authReady;
    const orderNumber = await nextOrderNumber();
    const total = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const orderItems = cart.map((l) => ({
      menuId: l.menuId,
      name: l.name,
      size: l.size || null,
      unitPrice: l.unitPrice,
      qty: l.qty,
    }));

    await addDoc(collection(db, "orders"), {
      orderNumber,
      items: orderItems,
      total,
      cashierRole: session.role,
      createdAt: serverTimestamp(),
    });

    printReceipts(orderNumber, orderItems, total);
    cart = [];
    renderCart();
    showToast(`Order #${orderNumber} placed — printing 2 copies…`);
  } catch (e) {
    console.error(e);
    showToast("Couldn't place the order. Check your connection and try again.");
  } finally {
    checkoutBtn.disabled = cart.length === 0;
    checkoutBtn.textContent = "Place order & print";
  }
});

function printReceipts(orderNumber, items, total) {
  const printArea = document.getElementById("print-area");
  const now = new Date();
  const dateStr = now.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const customerRows = items
    .map(
      (i) => `
      <tr>
        <td class="qty">${i.qty}x</td>
        <td class="item-name">${escapeHtml(i.name)}${i.size ? " (" + i.size + ")" : ""}</td>
        <td class="item-price">${peso(i.unitPrice * i.qty)}</td>
      </tr>`,
    )
    .join("");

  const kitchenRows = items
    .map(
      (i) => `
      <tr>
        <td class="qty">${i.qty}x</td>
        <td class="item-name" colspan="2">${escapeHtml(i.name)}${i.size ? " (" + i.size + ")" : ""}</td>
      </tr>`,
    )
    .join("");

  printArea.innerHTML = `
    <div class="receipt">
      <div class="center">
        <img class="logo-print" src="assets/logo.jpg" alt="" />
        <h1>Chillax Café</h1>
        <div class="sub">Sto. Niño, Calapan, Oriental Mindoro</div>
        <div class="sub">0977 702 3674</div>
      </div>
      <div class="rule"></div>
      <div class="copy-label">CASHIER / CUSTOMER COPY</div>
      <div class="meta-row"><span>Order #</span><span>${orderNumber}</span></div>
      <div class="meta-row"><span>Date</span><span>${dateStr}</span></div>
      <div class="rule"></div>
      <table class="receipt-items">${customerRows}</table>
      <div class="rule"></div>
      <div class="totals">
        <div class="totals-row grand"><span>TOTAL</span><span>${peso(total)}</span></div>
      </div>
      <div class="footer-note">Thank you, chill lang! 🧋</div>
    </div>
    <div class="receipt">
      <div class="center">
        <h1>KITCHEN COPY</h1>
      </div>
      <div class="rule"></div>
      <div class="meta-row"><span>Order #</span><span>${orderNumber}</span></div>
      <div class="meta-row"><span>Time</span><span>${dateStr}</span></div>
      <div class="rule"></div>
      <table class="receipt-items">${kitchenRows}</table>
    </div>
  `;
  setTimeout(() => window.print(), 60);
}

listenMenu();
