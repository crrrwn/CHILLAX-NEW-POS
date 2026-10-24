
/**
 * CHILLAX CAFE POS — ADMIN OWNERS
 *
 * Kuya Gaa and Kuya Boss sales
 * Delete Order confirmation
 * Combined GCash payments for two orders
 * Editable GCash totals
 * From / To date filters
 * Owner report printing
 */

import { db, authReady } from "./firebase-config.js";
import { requireRole } from "./auth.js";

import {
  dayKey,
  timestampDate,
  pesos,
  rounded,
  isMealItem,
  lineBoxPrice
} from "./business.js";

import { printOwnerReport } from "./receipt.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  where,
  runTransaction,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const session = requireRole(["admin"]);

if (!session || session.role !== "admin") {
  throw Error("Admin login required.");
}

const $ = id => document.getElementById(id);
const owners = ["gaa", "boss"];
const money = pesos;
const num = value => Number(value || 0);

const cents = value =>
  Math.round((Number(value) + Number.EPSILON) * 100);

const norm = value =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const keyOf = (category, name) =>
  `${norm(category)}|${norm(name)}`;

const unique = values =>
  [...new Set(values.filter(Boolean))];

const escapeHtml = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]
  );

/* DEFAULT OWNER PRODUCTS */

const defaults = {
  gaa: {
    categories: [
      "Iced Coffee (16oz)",
      "Hot Coffee (12oz)",
      "Frappé"
    ],
    items: [
      keyOf("Alacarte", "Lumpia Shanghai"),
      keyOf("All Day Breakfast", "Shanghai Silog")
    ]
  },

  boss: {
    categories: [
      "Samyang & Ramen",
      "Samyang & Ramen Add Ons"
    ],
    items: []
  }
};

const settingsRef = doc(db, "settings", "salesOwners");

const state = {
  orders: [],
  menu: [],
  categories: [],
  payments: [],

  assignments: structuredClone(defaults),

  dates: {
    gaa: {
      from: dayKey(),
      to: dayKey()
    },
    boss: {
      from: dayKey(),
      to: dayKey()
    }
  },

  pages: {
    gaa: 1,
    boss: 1
  }
};

function notify(message, error = false) {
  const node = $("owner-status");
  if (!node) return;

  node.textContent = message;
  node.style.color = error ? "#a12222" : "#216238";
}

/* ORDER DATE */

function orderDay(order) {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(order.dayKey || "")
  ) {
    return order.dayKey;
  }

  const date = timestampDate(order.createdAt);

  return date && !isNaN(date.getTime())
    ? dayKey(date)
    : "";
}

function withinDates(order, owner) {
  const date = orderDay(order);
  const { from, to } = state.dates[owner];

  return Boolean(date) &&
    (!from || date >= from) &&
    (!to || date <= to);
}

/* PRODUCT OWNER */

function categoryOf(item) {
  if (item.category) return item.category;

  const byId = state.menu.find(
    product => product.id === item.menuId
  );

  if (byId) return byId.category || "";

  const matches = state.menu.filter(
    product => norm(product.name) === norm(item.name)
  );

  return matches.length === 1
    ? matches[0].category || ""
    : "";
}

function ownerOf(item) {
  const category = categoryOf(item);
  const key = keyOf(category, item.name);

  if (
    key === keyOf("All Day Breakfast", "Shanghai Silog")
  ) {
    return "gaa";
  }

  if (state.assignments.gaa.items.includes(key)) {
    return "gaa";
  }

  if (state.assignments.boss.items.includes(key)) {
    return "boss";
  }

  if (/\b(samyang|buldak)\b/.test(norm(item.name))) {
    return "boss";
  }

  if (
    state.assignments.gaa.categories.some(
      value => norm(value) === norm(category)
    )
  ) {
    return "gaa";
  }

  if (
    state.assignments.boss.categories.some(
      value => norm(value) === norm(category)
    )
  ) {
    return "boss";
  }

  return null;
}

function positiveQty(value) {
  const n = Number(value);

  return Number.isInteger(n) && n > 0
    ? n
    : 0;
}

/* TAKEOUT BOX ACCOUNTING */

function linkedBoxRate(item, order) {
  if (item.boxUnitPrice != null) {
    const rate = Number(item.boxUnitPrice);

    return [15, 25].includes(rate) ? rate : 0;
  }

  if (
    item.boxChoice != null &&
    item.boxChoice !== "auto"
  ) {
    const rate = Number(item.boxChoice);

    return [15, 25].includes(rate) ? rate : 0;
  }

  const service =
    item.serveType || order.orderType || "Dine In";

  return service === "Take Out"
    ? lineBoxPrice({
        ...item,
        category: categoryOf(item),
        serveType: service
      })
    : 0;
}

