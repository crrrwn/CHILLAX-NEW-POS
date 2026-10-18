
import { db, authReady } from "./firebase-config.js";
import { requireRole, logout } from "./auth.js";
import { printOrder } from "./receipt.js";

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

/* LOGIN */
const session = requireRole(["staff", "admin"]);

if (!session) {
  throw new Error("Sign in is required.");
}

const $ = id => document.getElementById(id);

$("logout-btn").addEventListener("click", logout);
$("role-pill").textContent =
  session.role === "admin" ? "Admin" : "Cashier";

if (session.role !== "admin") {
  $("admin-link").classList.add("hidden");
}

/* POS STATE */
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
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);

const isDrink = (category, name = "") =>
  /coffee|frapp|frappé|shake|tea|drink|juice|smoothie|soda|lemonade|chocolate|matcha|milktea/i
    .test(category || "") ||
  /water|coke|cola|juice|soda|iced tea|iced coffee/i
    .test(name);

const positiveInt = value =>
  Math.max(0, Math.floor(Number(value) || 0));

const lineTotal = line =>
  Number(line.qty || 0) *
  Number(line.unitPrice || 0);

function newKey() {
  return crypto.randomUUID?.() ||
    `${Date.now()}-${Math.random()}`;
}

/* TAKEOUT BOX CALCULATIONS */
function currentBoxes() {
  return boxesForCart(cart, {
    "15": positiveInt($("box-15").value),
    "25": positiveInt($("box-25").value)
  });
}

/* OPTIONAL MANUAL ADD-ONS */
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

  return [{ name, qty, unitPrice }];
}

/* NOTIFICATIONS */
function toast(message) {
  const node = $("toast");

  node.textContent = message;
  node.classList.remove("hidden");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    node.classList.add("hidden");
  }, 3500);
}

function connectionError(message) {
  const node = $("connection-banner");

  node.textContent = message;
  node.classList.remove("hidden");
}

/* TODAY'S EXISTING ORDERS */
function availableOrders() {
  const today = dayKey();

  return recentOrders.filter(order => {
    const date = order.dayKey ||
      (
        order.createdAt?.toDate
          ? dayKey(order.createdAt.toDate())
          : ""
      );

    return date === today;
  });
}

function renderExistingOrders() {
  const select = $("existing-order");
  const previous = select.value;

  select.replaceChildren(
    new Option("New order (new number)", "")
  );

  availableOrders().forEach(order => {
    select.add(
      new Option(
        `#${order.orderNumber} · ${
          order.customerName || "Walk-in"
        } · ${money(order.total)}`,
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

/* LIVE MENU AND ORDERS */
async function listenMenu() {
  await authReady;

  onSnapshot(
    query(
      collection(db, "categories"),
      orderBy("order")
    ),
    snapshot => {
      categoryOrder = snapshot.docs
        .map(d => d.data().name)
        .flatMap(name =>
          name === "Shake & Frappé"
            ? ["Shake", "Frappé"]
            : [name]
        );

      categoryOrder = [...new Set(categoryOrder)];

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

      if (!activeCategory && menuByCategory.size) {
        activeCategory = [...menuByCategory.keys()][0];
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
      recentOrders = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));

      renderExistingOrders();
    },
    error => connectionError(
      `Orders failed: ${error.message}`
    )
  );
}

/* MENU CATEGORY TABS */
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
      category === activeCategory ? "active" : "";

    button.onclick = () => {
      activeCategory = category;
      renderTabs();
      renderGrid();
    };

    tabsEl.appendChild(button);
  });
}

/* MENU PRODUCTS */
function renderGrid() {
  const items = searchText
    ? [...menuByCategory.values()]
        .flat()
        .filter(item =>
          `${item.name} ${item.category}`
            .toLowerCase()
            .includes(searchText)
        )
    : (
      menuByCategory.get(activeCategory) || []
    );

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
        addToCart(item, null, item.price);
      }
    };

    menuPane.appendChild(button);
  });
}

/* ADD PRODUCT
 * Main Order Type is only the default for NEW items.
 */
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

