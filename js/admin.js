import { db, authReady } from "./firebase-config.js";
import { requireRole, logout, getPins, setPins } from "./auth.js";
import { SEED_CATEGORIES, SEED_MENU } from "./seed-menu.js";
import { printOrder, printFinanceReport } from "./receipt.js";
import { dayKey, pesos, countRevenue, orderBoxes } from "./business.js";
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
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const session = requireRole(["admin"]);
document.getElementById("logout-btn").addEventListener("click", logout);

/* ---------------- One-time seed ---------------- */

async function maybeSeedMenu() {
  await authReady;
  const seedFlag = doc(db, "settings", "menuInitialized");
  const seedSnap = await getDoc(seedFlag);
  if (seedSnap.exists()) return;

  const [categoriesSnap, itemsSnap] = await Promise.all([
    getDocs(collection(db, "categories")), getDocs(collection(db, "menu")),
  ]);
  if (!categoriesSnap.empty || !itemsSnap.empty) {
    // This could be an existing café menu: do NOT overwrite it.
    await setDoc(seedFlag, { initialized: true });
    return;
  }
  // Only one admin can seed. The transaction marker also prevents a fully
  // deleted menu from unexpectedly coming back on the next page load.
  await runTransaction(db, async tx => {
    const flag = await tx.get(seedFlag);
    if (flag.exists()) return;
    SEED_CATEGORIES.forEach((name, i) => {
      tx.set(doc(collection(db, "categories")), { name, order: i });
    });
    SEED_MENU.forEach(item => tx.set(doc(collection(db, "menu")), item));
    tx.set(seedFlag, { initialized: true });
  });
}

/* Move existing database products into separate Shake/Frappé categories.
   New installs already have the two categories in the seed data. */
async function splitDrinkCategories() {
  const snap = await getDocs(collection(db, "categories"));
  const old = snap.docs.find(d => d.data().name === "Shake & Frappé");
  if (!old) return;
  const existing = new Set(snap.docs.map(d => d.data().name));
  const products = await getDocs(collection(db, "menu"));
  const batch = writeBatch(db);
  const order = Number(old.data().order || 10);
  if (!existing.has("Shake")) batch.set(doc(collection(db,"categories")), {name:"Shake", order});
  if (!existing.has("Frappé")) batch.set(doc(collection(db,"categories")), {name:"Frappé", order:order+0.5});
  products.docs.filter(d => d.data().category === "Shake & Frappé").forEach(d => {
    batch.update(d.ref, {category:/frapp|frappé/i.test(d.data().name || "") ? "Frappé" : "Shake"});
  });
  batch.delete(old.ref);
  await batch.commit();
}

/* ---------------- Tab switching ---------------- */

const tabButtons = document.querySelectorAll(".admin-nav button");
const sections = {
  dashboard: document.getElementById("section-dashboard"),
  menu: document.getElementById("section-menu"),
  settings: document.getElementById("section-settings"),
  finances: document.getElementById("section-finances"),
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

const PAGE_SIZE = 5;

let allOrders = [];
let financeData = { expenses: [], cashEntries: [] };
let currentRange = "today";
let customDateFrom = null;
let customDateTo = null;
let pagination = {
  salesBreakdown: 1,
  recentOrders: 1,
  menuCats: {},
};

function paginate(items, page) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  return {
    items: items.slice(start, start + PAGE_SIZE),
    totalPages,
    currentPage,
    totalItems,
  };
}