function bossBoxTotals(order) {
  const items = Array.isArray(order.items)
    ? order.items
    : [];

  const hasCounts =
    order.boxes &&
    typeof order.boxes === "object";

  const saved = {
    15: hasCounts ? positiveQty(order.boxes["15"]) : 0,
    25: hasCounts ? positiveQty(order.boxes["25"]) : 0
  };

  const allocated = { 15: 0, 25: 0 };
  const bossAllocated = { 15: 0, 25: 0 };

  for (const item of items) {
    const rate = linkedBoxRate(item, order);
    const qty = positiveQty(item.qty);

    if (!rate || !qty) continue;

    allocated[rate] += qty;

    if (ownerOf(item) === "boss") {
      bossAllocated[rate] += qty;
    }
  }

  const result = { 15: 0, 25: 0 };

  if (hasCounts) {
    for (const rate of [15, 25]) {
      result[rate] = Math.min(
        saved[rate],
        bossAllocated[rate]
      );
    }

    const eligible = items.filter(item =>
      isMealItem({
        ...item,
        category: categoryOf(item)
      })
    );

    const bossOnly =
      eligible.length > 0 &&
      eligible.every(item => ownerOf(item) === "boss");

    if (bossOnly) {
      for (const rate of [15, 25]) {
        result[rate] += Math.max(
          0,
          saved[rate] - allocated[rate]
        );
      }
    }

  } else {
    let available = cents(order.packagingFee || 0);

    for (const rate of [15, 25]) {
      const count = Math.min(
        bossAllocated[rate],
        Math.floor(available / (rate * 100))
      );

      result[rate] = count;
      available -= count * rate * 100;
    }
  }

  return {
    count15: result[15],
    count25: result[25],

    total: rounded(
      result[15] * 15 + result[25] * 25
    )
  };
}

/* SALES FROM SAVED ORDERS */

function calculateOwner(owner) {
  const grouped = new Map();

  let ordersCount = 0;
  let boxes15 = 0;
  let boxes25 = 0;

  for (const order of state.orders) {
    if (!withinDates(order, owner)) continue;

    const lines = [
      ...(order.items || []),
      ...(order.addons || [])
    ];

    const grossAll = lines.reduce(
      (sum, item) =>
        sum + num(item.qty) * num(item.unitPrice),
      0
    );

    const legacyDiscount =
      order.discountMode === "perItem"
        ? num(order.legacyDiscountAmount)
        : num(order.discountAmount);

    let matched = false;

    for (const item of lines) {
      if (ownerOf(item) !== owner) continue;

      const qty = positiveQty(item.qty);
      const price = Number(item.unitPrice);

      if (!qty || !Number.isFinite(price) || price < 0) {
        continue;
      }

      matched = true;

      const category = categoryOf(item) || "Other";
      const gross = qty * price;

      const shanghai =
        owner === "gaa" &&
        norm(item.name) === "shanghai silog" &&
        norm(category) === "all day breakfast";

      const selectedDiscount =
        order.discountMode === "perItem"
          ? gross * num(item.discountRate) / 100
          : 0;

      const oldDiscount =
        grossAll > 0
          ? legacyDiscount * gross / grossAll
          : 0;

      const net = shanghai
        ? qty * 30
        : Math.max(
            0,
            rounded(gross - selectedDiscount - oldDiscount)
          );

      const title =
        `${item.name}${item.size ? ` (${item.size})` : ""}`;

      const key = keyOf(category, title);

      const row = grouped.get(key) || {
        category,
        name: title,
        qty: 0,
        sales: 0
      };

      row.qty += qty;
      row.sales = rounded(row.sales + net);

      grouped.set(key, row);
    }

    if (matched) {
      ordersCount++;

      if (owner === "boss") {
        const boxes = bossBoxTotals(order);

        boxes15 += boxes.count15;
        boxes25 += boxes.count25;
      }
    }
  }

  const rows = [...grouped.values()].sort(
    (a, b) =>
      b.sales - a.sales ||
      a.name.localeCompare(b.name)
  );

  const productSales = rounded(
    rows.reduce((sum, row) => sum + row.sales, 0)
  );

  const boxSales = owner === "boss"
    ? boxes15 * 15 + boxes25 * 25
    : 0;

  return {
    rows,
    productSales,
    boxSales,
    total: rounded(productSales + boxSales),
    qty: rows.reduce((sum, row) => sum + row.qty, 0),
    orders: ordersCount,
    box15: owner === "boss" ? boxes15 : 0,
    box25: owner === "boss" ? boxes25 : 0
  };
}

/* RENDER REPORT */

