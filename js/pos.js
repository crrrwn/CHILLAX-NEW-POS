
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
  discountDetails
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

document.getElementById("logout-btn")
  .addEventListener("click", logout);

document.getElementById("role-pill").textContent =
  session.role === "admin" ? "Admin" : "Cashier";

if (session.role !== "admin") {
  document.getElementById("admin-link")
    .classList.add("hidden");
}

/* ELEMENTS */

const $ = id => document.getElementById(id);

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

/* COMPACT CUSTOMER & ADD-ONS */

const compactStyles = document.createElement("style");

compactStyles.textContent = `
@media screen {
  .order-details .order-options {
    gap: 6px 10px !important;
    padding: 9px 12px !important;
    align-items: end !important;
  }

  .order-details .order-options label {
    font-size: .70rem !important;
    gap: 3px !important;
    line-height: 1.2 !important;
  }

  .order-details .order-options input,
  .order-details .order-options select {
    min-height: 34px !important;
    padding: 5px 8px !important;
  }

  .order-details .order-options .box-charge-title {
    grid-column: 1 / -1;
    margin: 4px 0 0 !important;
    font-size: .68rem !important;
    line-height: 1.3 !important;
  }

  .order-details .order-options .box-qty-row {
    display: contents !important;
  }

  .order-details .order-options > small {
    font-size: .68rem !important;
    line-height: 1.3 !important;
  }

  .order-details .order-options label[for="customer-name"] {
    grid-column: 1 / -1;
  }

  .order-details .order-options label[for="pos-discount-rate"] {
    grid-column: 1 / -1;
  }

  .order-details .order-options #existing-order {
    width: 100%;
  }
}
`;

document.head.appendChild(compactStyles);

/* POS DISCOUNT */

const discountLabel = document.createElement("label");

discountLabel.htmlFor = "pos-discount-rate";
discountLabel.textContent =
  "Discount (food + add-ons only)";

const discountSelect = document.createElement("select");

discountSelect.id = "pos-discount-rate";

for (const [value, label] of [
  [0, "No discount"],
  [10, "10% discount"],
  [20, "20% discount"]
]) {
  discountSelect.add(
    new Option(label, String(value))
  );
}

discountLabel.appendChild(discountSelect);

document.querySelector(
  "#order-details .order-options"
).appendChild(discountLabel);

discountSelect.addEventListener(
  "change",
  () => renderCart()
);

/* HELPERS */

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
  Math.max(0, Math.floor(Number(value) || 0));

function currentBoxes() {
  return boxesForCart(cart, {
    "15": positiveInt($("box-15").value),
    "25": positiveInt($("box-25").value)
  });
}

function currentAddons() {
  const name = $("addon-name").value.trim();
  const qty = positiveInt($("addon-qty").value);
  const unitPrice = Number(
    $("addon-price").value || 0
  );

  return name &&
    qty > 0 &&
    Number.isFinite(unitPrice) &&
    unitPrice >= 0
    ? [{ name, qty, unitPrice }]
    : [];
}

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

/* EXISTING ORDERS */

function availableOrders() {
  const today = dayKey();

  return recentOrders.filter(order =>
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
      `Categories failed to load: ${error.message}`
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
        activeCategory = [
          ...menuByCategory.keys()
        ][0];
      }

      renderTabs();
      renderGrid();
    },
    error => connectionError(
      `Products failed to load: ${error.message}`
    )
  );

  onSnapshot(
    query(
      collection(db, "orders"),
      orderBy("createdAt", "desc")
    ),
    snapshot => {
      recentOrders = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderExistingOrders();
    },
    error => connectionError(
      `Existing orders failed to load: ${error.message}`
    )
  );
}

/* CATEGORY TABS */