function renderPagination(containerId, totalItems, currentPage, onPageChange, containerEl = null) {
  const el = containerEl || document.getElementById(containerId);
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (totalItems <= PAGE_SIZE) {
    el.innerHTML = "";
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = `
    <span class="pagination-info">Page ${currentPage} of ${totalPages} (${totalItems} total)</span>
    <div class="pagination-controls">
      <button class="btn btn-sm btn-outline" data-page="prev" ${currentPage <= 1 ? "disabled" : ""}>Prev</button>
      <button class="btn btn-sm btn-outline" data-page="next" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;
  el.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const nextPage = btn.dataset.page === "prev" ? currentPage - 1 : currentPage + 1;
      onPageChange(nextPage);
    });
  });
}

function orderDate(order) {
  return order.createdAt?.toDate ? order.createdAt.toDate() : null;
}
function orderDay(order) {return order.dayKey || (orderDate(order) ? dayKey(orderDate(order)) : "");}
function rangeStart(range) {
  const today = dayKey();
  if (range === "today") return today;
  if (range === "month") return today.slice(0,7)+"-01";
  if (range === "week") {
    // Sunday-start week in Philippine time.
    const todayPh = new Date(`${today}T12:00:00+08:00`);
    const day = todayPh.getUTCDay();
    todayPh.setUTCDate(todayPh.getUTCDate() - day);
    return dayKey(todayPh);
  }
  return null;
}

async function listenOrders() {
  await authReady;
  // Pull everything once sorted by date; ranges are then filtered client
  // side. Fine for a single-branch café's order volume, and avoids needing
  // a composite index for every range.
  onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc")), (snap) => {
    allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDashboard();
  }, e => showError(`Orders could not load: ${e.message}`));
}

document.querySelectorAll(".range-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentRange = btn.dataset.range;
    customDateFrom = null;
    customDateTo = null;
    document.getElementById("date-from").value = "";
    document.getElementById("date-to").value = "";
    pagination.salesBreakdown = 1;
    pagination.recentOrders = 1;
    renderDashboard();
  });
});

document.getElementById("date-filter-apply").addEventListener("click", () => {
  const fromVal = document.getElementById("date-from").value;
  const toVal = document.getElementById("date-to").value;
  if (!fromVal && !toVal) return;
  customDateFrom = fromVal || null;
  customDateTo = toVal || null;
  if (customDateFrom && customDateTo && customDateFrom > customDateTo) {
    showError("The start date must be before the end date.");
    return;
  }
  document.querySelectorAll(".range-tabs button").forEach((b) => b.classList.remove("active"));
  pagination.salesBreakdown = 1;
  pagination.recentOrders = 1;
  renderDashboard();
});

document.getElementById("date-filter-clear").addEventListener("click", () => {
  customDateFrom = null;
  customDateTo = null;
  document.getElementById("date-from").value = "";
  document.getElementById("date-to").value = "";
  document.querySelectorAll(".range-tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.range === currentRange);
  });
  pagination.salesBreakdown = 1;
  pagination.recentOrders = 1;
  renderDashboard();
});

function getFilteredOrders() {
  if (customDateFrom || customDateTo) {
    return allOrders.filter(o => {
      const key = orderDay(o);
      return key && (!customDateFrom || key >= customDateFrom) && (!customDateTo || key <= customDateTo);
    });
  }
  const start = rangeStart(currentRange);
  const end = dayKey();
  return allOrders.filter(o => {const key=orderDay(o);return key && (!start || key >= start) && key <= end;});
}
function peso(n) {return pesos(n);}

function renderDashboard() {
  const orders = getFilteredOrders();

  const {sales, boxes, addons, orders:orderCount} = countRevenue(orders);
  document.getElementById("stat-sales").textContent = peso(sales);
  document.getElementById("stat-orders").textContent = orderCount;
  document.getElementById("stat-boxes").textContent = peso(boxes);
  document.getElementById("stat-addons").textContent = peso(addons);

  // Use the exact categories defined in Menu Management, not guessed keywords.
  const groupTotals = new Map(categories.map(c => [c.name, 0]));
  orders.forEach(o => (o.items || []).forEach(it => {
    const matchingMenu = menuItems.find(m => m.name === it.name);
    const category = it.category || matchingMenu?.category || "Uncategorized";
    groupTotals.set(category, (groupTotals.get(category) || 0) + Number(it.unitPrice || 0) * Number(it.qty || 0));
  }));
  // Show non-product charges too, so the category breakdown reconciles with Total Sales.
  groupTotals.set("Additional add-on charges", orders.reduce((sum,o)=>sum+(o.addons||[]).reduce((a,it)=>a+Number(it.qty||0)*Number(it.unitPrice||0),0),0));
  groupTotals.set("Takeout boxes", orders.reduce((sum,o)=>sum+orderBoxes(o),0));
  const categoryRoot = document.getElementById("category-sales");
  categoryRoot.replaceChildren();
  groupTotals.forEach((amount, category) => {
    const row = document.createElement("div"); row.className = "group-stat";
    const name = document.createElement("span"); name.textContent = category;
    const value = document.createElement("strong"); value.textContent = peso(amount);
    row.append(name, value); categoryRoot.append(row);
  });
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
  const salesPage = paginate(ranked, pagination.salesBreakdown);
  pagination.salesBreakdown = salesPage.currentPage;
  const tbody = document.getElementById("sales-table-body");
  tbody.innerHTML = salesPage.items
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.qty}</td>
        <td>${peso(r.revenue)}</td>
      </tr>`,
    )
    .join("") || `<tr><td colspan="3" style="opacity:.6;">No data yet.</td></tr>`;
  renderPagination("sales-table-pagination", ranked.length, salesPage.currentPage, (page) => {
    pagination.salesBreakdown = page;
    renderDashboard();
  });

  // Recent orders list.
  const ordersPage = paginate(orders, pagination.recentOrders);
  pagination.recentOrders = ordersPage.currentPage;
  const recentBody = document.getElementById("recent-orders-body");
  recentBody.innerHTML = ordersPage.items
    .map((o) => {
      const created = orderDate(o);
      const timeStr = created
        ? created.toLocaleString("en-PH", { dateStyle: "short", timeStyle: "short" })
        : "—";
      const itemSummary = [
        ...(o.items || []).map(it => `${it.qty}x ${it.name}${it.size ? ` (${it.size})` : ""}${it.isAddon ? " [Add-on]" : ""}${it.serveType ? ` · ${it.serveType}` : ""}`),
        ...(o.addons || []).map(it => `${it.qty}x ${it.name} [Add-on]`),
        ...(Number(o.boxes?.["15"]||0) ? [`${o.boxes["15"]}x ₱15 box`] : []),
        ...(Number(o.boxes?.["25"]||0) ? [`${o.boxes["25"]}x ₱25 box`] : []),
      ].join(", ");
      return `
        <tr>
          <td>#${escapeHtml(o.orderNumber ?? "—")}<br><small>${escapeHtml(orderDay(o))}</small></td>
          <td>${timeStr}</td>
          <td style="max-width:320px;">${escapeHtml(itemSummary)}</td>
          <td>${peso(o.total || 0)}</td><td><button class="btn btn-sm btn-secondary" data-reprint-order="${o.id}">Reprint</button></td>
        </tr>`;
    })
    .join("") || `<tr><td colspan="5" style="opacity:.6;">No orders yet.</td></tr>`;
  recentBody.querySelectorAll("[data-reprint-order]").forEach(btn => btn.addEventListener("click", async () => {
    const order = allOrders.find(o => o.id === btn.dataset.reprintOrder);
    if (!order) return;
    try { await printOrder(order); } catch(e) { showError(`Unable to print: ${e.message}`); }
  }));
  renderPagination("recent-orders-pagination", orders.length, ordersPage.currentPage, (page) => {
    pagination.recentOrders = page;
    renderDashboard();
  });
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
    renderDashboard();
  }, e => showError(`Categories could not load: ${e.message}`));
  onSnapshot(query(collection(db, "menu"), orderBy("sortOrder")), (snap) => {
    menuItems = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMenuAdmin();
    renderDashboard();
  }, e => showError(`Menu could not load: ${e.message}`));
}