function renderOwner(owner) {
  const body = $(`owner-${owner}-body`);
  if (!body) return;

  const report = calculateOwner(owner);

  $(`owner-${owner}-sales`).textContent =
    money(report.total);

  $(`owner-${owner}-qty`).textContent =
    String(report.qty);

  $(`owner-${owner}-orders`).textContent =
    String(report.orders);

  body.replaceChildren();

  const pages = Math.max(
    1,
    Math.ceil(report.rows.length / 5)
  );

  const page = state.pages[owner] = Math.max(
    1,
    Math.min(pages, state.pages[owner])
  );

  const visible = report.rows.slice(
    (page - 1) * 5,
    page * 5
  );

  for (const item of visible) {
    const tr = document.createElement("tr");

    for (
      const value of [
        item.category,
        item.name,
        item.qty,
        money(item.sales)
      ]
    ) {
      const td = document.createElement("td");

      td.textContent = String(value);
      tr.append(td);
    }

    body.append(tr);
  }

  if (!visible.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 4;
    td.textContent = "No sales for selected dates.";

    tr.append(td);
    body.append(tr);
  }

  $(`owner-${owner}-page`).textContent =
    `Page ${page} of ${pages} (${report.rows.length} items)`;

  $(`owner-${owner}-prev`).disabled = page <= 1;
  $(`owner-${owner}-next`).disabled = page >= pages;

  const id = `owner-${owner}-extra-summary`;

  let summary = $(id);

  if (!summary) {
    summary = document.createElement("p");
    summary.id = id;
    summary.className = "owner-note";

    body.closest(".owner-card")
      ?.querySelector(".owner-stats")
      ?.insertAdjacentElement("afterend", summary);
  }

  summary.textContent = owner === "boss"
    ? (
        `Products: ${money(report.productSales)} · ` +
        `Takeout boxes: ${report.box15}×₱15 + ` +
        `${report.box25}×₱25 = ${money(report.boxSales)} · ` +
        `Total: ${money(report.total)}`
      )
    : (
        `Sales: ${money(report.productSales)} · ` +
        "Shanghai Silog = ₱30/serving · No boxes"
      );
}

/* OWNER ASSIGNMENTS */

function cleanAssignments(data) {
  const result = {};

  for (const owner of owners) {
    const source = data?.[owner] || defaults[owner];

    result[owner] = {
      categories: unique(source.categories || []),
      items: unique(source.items || [])
    };
  }

  result.gaa.items = unique([
    ...result.gaa.items,
    keyOf("All Day Breakfast", "Shanghai Silog")
  ]);

  return result;
}

function fillSelect(id, choices, placeholder) {
  const select = $(id);
  if (!select) return;

  const previous = select.value;

  select.replaceChildren(new Option(placeholder, ""));

  for (const choice of choices) {
    select.add(new Option(choice.label, choice.value));
  }

  if (
    [...select.options].some(
      option => option.value === previous
    )
  ) {
    select.value = previous;
  }
}

function renderAssignments(owner) {
  const categoryNames = unique([
    ...state.categories.map(item => item.name),
    ...state.menu.map(item => item.category)
  ]).sort();

  fillSelect(
    `owner-${owner}-category`,
    categoryNames.map(value => ({
      label: value,
      value
    })),
    "Choose category"
  );

  fillSelect(
    `owner-${owner}-product`,
    state.menu
      .filter(item => item.name && item.category)
      .sort(
        (a, b) =>
          `${a.category} ${a.name}`.localeCompare(
            `${b.category} ${b.name}`
          )
      )
      .map(item => ({
        label: `${item.category} · ${item.name}`,
        value: keyOf(item.category, item.name)
      })),
    "Choose item"
  );

  const root = $(`owner-${owner}-rules`);
  if (!root) return;

  root.replaceChildren();

  for (const type of ["categories", "items"]) {
    for (const value of state.assignments[owner][type]) {
      const chip = document.createElement("span");
      chip.className = "owner-rule";

      chip.append(
        document.createTextNode(
          `${type === "items" ? "Item" : "Category"}: ` +
          `${value.replace("|", " · ")} `
        )
      );

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";

      remove.onclick = () =>
        changeAssignment(owner, type, value, false);

      chip.append(remove);
      root.append(chip);
    }
  }
}

function renderAll() {
  for (const owner of owners) {
    renderOwner(owner);
    renderAssignments(owner);
  }
}

