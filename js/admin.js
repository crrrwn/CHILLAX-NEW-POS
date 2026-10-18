import { db, authReady } from "./firebase-config.js";
import { requireRole, logout, getPins, setPins } from "./auth.js";
import { SEED_CATEGORIES, SEED_MENU } from "./seed-menu.js";
import { printOrder, printFinanceReport } from "./receipt.js";
import { dayKey, pesos, countRevenue, orderBoxes, manualBoxesForOrder, repriceEditedOrder, boxTotal, lineDiscountAmount, itemDiscountTotal, isDiscountableFood } from "./business.js";
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

/** Non-destructive catalog sync. Existing menu rows (including manually
 * changed prices and availability) stay untouched. New items get stable IDs,
 * so refreshing the admin page cannot create duplicates. */
async function syncNewCatalog() {
  await authReady;
  const [catsSnap, menuSnap] = await Promise.all([
    getDocs(collection(db,"categories")), getDocs(collection(db,"menu"))
  ]);
  const presentCats = new Set(catsSnap.docs.map(d=>d.data().name));
  const presentItems = new Set(menuSnap.docs.map(d=>`${d.data().category}\u0000${d.data().name}`.toLowerCase()));
  const needsCats = SEED_CATEGORIES.filter(name=>!presentCats.has(name));
  const needsItems = SEED_MENU.filter(it=>!presentItems.has(`${it.category}\u0000${it.name}`.toLowerCase()));
  if (!needsCats.length && !needsItems.length) return;
  const batch = writeBatch(db);
  // Stable suffix keeps this import safe across multiple Admin sessions.
  const safeId = text => Array.from(new TextEncoder().encode(text)).map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,240);
  const maxSort = Math.max(0,...menuSnap.docs.map(d=>Number(d.data().sortOrder||0)));
  const maxCat = Math.max(0,...catsSnap.docs.map(d=>Number(d.data().order||0)));
  needsCats.forEach((name,i)=>batch.set(doc(db,"categories",`catalog-${safeId(name)}`),{name,order:maxCat+i+1}));
  needsItems.forEach((item,i)=>batch.set(doc(db,"menu",`catalog-${safeId(item.category+"/"+item.name)}`),{
    ...item,sortOrder:maxSort+i+1
  }));
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
    groupTotals.set(category, (groupTotals.get(category) || 0) + Number(it.unitPrice || 0) * Number(it.qty || 0) - (o.discountMode === "perItem" ? lineDiscountAmount(it) : 0));
  }));
  // Show non-product charges too, so the category breakdown reconciles with Total Sales.
  groupTotals.set("Additional add-on charges", orders.reduce((sum,o)=>sum+(o.addons||[]).reduce((a,it)=>a+Number(it.qty||0)*Number(it.unitPrice||0),0),0));
  groupTotals.set("Takeout boxes", orders.reduce((sum,o)=>sum+orderBoxes(o),0));
  // Historical overall discounts are not included in item rows.
  groupTotals.set("Legacy discounts", -orders.reduce((sum,o)=>sum+Number(o.legacyDiscountAmount || (o.discountMode !== "perItem" ? o.discountAmount || 0 : 0)),0));
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
      cur.revenue += (it.unitPrice || 0) * (it.qty || 0) - (o.discountMode === "perItem" ? lineDiscountAmount(it) : 0);
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
          <td>${peso(o.total || 0)}${o.editCount ? `<br><small>Edited ${o.editCount}×</small>` : ""}</td>
          <td><div class="action-btn-group"><button class="btn btn-sm btn-primary" data-edit-order="${o.id}">Edit Order</button><button class="btn btn-sm btn-secondary" data-reprint-order="${o.id}">Reprint</button></div></td>
        </tr>`;
    })
    .join("") || `<tr><td colspan="5" style="opacity:.6;">No orders yet.</td></tr>`;
  recentBody.querySelectorAll("[data-reprint-order]").forEach(btn => btn.addEventListener("click", async () => {
    const order = allOrders.find(o => o.id === btn.dataset.reprintOrder);
    if (!order) return;
    try { await printOrder(categorizedOrder(order)); } catch(e) { showError(`Unable to print: ${e.message}`); }
  }));
  recentBody.querySelectorAll("[data-edit-order]").forEach(btn => btn.addEventListener("click", () => {
    const order = allOrders.find(o => o.id === btn.dataset.editOrder);
    if (order) openOrderEditor(order);
  }));
  renderPagination("recent-orders-pagination", orders.length, ordersPage.currentPage, (page) => {
    pagination.recentOrders = page;
    renderDashboard();
  });
}

/* ================= ORDER EDITOR (ADMIN ONLY) ================= */

// Firestore security still uses anonymous sign-in for this legacy POS.
// requireRole restricts this UI, but real server-side admin authorization
// needs authenticated, claim-based roles before public deployment.
function orderEditFingerprint(order) {
  return JSON.stringify({
    items: order.items || [], addons: order.addons || [], boxes: order.boxes || null,
    total: order.total, packagingFee: order.packagingFee,
    legacyPackagingFee: order.legacyPackagingFee, customerName: order.customerName,
    orderType: order.orderType, paymentMethod: order.paymentMethod,
    updatedAt: order.updatedAt || null
  });
}

function categorizedOrder(order) {
  return {
    ...order,
    items: (order.items || []).map(item => ({
      ...item,
      category: item.category ||
        menuItems.find(m => (item.menuId && m.id === item.menuId) || m.name === item.name)?.category ||
        (item.isAddon ? "Add Ons" : "Category not recorded")
    }))
  };
}

function openOrderEditor(order) {
  if (session?.role !== "admin" || !order) return;
  const original = categorizedOrder(order);
  // Copy item metadata (menuId, custom fields, etc.) so editing prices never
  // deletes product references or modifiers from an existing order.
  const bases = (original.items || []).map(item => ({...item}));
  const addonBases = (original.addons || []).map(addon => ({...addon}));
  const manualBoxes = manualBoxesForOrder(original);
  const categoriesList = [...new Set([
    ...categories.map(c => c.name),
    ...bases.map(item => item.category),
    "Uncategorized", "Add Ons"
  ].filter(Boolean))];
  const categoryOptions = chosen => [...new Set([...categoriesList, chosen])].map(name =>
    `<option value="${escapeHtml(name)}" ${name === chosen ? "selected" : ""}>${escapeHtml(name)}</option>`
  ).join("");
  const itemRow = item => {
    const index = bases.push({...item}) - 1;
    const category = item.category || "Uncategorized";
    return `<div class="order-edit-row" data-edit-item data-base="${index}">
      <div class="edit-row-header"><strong>Product / Meal</strong><button type="button" class="btn btn-sm btn-outline" data-remove-row>Remove</button></div>
      <div class="edit-fields">
        <label class="field">Name<input data-field="name" type="text" maxlength="120" required value="${escapeHtml(item.name || "")}"></label>
        <label class="field">Category<select data-field="category">${categoryOptions(category)}</select></label>
        <label class="field">Quantity<input data-field="qty" type="number" min="1" max="999" step="1" required value="${Number(item.qty || 1)}"></label>
        <label class="field">Unit price (₱)<input data-field="unitPrice" type="number" min="0" max="1000000" step="0.01" required value="${Number(item.unitPrice || 0)}"></label>
        <label class="field">Service<select data-field="serveType"><option value="Dine In" ${item.serveType !== "Take Out" ? "selected" : ""}>Dine In</option><option value="Take Out" ${item.serveType === "Take Out" ? "selected" : ""}>Take Out</option></select></label>
        <label class="field">Box per serving<select data-field="boxChoice">
          <option value="auto" ${(item.boxChoice == null || item.boxChoice === "auto") ? "selected" : ""}>Auto (meals/fries ₱15; Sharing/Family none)</option>
          <option value="15" ${String(item.boxChoice) === "15" ? "selected" : ""}>₱15</option>
          <option value="25" ${String(item.boxChoice) === "25" ? "selected" : ""}>₱25</option>
          <option value="0" ${String(item.boxChoice) === "0" ? "selected" : ""}>No box</option>
        </select></label>
        <label class="field">Size (optional)<input data-field="size" type="text" maxlength="40" value="${escapeHtml(item.size || "")}"></label>
        <label class="field">Note (optional)<input data-field="note" type="text" maxlength="180" value="${escapeHtml(item.note || "")}"></label>
      </div>
      ${isDiscountableFood(item) ? `<div class="edit-item-discount">
        <label class="edit-addon-check"><input data-field="discountEnabled" type="checkbox" ${Number(item.discountRate || 0) > 0 ? "checked" : ""}> Discount this item</label>
        <select data-field="discountRate" aria-label="Item discount" ${Number(item.discountRate || 0) > 0 ? "" : "disabled"}>
          <option value="10" ${Number(item.discountRate) === 10 ? "selected" : ""}>10% discount</option>
          <option value="20" ${Number(item.discountRate) === 20 ? "selected" : ""}>20% discount</option>
        </select>
      </div>` : ""}
      <label class="edit-addon-check"><input data-field="isAddon" type="checkbox" ${item.isAddon ? "checked" : ""}> Include in add-on sales</label>
    </div>`;
  };
  const addonRow = addon => {
    const index = addonBases.push({...addon}) - 1;
    return `<div class="order-edit-row order-edit-addon" data-edit-addon data-base="${index}">
      <div class="edit-row-header"><strong>Extra add-on</strong><button type="button" class="btn btn-sm btn-outline" data-remove-row>Remove</button></div>
      <div class="edit-fields">
        <label class="field">Name<input data-field="name" type="text" maxlength="120" required value="${escapeHtml(addon.name || "")}"></label>
        <label class="field">Quantity<input data-field="qty" type="number" min="1" max="999" step="1" required value="${Number(addon.qty || 1)}"></label>
        <label class="field">Unit price (₱)<input data-field="unitPrice" type="number" min="0" max="1000000" step="0.01" required value="${Number(addon.unitPrice || 0)}"></label>
      </div>
    </div>`;
  };
  modalRoot.innerHTML = `<div class="modal-backdrop order-edit-backdrop">
    <div class="modal-sheet order-edit-modal" role="dialog" aria-modal="true" aria-labelledby="order-edit-heading">
      <h3 id="order-edit-heading">Edit Order #${escapeHtml(order.orderNumber)} <small>(${escapeHtml(orderDay(order))})</small></h3>
      <p class="modal-subtitle">Edit the saved customer's order. Changes recalculate sales and all 3 receipt copies; the original order number and date stay the same.</p>
      <form id="order-edit-form" class="modal-form">
        <div class="edit-top-fields">
          <label class="field">Customer<input id="edit-customer" type="text" maxlength="100" value="${escapeHtml(original.customerName || "")}"></label>
          <label class="field">Order Type<select id="edit-order-type"><option value="Dine In" ${original.orderType !== "Take Out" ? "selected" : ""}>Dine In</option><option value="Take Out" ${original.orderType === "Take Out" ? "selected" : ""}>Take Out</option></select></label>
          <label class="field">Payment (managed in Finance)<select id="edit-payment" disabled><option value="Cash" ${original.paymentMethod !== "GCash" ? "selected" : ""}>Cash</option><option value="GCash" ${original.paymentMethod === "GCash" ? "selected" : ""}>GCash</option></select></label>
        </div>
        <p class="modal-subtitle"><strong>Discount:</strong> tick “Discount this item” on the specific food item, then choose 10% or 20%. Other items and boxes are not discounted.</p>
        <h4>Ordered items</h4>
        <div id="edit-items">${(original.items || []).map(itemRow).join("")}</div>
        <div class="edit-add-row">
          <select id="edit-product-choice" aria-label="Choose menu item to add"><option value="">Custom item</option>${menuItems.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.category)} · ${escapeHtml(m.name)} (${peso(m.price)})</option>`).join("")}</select>
          <button type="button" class="btn btn-sm btn-secondary" id="edit-add-product">+ Add product</button>
        </div>
        <h4>Extra add-ons</h4>
        <div id="edit-addons">${(original.addons || []).map(addonRow).join("")}</div>
        <button type="button" class="btn btn-sm btn-outline" id="edit-add-addon">+ Add add-on</button>
        <h4>Extra takeout boxes</h4>
        <p class="modal-subtitle">These are manually punched extras. Meals/fries automatically use ₱15 for Take Out; Sharing/Family boxes are manual only.</p>
        <div class="edit-box-fields">
          <label class="field">Extra ₱15 boxes<input type="number" id="edit-box15" min="0" max="999" step="1" value="${manualBoxes["15"]}"></label>
          <label class="field">Extra ₱25 boxes<input type="number" id="edit-box25" min="0" max="999" step="1" value="${manualBoxes["25"]}"></label>
        </div>
        <div class="edit-price-summary" id="edit-price-summary" aria-live="polite"></div>
        <p id="edit-order-error" class="form-error" role="alert"></p>
        <div class="modal-actions edit-order-actions">
          <button class="btn btn-outline" type="button" id="edit-order-cancel">Cancel</button>
          <button class="btn btn-primary" type="submit" id="edit-order-save">Save updated order</button>
        </div>
      </form>
    </div>
  </div>`;
  const form = modalRoot.querySelector("#order-edit-form");
  const input = (row, field) => row.querySelector(`[data-field="${field}"]`);
  const numeric = (row, field) => {
    const raw = input(row, field).value.trim();
    return raw === "" ? NaN : Number(raw);
  };
  function draft() {
    const items = [...form.querySelectorAll("[data-edit-item]")].map(row => ({
      ...bases[Number(row.dataset.base)],
      name:input(row,"name").value, category:input(row,"category").value,
      qty:numeric(row,"qty"),unitPrice:numeric(row,"unitPrice"),
      serveType:input(row,"serveType").value,boxChoice:input(row,"boxChoice").value,
      size:input(row,"size").value,note:input(row,"note").value,
      isAddon:input(row,"isAddon").checked,
      discountRate:input(row,"discountEnabled")?.checked ? Number(input(row,"discountRate").value) : 0
    }));
    const addons = [...form.querySelectorAll("[data-edit-addon]")].map(row => ({
      ...addonBases[Number(row.dataset.base)],
      name:input(row,"name").value,qty:numeric(row,"qty"),unitPrice:numeric(row,"unitPrice")
    }));
    return {
      items,addons,
      customerName:form.querySelector("#edit-customer").value,
      orderType:form.querySelector("#edit-order-type").value,
      paymentMethod:form.querySelector("#edit-payment").value,
      manualBoxes:{"15":Number(form.querySelector("#edit-box15").value), "25":Number(form.querySelector("#edit-box25").value)}
    };
  }
  function refreshTotal() {
    const preview = form.querySelector("#edit-price-summary");
    try {
      const priced = repriceEditedOrder(original, draft());
      const productTotal = priced.items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
      const extraTotal = priced.addons.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
      preview.innerHTML = `<div>Products: <strong>${peso(productTotal)}</strong></div>
        <div>Selected item discounts: <strong>−${peso(itemDiscountTotal(priced.items))}</strong></div>
        <div>Extra add-ons: <strong>${peso(extraTotal)}</strong></div>
        <div>Takeout boxes: <strong>${peso(boxTotal(priced.boxes))}</strong></div>
        ${priced.legacyPackagingFee ? `<div>Previous packaging: <strong>${peso(priced.legacyPackagingFee)}</strong></div>` : ""}
        <div class="edit-summary-total">New Total: <strong>${peso(priced.total)}</strong></div>
        <div class="edit-summary-old">Previous Total: ${peso(original.total)}</div>`;
    } catch(e) {preview.textContent = `Complete all required quantities and prices to preview the new total. ${e.message}`;}
  }
  form.addEventListener("input", refreshTotal);
  form.addEventListener("change", event => {
    if (event.target.matches('[data-field="discountEnabled"]')) {
      const row = event.target.closest('[data-edit-item]');
      row.querySelector('[data-field="discountRate"]').disabled = !event.target.checked;
    }
  });
  form.addEventListener("change", refreshTotal);
  form.addEventListener("click", e => {
    const remove = e.target.closest("[data-remove-row]");
    if (remove) {remove.closest(".order-edit-row").remove(); refreshTotal();}
  });
  form.querySelector("#edit-add-product").onclick = () => {
    const chosen = menuItems.find(m => m.id === form.querySelector("#edit-product-choice").value);
    const next = chosen ? {menuId:chosen.id,name:chosen.name,category:chosen.category,qty:1,unitPrice:Number(chosen.price),serveType:original.orderType,boxChoice:"auto",size:null,note:"",isAddon:/add\s*ons?/i.test(chosen.category),discountRate:0}
      : {name:"",category:categoriesList[0] || "Uncategorized",qty:1,unitPrice:0,serveType:"Dine In",boxChoice:"auto",size:null,note:"",isAddon:false};
    form.querySelector("#edit-items").insertAdjacentHTML("beforeend",itemRow(next));
    refreshTotal();
    form.querySelector("#edit-items .order-edit-row:last-child [data-field=name]").focus();
  };
  form.querySelector("#edit-add-addon").onclick = () => {
    form.querySelector("#edit-addons").insertAdjacentHTML("beforeend",addonRow({name:"",qty:1,unitPrice:0}));
    refreshTotal();
    form.querySelector("#edit-addons .order-edit-row:last-child [data-field=name]").focus();
  };
  const close = () => modalRoot.replaceChildren();
  form.querySelector("#edit-order-cancel").onclick = close;
  modalRoot.querySelector(".order-edit-backdrop").addEventListener("click", e => {if (e.target.classList.contains("order-edit-backdrop")) close();});
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const button = form.querySelector("#edit-order-save");
    const errorNode = form.querySelector("#edit-order-error");
    errorNode.textContent = "";
    try {
      const payload = repriceEditedOrder(original, draft());
      button.disabled = true;
      button.textContent = "Saving changes…";
      await authReady;
      await runTransaction(db, async tx => {
        const ref = doc(db, "orders", order.id);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists()) throw Error("Order no longer exists.");
        const current = snapshot.data();
        const gcashSnap = await tx.get(doc(db,"gcashPayments",order.id));
        if (gcashSnap.exists() && Number(gcashSnap.data().amount||0) > payload.total)
          throw Error("This order has a GCash payment higher than the new total. Update the GCash entry first.");
        // Checking editCount avoids false conflicts from serializing Firestore
        // Timestamp values. It only blocks a genuinely newer admin edit.
        if (Number(current.editCount || 0) !== Number(order.editCount || 0))
          throw Error("A newer edit exists. Reopen this order before saving again.");
        tx.update(ref, {
          ...payload,
          // A linked GCash finance entry takes precedence over an old form value.
          paymentMethod:gcashSnap.exists() ? "GCash" : payload.paymentMethod,
          updatedAt:serverTimestamp(),
          editCount:Number(current.editCount || 0) + 1,
          editHistory:[...(current.editHistory || []).slice(-19), {
            editedAt:new Date().toISOString(),
            previousTotal:Number(current.total || 0), newTotal:payload.total,
            source:"Admin order editor"
          }]
        });
      });
      close();
    } catch(error) {
      errorNode.textContent = `Unable to save: ${error.message}`;
      button.disabled = false;
      button.textContent = "Save updated order";
    }
  });
  refreshTotal();
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
                <select class="menu-availability-select" data-availability="${it.id}" aria-label="Availability for ${escapeHtml(it.name)}">
                  <option value="available" ${it.available === false ? "" : "selected"}>Available</option>
                  <option value="unavailable" ${it.available === false ? "selected" : ""}>Not Available</option>
                </select>
              </td>
              <td data-label="Actions">
                <div class="action-btn-group">
                  <button class="btn btn-sm btn-outline" data-edit="${it.id}">Edit</button>
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
  root.querySelectorAll("[data-availability]").forEach(select =>
    select.addEventListener("change", async () => {
      const item = menuItems.find(i => i.id === select.dataset.availability);
      if (!item) return;
      const desired = select.value === "available";
      select.disabled = true;
      try {
        await updateDoc(doc(db, "menu", item.id), {available: desired});
      } catch(error) {
        select.value = item.available === false ? "unavailable" : "available";
        showError(`Could not update availability: ${error.message}`);
      } finally {select.disabled = false;}
    })
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
          <div class="field"><span class="field-label">Availability</span>
            <select id="item-availability"><option value="available" ${item?.available === false ? "" : "selected"}>Available</option><option value="unavailable" ${item?.available === false ? "selected" : ""}>Not Available</option></select>
          </div>
          <div class="field"><span class="field-label">Sizes / variants (Size | Price, one per line, optional)</span>
            <textarea id="item-variants" rows="3" placeholder="Small | 699&#10;Large | 1399">${item?.variants?.map(v=>escapeHtml(`${v.label} | ${v.price}`)).join("\n") || ""}</textarea>
          </div>
          <div class="field"><span class="field-label">Description (optional)</span>
            <textarea id="item-description" rows="2">${escapeHtml(item?.description || "")}</textarea>
          </div>
          <div class="field"><span class="field-label">Party Box choices (one per line, optional)</span>
            <textarea id="item-combo-options" rows="3">${(item?.comboOptions || []).map(escapeHtml).join("\n")}</textarea>
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

    const rawVariants = document.getElementById("item-variants").value.trim();
    let variants = [];
    if (rawVariants) {
      try {
        variants = rawVariants.split(/\r?\n/).filter(Boolean).map(line => {
          const parts = line.split("|");
          if (parts.length !== 2) throw Error("Use Size | Price for each variant.");
          const label=parts[0].trim(), variantPrice=Number(parts[1].trim());
          if (!label || !Number.isFinite(variantPrice) || variantPrice<0) throw Error("Invalid variant: "+line);
          return {label,price:variantPrice};
        });
      } catch (error) { showFormError(modalRoot.querySelector("#item-form"),error.message);return; }
    }
    const payload = { name, category, price, priceLarge, variants,
      description:document.getElementById("item-description").value.trim().slice(0,500),
      comboOptions:document.getElementById("item-combo-options").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,25),
      available:document.getElementById("item-availability").value === "available" };

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
    try { await syncNewCatalog(); } catch(e) {console.error("Menu import failed", e); showError(`Menu additions were not imported: ${e.message}`);}
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