function renderMenuAdmin() {
  const root = document.getElementById("menu-admin-root");
  root.innerHTML = "";
  categories.forEach((cat) => {
    const items = menuItems.filter((i) => i.category === cat.name);
    if (!pagination.menuCats[cat.id]) pagination.menuCats[cat.id] = 1;
    const itemsPage = paginate(items, pagination.menuCats[cat.id]);
    pagination.menuCats[cat.id] = itemsPage.currentPage;
    const block = document.createElement("div");
    block.className = "menu-cat-block";
    block.innerHTML = `
      <div class="menu-cat-header">
        <div class="menu-cat-title">
          <h3>${escapeHtml(cat.name)}</h3>
          <span class="count">${items.length} item${items.length === 1 ? "" : "s"}</span>
        </div>
        <div class="menu-cat-actions">
          <button class="btn btn-sm btn-outline" data-add-item="${escapeHtml(cat.name)}">+ Add item</button>
          <button class="btn btn-sm btn-icon-only btn-outline" data-del-cat="${cat.id}" title="Delete empty category" aria-label="Delete category">🗑</button>
        </div>
      </div>
      <div class="table-scroll-wrap">
        <table class="data-table menu-table">
          <thead><tr><th>Item</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${
              itemsPage.items
                .map(
                  (it) => `
            <tr class="${it.available === false ? "row-unavailable" : ""}">
              <td data-label="Item">${escapeHtml(it.name)}</td>
              <td data-label="Price">${it.priceLarge ? peso(it.price) + " / " + peso(it.priceLarge) + " (M/L)" : peso(it.price)}</td>
              <td data-label="Status">
                <span class="status-badge ${it.available === false ? "status-off" : "status-on"}">
                  ${it.available === false ? "Unavailable" : "Available"}
                </span>
              </td>
              <td data-label="Actions">
                <div class="action-btn-group">
                  <button class="btn btn-sm btn-outline" data-edit="${it.id}">Edit</button>
                  <button class="btn btn-sm ${it.available === false ? "btn-secondary" : "btn-outline"}" data-toggle="${it.id}">
                    ${it.available === false ? "Enable" : "Disable"}
                  </button>
                  <button class="btn btn-sm btn-danger" data-del="${it.id}">Delete</button>
                </div>
              </td>
            </tr>`,
                )
                .join("") || `<tr class="empty-row"><td colspan="4">No items yet — add one above.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      <div class="table-pagination" data-cat-pagination="${cat.id}"></div>
    `;
    root.appendChild(block);
    renderPagination(
      null,
      items.length,
      itemsPage.currentPage,
      (page) => {
        pagination.menuCats[cat.id] = page;
        renderMenuAdmin();
      },
      block.querySelector(`[data-cat-pagination="${cat.id}"]`),
    );
  });

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
      await confirmDialog("Delete menu item?", "This permanently removes the product from the menu.", async () => {
        await deleteDoc(doc(db, "menu", b.dataset.del));
      });
    }),
  );
  root.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      const item = menuItems.find((i) => i.id === b.dataset.toggle);
      if (!item) return;
      try { await updateDoc(doc(db, "menu", item.id), { available: item.available === false }); }
      catch (e) { showError(e.message); }
    }),
  );
  root.querySelectorAll("[data-del-cat]").forEach((b) =>
    b.addEventListener("click", async () => {
      const cat = categories.find((c) => c.id === b.dataset.delCat);
      const hasItems = menuItems.some((i) => i.category === cat.name);
      if (hasItems) {
        showError("Move or delete every item in this category first.");
        return;
      }
      await confirmDialog("Delete category?", `Remove “${cat.name}” from the menu?`, async () => {
        await deleteDoc(doc(db, "categories", cat.id));
      });
    }),
  );
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

/* ---- Add category ---- */

function openCategoryModal() {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-sheet category-modal">
        <h3>Add category</h3>
        <p class="modal-subtitle">Create a new menu group for your items.</p>
        <form id="category-form" class="modal-form">
          <div class="field">
            <span class="field-label">Category name</span>
            <input type="text" id="category-name" required placeholder="e.g. Seasonal Drinks" autofocus />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline btn-block" id="modal-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary btn-block">Add category</button>
          </div>
        </form>
      </div>
    </div>
  `;

  modalRoot.querySelector("#modal-cancel").addEventListener("click", () => (modalRoot.innerHTML = ""));
  modalRoot.querySelector("#category-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("category-name").value.trim();
    if (!name) return;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      showFormError(modalRoot.querySelector("#category-form"), "A category with that name already exists.");
      return;
    }
    const nextOrder = categories.length ? Math.max(...categories.map((c) => c.order)) + 1 : 0;
    const save = modalRoot.querySelector('button[type="submit"]');
    save.disabled = true;
    try {
      await addDoc(collection(db, "categories"), { name, order: nextOrder });
      modalRoot.innerHTML = "";
    } catch (err) { save.disabled = false; showFormError(modalRoot.querySelector("#category-form"), err.message); }
  });
}

