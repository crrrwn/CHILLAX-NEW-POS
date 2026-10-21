
import {
  db,
  authReady
} from "./firebase-config.js";

import {
  requireRole,
  logout
} from "./auth.js";

import {
  printOrder
} from "./receipt.js";

import {
  dayKey,
  pesos,
  rounded,
  boxTotal,
  orderTotal,
  addonsTotal,
  isMealItem,
  lineBoxPrice,
  boxesForCart,
  lineDiscountAmount,
  itemDiscountTotal,
  isDiscountableFood
} from "./business.js";

import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* AUTHENTICATION */
const session = requireRole(["staff", "admin"]);

if (!session) {
  throw Error("Sign in required.");
}

const $ = id => document.getElementById(id);

$("logout-btn").addEventListener(
  "click",
  logout
);

$("role-pill").textContent =
  session.role === "admin"
    ? "Admin"
    : "Cashier";

if (session.role !== "admin") {
  $("admin-link").classList.add("hidden");
}

/* ELEMENTS */
const menuPane = $("item-grid");
const tabsEl = $("category-tabs");
const cartItemsEl = $("cart-items");
const checkoutBtn = $("checkout-btn");
const modalRoot = $("modal-root");

let menuByCategory = new Map();
let categoryOrder = [];
let activeCategory = null;

let cart = [];
let recentOrders = [];
let submitting = false;
let searchText = "";

const money = pesos;

const escapeHtml = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]
  );

const isDrink = (category, name = "") =>
  /coffee|frapp|frappé|shake|tea|drink|juice|smoothie|soda|lemonade|chocolate|matcha|milktea/i
    .test(category || "") ||
  /water|coke|cola|juice|soda|iced tea|iced coffee/i
    .test(name);

const positiveInt = value =>
  Math.max(
    0,
    Math.floor(Number(value) || 0)
  );

const lineTotal = line =>
  Number(line.qty || 0) *
  Number(line.unitPrice || 0);

function newKey() {
  return crypto.randomUUID?.() ||
    `${Date.now()}-${Math.random()}`;
}

/* TAKEOUT BOXES */
function currentBoxes() {
  return boxesForCart(cart, {
    "15": positiveInt($("box-15").value),
    "25": positiveInt($("box-25").value)
  });
}

/* CUSTOM ADD-ONS */
function currentAddons() {
  const name = $("addon-name").value.trim();
  const qty = positiveInt($("addon-qty").value);
  const unitPrice = Number(
    $("addon-price").value || 0
  );

  if (
    !name ||
    qty <= 0 ||
    !Number.isFinite(unitPrice) ||
    unitPrice < 0
  ) {
    return [];
  }

  return [{
    name,
    qty,
    unitPrice
  }];
}

/* MESSAGES */
function toast(message) {
  const node = $("toast");

  node.textContent = message;
  node.classList.remove("hidden");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(
    () => node.classList.add("hidden"),
    3500
  );
}

function connectionError(message) {
  const node = $("connection-banner");
  node.textContent = message;
  node.classList.remove("hidden");
}

/* WAITING LIST LOCAL STORAGE */
const QUEUE_KEY = "chillax_waiting_v1";
const ACTIVE_KEY = "chillax_active_draft_v1";

let restoringDraft = false;
let waitingOverlay = null;

function readStore(key, fallback) {
  try {
    return JSON.parse(
      localStorage.getItem(key) || "null"
    ) ?? fallback;
  } catch {
    return fallback;
  }
}

function drafts() {
  return readStore(QUEUE_KEY, []);
}

function draftSnapshot() {
  return {
    id: newKey(),
    name: $("customer-name").value.trim(),
    created: new Date().toISOString(),

    cart: cart.map(item => ({
      ...item
    })),

    form: Object.fromEntries(
      [
        "order-type",
        "existing-order",
        "box-15",
        "box-25",
        "addon-name",
        "addon-qty",
        "addon-price"
      ].map(id => [
        id,
        $(id).value
      ])
    )
  };
}

function saveActiveDraft() {
  if (restoringDraft || submitting) {
    return;
  }

  try {
    const hasData =
      cart.length ||
      $("customer-name").value.trim() ||
      $("addon-name").value.trim() ||
      positiveInt($("box-15").value) ||
      positiveInt($("box-25").value);

    if (hasData) {
      localStorage.setItem(
        ACTIVE_KEY,
        JSON.stringify(draftSnapshot())
      );
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }

  } catch (error) {
    console.warn(
      "Could not save unfinished order:",
      error
    );
  }
}

function resetWorkingOrder() {
  restoringDraft = true;
  cart = [];

  const fields = {
    "customer-name": "",
    "order-type": "Dine In",
    "existing-order": "",
    "box-15": "0",
    "box-25": "0",
    "addon-name": "",
    "addon-qty": "1",
    "addon-price": ""
  };

  for (const [id, value] of Object.entries(fields)) {
    $(id).value = value;
  }

  restoringDraft = false;

  try {
    localStorage.removeItem(ACTIVE_KEY);
  } catch {}

  renderCart();
}

