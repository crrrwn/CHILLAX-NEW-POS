
/**
 * CHILLAX CAFE POS
 * NOT AVAILABLE TODAY
 *
 * ADMIN:
 * - Sidebar with matching clipboard icon
 * - Located below Kuya Boss Sales
 * - Select entire categories
 * - Select individual menu products
 * - Search products
 * - Save for today
 * - Clear selections
 * - Print 58mm unavailable list
 *
 * POS:
 * - Disable unavailable products
 * - Block unavailable items at checkout
 *
 * Temporary availability expires at
 * Philippine midnight.
 *
 * Does not overwrite permanent menu.available.
 */

import {
  db,
  authReady
} from "./firebase-config.js";

import {
  dayKey
} from "./business.js";

import {
  collection,
  onSnapshot,
  doc,
  writeBatch,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* HELPERS */

const $ = id => document.getElementById(id);

const norm = value =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function formatDay(iso) {
  const [year, month, day] =
    iso.split("-").map(Number);

  return new Intl.DateTimeFormat(
    "en-PH",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Asia/Manila"
    }
  ).format(
    new Date(
      Date.UTC(year, month - 1, day, 4)
    )
  );
}

/* STATE */

const products = new Map();

let today = dayKey();
let loaded = false;

let chosen = new Set();

let dirty = false;
let saving = false;

let searchText = "";

const adminPage = Boolean(
  $("section-dashboard") &&
  document.querySelector(".admin-nav")
);

const posPage = !adminPage && Boolean(
  $("item-grid")
);

/* PRODUCT AVAILABILITY */

function unavailableNow(item) {
  return (
    item.available === false ||
    item.unavailableOn === today
  );
}

function temporaryNow(item) {
  return item.unavailableOn === today;
}

function orderedProducts() {
  return [...products.values()].sort(
    (a, b) =>
      String(a.category || "").localeCompare(
        String(b.category || "")
      ) ||
      String(a.name || "").localeCompare(
        String(b.name || "")
      )
  );
}

/* NOTIFICATION */

function showStatus(
  message,
  isError = false
) {
  const target = $(
    "today-unavailable-status"
  );

  if (!target) return;

  target.textContent = message;

  target.style.color = isError
    ? "#a52a2a"
    : "#315a39";
}

/* CREATE ELEMENT */

function makeElement(
  tag,
  text = null,
  className = null
) {
  const element =
    document.createElement(tag);

  if (text != null) {
    element.textContent = String(text);
  }

  if (className) {
    element.className = className;
  }

  return element;
}

/* GROUP PRODUCTS BY CATEGORY */

function groupedProducts() {
  const groups = new Map();

  for (const product of orderedProducts()) {
    const category =
      product.category || "Other";

    if (!groups.has(category)) {
      groups.set(category, []);
    }

    groups.get(category).push(product);
  }

  return groups;
}

/* ======================================
   ADMIN INITIALIZATION
====================================== */