async function changeAssignment(owner, type, value, add) {
  if (!value) return;

  try {
    await authReady;

    await runTransaction(db, async tx => {
      const snapshot = await tx.get(settingsRef);

      const next = cleanAssignments(
        snapshot.exists()
          ? snapshot.data().owners
          : defaults
      );

      next[owner][type] = add
        ? unique([...next[owner][type], value])
        : next[owner][type].filter(item => item !== value);

      tx.set(settingsRef, {
        owners: next,
        updatedAt: serverTimestamp()
      });
    });

    notify("Owner assignments saved.");
  } catch (error) {
    notify(`Save failed: ${error.message}`, true);
  }
}

/* 58MM OWNER REPORT */

function printOwner(owner) {
  const { from, to } = state.dates[owner];

  if (from && to && from > to) {
    notify("From date cannot be after To date.", true);
    return;
  }

  const report = calculateOwner(owner);

  printOwnerReport({
    ownerName: owner === "gaa" ? "KUYA GAA" : "KUYA BOSS",
    from: from || "All",
    to: to || "All",
    rows: report.rows,
    itemsSold: report.qty,
    orders: report.orders,
    productSales: report.productSales,
    boxSales: report.boxSales,
    note: owner === "gaa"
      ? "Shanghai Silog = P30 each. Boxes excluded."
      : `${report.box15} x P15 + ${report.box25} x P25 boxes`
  });
}

/* DELETE ORDER — CONFIRMATION MODAL */

const recent = $("recent-orders-body");

function installDeleteButtons() {
  if (!recent) return;

  for (
    const edit of recent.querySelectorAll("[data-edit-order]")
  ) {
    const group = edit.parentElement;

    if (!group || group.querySelector("[data-owner-delete]")) {
      continue;
    }

    const button = document.createElement("button");

    button.type = "button";
    button.textContent = "Delete";
    button.className =
      "btn btn-sm btn-outline order-delete-btn";

    button.dataset.ownerDelete = edit.dataset.editOrder;

    group.append(button);
  }
}

function showDeleteConfirmation(order) {
  const root = $("modal-root");

  root.innerHTML = `
    <div class="modal-backdrop" id="owner-delete-backdrop">
      <section class="modal-sheet"
        role="alertdialog"
        aria-modal="true"
        style="max-width:430px"
      >
        <h3>Delete Order #${escapeHtml(order.orderNumber)}?</h3>

        <p>
          Total: ${money(order.total)}
        </p>

        <p>
          This will permanently delete this order and
          its linked GCash payment. Sales reports will
          also be updated.
        </p>

        <p class="form-error" id="owner-delete-error"></p>

        <div class="modal-actions">
          <button type="button"
            id="owner-delete-cancel"
            class="btn btn-outline"
          >Cancel</button>

          <button type="button"
            id="owner-delete-confirm"
            class="btn btn-primary"
          >Yes, Delete Order</button>
        </div>
      </section>
    </div>
  `;

  const close = () => root.replaceChildren();

  root.querySelector("#owner-delete-cancel").onclick = close;

  const confirm = root.querySelector("#owner-delete-confirm");

  confirm.onclick = async () => {
    confirm.disabled = true;
    confirm.textContent = "Deleting…";

    try {
      await authReady;

      const orderRef = doc(db, "orders", order.id);

      const snap = await getDoc(orderRef);

      if (!snap.exists()) {
        throw Error("Order already deleted.");
      }

      const linked = await getDocs(
        query(
          collection(db, "gcashPayments"),
          where("orderId", "==", order.id)
        )
      );

      const batch = writeBatch(db);

      batch.delete(orderRef);

      for (const payment of linked.docs) {
        batch.delete(payment.ref);
      }

      if (
        !linked.docs.some(payment => payment.id === order.id)
      ) {
        batch.delete(doc(db, "gcashPayments", order.id));
      }

      await batch.commit();

      close();

      notify(
        `Order #${order.orderNumber} successfully deleted.`
      );

    } catch (error) {
      root.querySelector("#owner-delete-error")
        .textContent = error.message;

      confirm.disabled = false;
      confirm.textContent = "Yes, Delete Order";
    }
  };
}

recent?.addEventListener("click", event => {
  const button = event.target.closest("[data-owner-delete]");

  if (!button) return;

  const order = state.orders.find(
    item => item.id === button.dataset.ownerDelete
  );

  if (!order) {
    notify("Order not found.", true);
    return;
  }

  showDeleteConfirmation(order);
});

if (recent) {
  new MutationObserver(
    installDeleteButtons
  ).observe(recent, {
    childList: true,
    subtree: true
  });

  installDeleteButtons();
}

/* ==========================================
   GCASH — COMBINED PAYMENT FOR TWO ORDERS
   ========================================== */

function paymentFor(orderId) {
  return state.payments.find(
    payment =>
      payment.orderId === orderId ||
      payment.id === orderId
  );
}

function paymentDay(payment) {
  if (payment.dayKey) return payment.dayKey;

  const date = timestampDate(payment.createdAt);

  return date ? dayKey(date) : "";
}