/* HOLD CURRENT ORDER */
function holdCurrent() {
  if (submitting) return false;

  if (
    !cart.length &&
    !$("addon-name").value.trim() &&
    !positiveInt($("box-15").value) &&
    !positiveInt($("box-25").value)
  ) {
    toast(
      "Add an item before putting the order on hold."
    );

    return false;
  }

  const list = drafts();

  if (list.length >= 30) {
    toast(
      "Waiting List is full (30 orders)."
    );
    return false;
  }

  const current = draftSnapshot();

  list.unshift(current);

  try {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(list)
    );
  } catch {
    toast(
      "Could not save on this tablet. Check browser storage."
    );

    return false;
  }

  resetWorkingOrder();

  toast(
    `Waiting: ${current.name || "Unnamed customer"}. ` +
    "No order number yet."
  );

  return true;
}

/* RESUME WAITING ORDER */
function restoreWaiting(id) {
  if (submitting) return;

  const list = drafts();

  const found = list.find(
    item => item.id === id
  );

  if (!found) return;

  const hasCurrent =
    cart.length ||
    $("addon-name").value.trim() ||
    positiveInt($("box-15").value) ||
    positiveInt($("box-25").value);

  if (hasCurrent) {
    if (
      !confirm(
        "Hold the current unfinished order before opening this waiting order?"
      )
    ) {
      return;
    }

    if (!holdCurrent()) return;
  }

  restoringDraft = true;

  cart = Array.isArray(found.cart)
    ? found.cart
    : [];

  $("customer-name").value =
    found.name || "";

  for (
    const [id, value] of
    Object.entries(found.form || {})
  ) {
    if ($(id)) {
      $(id).value = value;
    }
  }

  restoringDraft = false;

  try {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(
        drafts().filter(
          item => item.id !== id
        )
      )
    );
  } catch (error) {
    console.warn(error);
  }

  renderCart();
  closeWaiting();

  toast(
    "Waiting order restored. You can continue punching."
  );
}

function closeWaiting() {
  waitingOverlay?.remove();
  waitingOverlay = null;
}

/* WAITING LIST MODAL */
function showWaiting() {
  closeWaiting();

  waitingOverlay = document.createElement("div");
  waitingOverlay.className = "wait-shade";

  const panel = document.createElement("section");
  panel.className = "wait-dialog";

  const heading = document.createElement("h2");
  heading.textContent =
    "Waiting List — Unfinished Orders";

  panel.append(heading);

  const hint = document.createElement("p");
  hint.textContent =
    "Saved on this tablet only. " +
    "No Firebase order number or receipt until checkout.";

  panel.append(hint);

  const list = drafts();

  for (const record of list) {
    const row = document.createElement("div");
    row.className = "wait-row";

    const details = document.createElement("div");

    const name = document.createElement("strong");
    name.textContent =
      record.name || "Unnamed customer";

    const description = document.createElement("small");

    const quantity = (
      record.cart || []
    ).reduce(
      (sum, item) =>
        sum + Number(item.qty || 0),
      0
    );

    description.textContent =
      `${quantity} items · ` +
      new Date(record.created).toLocaleString(
        "en-PH"
      );

    details.append(name, description);

    const resume = document.createElement("button");

    resume.type = "button";
    resume.className = "btn btn-primary";
    resume.textContent = "Resume";

    resume.onclick = () => restoreWaiting(record.id);

    const remove = document.createElement("button");

    remove.type = "button";
    remove.className = "btn btn-outline";
    remove.textContent = "Remove";

    remove.onclick = () => {
      if (
        !confirm("Remove this unfinished order?")
      ) {
        return;
      }

      localStorage.setItem(
        QUEUE_KEY,
        JSON.stringify(
          drafts().filter(
            item => item.id !== record.id
          )
        )
      );

      showWaiting();
    };

    row.append(details, resume, remove);
    panel.append(row);
  }

  if (!list.length) {
    const empty = document.createElement("p");
    empty.textContent = "No waiting orders.";
    panel.append(empty);
  }

  const close = document.createElement("button");

  close.type = "button";
  close.className = "btn btn-outline";
  close.textContent = "Close";
  close.onclick = closeWaiting;

  panel.append(close);

  waitingOverlay.append(panel);

  waitingOverlay.addEventListener(
    "click",
    event => {
      if (event.target === waitingOverlay) {
        closeWaiting();
      }
    }
  );

  document.body.append(waitingOverlay);
}