function initializeAdmin() {
  const nav = document.querySelector(
    ".admin-nav"
  );

  const main = document.querySelector(
    ".admin-main"
  );

  const menuTab = nav?.querySelector(
    '[data-tab="menu"]'
  );

  const bossTab = nav?.querySelector(
    '[data-tab="owner-boss"]'
  );

  if (!nav || !main || !menuTab) {
    return;
  }

  /* ====================================
     NOT AVAILABLE TODAY SIDEBAR BUTTON
  ==================================== */

  const existingButton = nav.querySelector(
    '[data-tab="unavailable-today"]'
  );

  const button =
    existingButton ||
    makeElement("button");

  button.type = "button";

  button.dataset.tab =
    "unavailable-today";

  /*
   * Clipboard-list icon matching
   * the other sidebar outline icons.
   */

  button.innerHTML = `
    <svg
      class="sidebar-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect
        x="5"
        y="4"
        width="14"
        height="18"
        rx="2"
      />

      <rect
        x="9"
        y="2"
        width="6"
        height="4"
        rx="1"
      />

      <path
        d="M9 11h6M9 15h6M9 19h3"
      />
    </svg>

    <span>Not Available Today</span>
  `;

  /*
   * IMPORTANT:
   * Place below KUYA BOSS SALES.
   */

  if (bossTab) {
    bossTab.after(button);
  } else {
    menuTab.after(button);
  }

  /* ====================================
     NOT AVAILABLE TODAY CONTENT
  ==================================== */

  const panel = makeElement(
    "section"
  );

  panel.id =
    "section-unavailable-today";

  panel.className = "hidden";

  panel.innerHTML = `
    <div class="section-head">
      <div>

        <p class="eyebrow">
          ADMIN · TODAY'S MENU
        </p>

        <h2>
          Not Available Today
        </h2>

        <p class="section-description">
          Select categories or individual
          menu products that are temporarily
          unavailable today.
        </p>

      </div>
    </div>

    <div class="card na-panel">

      <p
        id="na-date"
        class="na-date"
      ></p>

      <p class="na-help">
        Temporary selections expire automatically
        at Philippine midnight.

        Permanent
        <strong>Available / Not Available</strong>
        status is managed in Menu Management.
      </p>

      <div class="na-actions">

        <button
          type="button"
          id="na-save"
          class="btn btn-primary"
        >
          Save for Today
        </button>

        <button
          type="button"
          id="na-clear"
          class="btn btn-outline"
        >
          Clear Today's Selections
        </button>

        <button
          type="button"
          id="na-print"
          class="btn btn-outline"
        >
          Print 58mm List
        </button>

      </div>

      <p
        id="today-unavailable-status"
        role="status"
        aria-live="polite"
      ></p>

      <p
        id="na-count"
        class="na-date"
      ></p>

      <h3>
        1. Select entire categories
      </h3>

      <div
        id="na-categories"
        class="na-groups"
      ></div>

      <h3>
        2. Select individual products
      </h3>

      <label
        for="na-search"
        class="na-search-label"
      >
        Search item or category
      </label>

      <input
        id="na-search"
        type="search"
        placeholder="e.g. Caramel Milktea"
        autocomplete="off"
      >

      <div
        id="na-products"
        class="na-products"
      ></div>

    </div>
  `;

  main.append(panel);

  /* ====================================
     NOT AVAILABLE DESIGN
  ==================================== */

  const style = makeElement("style");

  style.textContent = `
    @media screen {

      .na-panel {
        max-width: 980px;
      }

      .na-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 9px;
        margin: 12px 0;
      }

      .na-date {
        margin: 9px 0;
        font-weight: 750;
        color: #674737;
      }

      .na-help {
        color: #80695c;
        font-size: .85rem;
        line-height: 1.5;
      }

      #today-unavailable-status {
        min-height: 20px;
        font-size: .85rem;
      }

      .na-groups {
        display: grid;

        grid-template-columns:
          repeat(
            auto-fit,
            minmax(190px, 1fr)
          );

        gap: 8px;
        margin: 12px 0 23px;
      }

      .na-products {
        max-height: 440px;

        overflow-y: auto;

        border: 1px solid #e8d8ca;
        border-radius: 12px;

        padding: 9px;

        overscroll-behavior: contain;
      }

      .na-check {
        display: flex;
        align-items: center;

        gap: 9px;
        padding: 9px 11px;

        border: 1px solid #eadbd1;
        border-radius: 10px;

        cursor: pointer;
        background: white;

        min-width: 0;
      }

      .na-check input {
        width: 18px;
        height: 18px;

        flex-shrink: 0;
        accent-color: #c44379;
      }

      .na-check span {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .na-check small {
        color: #816c5c;
        font-size: .72rem;
      }

      .na-check em {
        color: #a52a2a;
        font-size: .7rem;
        font-style: normal;
      }

      .na-category-heading {
        margin: 13px 0 6px;

        font-weight: 800;
        color: #5c3429;
      }

      .na-product-list {
        display: grid;

        grid-template-columns:
          repeat(
            auto-fit,
            minmax(235px, 1fr)
          );

        gap: 7px;
      }

      .na-search-label {
        display: block;

        margin: 10px 0 5px;

        font-size: .83rem;
        font-weight: 750;
      }

      #na-search {
        width: min(100%, 450px);

        padding: 10px 13px;
        margin-bottom: 10px;

        border: 1px solid #dfcfc5;
        border-radius: 9px;
      }

      .item-card .na-pos-tag {
        display: block;

        color: #ae315b;

        font-size: .7rem;
        font-weight: 850;
        margin-top: 4px;
      }

    }

    @media print {

      .receipt .na-print-category {
        font-weight: 900;

        border-top: 1px dashed black;

        padding: 1.5mm 0 .5mm;
        margin-top: 1.5mm;
      }

      .receipt .na-print-item {
        font-size: 8pt;

        padding: .7mm 0;
        overflow-wrap: anywhere;
      }

    }
  `;

  document.head.append(style);

  /* ====================================
     SIDEBAR NAVIGATION
  ==================================== */

  nav.addEventListener(
    "click",
    event => {
      const clicked =
        event.target.closest(
          "button[data-tab]"
        );

      if (!clicked) return;

      if (clicked === button) {
        /*
         * Show Not Available Today
         * and hide other sections.
         */

        for (const section of main.children) {
          if (
            section.id?.startsWith(
              "section-"
            )
          ) {
            section.classList.toggle(
              "hidden",
              section !== panel
            );
          }
        }

        /* ACTIVE SIDEBAR BUTTON */

        nav.querySelectorAll(
          "button[data-tab]"
        ).forEach(tab => {
          tab.classList.toggle(
            "active",
            tab === button
          );
        });

        main.scrollTo(0, 0);

      } else {
        panel.classList.add("hidden");
      }
    }
  );

  /* SEARCH */

  $("na-search").addEventListener(
    "input",
    event => {
      searchText = norm(
        event.target.value
      );

      renderProducts();
    }
  );

  /* SAVE */

  $("na-save").addEventListener(
    "click",
    saveSelection
  );

  /* PRINT */

  $("na-print").addEventListener(
    "click",
    printList
  );

  /* CLEAR */

  $("na-clear").addEventListener(
    "click",
    () => {
      if (!chosen.size) return;

      const confirmed = confirm(
        "Clear all temporary selections " +
        "for today? Click Save afterward."
      );

      if (!confirmed) return;

      chosen.clear();

      dirty = true;

      renderAdmin();

      showStatus(
        "Selections cleared on screen. " +
        "Click Save for Today to apply."
      );
    }
  );

  renderAdmin();
}