function renderTabs() {
  tabsEl.replaceChildren();

  [
    ...new Set([
      ...categoryOrder,
      ...menuByCategory.keys()
    ])
  ].forEach(category => {
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

/*
 * PARTY BOX SET A AND SET B
 *
 * Fallback choices for existing Firebase products
 * that have no comboOptions saved yet.
 */

const PARTY_BOX_CHOICES = {
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

function partyBoxChoices(item) {
  if (
    String(item.category || "")
      .trim()
      .toLowerCase() !== "party box on the go"
  ) {
    return [];
  }

  const name = String(item.name || "")
    .trim()
    .toLowerCase();

  if (PARTY_BOX_CHOICES[name]) {
    return PARTY_BOX_CHOICES[name];
  }

  return Array.isArray(item.comboOptions)
    ? item.comboOptions
    : [];
}

/* RENDER MENU PRODUCTS */

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
    menuPane.innerHTML = `
      <p class="menu-empty">
        No products found.
      </p>
    `;
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

    button.innerHTML = `
      <span class="name">
        ${escapeHtml(item.name)}
      </span>

      <span class="product-category">
        ${escapeHtml(item.category)}
      </span>

      <span class="price">
        ${money(item.price)}
        ${
          item.variants?.length
            ? " – " + money(
                item.variants[
                  item.variants.length - 1
                ].price
              )
            : item.priceLarge
              ? " / " + money(item.priceLarge)
              : ""
        }
      </span>

      ${
        item.available === false
          ? `<span class="badge-unavail">
               Unavailable
             </span>`
          : ""
      }
    `;

    button.onclick = () => {
      if (
        item.variants?.length ||
        item.priceLarge ||
        partyBoxChoices(item).length
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

/* ADD ITEM TO CART */

function addToCart(item, size, unitPrice) {
  cart.push({
    key:
      crypto.randomUUID?.() ||
      `${Date.now()}-${Math.random()}`,

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

    note: ""
  });

  renderCart();
}

function lineTotal(line) {
  return Number(line.qty || 0) *
    Number(line.unitPrice || 0);
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

  for (const line of cart) {
    const row = document.createElement("div");

    row.className = "cart-line";

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
            Auto: regular food ₱15 /
            Sharing-Family no auto box
          </option>

          <option value="15">₱15 box</option>
          <option value="25">₱25 box (manual)</option>
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
          aria-label="Dine in or take out for ${escapeHtml(line.name)}"
        >
          <option value="Dine In">Dine In</option>
          <option value="Take Out">Take Out</option>
        </select>

        ${boxLabel}

        <input
          class="custom-note"
          placeholder="Notes (optional)"
          maxlength="180"
          value="${escapeHtml(line.note)}"
        />

        ${
          line.qty > 1
            ? `<button
                 class="split-serve"
                 type="button"
               >
                 Split 1 serving
               </button>`
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

    const serviceSelect = row.querySelector(
      ".serve-select"
    );

    serviceSelect.value = line.serveType;

    serviceSelect.onchange = event => {
      line.serveType = event.target.value;
      renderCart();
    };

    const boxSelect = row.querySelector(
      ".meal-box-select"
    );

    if (boxSelect) {
      boxSelect.value =
        line.boxChoice ?? "auto";

      boxSelect.onchange = event => {
        line.boxChoice = event.target.value;
        renderCart();
      };
    }

    row.querySelector(
      ".custom-note"
    ).oninput = event => {
      line.note = event.target.value;
    };

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

    const split = row.querySelector(
      ".split-serve"
    );

    if (split) {
      split.onclick = () => {
        line.qty--;

        cart.push({
          ...line,
          key:
            crypto.randomUUID?.() ||
            `${Date.now()}-${Math.random()}`,

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

  const discount = discountDetails(
    subtotal + extraCost,
    discountSelect.value
  );

  const total = rounded(
    subtotal +
    boxTotal(boxes) +
    extraCost -
    discount.discountAmount
  );

  $("cart-total").textContent = money(total);

  const addonCost = extraCost +
    cart.filter(item => item.isAddon)
      .reduce(
        (sum, item) => sum + lineTotal(item),
        0
      );

  $("box-fee-label").textContent =
    `Boxes ${money(boxTotal(boxes))}` +
    ` · Add-ons ${money(addonCost)}` +
    ` · Discount ${money(discount.discountAmount)}` +
    ` (${discount.discountRate}%)`;

  $("cart-count").textContent = String(
    cart.reduce(
      (sum, item) => sum + item.qty,
      0
    )
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

/*
 * SIZE / VARIANT / PARTY BOX MODAL
 */

function openSizeModal(item) {
  const variants =
    Array.isArray(item.variants) &&
    item.variants.length
      ? item.variants
      : (
          item.priceLarge
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
              ]
        );

  const choices = partyBoxChoices(item);

  const isParty = choices.length > 0;

  const freebie = /set a$/i.test(
    String(item.name).trim()
  )
    ? "FREE: 1.5L Coke"
    : /set b$/i.test(
        String(item.name).trim()
      )
      ? "FREE: 1.5L Coke + 1 tub Graham"
      : "";

  let selectedVariant = variants[0];

  const choicesMarkup = isParty ? `
    <fieldset class="party-choices">

      <legend>
        Choose your Party Box dishes
      </legend>

      <p class="party-hint">
        Tap each dish the customer wants.
        You can choose more than one.
      </p>

      <div class="party-choice-grid">
        ${choices.map((option, index) => `
          <label
            class="party-choice"
            for="party-choice-${index}"
          >
            <input
              id="party-choice-${index}"
              type="checkbox"
              data-party-choice
              value="${index}"
            >

            <span>
              ${escapeHtml(option)}
            </span>
          </label>
        `).join("")}
      </div>

      <p
        id="party-count"
        class="party-count"
      >
        0 selected
      </p>

      ${
        freebie
          ? `<p class="party-freebie">
               ${escapeHtml(freebie)}
             </p>`
          : ""
      }

    </fieldset>

    <label
      class="party-extra-label"
      for="party-note"
    >
      Other instructions (optional)

      <textarea
        id="party-note"
        rows="2"
        maxlength="60"
        placeholder="e.g. Sauce on the side"
      ></textarea>
    </label>

    <p
      class="party-error"
      id="party-error"
      role="alert"
      hidden
    ></p>
  ` : "";

  modalRoot.innerHTML = `
    <div class="modal-backdrop party-modal-backdrop">

      <div
        class="modal-sheet party-modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="party-modal-title"
      >

        <h3 id="party-modal-title">
          ${escapeHtml(item.name)}
        </h3>

        ${
          item.description
            ? `<p class="modal-subtitle">
                 ${escapeHtml(item.description)}
               </p>`
            : ""
        }

        ${
          variants.length > 1
            ? `
              <div class="size-options party-variants">
                ${variants.map((variant, index) => `
                  <button
                    type="button"
                    data-variant="${index}"
                    class="${
                      index === 0 ? "selected" : ""
                    }"
                  >
                    ${escapeHtml(variant.label)} ·
                    ${money(variant.price)}
                  </button>
                `).join("")}
              </div>
            `
            : `<p class="party-price">
                 Price:
                 <strong>
                   ${money(selectedVariant.price)}
                 </strong>
               </p>`
        }

        ${choicesMarkup}

        <div class="modal-actions">

          <button
            type="button"
            class="btn btn-outline"
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

  /* PARTY BOX DESIGN */

  if (!document.getElementById("party-box-styles")) {
    const styles = document.createElement("style");

    styles.id = "party-box-styles";

    styles.textContent = `
      .party-modal-sheet {
        max-height: min(90dvh, 760px);
        overflow-y: auto;
        width: min(94vw, 550px);
        padding: 18px;
      }

      .party-choices {
        border: 1px solid #e4d7ce;
        border-radius: 12px;
        padding: 12px;
        margin: 14px 0;
        background: #fff;
        min-width: 0;
      }

      .party-choices legend {
        font-weight: 800;
        color: #583c2e;
        padding: 0 5px;
      }

      .party-hint {
        margin: 0 0 10px;
        font-size: .78rem;
        color: #72594a;
      }

      .party-choice-grid {
        display: grid;
        grid-template-columns:
          repeat(2, minmax(0, 1fr));
        gap: 7px;
      }

      .party-choice {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 10px 9px;
        border: 1px solid #e3d6cd;
        border-radius: 9px;
        font-size: .8rem;
        font-weight: 700;
        background: #fff9f4;
        min-width: 0;
      }

      .party-choice:has(input:checked) {
        background: #fff0f7;
        border-color: #cd437e;
      }

      .party-choice input {
        width: 17px;
        height: 17px;
        flex: 0 0 auto;
        accent-color: #c44379;
      }

      .party-count {
        margin: 8px 0 3px;
        font-size: .77rem;
        font-weight: 800;
        color: #7c3858;
      }

      .party-freebie {
        font-size: .75rem;
        font-weight: 800;
        color: #376044;
        margin: 4px 0;
      }

      .party-extra-label {
        display: block;
        font-size: .8rem;
        font-weight: 700;
      }

      .party-extra-label textarea {
        display: block;
        width: 100%;
        min-width: 0;
        padding: 8px;
        border: 1px solid #d9cbc0;
        border-radius: 9px;
        resize: vertical;
        font: inherit;
      }

      .party-error {
        font-size: .8rem;
        font-weight: 800;
        color: #a82121;
        margin: 8px 0;
      }

      .party-price {
        margin: 7px 0;
        font-size: .9rem;
      }

      .party-modal-sheet .modal-actions {
        margin-top: 14px;
      }

      @media (max-width: 440px) {
        .party-choice-grid {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(styles);
  }

  const modal = modalRoot.querySelector(
    ".party-modal-sheet"
  );

  const errorNode = modal.querySelector(
    "#party-error"
  );

  function showPartyError(message) {
    if (!errorNode) return;

    errorNode.hidden = false;
    errorNode.textContent = message;
  }

  /* VARIANT BUTTONS */

  modal.querySelectorAll(
    "[data-variant]"
  ).forEach(button => {
    button.addEventListener("click", () => {
      selectedVariant = variants[
        Number(button.dataset.variant)
      ];

      modal.querySelectorAll(
        "[data-variant]"
      ).forEach(other => {
        other.classList.toggle(
          "selected",
          other === button
        );
      });
    });
  });

  /* PARTY BOX CHECKBOXES */

  modal.querySelectorAll(
    "[data-party-choice]"
  ).forEach(input => {
    input.addEventListener("change", () => {
      const selectedCount = modal.querySelectorAll(
        "[data-party-choice]:checked"
      ).length;

      modal.querySelector(
        "#party-count"
      ).textContent = `${selectedCount} selected`;

      errorNode.hidden = true;
    });
  });

  /* CLOSE MODAL */

  const closeModal = () => {
    modalRoot.replaceChildren();
  };

  modal.querySelector(
    "#modal-cancel"
  ).addEventListener("click", closeModal);

  modalRoot.querySelector(
    ".modal-backdrop"
  ).addEventListener("click", event => {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  });

  /* ADD SELECTED PARTY BOX TO ORDER */

  modal.querySelector(
    "#modal-add"
  ).addEventListener("click", () => {
    let note = "";
    let selectedChoices = [];

    if (isParty) {
      selectedChoices = [
        ...modal.querySelectorAll(
          "[data-party-choice]:checked"
        )
      ].map(input =>
        choices[Number(input.value)]
      );

      if (!selectedChoices.length) {
        showPartyError(
          "Choose at least one dish before adding the Party Box."
        );
        return;
      }

      const extraNote = modal.querySelector(
        "#party-note"
      ).value.trim();

      note = `Choices: ${selectedChoices.join(", ")}`;

      if (freebie) {
        note += ` | ${freebie}`;
      }

      if (extraNote) {
        note += ` | Note: ${extraNote}`;
      }

      if (note.length > 180) {
        showPartyError(
          "Too many characters. Shorten the instructions or selection notes."
        );
        return;
      }
    }

    addToCart(
      item,
      selectedVariant.label === "Regular"
        ? null
        : selectedVariant.label,
      Number(selectedVariant.price)
    );

    if (isParty) {
      const last = cart[cart.length - 1];

      last.note = note;
      last.comboSelections = selectedChoices;

      renderCart();
    }

    closeModal();
  });
}

/* POS EVENTS */

$("menu-search").addEventListener(
  "input",
  event => {
    searchText = event.target.value
      .trim()
      .toLowerCase();

    renderGrid();
  }
);

$("order-type").addEventListener(
  "change",
  event => {
    for (const line of cart) {
      line.serveType = event.target.value;
    }

    renderCart();
  }
);

for (const id of [
  "box-15",
  "box-25",
  "addon-qty",
  "addon-price",
  "addon-name"
]) {
  $(id).addEventListener(
    "input",
    renderCart
  );
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

  const items = cart.map(({ key, ...line }) => ({
    ...line,
    qty: Number(line.qty),
    unitPrice: Number(line.unitPrice),
    isDrink: isDrink(
      line.category,
      line.name
    ),
    boxUnitPrice: lineBoxPrice(line)
  }));

  const eligibleSubtotal = rounded(
    items.reduce(
      (sum, item) => sum + lineTotal(item),
      0
    ) +
    addons.reduce(
      (sum, item) => sum + lineTotal(item),
      0
    )
  );

  const discount = discountDetails(
    eligibleSubtotal,
    discountSelect.value
  );

  const delta = {
    items,
    addons,
    boxes,
    packagingFee: boxTotal(boxes),
    ...discount
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

      /* ADD TO EXISTING ORDER */

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
              "Only today's orders can receive new add-ons."
            );
          }

          const next = {
            ...old,

            items: [
              ...(old.items || []),
              ...items.map(item => ({
                ...item,
                isAddon: true
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

          next.packagingFee =
            next.legacyPackagingFee +
            boxTotal(next.boxes);

          next.total = rounded(
            Number(old.total || 0) + charge
          );

          next.discountAmount = rounded(
            Number(old.discountAmount || 0) +
            discount.discountAmount
          );

          next.discountRate =
            Number(old.discountRate || 0) ===
            discount.discountRate
              ? discount.discountRate
              : 0;

          next.addOnTotal = rounded(
            Number(
              old.addOnTotal ?? addonsTotal(old)
            ) +
            items.reduce(
              (sum, item) =>
                sum + lineTotal(item),
              0
            ) +
            addons.reduce(
              (sum, item) =>
                sum + lineTotal(item),
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
            discountRate: next.discountRate,
            discountAmount: next.discountAmount,
            addOnTotal: next.addOnTotal,
            updatedAt: next.updatedAt
          });

          return {
            ...delta,

            items: items.map(item => ({
              ...item,
              isAddon: true
            })),

            orderNumber: old.orderNumber,
            orderType: old.orderType,
            paymentMethod: old.paymentMethod,
            customerName: old.customerName,

            dayKey: dayKey(),
            printedAt: new Date().toISOString(),

            total: charge,
            discountRate: discount.discountRate,
            discountAmount: discount.discountAmount,

            updatedOrderTotal: next.total,
            receiptMode: "ADD-ON"
          };
        }
      );

    } else {

      /* SAVE NEW ORDER */

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
          (number, item) => Math.max(
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

    /* CLEAR AFTER SUCCESS */

    cart = [];

    $("customer-name").value = "";
    $("addon-name").value = "";
    $("addon-price").value = "";
    $("addon-qty").value = "1";

    $("box-15").value = "0";
    $("box-25").value = "0";
    $("existing-order").value = "";

    discountSelect.value = "0";

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
    console.error(
      "Checkout failed",
      error
    );

    toast(
      `Not saved: ${error.message}`
    );

  } finally {
    submitting = false;
    renderCart();
  }
});

/* RESET DAILY ORDER CHOICES */

let lastBusinessDay = dayKey();

setInterval(() => {
  const today = dayKey();

  if (today === lastBusinessDay) return;

  lastBusinessDay = today;

  renderExistingOrders();
}, 60000);

/* START POS */

listenMenu().catch(error => {
  console.error(error);
  connectionError(error.message);
});