function initializeWaitingList() {
  const toolbar = document.createElement("div");
  toolbar.className = "wait-actions";

  const hold = document.createElement("button");

  hold.type = "button";
  hold.className = "btn btn-outline";
  hold.textContent = "Hold / Waiting";
  hold.onclick = holdCurrent;

  const view = document.createElement("button");

  view.type = "button";
  view.className = "btn btn-outline";
  view.textContent = "Waiting List";
  view.onclick = showWaiting;

  toolbar.append(hold, view);

  document.querySelector(
    ".cart-footer"
  )?.append(toolbar);

  /* RESTORE ACTIVE DRAFT AFTER REFRESH */
  const active = readStore(ACTIVE_KEY, null);

  if (active && Array.isArray(active.cart)) {
    restoringDraft = true;

    cart = active.cart;

    $("customer-name").value =
      active.name || "";

    for (
      const [id, value] of
      Object.entries(active.form || {})
    ) {
      if ($(id)) $(id).value = value;
    }

    restoringDraft = false;

    renderCart();
  }

  for (
    const id of [
      "customer-name",
      "order-type",
      "existing-order",
      "box-15",
      "box-25",
      "addon-name",
      "addon-qty",
      "addon-price"
    ]
  ) {
    $(id)?.addEventListener(
      "input",
      saveActiveDraft
    );

    $(id)?.addEventListener(
      "change",
      saveActiveDraft
    );
  }
}

/* TODAY'S EXISTING ORDERS */
function availableOrders() {
  const today = dayKey();

  return recentOrders.filter(
    order =>
      (
        order.dayKey ||
        (
          order.createdAt?.toDate
            ? dayKey(order.createdAt.toDate())
            : ""
        )
      ) === today
  );
}

function renderExistingOrders() {
  const select = $("existing-order");
  const previous = select.value;

  select.replaceChildren(
    new Option(
      "New order (new number)",
      ""
    )
  );

  availableOrders().forEach(order => {
    select.add(
      new Option(
        `#${order.orderNumber} · ` +
        `${order.customerName || "Walk-in"} · ` +
        money(order.total),
        order.id
      )
    );
  });

  select.value = availableOrders().some(
    order => order.id === previous
  ) ? previous : "";

  checkoutBtn.textContent = select.value
    ? "Add to order & print"
    : "Place order & print";
}

/* LIVE FIREBASE MENU */
async function listenMenu() {
  await authReady;

  onSnapshot(
    query(
      collection(db, "categories"),
      orderBy("order")
    ),

    snapshot => {
      categoryOrder = snapshot.docs
        .map(item => item.data().name)
        .flatMap(name =>
          name === "Shake & Frappé"
            ? ["Shake", "Frappé"]
            : [name]
        );

      categoryOrder = [
        ...new Set(categoryOrder)
      ];

      if (
        categoryOrder.length &&
        !categoryOrder.includes(activeCategory)
      ) {
        activeCategory = categoryOrder[0];
      }

      renderTabs();
      renderGrid();
    },

    error => connectionError(
      `Categories failed: ${error.message}`
    )
  );

  onSnapshot(
    query(
      collection(db, "menu"),
      orderBy("sortOrder")
    ),

    snapshot => {
      menuByCategory = new Map();

      snapshot.forEach(documentSnapshot => {
        const item = {
          id: documentSnapshot.id,
          ...documentSnapshot.data()
        };

        let category =
          item.category || "Uncategorized";

        if (category === "Shake & Frappé") {
          category = /frapp|frappé/i.test(item.name)
            ? "Frappé"
            : "Shake";
        }

        item.category = category;

        const list =
          menuByCategory.get(category) || [];

        list.push(item);
        menuByCategory.set(category, list);
      });

      if (
        !activeCategory &&
        menuByCategory.size
      ) {
        activeCategory =
          [...menuByCategory.keys()][0];
      }

      renderTabs();
      renderGrid();
    },

    error => connectionError(
      `Menu failed: ${error.message}`
    )
  );

  onSnapshot(
    query(
      collection(db, "orders"),
      orderBy("createdAt", "desc")
    ),

    snapshot => {
      recentOrders = snapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );

      renderExistingOrders();
    },

    error => connectionError(
      `Orders failed: ${error.message}`
    )
  );
}

/* CATEGORY TABS */
function renderTabs() {
  tabsEl.replaceChildren();

  const categories = [
    ...new Set([
      ...categoryOrder,
      ...menuByCategory.keys()
    ])
  ];

  categories.forEach(category => {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = category;

    button.className =
      category === activeCategory
        ? "active"
        : "";

    button.onclick = () => {
      activeCategory = category;

      renderTabs();
      renderGrid();
    };

    tabsEl.appendChild(button);
  });
}