/* ======================================
   CHECKBOX GENERATOR
====================================== */

function createCheckbox(
  product,
  isCategory,
  labelText,
  categoryItems = null
) {
  const label = makeElement(
    "label",
    null,
    "na-check"
  );

  const checkbox =
    makeElement("input");

  checkbox.type = "checkbox";

  const items = isCategory
    ? categoryItems
    : [product];

  checkbox.checked =
    items.length > 0 &&
    items.every(
      item => chosen.has(item.id)
    );

  checkbox.indeterminate =
    items.some(
      item => chosen.has(item.id)
    ) &&
    !checkbox.checked;

  checkbox.disabled =
    saving || !loaded;

  label.append(
    checkbox,
    makeElement("span", labelText)
  );

  if (isCategory) {
    label.append(
      makeElement(
        "small",
        `(${items.length} items)`
      )
    );

  } else if (
    product.available === false
  ) {
    label.append(
      makeElement(
        "em",
        "Menu: Not Available"
      )
    );
  }

  checkbox.addEventListener(
    "change",
    () => {
      for (const item of items) {
        if (checkbox.checked) {
          chosen.add(item.id);
        } else {
          chosen.delete(item.id);
        }
      }

      dirty = true;
      renderAdmin();
    }
  );

  return label;
}

/* ======================================
   CATEGORY CHECKBOXES
====================================== */

function renderCategories() {
  const root = $("na-categories");

  if (!root) return;

  root.replaceChildren();

  for (
    const [category, items] of
    groupedProducts()
  ) {
    root.append(
      createCheckbox(
        null,
        true,
        category,
        items
      )
    );
  }

  if (!root.children.length) {
    root.textContent =
      "No menu categories yet.";
  }
}

/* ======================================
   INDIVIDUAL PRODUCT CHECKBOXES
====================================== */

function renderProducts() {
  const root = $("na-products");

  if (!root) return;

  root.replaceChildren();

  let found = 0;

  for (
    const [category, items] of
    groupedProducts()
  ) {
    const visible = items.filter(
      item =>
        !searchText ||
        norm(
          `${item.name} ${category}`
        ).includes(searchText)
    );

    if (!visible.length) continue;

    found += visible.length;

    root.append(
      makeElement(
        "div",
        category,
        "na-category-heading"
      )
    );

    const group = makeElement(
      "div",
      null,
      "na-product-list"
    );

    for (const item of visible) {
      group.append(
        createCheckbox(
          item,
          false,
          item.name
        )
      );
    }

    root.append(group);
  }

  if (!found) {
    root.append(
      makeElement(
        "p",
        "No matching products."
      )
    );
  }
}

/* ======================================
   REFRESH ADMIN DISPLAY
====================================== */

function renderAdmin() {
  if (!adminPage || !$("na-date")) {
    return;
  }

  $("na-date").textContent =
    `Philippine date: ${formatDay(today)}`;

  const permanentCount =
    orderedProducts().filter(
      item => item.available === false
    ).length;

  $("na-count").textContent =
    `${chosen.size} selected for today · ` +
    `${permanentCount} permanently ` +
    `Not Available in Menu`;

  $("na-save").disabled =
    !loaded || saving || !dirty;

  $("na-clear").disabled =
    !loaded || saving || !chosen.size;

  $("na-print").disabled =
    !loaded || saving;

  renderCategories();
  renderProducts();
}