document.getElementById("add-category-btn").addEventListener("click", openCategoryModal);

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
    if (!name || !category || !Number.isFinite(price) || price < 0 || (priceLarge !== null && (!Number.isFinite(priceLarge) || priceLarge < price))) {
      showFormError(modalRoot.querySelector("#item-form"), "Enter a valid price. Large size must cost at least the base price.");
      return;
    }

    const payload = { name, category, price, priceLarge, available: item ? item.available !== false : true };

    const save = modalRoot.querySelector('button[type="submit"]');
    save.disabled = true;
    try {
      if (isEdit) await updateDoc(doc(db, "menu", item.id), payload);
      else {
        const maxSort = menuItems.length ? Math.max(...menuItems.map(i => i.sortOrder || 0)) : 0;
        await addDoc(collection(db, "menu"), { ...payload, sortOrder: maxSort + 1 });
      }
      modalRoot.innerHTML = "";
    } catch(err) { save.disabled = false; showFormError(modalRoot.querySelector("#item-form"), err.message); }
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
  try {
    await setPins({ adminPin, staffPin });
    msg.textContent = "PINs saved.";
    msg.style.color = "var(--green)";
  } catch(err) { msg.textContent = `Could not save: ${err.message}`; msg.style.color = "var(--red)"; return; }
  setTimeout(() => (msg.textContent = ""), 2500);
});

