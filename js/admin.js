import { db, authReady } from "./firebase-config.js";
import { requireRole, logout, getPins, setPins } from "./auth.js";
import { SEED_CATEGORIES, SEED_MENU } from "./seed-menu.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const session = requireRole(["admin"]);
document.getElementById("logout-btn").addEventListener("click", logout);

/* ---------------- One-time seed ---------------- */

async function maybeSeedMenu() {
  await authReady;
  const catsSnap = await getDocs(collection(db, "categories"));
  if (!catsSnap.empty) return; // already seeded / has real data

  const batch = writeBatch(db);
  SEED_CATEGORIES.forEach((name, i) => {
    batch.set(doc(collection(db, "categories")), { name, order: i });
  });
  SEED_MENU.forEach((item) => {
    batch.set(doc(collection(db, "menu")), item);
  });
  await batch.commit();
  console.log("Menu seeded from the starting Chillax Café price list.");
}

/* ---------------- Tab switching ---------------- */

const tabButtons = document.querySelectorAll(".admin-nav button");
const sections = {
  dashboard: document.getElementById("section-dashboard"),
  menu: document.getElementById("section-menu"),
  settings: document.getElementById("section-settings"),
};

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    Object.entries(sections).forEach(([key, el]) =>
      el.classList.toggle("hidden", key !== btn.dataset.tab),
    );
  });
});

/* ================= DASHBOARD ================= */

let allOrders = [];
let currentRange = "today";

function rangeStart(range) {
  const now = new Date();
  const start = new Date(now);
  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "week") {
    const day = start.getDay(); // 0=Sun
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
  } else if (range === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else {
    return null; // all time
  }
  return start;
}

async function listenOrders() {
  await authReady;
  // Pull everything once sorted by date; ranges are then filtered client
  // side. Fine for a single-branch café's order volume, and avoids needing
  // a composite index for every range.
  onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc")), (snap) => {
    allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDashboard();
  });
}

document.querySelectorAll(".range-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentRange = btn.dataset.range;
    renderDashboard();
  });
});

function peso(n) {
  return "₱" + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function renderDashboard() {
  const start = rangeStart(currentRange);
  const orders = allOrders.filter((o) => {
    if (!start) return true;
    const created = o.createdAt?.toDate ? o.createdAt.toDate() : null;
    return created && created >= start;
  });

  const totalSales = orders.reduce((s, o) => s + (o.total || 0), 0);
  const orderCount = orders.length;
  const avgTicket = orderCount ? totalSales / orderCount : 0;

  document.getElementById("stat-sales").textContent = peso(totalSales);
  document.getElementById("stat-orders").textContent = orderCount;
  document.getElementById("stat-avg").textContent = peso(avgTicket);

  // Best sellers: aggregate qty & revenue per item name (+size).
  const tally = new Map();
  orders.forEach((o) => {
    (o.items || []).forEach((it) => {
      const key = it.name + (it.size ? ` (${it.size})` : "");
      const cur = tally.get(key) || { qty: 0, revenue: 0 };
      cur.qty += it.qty || 0;
      cur.revenue += (it.unitPrice || 0) * (it.qty || 0);
      tally.set(key, cur);
    });
  });
  const ranked = [...tally.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.qty - a.qty);

  const top = ranked.slice(0, 10);
  const maxQty = top.length ? top[0].qty : 1;
  const bestSellersEl = document.getElementById("best-sellers");
  bestSellersEl.innerHTML = "";
  if (!top.length) {
    bestSellersEl.innerHTML = `<p style="opacity:.6;">No orders in this range yet.</p>`;
  }
  top.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label">${escapeHtml(item.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(item.qty / maxQty) * 100}%"></div></div>
      <div class="bar-value">${item.qty}</div>
    `;
    bestSellersEl.appendChild(row);
  });

  // Full breakdown table.
  const tbody = document.getElementById("sales-table-body");
  tbody.innerHTML = ranked
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.qty}</td>
        <td>${peso(r.revenue)}</td>
      </tr>`,
    )
    .join("") || `<tr><td colspan="3" style="opacity:.6;">No data yet.</td></tr>`;

  // Recent orders list.
  const recentBody = document.getElementById("recent-orders-body");
  recentBody.innerHTML = orders
    .slice(0, 25)
    .map((o) => {
      const created = o.createdAt?.toDate ? o.createdAt.toDate() : null;
      const timeStr = created
        ? created.toLocaleString("en-PH", { dateStyle: "short", timeStyle: "short" })
        : "—";
      const itemSummary = (o.items || [])
        .map((it) => `${it.qty}x ${it.name}${it.size ? ` (${it.size})` : ""}`)
        .join(", ");
      return `
        <tr>
          <td>#${o.orderNumber ?? "—"}</td>
          <td>${timeStr}</td>
          <td style="max-width:320px;">${escapeHtml(itemSummary)}</td>
          <td>${peso(o.total || 0)}</td>
        </tr>`;
    })
    .join("") || `<tr><td colspan="4" style="opacity:.6;">No orders yet.</td></tr>`;
}