/* ======================================
   SAVE SELECTIONS TO FIRESTORE
====================================== */

async function saveSelection() {
  if (
    saving ||
    !loaded ||
    !dirty
  ) {
    return;
  }

  if (today !== dayKey()) {
    showStatus(
      "The Philippine date changed. " +
      "Reload the list before saving.",
      true
    );

    return;
  }

  saving = true;
  renderAdmin();

  const changed = orderedProducts().filter(
    item =>
      temporaryNow(item) !==
      chosen.has(item.id)
  );

  try {
    await authReady;

    /*
     * Save in batches of up to 400.
     */

    for (
      let index = 0;
      index < changed.length;
      index += 400
    ) {
      const batch = writeBatch(db);

      for (
        const item of
        changed.slice(index, index + 400)
      ) {
        batch.update(
          doc(db, "menu", item.id),
          {
            unavailableOn:
              chosen.has(item.id)
                ? today
                : deleteField()
          }
        );
      }

      await batch.commit();
    }

    /* UPDATE LOCAL MENU STATE */

    for (const item of changed) {
      if (chosen.has(item.id)) {
        item.unavailableOn = today;
      } else {
        delete item.unavailableOn;
      }
    }

    dirty = false;

    showStatus(
      `${chosen.size} unavailable items ` +
      `saved for ${formatDay(today)}. ` +
      "POS will update automatically."
    );

  } catch (error) {
    showStatus(
      `Save failed: ${error.message}. ` +
      "Please check selections before retrying.",
      true
    );

  } finally {
    saving = false;
    renderAdmin();
  }
}

/* ======================================
   PRINT 58MM UNAVAILABLE LIST
====================================== */

function printList() {
  if (!loaded) return;

  if (dirty) {
    alert(
      "Click Save for Today before printing " +
      "so the list matches saved data."
    );

    return;
  }

  const area = $("print-area");

  if (!area) {
    showStatus(
      "Missing #print-area.",
      true
    );

    return;
  }

  /* TEMPORARY + PERMANENTLY UNAVAILABLE */

  const unavailable =
    orderedProducts().filter(
      unavailableNow
    );

  const groups = new Map();

  for (const item of unavailable) {
    const category =
      item.category || "Other";

    if (!groups.has(category)) {
      groups.set(category, []);
    }

    groups.get(category).push(item);
  }

  const receipt = makeElement(
    "section",
    null,
    "receipt"
  );

  receipt.append(
    makeElement(
      "h1",
      "NOT AVAILABLE TODAY",
      "center"
    )
  );

  receipt.append(
    makeElement(
      "div",
      formatDay(today),
      "center"
    )
  );

  receipt.append(
    makeElement(
      "div",
      null,
      "rule"
    )
  );

  receipt.append(
    makeElement(
      "div",
      `Unavailable items: ${unavailable.length}`,
      "copy-label"
    )
  );

  if (!unavailable.length) {
    receipt.append(
      makeElement(
        "div",
        "All listed menu items are available.",
        "na-print-item"
      )
    );
  }

  for (
    const [category, items] of groups
  ) {
    receipt.append(
      makeElement(
        "div",
        category.toUpperCase(),
        "na-print-category"
      )
    );

    for (const item of items) {
      receipt.append(
        makeElement(
          "div",
          `• ${item.name}`,
          "na-print-item"
        )
      );
    }
  }

  receipt.append(
    makeElement(
      "div",
      null,
      "rule"
    )
  );

  receipt.append(
    makeElement(
      "div",
      "Please ask the cashier for available alternatives.",
      "footer-note"
    )
  );

  area.replaceChildren(receipt);

  window.print();
}

/* ======================================
   POS AVAILABILITY
====================================== */

function displayedCategory(item) {
  if (item.category === "Shake & Frappé") {
    return /frapp|frappé/i.test(item.name)
      ? "Frappé"
      : "Shake";
  }

  return item.category;
}

/* MATCH POS CARD TO FIRESTORE PRODUCT */

function findPOSItem(
  name,
  category
) {
  const matches =
    orderedProducts().filter(
      item =>
        norm(item.name) === norm(name) &&
        norm(displayedCategory(item)) ===
          norm(category)
    );

  return matches.length === 1
    ? matches[0]
    : null;
}

/* DISABLE UNAVAILABLE PRODUCT CARDS */