/* Finance ledger (Cash + Expenses + GCash linked to existing orders). */
function openFormModal(title, fields, onSave) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal-sheet finance-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><h3>${escapeHtml(title)}</h3><form id="unified-form" class="modal-form">${fields.map(f=>`<label class="field"><span class="field-label">${escapeHtml(f.label)}</span>${f.kind==="textarea"?`<textarea name="${f.key}" rows="3">${escapeHtml(String(f.value??""))}</textarea>`:`<input name="${f.key}" type="${f.kind||"text"}" ${f.kind==="number"?'min="0" step="0.01"':""} value="${escapeHtml(String(f.value??""))}" ${f.required===false?"":"required"}>`}</label>`).join("")}<p class="form-error" id="unified-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn btn-outline" id="unified-cancel">Cancel</button><button type="submit" class="btn btn-primary" id="unified-save">Save</button></div></form></div></div>`;
  const form=modalRoot.querySelector("#unified-form"), close=()=>modalRoot.replaceChildren();
  modalRoot.querySelector("#unified-cancel").onclick=close;
  modalRoot.querySelector(".modal-backdrop").onclick=e=>{if(e.target.classList.contains("modal-backdrop"))close();};
  form.addEventListener("submit",async e=>{
    e.preventDefault();const values=Object.fromEntries(new FormData(form).entries());
    const save=form.querySelector("#unified-save");save.disabled=true;save.textContent="Saving…";
    try{await onSave(values);close();}catch(err){form.querySelector("#unified-error").textContent=err.message;save.disabled=false;save.textContent="Try again";}
  });
}
function financeEditor(type,entry=null){
  const label=type==="expenses"?"Expense":"Cash on Hand";
  openFormModal(`${entry?"Edit":"Add"} ${label}`,[
    {key:"description",label:"Description",value:entry?.description||""},
    {key:"amount",label:"Amount (₱)",kind:"number",value:entry?.amount??""}
  ],async values=>{
    const amount=Number(values.amount);
    if(!values.description.trim()||!Number.isFinite(amount)||amount<0)throw Error("Enter a description and valid amount.");
    const data={description:values.description.trim(),amount,updatedAt:serverTimestamp()};
    if(entry)await updateDoc(doc(db,type,entry.id),data);
    else await addDoc(collection(db,type),{...data,dayKey:selectedFinanceDay(),createdAt:serverTimestamp()});
  });
}
function financeDay(entry){return entry.dayKey||(entry.createdAt?.toDate?dayKey(entry.createdAt.toDate()):"");}
function selectedFinanceDay(){return document.getElementById("finance-date").value||dayKey();}
function financeForDay(type){return financeData[type].filter(e=>financeDay(e)===selectedFinanceDay());}
function gcashOrderOptions(day){
  // Only orders actually saved for the selected date can be linked.
  return allOrders.filter(o=>orderDay(o)===day).sort((a,b)=>Number(a.orderNumber||0)-Number(b.orderNumber||0));
}
function gcashEditor(entry=null){
  const orders=gcashOrderOptions(entry?.dayKey||selectedFinanceDay());
  if(!orders.length){showError("No saved orders exist on the selected date. Create an order first.");return;}
  const alreadyPaid=new Set(financeData.gcashPayments.filter(p=>p.id!==entry?.id).map(p=>p.orderId));
  const available=orders.filter(o=>!alreadyPaid.has(o.id)||o.id===entry?.orderId);
  if(!available.length){showError("All orders for this date already have GCash entries.");return;}
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal-sheet finance-modal" role="dialog" aria-modal="true" aria-label="GCash payment"><h3>${entry?"Edit":"Add"} GCash Payment</h3>
    <p class="modal-subtitle">Link payment to a saved order from ${escapeHtml(entry?.dayKey||selectedFinanceDay())}. Only one GCash entry per order. Payment will not increase sales twice.</p>
    <form id="gcash-form" class="modal-form">
      <label class="field">Saved order (required)<select id="gcash-order" required>${available.map(o=>`<option value="${escapeHtml(o.id)}" ${o.id===(entry?.orderId||"")?"selected":""}>#${escapeHtml(o.orderNumber)} — ${escapeHtml(o.customerName||"Walk-in")} — ${peso(o.total)}</option>`).join("")}</select></label>
      <label class="field">Description (required)<input id="gcash-desc" type="text" maxlength="160" required value="${escapeHtml(entry?.description||"")}" placeholder="e.g. Paid via GCash reference"></label>
      <label class="field">Amount (₱) (required)<input id="gcash-amount" type="number" min="0.01" step="0.01" required value="${entry?.amount??""}"></label>
      <p class="form-error" id="gcash-error" role="alert"></p>
      <div class="modal-actions"><button type="button" class="btn btn-outline" id="gcash-cancel">Cancel</button><button type="submit" class="btn btn-primary" id="gcash-save">Save GCash Payment</button></div>
    </form></div></div>`;
  const form=modalRoot.querySelector("#gcash-form"), orderSel=form.querySelector("#gcash-order"), amountEl=form.querySelector("#gcash-amount");
  const syncAmount=()=>{if(!entry||orderSel.value!==entry.orderId)amountEl.value=String(orders.find(o=>o.id===orderSel.value)?.total??"");};
  if(!entry)syncAmount();orderSel.onchange=syncAmount;
  const close=()=>modalRoot.replaceChildren();form.querySelector("#gcash-cancel").onclick=close;
  modalRoot.querySelector(".modal-backdrop").onclick=e=>{if(e.target===e.currentTarget)close();};
  form.onsubmit=async e=>{
    e.preventDefault();const save=form.querySelector("#gcash-save"),err=form.querySelector("#gcash-error");
    const orderId=orderSel.value,amount=Number(amountEl.value),description=form.querySelector("#gcash-desc").value.trim(),targetDay=entry?.dayKey||selectedFinanceDay();
    if(!description||!Number.isFinite(amount)||amount<=0){err.textContent="A description and positive amount are required.";return;}
    save.disabled=true;save.textContent="Saving…";err.textContent="";
    try{
      await authReady;
      await runTransaction(db,async tx=>{
        const oref=doc(db,"orders",orderId),pref=doc(db,"gcashPayments",orderId);
        const [orderSnap,paySnap]=await Promise.all([tx.get(oref),tx.get(pref)]);
        if(!orderSnap.exists())throw Error("Selected order no longer exists.");
        const order=orderSnap.data();
        const docDay=order.dayKey||(order.createdAt?.toDate?dayKey(order.createdAt.toDate()):"");
        if(docDay!==targetDay)throw Error("Order does not belong to selected day.");
        if(amount>Number(order.total||0))throw Error(`Amount exceeds order total (${peso(order.total)}).`);
        if(paySnap.exists() && (!entry || entry.orderId!==orderId))throw Error("A GCash payment already exists for that order.");
        if(entry && entry.orderId!==orderId)throw Error("Order cannot change when editing a GCash payment. Delete and add a new one.");
        tx.set(pref,{orderId,orderNumber:Number(order.orderNumber),customerName:order.customerName||"",dayKey:docDay,description,amount:Math.round(amount*100)/100,
          createdAt:paySnap.exists()?paySnap.data().createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
        tx.update(oref,{paymentMethod:"GCash"});
      });
      close();
    }catch(error){err.textContent=`Unable to save: ${error.message}`;save.disabled=false;save.textContent="Save GCash Payment";}
  };
}
const FINANCE_ROWS_PER_TABLE = 5;
const financePages = {expenses:1,cashEntries:1,gcashPayments:1};
function renderFinance(){
  const expenses = financeForDay("expenses"), cash = financeForDay("cashEntries"), gcash = financeForDay("gcashPayments");
  const sum = rows => rows.reduce((amount,row) => amount + Number(row.amount || 0),0);
  // GCash is its OWN ledger: expenses are never subtracted from GCash payments.
  document.getElementById("finance-expenses-total").textContent = peso(sum(expenses));
  document.getElementById("finance-cash-total").textContent = peso(sum(cash));
  document.getElementById("finance-gcash-total").textContent = peso(sum(gcash));
  const root = document.getElementById("combined-finance-list");
  root.replaceChildren();
  for (const [type,title,entries] of [
    ["expenses","Expenses",expenses],
    ["gcashPayments","GCash Payments",gcash],
    ["cashEntries","Cash on Hand",cash]
  ]) {
    const sorted = [...entries].sort((a,b)=>Number(b.createdAt?.seconds || 0)-Number(a.createdAt?.seconds || 0));
    const pages = Math.max(1,Math.ceil(sorted.length/FINANCE_ROWS_PER_TABLE));
    financePages[type] = Math.min(Math.max(1,financePages[type]),pages);
    const start = (financePages[type]-1)*FINANCE_ROWS_PER_TABLE;
    const currentRows = sorted.slice(start,start+FINANCE_ROWS_PER_TABLE);
    const section = document.createElement("section");
    section.className = "card finance-separated-section";
    const heading = document.createElement("h3");
    heading.textContent = `${title} — ${peso(sum(entries))}`;
    section.appendChild(heading);
    const wrap = document.createElement("div");
    wrap.className = "table-scroll-wrap";
    const table = document.createElement("table");
    table.className = "data-table";
    table.innerHTML = `<thead><tr><th>${type === "gcashPayments" ? "Order #" : "Date"}</th><th>Description</th><th>Amount</th><th>Actions</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    currentRows.forEach(entry => {
      const tr = document.createElement("tr");
      const labels = [type === "gcashPayments" ? `#${entry.orderNumber ?? "—"}` : financeDay(entry), entry.description || "—", peso(entry.amount)];
      labels.forEach(label => {const td=document.createElement("td");td.textContent=label;tr.appendChild(td);});
      const actions = document.createElement("td");
      actions.className = "finance-table-actions";
      const edit = document.createElement("button");
      edit.type="button";edit.className="btn btn-sm btn-outline";edit.textContent="Edit";
      edit.onclick=()=>type==="gcashPayments"?gcashEditor(entry):financeEditor(type,entry);
      const del = document.createElement("button");
      del.type="button";del.className="btn btn-sm btn-outline";del.textContent="Delete";
      del.onclick=()=>openFormModal("Delete entry",[{key:"confirmation",label:`Type DELETE to remove ${entry.description}`}],async vals=>{
        if(vals.confirmation!=="DELETE")throw Error("Type DELETE to confirm.");
        if(type==="gcashPayments") {
          await runTransaction(db,async tx=>{
            const pref=doc(db,"gcashPayments",entry.id),oref=doc(db,"orders",entry.orderId);
            const [paymentSnap,orderSnap]=await Promise.all([tx.get(pref),tx.get(oref)]);
            if(!paymentSnap.exists())throw Error("Payment was already removed.");
            tx.delete(pref);
            if(orderSnap.exists())tx.update(oref,{paymentMethod:"Cash"});
          });
        } else await deleteDoc(doc(db,type,entry.id));
      });
      actions.append(edit,del);tr.append(actions);tbody.append(tr);
    });
    if(!currentRows.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=4;td.textContent=`No ${title.toLowerCase()} for this day.`;tr.append(td);tbody.append(tr);}
    table.appendChild(tbody);wrap.append(table);section.appendChild(wrap);
    const pager=document.createElement("div");pager.className="table-pagination";
    const label=document.createElement("span");label.textContent=`Page ${financePages[type]} of ${pages} (${entries.length} records)`;
    const prev=document.createElement("button"),next=document.createElement("button");
    for(const b of [prev,next]){b.type="button";b.className="btn btn-sm btn-outline";}
    prev.textContent="Prev";next.textContent="Next";
    prev.disabled=financePages[type]<=1;next.disabled=financePages[type]>=pages;
    prev.onclick=()=>{financePages[type]--;renderFinance();};
    next.onclick=()=>{financePages[type]++;renderFinance();};
    pager.append(label,prev,next);section.appendChild(pager);root.appendChild(section);
  }
}