/* PRODUCT GRID */
function renderGrid() {
  const items = searchText
    ? [...menuByCategory.values()]
        .flat()
        .filter(item =>
          `${item.name} ${item.category}`
            .toLowerCase()
            .includes(searchText)
        )
    : menuByCategory.get(activeCategory) || [];

  $("item-count").textContent =
    `${items.length} products${
      searchText ? " found" : ""
    }`;

  menuPane.replaceChildren();

  if (!items.length) {
    menuPane.innerHTML =
      '<p class="menu-empty">No products found.</p>';

    return;
  }

  items.forEach(item => {
    const button = document.createElement("button");

    button.type = "button";
    button.disabled = item.available === false;

    button.className =
      "item-card" +
      (
        item.available === false
          ? " unavailable"
          : ""
      );

    const priceRange = item.variants?.length
      ? " – " + money(
          item.variants[
            item.variants.length - 1
          ].price
        )
      : item.priceLarge
        ? " / " + money(item.priceLarge)
        : "";

    button.innerHTML = `
      <span class="name">
        ${escapeHtml(item.name)}
      </span>

      <span class="product-category">
        ${escapeHtml(item.category)}
      </span>

      <span class="price">
        ${money(item.price)}${priceRange}
      </span>

      ${
        item.available === false
          ? '<span class="badge-unavail">Unavailable</span>'
          : ""
      }
    `;

    button.onclick = () => {
      if (
        item.variants?.length ||
        item.priceLarge ||
        item.comboOptions?.length ||
        item.category === "Party Box on the Go"
      ) {
        openSizeModal(item);
      } else {
        addToCart(
          item,
          null,
          item.price
        );
      }
    };

    menuPane.appendChild(button);
  });
}

/* ADD PRODUCT TO CART */
function addToCart(item, size, unitPrice) {
  cart.push({
    key: newKey(),

    menuId: item.id,
    name: item.name,
    category: item.category,
    size,

    unitPrice: Number(unitPrice),
    qty: 1,

    serveType: $("order-type").value,
    boxChoice: "auto",

    isAddon:
      item.isAddon === true ||
      /add\s*ons?/i.test(item.category || ""),

    discountRate: 0,
    note: ""
  });

  renderCart();
}