function refreshPOSCards() {
  if (!posPage || !loaded) return;

  const cards =
    $("item-grid")?.querySelectorAll(
      ".item-card"
    ) || [];

  for (const card of cards) {
    const name = card.querySelector(
      ".name"
    )?.textContent.trim();

    const category = card.querySelector(
      ".product-category"
    )?.textContent.trim();

    const product = findPOSItem(
      name,
      category
    );

    if (!product) continue;

    const temporary =
      temporaryNow(product);

    const unavailable =
      unavailableNow(product);

    card.disabled = unavailable;

    card.classList.toggle(
      "unavailable",
      unavailable
    );

    const badge = card.querySelector(
      ".na-pos-tag"
    );

    if (temporary && !badge) {
      card.append(
        makeElement(
          "span",
          "Not Available Today",
          "na-pos-tag"
        )
      );

    } else if (!temporary && badge) {
      badge.remove();
    }
  }
}

/* ======================================
   POS CHECKOUT SAFEGUARD
====================================== */

function initializePOS() {
  const grid = $("item-grid");

  if (!grid) return;

  const styles = makeElement("style");

  styles.textContent = `
    @media screen {
      .item-card .na-pos-tag {
        display: block;
        color: #ae315b;
        font-size: .7rem;
        font-weight: 850;
        margin-top: 4px;
      }
    }
  `;

  document.head.append(styles);

  /*
   * Recheck product cards when
   * the main POS script redraws the menu.
   */

  new MutationObserver(
    refreshPOSCards
  ).observe(
    grid,
    {
      childList: true
    }
  );

  /*
   * Check current cart before checkout.
   */

  document.addEventListener(
    "click",
    event => {
      if (
        !event.target.closest(
          "#checkout-btn"
        )
      ) {
        return;
      }

      if (!loaded) {
        event.preventDefault();
        event.stopImmediatePropagation();

        alert(
          "Menu availability is still loading. " +
          "Please retry checkout."
        );

        return;
      }

      const unavailable = [];

      const rows =
        $("cart-items")?.querySelectorAll(
          ".cart-line"
        ) || [];

      for (const row of rows) {
        const name = row.querySelector(
          ".info .name"
        )?.textContent.trim();

        const unit = row.querySelector(
          ".info .unit"
        )?.textContent || "";

        const category = unit.includes("·")
          ? unit.split("·").slice(-1)[0].trim()
          : "";

        let item = findPOSItem(
          name,
          category
        );

        if (!item) {
          const matches = orderedProducts().filter(
            product =>
              norm(product.name) === norm(name)
          );

          if (matches.length === 1) {
            item = matches[0];
          }
        }

        if (item && unavailableNow(item)) {
          unavailable.push(item.name);
        }
      }

      if (unavailable.length) {
        event.preventDefault();

        event.stopImmediatePropagation();

        alert(
          "Cannot checkout. These items " +
          "are unavailable today:\n" +
          [...new Set(unavailable)].join("\n") +
          "\nRemove them before checkout."
        );
      }
    },
    true
  );
}

/* ======================================
   APPLICATION START
====================================== */

if (adminPage) {
  initializeAdmin();
}

if (posPage) {
  initializePOS();
}

/* LIVE FIRESTORE MENU */

if (adminPage || posPage) {
  authReady.then(() => {
    onSnapshot(
      collection(db, "menu"),

      snapshot => {
        products.clear();

        snapshot.docs.forEach(
          documentSnapshot => {
            products.set(
              documentSnapshot.id,
              {
                id: documentSnapshot.id,
                ...documentSnapshot.data()
              }
            );
          }
        );

        loaded = true;

        if (adminPage) {
          if (!dirty && !saving) {
            chosen = new Set(
              orderedProducts()
                .filter(temporaryNow)
                .map(item => item.id)
            );
          }

          renderAdmin();
        }

        if (posPage) {
          refreshPOSCards();
        }
      },

      error => {
        showStatus(
          `Cannot load menu: ${error.message}`,
          true
        );
      }
    );

  }).catch(error => {
    showStatus(
      `Sign-in error: ${error.message}`,
      true
    );
  });

  /* ====================================
     PHILIPPINE MIDNIGHT EXPIRY
  ==================================== */

  let previousDay = today;

  setInterval(
    () => {
      const current = dayKey();

      if (current === previousDay) {
        return;
      }

      previousDay = current;
      today = current;

      if (adminPage) {
        dirty = false;

        chosen = new Set(
          orderedProducts()
            .filter(temporaryNow)
            .map(item => item.id)
        );

        renderAdmin();

        showStatus(
          "New Philippine day. " +
          "Yesterday's temporary restrictions expired."
        );
      }

      if (posPage) {
        refreshPOSCards();
      }
    },
    30000
  );
}