/* ================= MENU MANAGEMENT ================= */

let categories = []; // {id, name, order}
let menuItems = []; // {id, category, name, price, priceLarge, available, sortOrder}

async function listenMenuAdmin() {
  await authReady;
  onSnapshot(query(collection(db, "categories"), orderBy("order")), (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMenuAdmin();
    fillCategorySelect();
  });
  onSnapshot(query(collection(db, "menu"), orderBy("sortOrder")), (snap) => {
    menuItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMenuAdmin();
  });
}

function renderMenuAdmin() {
  const root = document.getElementById("menu-admin-root");
  root.innerHTML = "";
  categories.forEach((cat) => {
    const items = menuItems.filter((i) => i.category === cat.name);
    const block = document.createElement("div");
    block.className = "menu-cat-block";
    block.innerHTML = `
      <h3>${escapeHtml(cat.name)} <span class="count">${items.length} item${items.length === 1 ? "" : "s"}</span>
        <button class="btn btn-sm btn-outline" data-add-item="${escapeHtml(cat.name)}" style="margin-left:auto;">+ Item</button>
        <button class="btn btn-sm btn-outline" data-del-cat="${cat.id}" title="Delete empty category">🗑</button>
      </h3>
      <table class="data-table">
        <thead><tr><th>Item</th><th>Price</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${
            items
              .map(
                (it) => `
            <tr>
              <td>${escapeHtml(it.name)}</td>
              <td>${it.priceLarge ? peso(it.price) + " / " + peso(it.priceLarge) + " (M/L)" : peso(it.price)}</td>
              <td>${it.available === false ? "Unavailable" : "Available"}</td>
              <td style="white-space:nowrap;">
                <button class="btn btn-sm btn-outline" data-edit="${it.id}">Edit</button>
                <button class="btn btn-sm ${it.available === false ? "btn-secondary" : "btn-outline"}" data-toggle="${it.id}">
                  ${it.available === false ? "Enable" : "86 it"}
                </button>
                <button class="btn btn-sm btn-danger" data-del="${it.id}">Delete</button>
              </td>
            </tr>`,
              )
              .join("") || `<tr><td colspan="4" style="opacity:.6;">No items yet — add one above.</td></tr>`
          }
        </tbody>
      </table>
    `;
    root.appendChild(block);
  });

  root.style.marginTop = "6px";

  root.querySelectorAll("[data-add-item]").forEach((b) =>
    b.addEventListener("click", () => openItemModal(null, b.dataset.addItem)),
  );
  root.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const item = menuItems.find((i) => i.id === b.dataset.edit);
      openItemModal(item);
    }),
  );
  root.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (confirm("Delete this item? This can't be undone.")) {
        await deleteDoc(doc(db, "menu", b.dataset.del));
      }
    }),
  );
  root.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      const item = menuItems.find((i) => i.id === b.dataset.toggle);
      await updateDoc(doc(db, "menu", item.id), { available: item.available === false });
    }),
  );
  root.querySelectorAll("[data-del-cat]").forEach((b) =>
    b.addEventListener("click", async () => {
      const cat = categories.find((c) => c.id === b.dataset.delCat);
      const hasItems = menuItems.some((i) => i.category === cat.name);
      if (hasItems) {
        alert("Move or delete every item in this category first.");
        return;
      }
      if (confirm(`Delete category "${cat.name}"?`)) {
        await deleteDoc(doc(db, "categories", cat.id));
      }
    }),
  );
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