/* CURRENT ORDER */
function renderCart() {
  cartItemsEl.replaceChildren();

  if (!cart.length) {
    cartItemsEl.innerHTML = `
      <div class="cart-empty">
        Tap a product to start an order.
      </div>
    `;
  }

  const serviceOrder = [...cart].sort(
    (a, b) =>
      Number(a.serveType === "Take Out") -
      Number(b.serveType === "Take Out")
  );

  let previousService = "";

  for (const line of serviceOrder) {
    const service =
      line.serveType === "Take Out"
        ? "Take Out"
        : "Dine In";

    if (service !== previousService) {
      const heading = document.createElement("div");

      heading.className = "cart-service-group";

      heading.textContent =
        service === "Take Out"
          ? "TAKE OUT — PACK THESE ITEMS"
          : "DINE IN — SERVE HERE";

      cartItemsEl.appendChild(heading);

      previousService = service;
    }

    const row = document.createElement("div");
    row.className = "cart-line";

    const meal = isMealItem(line);
    const boxPrice = lineBoxPrice(line);

    const boxLabel = meal ? `
      <label class="meal-box-label">
        Box per serving

        <select
          class="meal-box-select"
          aria-label="Box for ${escapeHtml(line.name)}"
        >
          <option value="auto">
            Auto: Regular ₱15; Sharing ₱25; Family manual
          </option>

          <option value="15">₱15 box</option>
          <option value="25">₱25 box</option>
          <option value="0">No box</option>
        </select>
      </label>

      <div class="meal-box-cost">
        ${
          boxPrice
            ? (
                `${money(boxPrice)} × ${line.qty} = ` +
                money(boxPrice * line.qty)
              )
            : "No box charge"
        }
      </div>
    ` : "";

    row.innerHTML = `
      <div class="info">

        <div class="name">
          ${escapeHtml(line.name)}
        </div>

        ${
          line.size
            ? `<div class="size">
                 Size: ${escapeHtml(line.size)}
               </div>`
            : ""
        }

        <div class="unit">
          ${money(line.unitPrice)} each ·
          ${escapeHtml(line.category)}
        </div>

        <select
          class="serve-select"
          aria-label="Service for ${escapeHtml(line.name)}"
        >
          <option value="Dine In">Dine In</option>
          <option value="Take Out">Take Out</option>
        </select>

        ${boxLabel}

        ${
          isDiscountableFood(line)
            ? `
              <div class="line-discount-control">
                <label class="item-discount-check">
                  <input
                    class="discount-enabled"
                    type="checkbox"
                    ${
                      Number(line.discountRate || 0) > 0
                        ? "checked"
                        : ""
                    }
                  >
                  Discount this item
                </label>

                <select
                  class="item-discount-rate"
                  aria-label="Discount for ${escapeHtml(line.name)}"
                  ${
                    Number(line.discountRate || 0) > 0
                      ? ""
                      : "disabled"
                  }
                >
                  <option
                    value="10"
                    ${
                      Number(line.discountRate) === 10
                        ? "selected"
                        : ""
                    }
                  >
                    10%
                  </option>

                  <option
                    value="20"
                    ${
                      Number(line.discountRate) === 20
                        ? "selected"
                        : ""
                    }
                  >
                    20%
                  </option>
                </select>

                <span class="item-discount-amount">
                  ${
                    line.discountRate
                      ? `−${money(lineDiscountAmount(line))}`
                      : ""
                  }
                </span>
              </div>
            `
            : ""
        }

        <input
          class="custom-note"
          placeholder="Notes (optional)"
          maxlength="180"
          value="${escapeHtml(line.note)}"
        >

        ${
          line.qty > 1
            ? `
              <button
                class="split-serve"
                type="button"
              >
                Split 1 serving
              </button>
            `
            : ""
        }

      </div>

      <div class="qty-control">
        <button type="button" data-act="dec">−</button>
        <span>${line.qty}</span>
        <button type="button" data-act="inc">+</button>
      </div>

      <div class="line-total">
        ${money(lineTotal(line))}
      </div>

      <button
        type="button"
        class="remove-btn"
        data-act="remove"
        aria-label="Remove"
      >
        ✕
      </button>
    `;

    /* PER-ITEM SERVICE */
    const serviceSelect = row.querySelector(
      ".serve-select"
    );

    serviceSelect.value = line.serveType;

    serviceSelect.onchange = event => {
      line.serveType = event.target.value;
      renderCart();
    };

    /* PER-ITEM BOX */
    const boxSelect = row.querySelector(
      ".meal-box-select"
    );

    if (boxSelect) {
      boxSelect.value = line.boxChoice ?? "auto";

      boxSelect.onchange = event => {
        line.boxChoice = event.target.value;
        renderCart();
      };
    }

    /* NOTES */
    row.querySelector(
      ".custom-note"
    ).oninput = event => {
      line.note = event.target.value;
      saveActiveDraft();
    };

    /* DISCOUNT */
    const discountToggle = row.querySelector(
      ".discount-enabled"
    );

    if (discountToggle) {
      discountToggle.onchange = event => {
        line.discountRate = event.target.checked
          ? (
              Number(
                row.querySelector(
                  ".item-discount-rate"
                ).value
              ) || 10
            )
          : 0;

        renderCart();
      };

      row.querySelector(
        ".item-discount-rate"
      ).onchange = event => {
        line.discountRate = Number(event.target.value);
        renderCart();
      };
    }

    /* QUANTITY */
    row.querySelector(
      '[data-act="inc"]'
    ).onclick = () => {
      line.qty++;
      renderCart();
    };

    row.querySelector(
      '[data-act="dec"]'
    ).onclick = () => {
      line.qty--;

      if (line.qty <= 0) {
        cart = cart.filter(
          item => item.key !== line.key
        );
      }

      renderCart();
    };

    /* REMOVE */
    row.querySelector(
      '[data-act="remove"]'
    ).onclick = () => {
      cart = cart.filter(
        item => item.key !== line.key
      );

      renderCart();
    };

    /* SPLIT DINE IN AND TAKE OUT */
    const split = row.querySelector(
      ".split-serve"
    );

    if (split) {
      split.onclick = () => {
        if (line.qty <= 1) return;

        line.qty--;

        cart.push({
          ...line,
          key: newKey(),
          qty: 1,

          serveType:
            line.serveType === "Dine In"
              ? "Take Out"
              : "Dine In"
        });

        renderCart();
      };
    }

    cartItemsEl.appendChild(row);
  }

  /* TOTAL CALCULATIONS */
  const boxes = currentBoxes();
  const extras = currentAddons();

  const subtotal = cart.reduce(
    (sum, item) =>
      sum + lineTotal(item),
    0
  );

  const extraCost = extras.reduce(
    (sum, item) =>
      sum + lineTotal(item),
    0
  );

  const totalDiscount =
    itemDiscountTotal(cart);

  const total = rounded(
    subtotal +
    boxTotal(boxes) +
    extraCost -
    totalDiscount
  );

  $("cart-total").textContent = money(total);

  const addonsCost =
    extraCost +
    cart.filter(
      item => item.isAddon
    ).reduce(
      (sum, item) =>
        sum + lineTotal(item),
      0
    );

  $("box-fee-label").textContent =
    `Boxes: ${boxes["15"]}×₱15 + ` +
    `${boxes["25"]}×₱25 = ${money(boxTotal(boxes))}` +
    ` · Add-ons: ${money(addonsCost)}` +
    (
      totalDiscount
        ? ` · Discount: -${money(totalDiscount)}`
        : ""
    );

  $("cart-count").textContent = String(
    cart.reduce(
      (sum, item) =>
        sum + item.qty,
      0
    )
  );

  checkoutBtn.disabled =
    submitting ||
    (
      !cart.length &&
      !extraCost &&
      !boxTotal(boxes)
    );

  checkoutBtn.textContent = $("existing-order").value
    ? "Add to order & print"
    : "Place order & print";

  saveActiveDraft();
}