/* DINE IN / TAKE OUT ORDER PREVIEW */
function renderCart() {
  cartItemsEl.replaceChildren();

  if (!cart.length) {
    cartItemsEl.innerHTML = `
      <div class="cart-empty">
        Tap a product to start an order.
      </div>
    `;
  }

  const counts = {
    "Dine In": cart
      .filter(item => item.serveType !== "Take Out")
      .reduce(
        (sum, item) => sum + Number(item.qty || 0),
        0
      ),

    "Take Out": cart
      .filter(item => item.serveType === "Take Out")
      .reduce(
        (sum, item) => sum + Number(item.qty || 0),
        0
      )
  };

  // Group the visible order without changing saved data.
  for (const service of ["Dine In", "Take Out"]) {
    const lines = cart.filter(item =>
      (
        item.serveType === "Take Out"
          ? "Take Out"
          : "Dine In"
      ) === service
    );

    if (!lines.length) continue;

    const heading = document.createElement("div");

    heading.className =
      "cart-service-group " +
      (
        service === "Take Out"
          ? "service-takeout"
          : "service-dinein"
      );

    heading.textContent =
      service === "Take Out"
        ? `TAKE OUT — PACK THESE ITEMS (${counts[service]} pcs)`
        : `DINE IN — SERVE HERE (${counts[service]} pcs)`;

    cartItemsEl.appendChild(heading);

    for (const line of lines) {
      const row = document.createElement("div");

      row.className =
        "cart-line " +
        (
          service === "Take Out"
            ? "cart-takeout"
            : "cart-dinein"
        );

      const meal = isMealItem(line);
      const boxPrice = lineBoxPrice(line);

      const boxLabel = meal ? `
        <label class="meal-box-label">
          Box per serving

          <select
            class="meal-box-select"
            aria-label="Box type for ${escapeHtml(line.name)}"
          >
            <option value="auto">
              Auto: Meals/Fries ₱15; Sharing/Family ₱0
            </option>

            <option value="15">₱15 box</option>
            <option value="25">₱25 box</option>
            <option value="0">No box</option>
          </select>
        </label>

        <div class="meal-box-cost">
          ${
            boxPrice
              ? `${money(boxPrice)} × ${line.qty} box = ${
                  money(boxPrice * line.qty)
                }`
              : "No box charge"
          }
        </div>
      ` : "";

      row.innerHTML = `
        <div class="info">

          <div class="name">
            ${escapeHtml(line.name)}
          </div>

          <div class="cart-service-badge ${
            service === "Take Out"
              ? "service-takeout"
              : "service-dinein"
          }">
            ${
              service === "Take Out"
                ? "● TAKE OUT"
                : "● DINE IN"
            }
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
                    >10%</option>

                    <option
                      value="20"
                      ${
                        Number(line.discountRate) === 20
                          ? "selected"
                          : ""
                      }
                    >20%</option>
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
                  Move 1 serving to ${
                    service === "Dine In"
                      ? "TAKE OUT"
                      : "DINE IN"
                  }
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
        >✕</button>
      `;

      // Service of this item only.
      const serviceSelect = row.querySelector(
        ".serve-select"
      );

      serviceSelect.value = line.serveType;

      serviceSelect.onchange = event => {
        line.serveType = event.target.value;
        renderCart();
      };

      // Box for this item only.
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

      row.querySelector(".custom-note").oninput = event => {
        line.note = event.target.value;
      };

      const discountToggle = row.querySelector(
        ".discount-enabled"
      );

      if (discountToggle) {
        discountToggle.onchange = event => {
          line.discountRate = event.target.checked
            ? Number(
                row.querySelector(".item-discount-rate").value
              ) || 10
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

      row.querySelector(
        '[data-act="remove"]'
      ).onclick = () => {
        cart = cart.filter(
          item => item.key !== line.key
        );

        renderCart();
      };

      // Splits one serving to the opposite service.
      const split = row.querySelector(".split-serve");

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
  }

  // Recalculate complete order.
  const boxes = currentBoxes();
  const extras = currentAddons();

  const subtotal = cart.reduce(
    (sum, item) => sum + lineTotal(item),
    0
  );

  const extraCost = extras.reduce(
    (sum, item) => sum + lineTotal(item),
    0
  );

  const totalDiscount = itemDiscountTotal(cart);

  const total = rounded(
    subtotal +
    boxTotal(boxes) +
    extraCost -
    totalDiscount
  );

  $("cart-total").textContent = money(total);

  const addonsCost = extraCost +
    cart.filter(item => item.isAddon).reduce(
      (sum, item) => sum + lineTotal(item),
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
    counts["Dine In"] + counts["Take Out"]
  );

  checkoutBtn.disabled =
    submitting ||
    (
      cart.length === 0 &&
      extraCost === 0 &&
      boxTotal(boxes) === 0
    );

  checkoutBtn.textContent = $("existing-order").value
    ? "Add to order & print"
    : "Place order & print";
}

/* PARTY BOX / VARIANT MODAL */
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
      : [
          {
            label: "Regular",
            price: Number(item.price)
          }
        ];

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

  const choices = item.category === "Party Box on the Go"
    ? (
        item.comboOptions?.length
          ? item.comboOptions
          : fallback[item.name.toLowerCase()] || []
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
            ? `<p class="modal-subtitle">
                 ${escapeHtml(item.description)}
               </p>`
            : ""
        }

        <div
          class="size-options"
          style="flex-wrap:wrap"
        >
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
            type="button"
            class="btn btn-outline"
            id="modal-cancel"
          >Cancel</button>

          <button
            type="button"
            class="btn btn-primary"
            id="modal-add"
          >Add to order</button>
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
  ).onclick = () => modalRoot.replaceChildren();

  modalRoot.querySelector(
    "#modal-add"
  ).onclick = () => {
    const chosen = [
      ...modalRoot.querySelectorAll(
        "[data-party-choice]:checked"
      )
    ].map(checkbox =>
      choices[Number(checkbox.dataset.partyChoice)]
    );

    if (choices.length && !chosen.length) {
      modalRoot.querySelector(
        "#party-error"
      ).textContent = "Choose at least one dish.";
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

    const freebie = item.name.toLowerCase()
      .includes("set a")
        ? "FREE 1.5L Coke"
        : "FREE 1.5L Coke + 1 tub Graham";

    const noteParts = choices.length
      ? [
          `Choices: ${chosen.join(", ")}`,
          freebie
        ]
      : [];

    if (notes) noteParts.push(notes);

    cart[cart.length - 1].note = noteParts
      .join(" | ")
      .slice(0, 450);

    if (chosen.length) {
      cart[cart.length - 1].comboSelections = chosen;
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
$("menu-search").addEventListener("input", event => {
  searchText = event.target.value.trim().toLowerCase();
  renderGrid();
});

// Changing the main Order Type only affects
// the default service for items added afterward.
$("order-type").addEventListener("change", () => {
  toast(
    "Default updated for new items. Existing items are unchanged."
  );

  renderCart();
});

for (const id of [
  "box-15",
  "box-25",
  "addon-qty",
  "addon-price",
  "addon-name"
]) {
  $(id).addEventListener("input", renderCart);
}

$("existing-order").addEventListener(
  "change",
  renderCart
);

document.addEventListener("keydown", event => {
  if (
    event.key === "Escape" &&
    modalRoot.hasChildNodes()
  ) {
    modalRoot.replaceChildren();
  }
});

/* CHECKOUT / FIRESTORE */
checkoutBtn.addEventListener("click", async () => {
  if (submitting) return;

  const addons = currentAddons();
  const boxes = currentBoxes();
  const rawName = $("addon-name").value.trim();

  if (rawName && !addons.length) {
    toast(
      "Enter a valid add-on quantity and price."
    );
    return;
  }

  // Each item keeps its independent service type.
  const items = cart.map(({ key, ...line }) => ({
    ...line,
    qty: Number(line.qty),
    unitPrice: Number(line.unitPrice),
    isDrink: isDrink(line.category, line.name),
    boxUnitPrice: lineBoxPrice(line)
  }));

  const delta = {
    items,
    addons,
    boxes,
    packagingFee: boxTotal(boxes),

    discountMode: "perItem",
    discountRate: 0,
    discountAmount: itemDiscountTotal(items),
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

    const selectedId = $("existing-order").value;
    let printPayload;

    if (selectedId) {
      // ADD CHARGES TO AN EXISTING ORDER
      const reference = doc(db, "orders", selectedId);

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

          const orderDate = old.dayKey ||
            (
              old.createdAt?.toDate
                ? dayKey(old.createdAt.toDate())
                : ""
            );

          if (orderDate !== dayKey()) {
            throw Error(
              "Only today's orders can receive new items."
            );
          }

          const next = {
            ...old,

            items: [
              ...(old.items || []),

              ...items.map(item => ({
                ...item,
                isAddon: Boolean(item.isAddon),
                addedToExistingOrder: true
              }))
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

          next.packagingFee = rounded(
            next.legacyPackagingFee +
            boxTotal(next.boxes)
          );

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

          next.addOnTotal = rounded(
            Number(
              old.addOnTotal ?? addonsTotal(old)
            ) +

            items.reduce(
              (sum, item) => sum + lineTotal(item),
              0
            ) +

            addons.reduce(
              (sum, item) => sum + lineTotal(item),
              0
            )
          );

          next.updatedAt = serverTimestamp();

          transaction.update(reference, {
            items: next.items,
            addons: next.addons,
            boxes: next.boxes,
            legacyPackagingFee: next.legacyPackagingFee,
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

            items: items.map(item => ({
              ...item,
              isAddon: Boolean(item.isAddon),
              addedToExistingOrder: true
            })),

            orderNumber: old.orderNumber,
            orderType: old.orderType,
            paymentMethod: old.paymentMethod,
            customerName: old.customerName,

            dayKey: dayKey(),
            printedAt: new Date().toISOString(),

            total: charge,
            updatedOrderTotal: next.total,
            receiptMode: "ADD-ON"
          };
        }
      );

    } else {
      // SAVE NEW ORDER
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

        // Keep Firestore-compatible order type.
        // Per-item serveType stores mixed service.
        orderType: items.some(
          item => item.serveType === "Take Out"
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

      const maxExistingToday = availableOrders()
        .reduce(
          (max, order) => Math.max(
            max,
            Number(order.orderNumber) || 0
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

          transaction.set(counterReference, {
            value: next,
            dayKey: date
          });

          transaction.set(orderReference, {
            ...order,
            orderNumber: next,
            createdAt: serverTimestamp()
          });

          return next;
        }
      );

      printPayload = {
        ...order,
        orderNumber,
        printedAt: new Date().toISOString()
      };
    }

    // CLEAR ONLY AFTER SUCCESSFUL FIRESTORE SAVE
    cart = [];

    $("customer-name").value = "";
    $("addon-name").value = "";
    $("addon-price").value = "";
    $("addon-qty").value = "1";

    $("box-15").value = "0";
    $("box-25").value = "0";
    $("existing-order").value = "";

    renderCart();

    toast(
      `Order #${printPayload.orderNumber} saved. Printing 3 copies…`
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
    console.error("Checkout failed:", error);

    toast(`Not saved: ${error.message}`);

  } finally {
    submitting = false;
    renderCart();
  }
});

/* DAILY ORDER SELECTOR REFRESH */
let lastBusinessDay = dayKey();

setInterval(() => {
  const today = dayKey();

  if (today === lastBusinessDay) return;

  lastBusinessDay = today;
  renderExistingOrders();
}, 60000);

/* DISCOUNT DESIGN */
const discountStyle = document.createElement("style");

discountStyle.textContent = `
@media screen {
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
    white-space: nowrap;
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
}`;

document.head.append(discountStyle);

/* PARTY BOX CHOICES DESIGN */
const partyChoicesStyle = document.createElement("style");

partyChoicesStyle.textContent = `
@media screen {
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
}`;

document.head.append(partyChoicesStyle);

/* DINE IN / TAKE OUT VISUAL SEPARATION */
const serviceStyles = document.createElement("style");

serviceStyles.textContent = `
@media screen {
  .cart-service-group {
    position: sticky;
    top: 0;
    z-index: 2;
    margin: 8px 0 5px;
    padding: 8px 10px;
    border-radius: 9px;
    font-weight: 900;
    font-size: .76rem;
    letter-spacing: .2px;
  }

  .cart-service-group.service-dinein {
    background: #edf7ee;
    color: #245d35;
    border: 1px solid #b9d9c0;
  }

  .cart-service-group.service-takeout {
    background: #fff0e3;
    color: #8c410d;
    border: 1px solid #efbf91;
  }

  .cart-service-badge {
    display: inline-block;
    border-radius: 6px;
    padding: 3px 6px;
    font-weight: 900;
    font-size: .69rem;
    margin: 4px 0;
  }

  .cart-service-badge.service-dinein {
    background: #e4f4e8;
    color: #205f33;
  }

  .cart-service-badge.service-takeout {
    background: #ffead2;
    color: #823b0c;
  }

  .cart-line.cart-takeout {
    border-left: 3px solid #dc8a35;
    padding-left: 8px;
  }

  .cart-line.cart-dinein {
    border-left: 3px solid #63a574;
    padding-left: 8px;
  }

  .cart-line .serve-select {
    max-width: 100%;
  }

  .cart-line .split-serve {
    font-weight: 800;
  }
}`;

document.head.append(serviceStyles);

/* MAIN ORDER TYPE HELPER */
const defaultServiceHint = document.createElement("small");

defaultServiceHint.textContent =
  "Default for NEW items only. Set Dine In/Take Out for each item below.";

defaultServiceHint.style.cssText =
  "display:block;font-size:.7rem;line-height:1.25;" +
  "margin:4px 0;color:#735847";

$("order-type").insertAdjacentElement(
  "afterend",
  defaultServiceHint
);

/* START */
listenMenu().catch(error => {
  console.error(error);
  connectionError(error.message);
});
