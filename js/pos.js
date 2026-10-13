import { db, authReady } from "./firebase-config.js";
import { requireRole, logout } from "./auth.js";
import { printOrder } from "./receipt.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const session = requireRole(["staff", "admin"]);
document.getElementById("logout-btn").addEventListener("click", logout);
document.getElementById("role-pill").textContent =
  session?.role === "admin" ? "Admin" : "Cashier";
if (session?.role !== "admin") {
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
let cart = [];
let lastOrder = null;
let submitting = false;
let searchText = "";
const orderType = document.getElementById("order-type");
orderType.addEventListener("change", renderCart);
document.getElementById("menu-search").addEventListener("input", e => {
  searchText = e.target.value.trim().toLowerCase();
  renderGrid();
});
document.getElementById("reprint-last-btn").addEventListener("click", async () => {
  if (!lastOrder) return;
  try { await printOrder(lastOrder); } catch (e) { showToast(`Unable to reprint: ${e.message}`); }
});
function showConnectionError(message) {
  const banner = document.getElementById("connection-banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
}
const isDrink = (category, name = "") =>
  /coffee|frapp|frappé|shake|tea|drink|juice|smoothie|soda|lemonade|chocolate|matcha|milktea/i.test(category || "") ||
  /water|coke|cola|juice|soda|iced tea|iced coffee/i.test(name || "");
const boxFee = () => orderType.value === "Dine In" ? 0 : cart.reduce((sum, line) => sum + (line.isDrink ? 0 : line.qty * 15), 0); // {id, name, price, qty, size}

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
    if (categoryOrder.length && !categoryOrder.includes(activeCategory)) activeCategory = categoryOrder[0];
    renderTabs();
    renderGrid();
  }, e => showConnectionError(`Menu categories could not load: ${e.message}`));

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
  }, e => showConnectionError(`Menu items could not load: ${e.message}`));
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
  const items = searchText
    ? [...menuByCategory.values()].flat().filter(item =>
        `${item.name} ${item.category}`.toLowerCase().includes(searchText))
    : (menuByCategory.get(activeCategory) || []).slice();
  document.getElementById("item-count").textContent = `${items.length} product${items.length === 1 ? "" : "s"}${searchText ? " found" : ""}`;
  menuPane.innerHTML = "";
  if (!items.length) {
    menuPane.innerHTML = `<p class="menu-empty">${searchText ? "No matching products found." : "No items in this category yet."}</p>`;
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
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}
const escapeAttr = escapeHtml;

/* ---------------- Cart ---------------- */

function onItemTap(item) {
  if (item.priceLarge) {
    openSizeModal(item);
  } else {
    addToCart(item, null, item.price);
  }
}

function addToCart(item, size, unitPrice) {
  const key = `${item.id}:${size || "one"}:${globalThis.crypto?.randomUUID?.() || Date.now() + Math.random()}`;
  cart.push({
      key,
      menuId: item.id,
      name: item.name,
      size,
      unitPrice,
      qty: 1,
      category: item.category || "",
      isDrink: isDrink(item.category, item.name),
      note: "",
    });
  renderCart();
}

function renderCart() {
  cartItemsEl.innerHTML = "";
  if (!cart.length) {
    cartItemsEl.innerHTML = `<div class="cart-empty">Tap a menu item to start an order.</div>`;
  }
  let total = 0;
  cart.forEach((line) => {
    const lineTotal = Number(line.unitPrice) * line.qty;
    total += lineTotal;
    const row = document.createElement("div");
    row.className = "cart-line";
    row.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(line.name)}</div>
        ${line.size ? `<div class="size">Size: ${line.size}</div>` : ""}
        <div class="unit">${peso(line.unitPrice)} each</div><input class="custom-note" placeholder="Customize / special instructions" value="${escapeAttr(line.note || "")}" />
      </div>
      <div class="qty-control">
        <button data-act="dec">−</button>
        <span>${line.qty}</span>
        <button data-act="inc">+</button>
      </div>
      <div class="line-total">${peso(lineTotal)}</div>
      <button class="remove-btn" data-act="remove" title="Remove">✕</button>
    `;
    row.querySelector(".custom-note").addEventListener("input", e => line.note = e.target.value);
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
  cartTotalEl.textContent = peso(total + boxFee());
  document.getElementById("box-fee-label").textContent = boxFee() ? `(includes ${peso(boxFee())} packaging)` : "";
  checkoutBtn.disabled = submitting || cart.length === 0;
  document.getElementById("cart-count").textContent = String(cart.reduce((total, item) => total + item.qty, 0));
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
  modalRoot.querySelector(".modal-backdrop").addEventListener("click", e => {
    if (e.target.classList.contains("modal-backdrop")) closeModal();
  });
  modalRoot.querySelector("#modal-add").addEventListener("click", () => {
    const unitPrice = size === "L" ? item.priceLarge : item.price;
    addToCart(item, size, unitPrice);
    closeModal();
  });
}

function closeModal() { modalRoot.replaceChildren(); }
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && modalRoot.hasChildNodes()) closeModal();
});

/* ---------------- Checkout + 58mm print ---------------- */

checkoutBtn.addEventListener("click", async () => {
  if (submitting || !cart.length) return;
  submitting = true;
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "Saving order…";
  const orderItems = cart.map(line => ({
    menuId: line.menuId, name: line.name, size: line.size || null,
    unitPrice: Number(line.unitPrice), qty: Number(line.qty), category: line.category,
    isDrink: line.isDrink, note: line.note || "",
  }));
  const order = {
    items: orderItems,
    total: Math.round((orderItems.reduce((sum, item) => sum + item.unitPrice * item.qty, 0) + boxFee()) * 100) / 100,
    packagingFee: boxFee(),
    orderType: orderType.value,
    paymentMethod: document.getElementById("payment-method").value,
    customerName: document.getElementById("customer-name").value.trim(),
    cashierRole: session?.role || "staff",
  };
  try {
    await authReady;
    // Reserve the order number AND save the order in the SAME transaction;
    // a failed save does not waste a number or create an incomplete order.
    const counterRef = doc(db, "counters", "orderNumber");
    const orderRef = doc(collection(db, "orders"));
    const orderNumber = await runTransaction(db, async tx => {
      const snap = await tx.get(counterRef);
      const next = Number(snap.exists() ? snap.data().value : 0) + 1;
      tx.set(counterRef, { value: next });
      tx.set(orderRef, { ...order, orderNumber: next, createdAt: serverTimestamp() });
      return next;
    });
    lastOrder = { ...order, orderNumber, printedAt: new Date().toISOString() };
    cart = [];
    document.getElementById("customer-name").value = "";
    renderCart();
    document.getElementById("reprint-last-btn").disabled = false;
    showToast(`Order #${orderNumber} saved. Opening 58mm print dialog…`);
    try { await printOrder(lastOrder); }
    catch (printError) {
      console.error("Printing error:", printError);
      showToast(`Order #${orderNumber} saved. Use Reprint last receipt to retry.`);
    }
  } catch (error) {
    console.error("Checkout error:", error);
    showToast(`Order was not saved: ${error.message || "Check your connection."}`);
  } finally {
    submitting = false;
    checkoutBtn.textContent = "Place order & print";
    renderCart();
  }
});

listenMenu().catch(error => {
  console.error("Unable to load POS menu:", error);
  showConnectionError(`Connection failed: ${error.message}`);
});