/* PARTY BOX CHOICES AND TRAY SIZES */
function openSizeModal(item) {
  const variants = item.variants?.length
    ? item.variants
    : item.priceLarge
      ? [
          {
            label: "Medium",
            price: Number(item.price)
          },
          {
            label: "Large",
            price: Number(item.priceLarge)
          }
        ]
      : [{
          label: "Regular",
          price: Number(item.price)
        }];

  let selected = variants[0];

  const fallback = {
    "party box set a": [
      "Pansit Canton",
      "Spaghetti",
      "Pansit Bihon",
      "Baked Mac",
      "Lumpia (30 pcs)",
      "Classic Chicken (15 pcs)"
    ],

    "party box set b": [
      "Carbonara",
      "Seafood Pasta",
      "Cordon Bleu",
      "Buffalo Wings",
      "Buttered Shrimp",
      "Fish Fillet"
    ]
  };

  const choices =
    item.category === "Party Box on the Go"
      ? (
          item.comboOptions?.length
            ? item.comboOptions
            : fallback[
                item.name.toLowerCase()
              ] || []
        )
      : [];

  modalRoot.innerHTML = `
    <div class="modal-backdrop">

      <div
        class="modal-sheet"
        style="max-height:90dvh;overflow:auto"
      >
        <h3>${escapeHtml(item.name)}</h3>

        ${
          item.description
            ? `
              <p class="modal-subtitle">
                ${escapeHtml(item.description)}
              </p>
            `
            : ""
        }

        <div class="size-options" style="flex-wrap:wrap">
          ${variants.map((variant, index) => `
            <button
              type="button"
              data-variant="${index}"
              class="${index === 0 ? "selected" : ""}"
            >
              ${escapeHtml(variant.label)} ·
              ${money(variant.price)}
            </button>
          `).join("")}
        </div>

        ${
          choices.length
            ? `
              <fieldset class="party-checkbox-group">
                <legend>Choose Party Box dishes</legend>

                ${choices.map((choice, index) => `
                  <label>
                    <input
                      type="checkbox"
                      data-party-choice="${index}"
                    >
                    ${escapeHtml(choice)}
                  </label>
                `).join("")}

                <label>
                  Other instructions

                  <textarea
                    id="combo-notes"
                    maxlength="80"
                    rows="2"
                    placeholder="Special instructions (optional)"
                  ></textarea>
                </label>

                <p
                  class="form-error"
                  id="party-error"
                  aria-live="polite"
                ></p>
              </fieldset>
            `
            : ""
        }

        <div class="modal-actions">
          <button
            class="btn btn-outline"
            type="button"
            id="modal-cancel"
          >
            Cancel
          </button>

          <button
            type="button"
            class="btn btn-primary"
            id="modal-add"
          >
            Add to order
          </button>
        </div>

      </div>
    </div>
  `;

  modalRoot.querySelectorAll(
    "[data-variant]"
  ).forEach(button => {
    button.onclick = () => {
      selected = variants[
        Number(button.dataset.variant)
      ];

      modalRoot.querySelectorAll(
        "[data-variant]"
      ).forEach(other => {
        other.classList.toggle(
          "selected",
          other === button
        );
      });
    };
  });

  modalRoot.querySelector(
    "#modal-cancel"
  ).onclick = () => {
    modalRoot.replaceChildren();
  };

  modalRoot.querySelector(
    "#modal-add"
  ).onclick = () => {
    const chosen = [
      ...modalRoot.querySelectorAll(
        "[data-party-choice]:checked"
      )
    ].map(checkbox =>
      choices[
        Number(checkbox.dataset.partyChoice)
      ]
    );

    if (choices.length && !chosen.length) {
      modalRoot.querySelector(
        "#party-error"
      ).textContent =
        "Choose at least one dish.";

      return;
    }

    addToCart(
      item,
      selected.label === "Regular"
        ? null
        : selected.label,
      selected.price
    );

    const notes = modalRoot.querySelector(
      "#combo-notes"
    )?.value.trim();

    const freebie =
      item.name.toLowerCase().includes("set a")
        ? "FREE 1.5L Coke"
        : "FREE 1.5L Coke + 1 tub Graham";

    const parts = choices.length
      ? [
          `Choices: ${chosen.join(", ")}`,
          freebie
        ]
      : [];

    if (notes) parts.push(notes);

    cart[cart.length - 1].note = parts
      .join(" | ")
      .slice(0, 450);

    if (chosen.length) {
      cart[cart.length - 1].comboSelections =
        chosen;
    }

    renderCart();
    modalRoot.replaceChildren();
  };

  modalRoot.querySelector(
    ".modal-backdrop"
  ).onclick = event => {
    if (
      event.target.classList.contains(
        "modal-backdrop"
      )
    ) {
      modalRoot.replaceChildren();
    }
  };
}

/* EVENTS */
$("menu-search").addEventListener(
  "input",
  event => {
    searchText = event.target.value
      .trim()
      .toLowerCase();

    renderGrid();
  }
);

/*
 * Default Dine In / Take Out only affects
 * NEW items, not previous cart items.
 */
$("order-type").addEventListener(
  "change",
  () => {
    toast("Default changed for new items only.");
    renderCart();
  }
);

for (
  const id of [
    "box-15",
    "box-25",
    "addon-qty",
    "addon-price",
    "addon-name"
  ]
) {
  $(id).addEventListener(
    "input",
    renderCart
  );
}

$("existing-order").addEventListener(
  "change",
  renderCart
);

document.addEventListener(
  "keydown",
  event => {
    if (
      event.key === "Escape" &&
      modalRoot.hasChildNodes()
    ) {
      modalRoot.replaceChildren();
    }
  }
);