function ordersOnDay(day) {
  return state.orders
    .filter(order => orderDay(order) === day)
    .sort(
      (a, b) =>
        num(a.orderNumber) - num(b.orderNumber)
    );
}

function remainingGcash(order) {
  return Math.max(
    0,
    rounded(
      num(order.total) -
      num(paymentFor(order.id)?.amount)
    )
  );
}

function parseCents(value) {
  const text = String(value).trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    return NaN;
  }

  return cents(Number(text));
}

function openGcashModal(existingEntry = null) {
  const root = $("modal-root");

  const day = existingEntry
    ? paymentDay(existingEntry)
    : $("finance-date")?.value || dayKey();

  const orders = ordersOnDay(day);

  if (!orders.length) {
    notify("No saved orders for this date.", true);
    return;
  }

  const firstId =
    existingEntry?.orderId || orders[0].id;

  const options = orders.map(order => `
    <option value="${escapeHtml(order.id)}"
      ${order.id === firstId ? "selected" : ""}
    >
      #${escapeHtml(order.orderNumber)} ·
      ${escapeHtml(order.customerName || "Walk-in")} ·
      ${money(order.total)}
    </option>
  `).join("");

  root.innerHTML = `
    <div class="modal-backdrop" id="combined-gcash-backdrop">
      <section class="modal-sheet finance-modal"
        style="max-width:590px;max-height:90dvh;overflow-y:auto"
      >
        <h3>
          ${
            existingEntry
              ? "Edit GCash Amount"
              : "Add GCash Payment"
          }
        </h3>

        <p class="modal-subtitle">
          ${
            existingEntry
              ? "Correct the total GCash amount for this order."
              : "For one GCash transfer covering two receipts, select both saved orders."
          }
        </p>

        <form id="combined-gcash-form" class="modal-form">

          <label class="field">
            Main saved order
            <select id="combined-gcash-first"
              required
              ${existingEntry ? "disabled" : ""}
            >
              ${options}
            </select>
          </label>

          ${
            existingEntry
              ? ""
              : `
                <label class="field">
                  Additional saved order (optional)
                  <select id="combined-gcash-second">
                    <option value="">
                      None — one order only
                    </option>

                    ${orders.map(order => `
                      <option value="${escapeHtml(order.id)}">
                        #${escapeHtml(order.orderNumber)} ·
                        ${money(order.total)}
                      </option>
                    `).join("")}
                  </select>
                </label>
              `
          }

          <label class="field">
            Description
            <input id="combined-gcash-description"
              type="text"
              maxlength="160"
              required
              value="${escapeHtml(
                existingEntry?.description || ""
              )}"
              placeholder="GCash includes Orders #18 and #23"
            >
          </label>

          <label class="field">
            ${
              existingEntry
                ? "Corrected GCash amount"
                : "Total NEW GCash received"
            }

            <input id="combined-gcash-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputmode="decimal"
              required
              value="${existingEntry?.amount ?? ""}"
              placeholder="1612.00"
            >
          </label>

          ${
            existingEntry
              ? ""
              : `
                <label class="field">
                  Portion for main order (optional)
                  <input
                    id="combined-gcash-first-share"
                    type="number"
                    min="0"
                    step="0.01"
                    inputmode="decimal"
                    placeholder="Auto-allocate"
                  >
                </label>
              `
          }

          <div id="combined-gcash-preview"
            role="status"
            style="background:#fff1f7;padding:12px;border-radius:10px;white-space:pre-line;font-size:.85rem;line-height:1.6"
          ></div>

          <p class="form-error"
            id="combined-gcash-error"
            role="alert"
          ></p>

          <div class="modal-actions">

            <button type="button"
              class="btn btn-outline"
              id="combined-gcash-cancel"
            >
              Cancel
            </button>

            <button type="submit"
              class="btn btn-primary"
              id="combined-gcash-save"
            >
              Save GCash Payment
            </button>

          </div>
        </form>
      </section>
    </div>
  `;

  const form = root.querySelector("#combined-gcash-form");

  const firstField = form.querySelector(
    "#combined-gcash-first"
  );

  const secondField = form.querySelector(
    "#combined-gcash-second"
  );

  const totalField = form.querySelector(
    "#combined-gcash-amount"
  );

  const firstShareField = form.querySelector(
    "#combined-gcash-first-share"
  );

  const descriptionField = form.querySelector(
    "#combined-gcash-description"
  );

  const preview = form.querySelector(
    "#combined-gcash-preview"
  );

  const errorBox = form.querySelector(
    "#combined-gcash-error"
  );

  const saveButton = form.querySelector(
    "#combined-gcash-save"
  );

  const close = () => root.replaceChildren();

  form.querySelector("#combined-gcash-cancel").onclick =
    close;

  const findOrder = id =>
    orders.find(order => order.id === id);

  function allocation() {
    const first = findOrder(firstField.value);

    const second = secondField
      ? findOrder(secondField.value)
      : null;

    const total = parseCents(totalField.value);

    const firstAmount = existingEntry
      ? total
      : (
          firstShareField.value.trim()
            ? parseCents(firstShareField.value)
            : Math.min(
                Number.isFinite(total) ? total : 0,
                cents(remainingGcash(first))
              )
        );

    const secondAmount = existingEntry
      ? 0
      : total - firstAmount;

    return {
      first,
      second,
      total,
      firstAmount,
      secondAmount
    };
  }

  function refreshPreview() {
    const data = allocation();

    if (!data.first) return;

    const previous = num(
      paymentFor(data.first.id)?.amount
    );

    if (existingEntry) {
      preview.textContent =
        `Order #${data.first.orderNumber}\n` +
        `Order total: ${money(data.first.total)}\n` +
        `Existing GCash: ${money(previous)}\n` +
        `Corrected GCash: ${
          money(Number.isFinite(data.total)
            ? data.total / 100 : 0)
        }`;

      return;
    }

    preview.textContent =
      `Order #${data.first.orderNumber}\n` +
      `Available balance: ${money(remainingGcash(data.first))}\n` +
      `New GCash portion: ${money(
        Number.isFinite(data.firstAmount)
          ? data.firstAmount / 100 : 0
      )}`;

    if (data.second) {
      preview.textContent +=
        `\n\nOrder #${data.second.orderNumber}\n` +
        `Available balance: ${money(remainingGcash(data.second))}\n` +
        `New GCash portion: ${money(
          Number.isFinite(data.secondAmount)
            ? data.secondAmount / 100 : 0
        )}`;
    }

    preview.textContent +=
      `\n\nTOTAL NEW GCASH: ${money(
        Number.isFinite(data.total)
          ? data.total / 100 : 0
      )}`;

    if (
      Number.isFinite(data.total) &&
      data.total > 0 &&
      !data.second &&
      data.total > cents(remainingGcash(data.first))
    ) {
      preview.textContent +=
        "\nSelect an additional saved order for the remaining amount.";
    }
  }

  firstField.onchange = () => {
    if (firstShareField) firstShareField.value = "";
    refreshPreview();
  };

  if (secondField) {
    secondField.onchange = () => {
      if (secondField.value === firstField.value) {
        secondField.value = "";
      }

      if (firstShareField) firstShareField.value = "";

      refreshPreview();
    };
  }

  totalField.oninput = refreshPreview;

  if (firstShareField) {
    firstShareField.oninput = refreshPreview;
  }

  refreshPreview();

  form.onsubmit = async event => {
    event.preventDefault();

    errorBox.textContent = "";

    const data = allocation();

    const description =
      descriptionField.value.trim();

    if (
      !description ||
      !data.first ||
      !Number.isFinite(data.total) ||
      data.total <= 0
    ) {
      errorBox.textContent =
        "Enter a valid description and GCash amount.";

      return;
    }

    if (
      data.second &&
      data.second.id === data.first.id
    ) {
      errorBox.textContent =
        "Choose a different additional order.";

      return;
    }

    if (
      !Number.isFinite(data.firstAmount) ||
      data.firstAmount <= 0 ||
      (
        data.second &&
        (
          !Number.isFinite(data.secondAmount) ||
          data.secondAmount <= 0
        )
      ) ||
      (
        !data.second &&
        data.secondAmount !== 0
      )
    ) {
      errorBox.textContent = data.second
        ? "Allocate a positive amount to both orders."
        : "Amount exceeds this order. Select an additional saved order.";

      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Saving…";

    const selected = [{
      order: data.first,
      share: data.firstAmount
    }];

    if (data.second) {
      selected.push({
        order: data.second,
        share: data.secondAmount
      });
    }

    try {
      await authReady;

      const groupId =
        crypto.randomUUID?.() ||
        `gcash-${Date.now()}`;

      await runTransaction(db, async transaction => {
        const references = selected.map(({ order }) => ({
          orderRef: doc(db, "orders", order.id),

          paymentRef: doc(
            db,
            "gcashPayments",
            order.id
          )
        }));

        // Read all documents before writing.

        const snapshots = await Promise.all(
          references.flatMap(ref => [
            transaction.get(ref.orderRef),
            transaction.get(ref.paymentRef)
          ])
        );

        const pendingWrites = [];

        for (let index = 0; index < selected.length; index++) {
          const selectedItem = selected[index];
          const refs = references[index];

          const orderSnap = snapshots[index * 2];
          const paymentSnap = snapshots[index * 2 + 1];

          if (!orderSnap.exists()) {
            throw Error(
              "One of the selected orders no longer exists."
            );
          }

          const order = orderSnap.data();

          const savedDate =
            order.dayKey ||
            (
              order.createdAt?.toDate
                ? dayKey(order.createdAt.toDate())
                : ""
            );

          if (savedDate !== day) {
            throw Error(
              `Order #${order.orderNumber} belongs to another date.`
            );
          }

          if (
            existingEntry &&
            !paymentSnap.exists()
          ) {
            throw Error(
              "The GCash entry no longer exists."
            );
          }

          const previous = paymentSnap.exists()
            ? cents(paymentSnap.data().amount)
            : 0;

          const next = existingEntry
            ? selectedItem.share
            : previous + selectedItem.share;

          const maximum = cents(order.total);

          if (next <= 0 || next > maximum) {
            const remaining = Math.max(
              0,
              maximum - previous
            );

            throw Error(
              `Order #${order.orderNumber} can accept ` +
              `only ${money(remaining / 100)} more GCash. ` +
              `Check the allocation.`
            );
          }

          const oldHistory =
            paymentSnap.exists() &&
            Array.isArray(
              paymentSnap.data().paymentHistory
            )
              ? paymentSnap.data().paymentHistory
              : [];

          const historyEntry = {
            action: existingEntry
              ? "edit-total"
              : "add",

            amount: selectedItem.share / 100,

            previousAmount: previous / 100,
            newAmount: next / 100,

            groupId,
            combinedTransfer: data.total / 100,

            description,
            at: new Date().toISOString()
          };

          const payment = {
            orderId: refs.orderRef.id,

            orderNumber: Number(
              order.orderNumber
            ),

            customerName:
              order.customerName || "",

            dayKey: savedDate,

            amount: rounded(next / 100),

            description: selected.length > 1
              ? (
                  `${description} [Orders ${
                    selected.map(
                      item => "#" + item.order.orderNumber
                    ).join(" + ")
                  }]`
                ).slice(0, 160)
              : description,

            paymentHistory: [
              ...oldHistory,
              historyEntry
            ].slice(-60),

            createdAt: paymentSnap.exists()
              ? paymentSnap.data().createdAt ||
                serverTimestamp()
              : serverTimestamp(),

            updatedAt: serverTimestamp()
          };

          pendingWrites.push({
            ...refs,
            payment,
            amount: next / 100
          });
        }

        // Update both orders atomically.

        for (const write of pendingWrites) {
          transaction.set(
            write.paymentRef,
            write.payment
          );

          transaction.update(
            write.orderRef,
            {
              paymentMethod: "GCash",
              gcashAmount: write.amount
            }
          );
        }
      });

      close();

      notify(
        `${money(data.total / 100)} GCash saved for ` +
        selected.map(
          item => `Order #${item.order.orderNumber}`
        ).join(" and ") +
        "."
      );

    } catch (error) {
      errorBox.textContent =
        `Save failed: ${error.message}`;

      saveButton.disabled = false;
      saveButton.textContent = "Save GCash Payment";
    }
  };
}

/* REPLACE ORIGINAL GCASH MODAL */

document.addEventListener(
  "click",
  event => {
    const add = event.target.closest(
      "#add-gcash-payment"
    );

    if (add) {
      event.preventDefault();
      event.stopImmediatePropagation();

      openGcashModal();
      return;
    }

    const edit = event.target.closest(
      ".finance-separated-section button"
    );

    if (
      !edit ||
      edit.textContent.trim() !== "Edit"
    ) {
      return;
    }

    const section = edit.closest(
      ".finance-separated-section"
    );

    if (
      !section?.querySelector("h3")
        ?.textContent.startsWith("GCash Payments")
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const row = edit.closest("tr");

    const rowIndex = [
      ...section.querySelectorAll("tbody tr")
    ].indexOf(row);

    const pageText =
      section.querySelector(
        ".table-pagination span"
      )?.textContent || "";

    const page = Number(
      /Page\s+(\d+)/.exec(pageText)?.[1] || 1
    );

    const day =
      $("finance-date")?.value || dayKey();

    const records = state.payments
      .filter(payment => paymentDay(payment) === day)
      .sort(
        (a, b) =>
          num(b.createdAt?.seconds) -
          num(a.createdAt?.seconds)
      );

    const entry = records[
      (page - 1) * 5 + rowIndex
    ];

    if (!entry) {
      notify(
        "GCash table is refreshing. Try Edit again.",
        true
      );

      return;
    }

    openGcashModal(entry);
  },
  true
);

/* SIDEBAR AND DATE FILTERS */

function setupUI() {
  const nav = document.querySelector(".admin-nav");

  const finance = nav?.querySelector(
    '[data-tab="finances"]'
  );

  const gaa = nav?.querySelector(
    '[data-tab="owner-gaa"]'
  );

  const boss = nav?.querySelector(
    '[data-tab="owner-boss"]'
  );

  if (finance && gaa && boss) {
    finance.after(gaa);
    gaa.after(boss);
  }

  for (const owner of owners) {
    const section = $(`section-owner-${owner}`);
    if (!section) continue;

    const range = $(`owner-${owner}-range`);
    range?.closest("label")?.remove();

    const custom = $(`owner-${owner}-custom`);

    if (custom) {
      custom.hidden = false;
      custom.style.display = "flex";
      custom.style.flexWrap = "wrap";
      custom.style.gap = "10px";
    }

    for (const part of ["from", "to"]) {
      const field = $(`owner-${owner}-${part}`);

      field.value = state.dates[owner][part];

      field.onchange = () => {
        state.dates[owner][part] = field.value;
        state.pages[owner] = 1;

        renderOwner(owner);
      };
    }

    const filters = section.querySelector(
      ".owner-filters"
    );

    if (
      filters &&
      !filters.querySelector(".owner-print-button")
    ) {
      const button = document.createElement("button");

      button.type = "button";
      button.className =
        "btn btn-primary owner-print-button";

      button.textContent = "Print 58mm Sales Report";

      button.onclick = () => printOwner(owner);

      filters.append(button);
    }

    $(`owner-${owner}-prev`).onclick = () => {
      state.pages[owner]--;
      renderOwner(owner);
    };

    $(`owner-${owner}-next`).onclick = () => {
      state.pages[owner]++;
      renderOwner(owner);
    };

    $(`owner-${owner}-add-category`).onclick =
      () => changeAssignment(
        owner,
        "categories",
        $(`owner-${owner}-category`).value,
        true
      );

    $(`owner-${owner}-add-product`).onclick =
      () => changeAssignment(
        owner,
        "items",
        $(`owner-${owner}-product`).value,
        true
      );

    nav?.querySelector(
      `[data-tab="owner-${owner}"]`
    )?.addEventListener("click", () => {
      for (
        const id of [
          "dashboard",
          "menu",
          "finances",
          "settings",
          "owner-gaa",
          "owner-boss"
        ]
      ) {
        $(`section-${id}`)?.classList.toggle(
          "hidden",
          id !== `owner-${owner}`
        );
      }

      document.querySelector(".admin-main")
        ?.scrollTo(0, 0);
    });
  }

  nav?.querySelectorAll(
    'button[data-tab]:not([data-tab^="owner-"])'
  ).forEach(button => {
    button.addEventListener("click", () => {
      for (const owner of owners) {
        $(`section-owner-${owner}`)
          ?.classList.add("hidden");
      }
    });
  });
}

setupUI();
renderAll();

/* REALTIME FIRESTORE */

authReady.then(() => {
  onSnapshot(
    query(
      collection(db, "orders"),
      orderBy("createdAt", "desc")
    ),

    snapshot => {
      state.orders = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderAll();
    },

    error => notify(
      `Orders error: ${error.message}`,
      true
    )
  );

  onSnapshot(
    collection(db, "menu"),

    snapshot => {
      state.menu = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderAll();
    }
  );

  onSnapshot(
    collection(db, "categories"),

    snapshot => {
      state.categories = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderAll();
    }
  );

  onSnapshot(
    collection(db, "gcashPayments"),

    snapshot => {
      state.payments = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));
    },

    error => notify(
      `GCash error: ${error.message}`,
      true
    )
  );

  onSnapshot(
    settingsRef,

    snapshot => {
      state.assignments = cleanAssignments(
        snapshot.exists()
          ? snapshot.data().owners
          : defaults
      );

      renderAll();
    },

    error => notify(
      `Owner settings error: ${error.message}`,
      true
    )
  );
}).catch(error => {
  notify(`Sign-in error: ${error.message}`, true);
});

/* DAY CHANGE */

let previousDay = dayKey();

setInterval(() => {
  const currentDay = dayKey();

  if (currentDay === previousDay) return;

  for (const owner of owners) {
    for (const field of ["from", "to"]) {
      if (state.dates[owner][field] === previousDay) {
        state.dates[owner][field] = currentDay;

        const input = $(`owner-${owner}-${field}`);

        if (input) {
          input.value = currentDay;
        }
      }
    }
  }

  previousDay = currentDay;

  renderAll();
}, 60000);