/* ---- Add category ---- */

document.getElementById("add-category-btn").addEventListener("click", async () => {
  const name = prompt("New category name (e.g. \"Seasonal Drinks\")");
  if (!name || !name.trim()) return;
  if (categories.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) {
    alert("A category with that name already exists.");
    return;
  }
  const nextOrder = categories.length ? Math.max(...categories.map((c) => c.order)) + 1 : 0;
  await addDoc(collection(db, "categories"), { name: name.trim(), order: nextOrder });
});

/* ---- Item add/edit modal ---- */

const modalRoot = document.getElementById("modal-root");

function fillCategorySelect() {
  const sel = document.getElementById("item-category-select");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = categories.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  if (current) sel.value = current;
}

function openItemModal(item, defaultCategory) {
  const isEdit = !!item;
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-sheet">
        <h3>${isEdit ? "Edit item" : "Add item"}</h3>
        <form id="item-form" class="modal-form">
          <div class="field">
            <span class="field-label">Category</span>
            <select id="item-category-select"></select>
          </div>
          <div class="field">
            <span class="field-label">Item name</span>
            <input type="text" id="item-name" required value="${item ? escapeHtml(item.name) : ""}" />
          </div>
          <div class="field">
            <span class="field-label">Price (₱) ${isEdit ? "" : ""}</span>
            <input type="number" id="item-price" min="0" step="1" required value="${item ? item.price : ""}" />
          </div>
          <div class="field">
            <span class="field-label">Large size price (₱) — leave blank if this item has no M/L sizes</span>
            <input type="number" id="item-price-large" min="0" step="1" value="${item && item.priceLarge ? item.priceLarge : ""}" />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline btn-block" id="modal-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary btn-block">${isEdit ? "Save" : "Add item"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
  fillCategorySelect();
  const sel = document.getElementById("item-category-select");
  if (item) sel.value = item.category;
  else if (defaultCategory) sel.value = defaultCategory;

  modalRoot.querySelector("#modal-cancel").addEventListener("click", () => (modalRoot.innerHTML = ""));
  modalRoot.querySelector("#item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("item-name").value.trim();
    const price = Number(document.getElementById("item-price").value);
    const priceLargeRaw = document.getElementById("item-price-large").value;
    const priceLarge = priceLargeRaw ? Number(priceLargeRaw) : null;
    const category = sel.value;
    if (!name || !category || Number.isNaN(price)) return;

    const payload = { name, category, price, priceLarge, available: item ? item.available !== false : true };

    if (isEdit) {
      await updateDoc(doc(db, "menu", item.id), payload);
    } else {
      const maxSort = menuItems.length ? Math.max(...menuItems.map((i) => i.sortOrder || 0)) : 0;
      await addDoc(collection(db, "menu"), { ...payload, sortOrder: maxSort + 1 });
    }
    modalRoot.innerHTML = "";
  });
}

/* ================= SETTINGS ================= */

async function loadSettingsForm() {
  const pins = await getPins();
  document.getElementById("admin-pin-input").value = pins.adminPin;
  document.getElementById("staff-pin-input").value = pins.staffPin;
}

document.getElementById("save-pins-btn").addEventListener("click", async () => {
  const adminPin = document.getElementById("admin-pin-input").value.trim();
  const staffPin = document.getElementById("staff-pin-input").value.trim();
  const msg = document.getElementById("settings-msg");
  if (!/^\d{4,6}$/.test(adminPin) || !/^\d{4,6}$/.test(staffPin)) {
    msg.textContent = "PINs must be 4–6 digits.";
    msg.style.color = "var(--red)";
    return;
  }
  await setPins({ adminPin, staffPin });
  msg.textContent = "Saved.";
  msg.style.color = "var(--green)";
  setTimeout(() => (msg.textContent = ""), 2500);
});

/* ---------------- Boot ---------------- */

(async function init() {
  await maybeSeedMenu();
  listenOrders();
  listenMenuAdmin();
  loadSettingsForm();
})();