/* CHECKOUT */
checkoutBtn.addEventListener(
  "click",
  async () => {
    if (submitting) return;

    const addons = currentAddons();
    const boxes = currentBoxes();

    const rawName = $("addon-name").value.trim();

    if (rawName && !addons.length) {
      toast(
        "Enter valid add-on quantity and price."
      );
      return;
    }

    const items = cart.map(
      ({ key, ...line }) => ({
        ...line,

        qty: Number(line.qty),
        unitPrice: Number(line.unitPrice),

        isDrink: isDrink(
          line.category,
          line.name
        ),

        boxUnitPrice: lineBoxPrice(line)
      })
    );

    const delta = {
      items,
      addons,
      boxes,

      packagingFee: boxTotal(boxes),

      discountMode: "perItem",
      discountRate: 0,

      discountAmount:
        itemDiscountTotal(items),

      legacyDiscountAmount: 0
    };

    const charge = orderTotal(delta);

    if (
      !items.length &&
      !addons.length &&
      !boxTotal(boxes)
    ) {
      return;
    }

    submitting = true;
    renderCart();

    checkoutBtn.textContent = "Saving order…";

    try {
      await authReady;

      const selectedId =
        $("existing-order").value;

      let printPayload;

      if (selectedId) {

        /* ADD ITEMS TO EXISTING ORDER */
        const reference = doc(
          db,
          "orders",
          selectedId
        );

        printPayload = await runTransaction(
          db,
          async transaction => {
            const snapshot = await transaction.get(
              reference
            );

            if (!snapshot.exists()) {
              throw Error(
                "Existing order no longer exists."
              );
            }

            const old = snapshot.data();

            const oldDate = old.dayKey ||
              (
                old.createdAt?.toDate
                  ? dayKey(old.createdAt.toDate())
                  : ""
              );

            if (oldDate !== dayKey()) {
              throw Error(
                "Only today's orders can receive new items."
              );
            }

            const appendedItems = items.map(
              item => ({
                ...item,
                isAddon: Boolean(item.isAddon)
              })
            );

            const next = {
              ...old,

              items: [
                ...(old.items || []),
                ...appendedItems
              ],

              addons: [
                ...(old.addons || []),
                ...addons
              ],

              boxes: {
                "15":
                  Number(old.boxes?.["15"] || 0) +
                  boxes["15"],

                "25":
                  Number(old.boxes?.["25"] || 0) +
                  boxes["25"]
              }
            };

            next.legacyPackagingFee = Number(
              old.legacyPackagingFee ??
              (
                old.boxes
                  ? 0
                  : old.packagingFee || 0
              )
            );

            next.packagingFee =
              next.legacyPackagingFee +
              boxTotal(next.boxes);

            next.total = rounded(
              Number(old.total || 0) + charge
            );

            next.discountMode = "perItem";
            next.discountRate = 0;

            next.legacyDiscountAmount = Number(
              old.legacyDiscountAmount ||
              (
                old.discountMode !== "perItem"
                  ? old.discountAmount || 0
                  : 0
              )
            );

            next.discountAmount = rounded(
              itemDiscountTotal(next.items) +
              next.legacyDiscountAmount
            );

            const newAddonRevenue =
              appendedItems
                .filter(item => item.isAddon)
                .reduce(
                  (sum, item) =>
                    sum + lineTotal(item),
                  0
                ) +
              addons.reduce(
                (sum, item) =>
                  sum + lineTotal(item),
                0
              );

            next.addOnTotal = rounded(
              Number(
                old.addOnTotal ??
                addonsTotal(old)
              ) + newAddonRevenue
            );

            next.updatedAt = serverTimestamp();

            transaction.update(reference, {
              items: next.items,
              addons: next.addons,
              boxes: next.boxes,

              legacyPackagingFee:
                next.legacyPackagingFee,

              packagingFee: next.packagingFee,
              total: next.total,
              addOnTotal: next.addOnTotal,

              discountMode: next.discountMode,
              discountRate: next.discountRate,
              discountAmount: next.discountAmount,

              legacyDiscountAmount:
                next.legacyDiscountAmount,

              updatedAt: next.updatedAt
            });

            return {
              ...delta,

              items: appendedItems,

              orderNumber: old.orderNumber,
              orderType: old.orderType,

              paymentMethod: old.paymentMethod,
              customerName: old.customerName,

              dayKey: dayKey(),

              printedAt:
                new Date().toISOString(),

              total: charge,

              updatedOrderTotal:
                next.total,

              receiptMode: "ADD-ON"
            };
          }
        );

      } else {

        /* NEW CUSTOMER ORDER */
        const date = dayKey();

        const counterReference = doc(
          db,
          "counters",
          `orderNumber-${date}`
        );

        const orderReference = doc(
          collection(db, "orders")
        );

        const order = {
          ...delta,

          dayKey: date,

          orderType: items.some(
            item =>
              item.serveType === "Take Out"
          )
            ? "Take Out"
            : $("order-type").value,

          paymentMethod: "Cash",

          customerName:
            $("customer-name").value.trim(),

          cashierRole: session.role,

          total: charge,
          addOnTotal: addonsTotal(delta)
        };

        const maxExistingToday =
          availableOrders().reduce(
            (number, item) =>
              Math.max(
                number,
                Number(item.orderNumber) || 0
              ),
            0
          );

        const orderNumber = await runTransaction(
          db,
          async transaction => {
            const snapshot = await transaction.get(
              counterReference
            );

            const next = Math.max(
              Number(
                snapshot.exists()
                  ? snapshot.data().value
                  : 0
              ),
              maxExistingToday
            ) + 1;

            transaction.set(
              counterReference,
              {
                value: next,
                dayKey: date
              }
            );

            transaction.set(
              orderReference,
              {
                ...order,
                orderNumber: next,
                createdAt: serverTimestamp()
              }
            );

            return next;
          }
        );

        printPayload = {
          ...order,
          orderNumber,

          printedAt:
            new Date().toISOString()
        };
      }

      /* CLEAR AFTER SUCCESSFUL SAVE */
      cart = [];

      try {
        localStorage.removeItem(ACTIVE_KEY);
      } catch {}

      $("customer-name").value = "";
      $("addon-name").value = "";
      $("addon-price").value = "";
      $("addon-qty").value = "1";

      $("box-15").value = "0";
      $("box-25").value = "0";

      $("existing-order").value = "";

      renderCart();

      toast(
        `Order #${printPayload.orderNumber} saved. Printing…`
      );

      try {
        await printOrder(printPayload);
      } catch (printError) {
        console.error(printError);

        toast(
          "Saved! Reprint from Admin → Recent Orders."
        );
      }

    } catch (error) {
      console.error(
        "Checkout failed:",
        error
      );

      toast(
        `Not saved: ${error.message}`
      );

    } finally {
      submitting = false;
      renderCart();
    }
  }
);