financeData.gcashPayments=[];
document.getElementById("finance-date").value=dayKey();
document.getElementById("finance-date").onchange=renderFinance;
document.getElementById("finance-today").onclick=()=>{document.getElementById("finance-date").value=dayKey();renderFinance();};
document.getElementById("print-finances").onclick=async()=>{
  try{await printFinanceReport(selectedFinanceDay(),financeForDay("expenses"),financeForDay("cashEntries"),financeForDay("gcashPayments"));}
  catch(error){showError(`Finance printing failed: ${error.message}`);}
};
document.getElementById("add-gcash-payment").onclick=()=>gcashEditor();
document.querySelectorAll("[data-finance-add]").forEach(b=>b.onclick=()=>financeEditor(b.dataset.financeAdd));
authReady.then(()=>["expenses","cashEntries","gcashPayments"].forEach(type=>onSnapshot(collection(db,type),snap=>{
  financeData[type]=snap.docs.map(d=>({id:d.id,...d.data()}));renderFinance();
},e=>showError(`Unable to load ${type}: ${e.message}`)))).catch(console.error);
let lastDate=dayKey();
setInterval(()=>{
  const today=dayKey();if(today===lastDate)return;
  if(document.getElementById("finance-date").value===lastDate)document.getElementById("finance-date").value=today;
  lastDate=today;renderDashboard();renderFinance();
},60000);

/* Menu availability, individual discounts, separated finance tables */
const adminEnhanceStyles = document.createElement("style");
adminEnhanceStyles.textContent = `
@media screen {
 .edit-item-discount{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:9px 0;padding:9px;background:#fff1f7;border-radius:9px}
 .edit-item-discount select{max-width:150px;min-height:35px}
 .menu-availability-select{padding:6px;border:1px solid #d9c8bc;border-radius:8px;min-width:125px;background:#fff}
 .finance-separated-section{margin-top:16px;padding:15px;overflow:hidden}
 .finance-separated-section h3{margin:0 0 10px}
 .finance-table-actions{white-space:nowrap}
 .finance-table-actions .btn + .btn{margin-left:6px}
 .finance-separated-section .table-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:10px}
}
`;
document.head.append(adminEnhanceStyles);