/* ---------------- Boot ---------------- */

(async function init() {
  try {
    await maybeSeedMenu();
    try { await splitDrinkCategories(); } catch(e) { console.error("Drink category migration failed",e); showError(`Check Shake / Frappé categories in Menu: ${e.message}`); }
    await Promise.all([listenOrders(), listenMenuAdmin(), loadSettingsForm()]);
  } catch (err) {
    console.error("Admin initialization failed:", err);
    showError(`Unable to load admin data: ${err.message}`);
  }
})();


function showError(message) {
  const banner = document.getElementById("connection-banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
}
function showFormError(form, message) {
  let el = form.querySelector(".form-error");
  if (!el) {
    el = document.createElement("p");
    el.className = "form-error";
    el.setAttribute("role", "alert");
    form.appendChild(el);
  }
  el.textContent = message;
}
async function confirmDialog(title, message, onConfirm) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal-sheet confirmation-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
    <h3>${escapeHtml(title)}</h3><p class="modal-subtitle">${escapeHtml(message)}</p>
    <p class="form-error" role="alert"></p>
    <div class="modal-actions"><button class="btn btn-outline" type="button" data-cancel>Cancel</button>
    <button class="btn btn-danger" type="button" data-confirm>Yes, delete</button></div></div></div>`;
  const dialog = modalRoot.querySelector(".modal-backdrop");
  const close = () => modalRoot.replaceChildren();
  dialog.querySelector("[data-cancel]").onclick = close;
  dialog.addEventListener("click", e => { if (e.target === dialog) close(); });
  dialog.querySelector("[data-confirm]").onclick = async e => {
    e.currentTarget.disabled = true;
    try { await onConfirm(); close(); }
    catch (error) { dialog.querySelector(".form-error").textContent = error.message; e.currentTarget.disabled = false; }
  };
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && modalRoot.hasChildNodes()) modalRoot.replaceChildren();
});

/* Finance ledger and order adjustment: single-form modals, no browser prompts */
function openFormModal(title, fields, onSave) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal-sheet finance-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><h3>${escapeHtml(title)}</h3><form id="unified-form" class="modal-form">${fields.map(f => `<label class="field"><span class="field-label">${escapeHtml(f.label)}</span>${f.kind === "textarea" ? `<textarea name="${f.key}" rows="3">${escapeHtml(String(f.value ?? ""))}</textarea>` : `<input name="${f.key}" type="${f.kind || "text"}" ${f.kind === "number" ? 'min="0" step="0.01"' : ""} value="${escapeHtml(String(f.value ?? ""))}" ${f.required === false ? "" : "required"}>`}</label>`).join("")}<p class="form-error" id="unified-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn btn-outline" id="unified-cancel">Cancel</button><button type="submit" class="btn btn-primary" id="unified-save">Save changes</button></div></form></div></div>`;
  const form = modalRoot.querySelector("#unified-form");
  const close = () => modalRoot.replaceChildren();
  modalRoot.querySelector("#unified-cancel").onclick = close;
  modalRoot.querySelector(".modal-backdrop").addEventListener("click", e => { if (e.target.classList.contains("modal-backdrop")) close(); });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const save = form.querySelector("#unified-save"); save.disabled = true; save.textContent = "Saving…";
    try { await onSave(values); close(); }
    catch (err) { form.querySelector("#unified-error").textContent = `Unable to save: ${err.message}`; save.disabled = false; save.textContent = "Try again"; }
  });
}
function financeEditor(type, entry = null) {
  const label = type === "expenses" ? "Expense" : "Cash on Hand";
  openFormModal(`${entry ? "Edit" : "Add"} ${label}`, [
    {key:"description",label:"Description",value:entry?.description || ""},
    {key:"amount",label:"Amount (₱)",kind:"number",value:entry?.amount ?? ""}
  ], async values => {
    const amount = Number(values.amount);
    if (!values.description.trim() || !Number.isFinite(amount) || amount < 0) throw Error("Enter a description and a valid amount.");
    const data = { description: values.description.trim(), amount, updatedAt: serverTimestamp() };
    if (entry) await updateDoc(doc(db, type, entry.id), data);
    else await addDoc(collection(db, type), {...data, dayKey: selectedFinanceDay(), createdAt: serverTimestamp()});
  });
}
function financeDay(entry) {
  return entry.dayKey || (entry.createdAt?.toDate ? dayKey(entry.createdAt.toDate()) : "");
}
function selectedFinanceDay() {return document.getElementById("finance-date").value || dayKey();}
function financeForDay(type) {return financeData[type].filter(e => financeDay(e) === selectedFinanceDay());}
function renderFinance() {
  const expenses=financeForDay("expenses"), cash=financeForDay("cashEntries");
  const expenseTotal=expenses.reduce((sum,x)=>sum+Number(x.amount||0),0);
  const cashTotal=cash.reduce((sum,x)=>sum+Number(x.amount||0),0);
  document.getElementById("finance-expenses-total").textContent=peso(expenseTotal);
  document.getElementById("finance-cash-total").textContent=peso(cashTotal);
  document.getElementById("finance-balance").textContent=peso(cashTotal-expenseTotal);
  const root=document.getElementById("combined-finance-list");
  root.replaceChildren();
  const entries=[...expenses.map(e=>({...e,type:"expenses"})),...cash.map(e=>({...e,type:"cashEntries"}))];
  entries.sort((a,b)=>Number(b.createdAt?.seconds||0)-Number(a.createdAt?.seconds||0));
  if(!entries.length) {const p=document.createElement("p");p.className="muted";p.textContent="No cash or expense entries for this date.";root.appendChild(p);return;}
  entries.forEach(entry=>{
    const row=document.createElement("div");row.className="ledger-row";
    const text=document.createElement("span");text.textContent=`${entry.type==="expenses"?"Expense":"Cash"}: ${entry.description} — ${peso(entry.amount)}`;
    const edit=document.createElement("button");edit.type="button";edit.className="btn btn-sm btn-outline";edit.textContent="Edit";edit.onclick=()=>financeEditor(entry.type,entry);
    const del=document.createElement("button");del.type="button";del.className="btn btn-sm btn-outline";del.textContent="Delete";
    del.onclick=()=>openFormModal("Delete entry",[{key:"confirmation",label:`Type DELETE to remove ${entry.description}`}],async v=>{if(v.confirmation!=="DELETE")throw Error("Type DELETE to confirm.");await deleteDoc(doc(db,entry.type,entry.id));});
    row.append(text,edit,del);root.appendChild(row);
  });
}
document.getElementById("finance-date").value=dayKey();
document.getElementById("finance-date").addEventListener("change",renderFinance);
document.getElementById("finance-today").addEventListener("click",()=>{document.getElementById("finance-date").value=dayKey();renderFinance();});
document.getElementById("print-finances").addEventListener("click", async()=>{
  if(session?.role!=="admin")return;
  try {await printFinanceReport(selectedFinanceDay(),financeForDay("expenses"),financeForDay("cashEntries"));}
  catch(e){showError(`Finance print failed: ${e.message}`);}
});
document.querySelectorAll("[data-finance-add]").forEach(b=>b.addEventListener("click",()=>financeEditor(b.dataset.financeAdd)));
authReady.then(()=>["expenses","cashEntries"].forEach(type=>onSnapshot(collection(db,type),snap=>{
  financeData[type]=snap.docs.map(d=>({id:d.id,...d.data()}));renderFinance();
},e=>showError(`Unable to load ${type}: ${e.message}`)))).catch(console.error);
let lastDate=dayKey();
setInterval(()=>{
  const today=dayKey();
  if(today===lastDate)return;
  if(document.getElementById("finance-date").value===lastDate)document.getElementById("finance-date").value=today;
  lastDate=today;renderDashboard();renderFinance();
},60000);