/* DAILY ORDER REFRESH */
let lastBusinessDay = dayKey();

setInterval(() => {
  const today = dayKey();

  if (today === lastBusinessDay) return;

  lastBusinessDay = today;
  renderExistingOrders();
}, 60000);

/* POS DESIGN */
const styles = document.createElement("style");

styles.textContent = `
@media screen {

  .cart-service-group {
    background: #f7ece3;
    color: #533626;
    border-radius: 8px;
    padding: 8px;
    margin: 10px 0 5px;
    font-weight: 850;
    font-size: .78rem;
  }

  .line-discount-control {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    margin: 5px 0;
    font-size: .77rem;
  }

  .item-discount-check {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-weight: 700;
  }

  .item-discount-check input {
    width: 16px;
    height: 16px;
    accent-color: #c44379;
  }

  .item-discount-rate {
    max-width: 85px;
    min-height: 30px !important;
    padding: 3px 5px !important;
  }

  .item-discount-amount {
    font-weight: 800;
    color: #b92d65;
  }

  .wait-actions {
    display: flex;
    gap: 7px;
    margin-top: 9px;
  }

  .wait-actions button {
    flex: 1;
    min-width: 0;
    font-size: .78rem;
  }

  .wait-shade {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0009;
    padding: 12px;
  }

  .wait-dialog {
    width: min(540px, 96vw);
    max-height: 85dvh;
    overflow: auto;
    background: #fffaf5;
    padding: 20px;
    border-radius: 18px;
    color: #513c2f;
  }

  .wait-dialog h2 {
    margin: 0 0 8px;
  }

  .wait-dialog p {
    font-size: .84rem;
  }

  .wait-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    border-bottom: 1px solid #e7d9cf;
  }

  .wait-row div {
    flex: 1;
    min-width: 0;
  }

  .wait-row small {
    display: block;
    color: #7c695d;
  }

  .wait-row button {
    white-space: nowrap;
  }

  .party-checkbox-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    border: 1px solid #e2d6d1;
    padding: 12px;
    border-radius: 12px;
    margin: 12px 0;
  }

  .party-checkbox-group legend {
    font-weight: 800;
  }

  .party-checkbox-group label {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px;
    background: #fff7fa;
    border-radius: 8px;
    cursor: pointer;
  }

  .party-checkbox-group input {
    accent-color: #bd3171;
  }

  .party-checkbox-group label:has(textarea) {
    grid-column: 1 / -1;
    display: block;
  }

  .party-checkbox-group textarea {
    width: 100%;
    display: block;
  }

  .party-checkbox-group .form-error {
    grid-column: 1 / -1;
    color: #b42318;
  }
}

@media screen and (max-width: 480px) {
  .party-checkbox-group {
    grid-template-columns: 1fr;
  }

  .wait-row {
    flex-wrap: wrap;
  }
}

@media print {
  .wait-shade,
  .wait-actions {
    display: none !important;
  }
}
`;

document.head.append(styles);

/* START POS */
initializeWaitingList();

listenMenu().catch(error => {
  console.error(error);
  connectionError(error.message);
});
