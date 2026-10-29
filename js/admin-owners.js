
/**
 * CHILLAX CAFE POS — ADMIN OWNER SALES
 * COMPLETE js/admin-owners.js
 *
 * KUYA GAA:
 * Iced Coffee, Hot Coffee, Frappe,
 * Lumpia Shanghai Alacarte,
 * Shanghai Silog = P30/serving,
 * Party Box/Party Tray Set A with Shanghai = P450/set,
 * Lumpia Shanghai Party Trays = actual saved price,
 * NO takeout boxes.
 *
 * KUYA BOSS:
 * Samyang, Buldak, Ramen and related add-ons,
 * linked P15/P25 takeout boxes.
 *
 * Other features:
 * From/To dates, printing, category assignments,
 * delete confirmation, combined GCash payments.
 */

import {
  db,
  authReady
} from "./firebase-config.js";

import {
  requireRole
} from "./auth.js";

import {
  dayKey,
  timestampDate,
  pesos,
  rounded,
  isMealItem,
  lineBoxPrice
} from "./business.js";

import {
  printOwnerReport
} from "./receipt.js";

import {
  collection,
  doc,
  onSnapshot,
  getDocs,
  query,
  where,
  runTransaction,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ADMIN ACCESS */

const session = requireRole(["admin"]);

if (!session || session.role !== "admin") {
  throw Error("Admin login required.");
}

/* HELPERS */

const $ = id =>
  document.getElementById(id);

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

const uniq = values => [
  ...new Set(
    (values || []).filter(
      value =>
        typeof value === "string" &&
        value.trim()
    )
  )
];

const num = value =>
  Number(value || 0);

const toCents = value =>
  Math.round(
    (Number(value) + Number.EPSILON) * 100
  );

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

const OWNERS = ["gaa", "boss"];

/* DEFAULT SALES ASSIGNMENTS */

const DEFAULTS = {
  gaa: {
    categories: [
      "Iced Coffee (16oz)",
      "Hot Coffee (12oz)",
      "Frappé"
    ],

    items: [
      keyOf(
        "Alacarte",
        "Lumpia Shanghai"
      ),

      keyOf(
        "All Day Breakfast",
        "Shanghai Silog"
      )
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

/* FIRESTORE SETTINGS */

const settingsRef = doc(
  db,
  "settings",
  "salesOwners"
);

/* APPLICATION STATE */

const state = {
  orders: [],
  menu: [],
  categories: [],
  payments: [],

  rules: structuredClone(DEFAULTS),

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

  page: {
    gaa: 1,
    boss: 1
  }
};

/* NOTIFICATIONS */

function showStatus(
  message,
  error = false
) {
  const element = $("owner-status");

  if (!element) return;

  element.textContent = message;

  element.style.color = error
    ? "#a22"
    : "#27613a";
}

/* CLEAN OWNER SETTINGS */

function cleanRules(saved) {
  const result = {};

  for (const owner of OWNERS) {
    const source =
      saved?.[owner] || DEFAULTS[owner];

    result[owner] = {
      categories: uniq(
        source.categories
      ),

      items: uniq(
        source.items
      )
    };
  }

  result.gaa.items = uniq([
    ...result.gaa.items,

    keyOf(
      "All Day Breakfast",
      "Shanghai Silog"
    )
  ]);

  return result;
}

/* PHILIPPINE DATE */

function orderDate(order) {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      order.dayKey || ""
    )
  ) {
    return order.dayKey;
  }

  const date = timestampDate(
    order.createdAt
  );

  return date &&
    Number.isFinite(date.getTime())
      ? dayKey(date)
      : "";
}

function paymentDate(payment) {
  if (payment.dayKey) {
    return payment.dayKey;
  }

  const date = timestampDate(
    payment.createdAt
  );

  return date &&
    Number.isFinite(date.getTime())
      ? dayKey(date)
      : "";
}

/* FROM / TO DATE FILTER */

function inRange(order, owner) {
  const date = orderDate(order);

  const {
    from,
    to
  } = state.dates[owner];

  return Boolean(date) &&
    (!from || date >= from) &&
    (!to || date <= to);
}

/* PRODUCT CATEGORY */

function categoryOf(item) {
  if (item.category) {
    return item.category;
  }

  const byId = state.menu.find(
    product =>
      product.id === item.menuId
  );

  if (byId) {
    return byId.category || "";
  }

  const matches = state.menu.filter(
    product =>
      norm(product.name) ===
      norm(item.name)
  );

  return matches.length === 1
    ? matches[0].category || ""
    : "";
}

/* SHANGHAI SILOG */

function isShanghaiSilog(item) {
  return (
    norm(item.name) === "shanghai silog" &&
    norm(categoryOf(item)) ===
      "all day breakfast"
  );
}

/* LUMPIANG SHANGHAI PARTY TRAYS */

function isShanghaiPartyTray(item) {
  const category = norm(
    categoryOf(item)
  );

  const name = norm(
    item.name
  );

  return (
    category.includes("party tray") &&
    (
      name === "lumpiang shanghai" ||
      name === "lumpia shanghai"
    )
  );
}

/* PARTY BOX / PARTY TRAY SET A */

function isSetA(item) {
  const name = norm(item.name);

  const category = norm(
    categoryOf(item)
  );

  const validName = [
    "party box set a",
    "party tray set a",
    "set a",
    "party box on the go set a"
  ].includes(name);

  const validCategory =
    category.includes("party box") ||
    category.includes("party tray");

  return validName && validCategory;
}

/**
 * CHECK IF SHANGHAI WAS SELECTED
 *
 * New POS:
 * comboSelections: ["Lumpia (30 pcs)"]
 *
 * Old POS:
 * note: "Choices: Lumpia (30 pcs), ..."
 */

function hasShanghaiInSetA(item) {
  if (!isSetA(item)) {
    return false;
  }

  if (
    Array.isArray(
      item.comboSelections
    )
  ) {
    return item.comboSelections.some(
      choice => {
        const name = norm(
          typeof choice === "string"
            ? choice
            : choice?.name
        );

        return /\b(lumpia|lumpiang|shanghai)\b/
          .test(name);
      }
    );
  }

  const note = String(
    item.note || ""
  );

  const selected =
    /(?:choices|selected dishes|selected)\s*:\s*([^|;\n]+)/i
      .exec(note)?.[1] || "";

  return selected
    .split(",")
    .some(choice =>
      /\b(lumpia|lumpiang|shanghai)\b/
        .test(norm(choice))
    );
}

/* IDENTIFY OWNER */

function ownerOf(item) {
  if (
    isShanghaiSilog(item) ||
    isShanghaiPartyTray(item)
  ) {
    return "gaa";
  }

  /*
   * SET A:
   * Count only the Shanghai share.
   * Never count the complete Set A price.
   */

  if (isSetA(item)) {
    return hasShanghaiInSetA(item)
      ? "gaa"
      : null;
  }

  const category = categoryOf(item);

  const product = keyOf(
    category,
    item.name
  );

  if (
    state.rules.gaa.items.includes(
      product
    )
  ) {
    return "gaa";
  }

  if (
    state.rules.boss.items.includes(
      product
    )
  ) {
    return "boss";
  }

  /* SAMYANG AND BULDAK */

  if (
    /\b(samyang|buldak)\b/.test(
      norm(item.name)
    )
  ) {
    return "boss";
  }

  /* CUSTOM CATEGORY ASSIGNMENTS */

  if (
    state.rules.gaa.categories.some(
      categoryName =>
        norm(categoryName) ===
        norm(category)
    )
  ) {
    return "gaa";
  }

  if (
    state.rules.boss.categories.some(
      categoryName =>
        norm(categoryName) ===
        norm(category)
    )
  ) {
    return "boss";
  }

  return null;
}

/* ITEM-LINKED TAKEOUT BOX PRICE */

function linkedBoxRate(
  item,
  order
) {
  if (item.boxUnitPrice != null) {
    const rate = Number(
      item.boxUnitPrice
    );

    return [15, 25].includes(rate)
      ? rate
      : 0;
  }

  if (
    item.boxChoice != null &&
    item.boxChoice !== "auto"
  ) {
    const rate = Number(
      item.boxChoice
    );

    return [15, 25].includes(rate)
      ? rate
      : 0;
  }

  const service =
    item.serveType ||
    order.orderType ||
    "Dine In";

  return service === "Take Out"
    ? lineBoxPrice({
        ...item,
        category: categoryOf(item),
        serveType: service
      })
    : 0;
}

/* KUYA BOSS TAKEOUT BOX SALES */

function bossBoxes(order) {
  const items =
    Array.isArray(order.items)
      ? order.items
      : [];

  const savedKnown =
    order.boxes &&
    typeof order.boxes === "object";

  const saved = {
    15: Math.max(
      0,
      num(order.boxes?.["15"])
    ),

    25: Math.max(
      0,
      num(order.boxes?.["25"])
    )
  };

  const allocated = {
    15: 0,
    25: 0
  };

  const boss = {
    15: 0,
    25: 0
  };

  for (const item of items) {
    const rate = linkedBoxRate(
      item,
      order
    );

    const qty = Math.max(
      0,
      Math.floor(num(item.qty))
    );

    if (!rate || !qty) {
      continue;
    }

    allocated[rate] += qty;

    if (ownerOf(item) === "boss") {
      boss[rate] += qty;
    }
  }

  const result = {
    15: 0,
    25: 0
  };

  if (savedKnown) {
    for (const rate of [15, 25]) {
      result[rate] = Math.min(
        saved[rate],
        boss[rate]
      );
    }

    /*
     * Extra boxes can be attributed to Boss
     * when all box-eligible meals in the order
     * belong to Boss.
     */

    const eligible = items.filter(
      item =>
        isMealItem({
          ...item,
          category: categoryOf(item)
        })
    );

    const bossOnly =
      eligible.length > 0 &&
      eligible.every(
        item =>
          ownerOf(item) === "boss"
      );

    if (bossOnly) {
      for (const rate of [15, 25]) {
        result[rate] += Math.max(
          0,
          saved[rate] -
          allocated[rate]
        );
      }
    }
  } else {
    /* SUPPORT OLDER SAVED ORDERS */

    let remaining = toCents(
      order.packagingFee || 0
    );

    for (const rate of [15, 25]) {
      const count = Math.min(
        boss[rate],
        Math.floor(
          remaining / (rate * 100)
        )
      );

      result[rate] = count;

      remaining -=
        count * rate * 100;
    }
  }

  return {
    count15: result[15],
    count25: result[25],

    total:
      result[15] * 15 +
      result[25] * 25
  };
}

/* ======================================
   OWNER SALES CALCULATIONS
====================================== */

function calculate(owner) {
  const grouped = new Map();

  let orderCount = 0;
  let boxes15 = 0;
  let boxes25 = 0;

  /*
   * Same Firestore orders collection
   * used by Admin Recent Orders.
   */

  for (const order of state.orders) {
    if (!inRange(order, owner)) {
      continue;
    }

    const lines = [
      ...(
        Array.isArray(order.items)
          ? order.items
          : []
      ),

      ...(
        Array.isArray(order.addons)
          ? order.addons
          : []
      )
    ];

    const subtotal = lines.reduce(
      (sum, item) =>
        sum +
        num(item.qty) *
        num(item.unitPrice),
      0
    );

    const legacyDiscount = num(
      order.discountMode === "perItem"
        ? order.legacyDiscountAmount
        : order.discountAmount
    );

    let matched = false;

    for (const item of lines) {
      if (ownerOf(item) !== owner) {
        continue;
      }

      const qty = Number(
        item.qty
      );

      const unitPrice = Number(
        item.unitPrice
      );

      if (
        !Number.isInteger(qty) ||
        qty <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        continue;
      }

      matched = true;

      const category =
        categoryOf(item) || "Other";

      const gross =
        qty * unitPrice;

      const perItemDiscount =
        order.discountMode === "perItem"
          ? gross *
            num(item.discountRate) / 100
          : 0;

      const legacyShare =
        subtotal > 0
          ? legacyDiscount *
            gross / subtotal
          : 0;

      let sales = Math.max(
        0,
        rounded(
          gross -
          perItemDiscount -
          legacyShare
        )
      );

      let title =
        `${item.name}${
          item.size
            ? ` (${item.size})`
            : ""
        }`;

      /*
       * SHANGHAI SILOG:
       * P30 PER SERVING
       */

      if (
        owner === "gaa" &&
        isShanghaiSilog(item)
      ) {
        sales = qty * 30;
      }

      /*
       * PARTY BOX / PARTY TRAY SET A
       * WITH LUMPIANG SHANGHAI:
       *
       * P450 PER SET
       *
       * 1 set = P450
       * 2 sets = P900
       * 3 sets = P1350
       */

      if (
        owner === "gaa" &&
        isSetA(item) &&
        hasShanghaiInSetA(item)
      ) {
        sales = qty * 450;

        title =
          "Set A — Lumpiang Shanghai share";
      }

      /*
       * STANDALONE LUMPIANG SHANGHAI
       * PARTY TRAYS:
       *
       * Uses the saved unitPrice,
       * quantity, size and applicable
       * discount from the order.
       */

      const id = keyOf(
        category,
        title
      );

      const row = grouped.get(id) || {
        category,
        name: title,
        qty: 0,
        sales: 0
      };

      row.qty += qty;

      row.sales = rounded(
        row.sales + sales
      );

      grouped.set(id, row);
    }

    if (matched) {
      orderCount++;

      if (owner === "boss") {
        const boxes = bossBoxes(order);

        boxes15 += boxes.count15;
        boxes25 += boxes.count25;
      }
    }
  }

  const rows = [
    ...grouped.values()
  ].sort(
    (a, b) =>
      b.sales - a.sales ||
      a.name.localeCompare(b.name)
  );

  const productSales = rounded(
    rows.reduce(
      (sum, row) =>
        sum + row.sales,
      0
    )
  );

  /* NO TAKEOUT BOXES FOR KUYA GAA */

  const boxSales =
    owner === "boss"
      ? boxes15 * 15 +
        boxes25 * 25
      : 0;

  return {
    rows,

    productSales,
    boxSales,

    total: rounded(
      productSales + boxSales
    ),

    qty: rows.reduce(
      (sum, row) =>
        sum + row.qty,
      0
    ),

    orders: orderCount,

    box15:
      owner === "boss"
        ? boxes15
        : 0,

    box25:
      owner === "boss"
        ? boxes25
        : 0
  };
}

/* ======================================
   RENDER OWNER REPORT
====================================== */

function renderOwner(owner) {
  const body = $(
    `owner-${owner}-body`
  );

  if (!body) return;

  const report = calculate(owner);

  $(`owner-${owner}-sales`).textContent =
    pesos(report.total);

  $(`owner-${owner}-qty`).textContent =
    String(report.qty);

  $(`owner-${owner}-orders`).textContent =
    String(report.orders);

  body.replaceChildren();

  const pageCount = Math.max(
    1,
    Math.ceil(
      report.rows.length / 5
    )
  );

  const page = state.page[owner] =
    Math.max(
      1,
      Math.min(
        pageCount,
        state.page[owner]
      )
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
        pesos(item.sales)
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
    td.textContent =
      "No matching sales for selected dates.";

    tr.append(td);
    body.append(tr);
  }

  $(`owner-${owner}-page`).textContent =
    `Page ${page} of ${pageCount} ` +
    `(${report.rows.length} items)`;

  $(`owner-${owner}-prev`).disabled =
    page <= 1;

  $(`owner-${owner}-next`).disabled =
    page >= pageCount;

  /* SALES SUMMARY */

  let summary = $(
    `owner-${owner}-extra-summary`
  );

  if (!summary) {
    summary = document.createElement("p");

    summary.id =
      `owner-${owner}-extra-summary`;

    summary.className =
      "owner-note";

    body.closest(".owner-card")
      ?.querySelector(".owner-stats")
      ?.insertAdjacentElement(
        "afterend",
        summary
      );
  }

  if (summary) {
    if (owner === "gaa") {
      summary.textContent =
        `Products: ${pesos(report.productSales)} · ` +
        `Set A with Shanghai: ₱450/set · ` +
        `Shanghai Party Trays: saved price · ` +
        `Shanghai Silog: ₱30/serving · ` +
        `Boxes excluded.`;

    } else {
      summary.textContent =
        `Products: ${pesos(report.productSales)} · ` +
        `Boxes: ${report.box15}×₱15 + ` +
        `${report.box25}×₱25 = ` +
        `${pesos(report.boxSales)} · ` +
        `Total: ${pesos(report.total)}`;
    }
  }
}

/* ======================================
   OWNER ASSIGNMENTS
====================================== */

function fillSelect(
  id,
  choices,
  placeholder
) {
  const select = $(id);

  if (!select) return;

  const previous = select.value;

  select.replaceChildren(
    new Option(placeholder, "")
  );

  for (const option of choices) {
    select.add(
      new Option(
        option.label,
        option.value
      )
    );
  }

  if (
    [...select.options].some(
      option =>
        option.value === previous
    )
  ) {
    select.value = previous;
  }
}

function renderChoices(owner) {
  const categories = uniq([
    ...state.categories.map(
      category => category.name
    ),

    ...state.menu.map(
      product => product.category
    )
  ]).sort();

  fillSelect(
    `owner-${owner}-category`,

    categories.map(name => ({
      label: name,
      value: name
    })),

    "Choose category"
  );

  fillSelect(
    `owner-${owner}-product`,

    state.menu
      .filter(
        product =>
          product.category &&
          product.name
      )
      .sort(
        (a, b) =>
          `${a.category} ${a.name}`
            .localeCompare(
              `${b.category} ${b.name}`
            )
      )
      .map(product => ({
        label:
          `${product.category} · ${product.name}`,

        value: keyOf(
          product.category,
          product.name
        )
      })),

    "Choose item"
  );

  const root = $(
    `owner-${owner}-rules`
  );

  if (!root) return;

  root.replaceChildren();

  for (const type of ["categories", "items"]) {
    for (
      const value of
      state.rules[owner][type]
    ) {
      const chip =
        document.createElement("span");

      chip.className = "owner-rule";

      chip.append(
        document.createTextNode(
          `${
            type === "items"
              ? "Item"
              : "Category"
          }: ${value.replace("|", " · ")} `
        )
      );

      const remove =
        document.createElement("button");

      remove.type = "button";
      remove.textContent = "×";

      remove.onclick = () =>
        changeRule(
          owner,
          type,
          value,
          false
        );

      chip.append(remove);
      root.append(chip);
    }
  }
}

function renderAll() {
  for (const owner of OWNERS) {
    renderOwner(owner);
    renderChoices(owner);
  }
}

async function changeRule(
  owner,
  type,
  value,
  add
) {
  if (!value) return;

  try {
    await authReady;

    await runTransaction(
      db,
      async transaction => {
        const snapshot =
          await transaction.get(
            settingsRef
          );

        const next = cleanRules(
          snapshot.exists()
            ? snapshot.data().owners
            : DEFAULTS
        );

        next[owner][type] = add
          ? uniq([
              ...next[owner][type],
              value
            ])
          : next[owner][type].filter(
              item => item !== value
            );

        transaction.set(
          settingsRef,
          {
            owners: next,
            updatedAt: serverTimestamp()
          }
        );
      }
    );

    showStatus(
      "Owner assignments saved. Reports will refresh."
    );

  } catch (error) {
    showStatus(
      `Assignment failed: ${error.message}`,
      true
    );
  }
}

/* ======================================
   PRINT KUYA GAA / KUYA BOSS
====================================== */

function printOwner(owner) {
  const {
    from,
    to
  } = state.dates[owner];

  if (from && to && from > to) {
    showStatus(
      "From date must not be after To date.",
      true
    );

    return;
  }

  const report = calculate(owner);

  try {
    printOwnerReport({
      ownerName:
        owner === "gaa"
          ? "KUYA GAA"
          : "KUYA BOSS",

      from: from || "All",
      to: to || "All",

      rows: report.rows,

      itemsSold: report.qty,
      orders: report.orders,

      productSales: report.productSales,
      boxSales: report.boxSales,

      note:
        owner === "gaa"
          ? (
              "Set A w/ Shanghai: P450; " +
              "Shanghai trays: saved price; " +
              "Silog: P30. No boxes."
            )
          : (
              `Boxes: ${report.box15} x P15, ` +
              `${report.box25} x P25.`
            )
    });

  } catch (error) {
    showStatus(
      `Print failed: ${error.message}`,
      true
    );
  }
}

/* ======================================
   SIDEBAR NAVIGATION
====================================== */

function setupNavigation() {
  const nav = document.querySelector(
    ".admin-nav"
  );

  if (!nav) return;

  const finance = nav.querySelector(
    '[data-tab="finances"]'
  );

  const gaa = nav.querySelector(
    '[data-tab="owner-gaa"]'
  );

  const boss = nav.querySelector(
    '[data-tab="owner-boss"]'
  );

  /* OWNER REPORTS BELOW EXPENSES & CASH */

  if (finance && gaa && boss) {
    finance.after(gaa);
    gaa.after(boss);
  }

  for (const owner of OWNERS) {
    const section = $(
      `section-owner-${owner}`
    );

    if (!section) continue;

    /* SHOW FROM AND TO DIRECTLY */

    $(`owner-${owner}-range`)
      ?.closest("label")
      ?.remove();

    const custom = $(
      `owner-${owner}-custom`
    );

    if (custom) {
      custom.hidden = false;

      custom.style.cssText =
        "display:flex;" +
        "gap:10px;" +
        "flex-wrap:wrap;" +
        "align-items:center";
    }

    for (const part of ["from", "to"]) {
      const input = $(
        `owner-${owner}-${part}`
      );

      if (!input) continue;

      input.value =
        state.dates[owner][part];

      input.onchange = () => {
        state.dates[owner][part] =
          input.value;

        state.page[owner] = 1;

        renderOwner(owner);
      };
    }

    /* PRINT BUTTON */

    const filters = section.querySelector(
      ".owner-filters"
    );

    if (
      filters &&
      !filters.querySelector(
        ".owner-print-button"
      )
    ) {
      const button =
        document.createElement("button");

      button.type = "button";

      button.className =
        "btn btn-primary owner-print-button";

      button.textContent =
        "Print 58mm Sales Report";

      button.onclick = () =>
        printOwner(owner);

      filters.append(button);
    }

    /* TABLE PAGINATION */

    const prev = $(
      `owner-${owner}-prev`
    );

    const next = $(
      `owner-${owner}-next`
    );

    if (prev) {
      prev.onclick = () => {
        state.page[owner]--;
        renderOwner(owner);
      };
    }

    if (next) {
      next.onclick = () => {
        state.page[owner]++;
        renderOwner(owner);
      };
    }

    /* ADD CATEGORY */

    const addCategory = $(
      `owner-${owner}-add-category`
    );

    if (addCategory) {
      addCategory.onclick = () =>
        changeRule(
          owner,
          "categories",
          $(`owner-${owner}-category`).value,
          true
        );
    }

    /* ADD PRODUCT */

    const addProduct = $(
      `owner-${owner}-add-product`
    );

    if (addProduct) {
      addProduct.onclick = () =>
        changeRule(
          owner,
          "items",
          $(`owner-${owner}-product`).value,
          true
        );
    }

    /* OWNER SIDEBAR BUTTON */

    nav.querySelector(
      `[data-tab="owner-${owner}"]`
    )?.addEventListener(
      "click",
      () => {
        for (
          const id of [
            "dashboard",
            "menu",
            "finances",
            "settings",
            "owner-gaa",
            "owner-boss",
            "unavailable-today"
          ]
        ) {
          $(`section-${id}`)
            ?.classList.toggle(
              "hidden",
              id !== `owner-${owner}`
            );
        }

        nav.querySelectorAll(
          "button[data-tab]"
        ).forEach(button => {
          button.classList.toggle(
            "active",
            button.dataset.tab ===
              `owner-${owner}`
          );
        });

        document.querySelector(
          ".admin-main"
        )?.scrollTo(0, 0);
      }
    );
  }

  /* REGULAR ADMIN TABS */

  nav.querySelectorAll(
    'button[data-tab]:not([data-tab^="owner-"])'
  ).forEach(button => {
    button.addEventListener(
      "click",
      () => {
        OWNERS.forEach(owner =>
          $(`section-owner-${owner}`)
            ?.classList.add("hidden")
        );
      }
    );
  });
}

/* ======================================
   DELETE ORDER WITH CONFIRMATION
====================================== */

const recent = $(
  "recent-orders-body"
);

function ensureDeleteButtons() {
  if (!recent) return;

  recent.querySelectorAll(
    "[data-edit-order]"
  ).forEach(edit => {
    const parent = edit.parentElement;

    if (
      !parent ||
      parent.querySelector(
        "[data-owner-delete]"
      )
    ) {
      return;
    }

    const button =
      document.createElement("button");

    button.type = "button";

    button.className =
      "btn btn-sm btn-outline order-delete-btn";

    button.textContent = "Delete";

    button.dataset.ownerDelete =
      edit.dataset.editOrder;

    parent.append(button);
  });
}

function confirmDelete(order) {
  const root = $("modal-root");

  if (!root) return;

  root.innerHTML = `
    <div
      class="modal-backdrop"
      id="owner-delete-modal"
    >
      <section
        class="modal-sheet"
        role="alertdialog"
        aria-modal="true"
        style="max-width:440px"
      >

        <h3>
          Delete Order #${escapeHtml(order.orderNumber)}?
        </h3>

        <p>
          Total: ${pesos(order.total)}.
          This permanently removes the order
          and its linked GCash payments.
          Sales, Kuya Gaa, and Kuya Boss
          reports will update.
        </p>

        <p
          id="owner-delete-error"
          class="form-error"
          role="alert"
        ></p>

        <div class="modal-actions">

          <button
            id="owner-delete-cancel"
            type="button"
            class="btn btn-outline"
          >
            Cancel
          </button>

          <button
            id="owner-delete-confirm"
            type="button"
            class="btn btn-primary"
          >
            Yes, Delete Order
          </button>

        </div>

      </section>
    </div>
  `;

  const close = () =>
    root.replaceChildren();

  root.querySelector(
    "#owner-delete-cancel"
  ).onclick = close;

  const button = root.querySelector(
    "#owner-delete-confirm"
  );

  button.onclick = async () => {
    button.disabled = true;
    button.textContent = "Deleting…";

    try {
      await authReady;

      const linked = await getDocs(
        query(
          collection(
            db,
            "gcashPayments"
          ),

          where(
            "orderId",
            "==",
            order.id
          )
        )
      );

      const batch = writeBatch(db);

      batch.delete(
        doc(
          db,
          "orders",
          order.id
        )
      );

      const payments = new Map(
        linked.docs.map(payment => [
          payment.id,
          payment.ref
        ])
      );

      payments.set(
        order.id,
        doc(
          db,
          "gcashPayments",
          order.id
        )
      );

      for (const payment of payments.values()) {
        batch.delete(payment);
      }

      await batch.commit();

      close();

      showStatus(
        `Order #${order.orderNumber} deleted. ` +
        "Reports will update."
      );

    } catch (error) {
      root.querySelector(
        "#owner-delete-error"
      ).textContent = error.message;

      button.disabled = false;

      button.textContent =
        "Yes, Delete Order";
    }
  };
}

recent?.addEventListener(
  "click",
  event => {
    const button = event.target.closest(
      "[data-owner-delete]"
    );

    if (!button) return;

    const order = state.orders.find(
      item =>
        item.id ===
        button.dataset.ownerDelete
    );

    if (order) {
      confirmDelete(order);
    } else {
      showStatus(
        "Order no longer exists.",
        true
      );
    }
  }
);

if (recent) {
  new MutationObserver(
    ensureDeleteButtons
  ).observe(
    recent,
    {
      childList: true,
      subtree: true
    }
  );

  ensureDeleteButtons();
}

/* ======================================
   COMBINED / SPLIT GCASH PAYMENTS
====================================== */

function paymentFor(id) {
  return state.payments.find(
    payment =>
      payment.orderId === id ||
      payment.id === id
  );
}

function ordersOnDay(day) {
  return state.orders
    .filter(
      order =>
        orderDate(order) === day
    )
    .sort(
      (a, b) =>
        num(a.orderNumber) -
        num(b.orderNumber)
    );
}

function parseCents(value) {
  const text = String(value).trim();

  return /^\d+(?:\.\d{1,2})?$/.test(text)
    ? toCents(Number(text))
    : NaN;
}

/* OPEN GCASH PAYMENT MODAL */

function openGcashModal(entry = null) {
  const root = $("modal-root");

  const day = entry
    ? paymentDate(entry)
    : $("finance-date")?.value || dayKey();

  const orders = ordersOnDay(day);

  if (!orders.length) {
    showStatus(
      "No saved orders on this date.",
      true
    );

    return;
  }

  const startId =
    entry?.orderId ||
    orders[0].id;

  const options = orders.map(order => `
    <option
      value="${escapeHtml(order.id)}"
      ${order.id === startId ? "selected" : ""}
    >
      #${escapeHtml(order.orderNumber)} ·
      ${escapeHtml(order.customerName || "Walk-in")} ·
      ${pesos(order.total)}
    </option>
  `).join("");

  root.innerHTML = `
    <div
      class="modal-backdrop"
      id="owner-gcash-modal"
    >
      <section
        class="modal-sheet finance-modal"
        style="max-width:590px;max-height:90dvh;overflow:auto"
      >

        <h3>
          ${entry ? "Edit GCash Amount" : "Add GCash Payment"}
        </h3>

        <p class="modal-subtitle">
          ${
            entry
              ? "Correct the cumulative GCash amount for this order."
              : "One GCash transfer may cover two saved orders. Allocate the amount to each receipt."
          }
        </p>

        <form
          id="owner-gcash-form"
          class="modal-form"
        >

          <label class="field">
            Main order

            <select
              id="owner-gcash-main"
              required
              ${entry ? "disabled" : ""}
            >
              ${options}
            </select>
          </label>

          ${
            entry
              ? ""
              : `
                <label class="field">
                  Additional order (optional)

                  <select id="owner-gcash-extra">
                    <option value="">
                      None — one order only
                    </option>

                    ${options}
                  </select>
                </label>
              `
          }

          <label class="field">
            Description

            <input
              id="owner-gcash-description"
              type="text"
              maxlength="160"
              required
              value="${escapeHtml(entry?.description || "")}"
              placeholder="GCash for Orders #18 and #23"
            >
          </label>

          <label class="field">
            ${
              entry
                ? "Corrected cumulative GCash amount"
                : "Total NEW GCash received"
            }

            <input
              id="owner-gcash-total"
              type="number"
              min="0.01"
              step="0.01"
              inputmode="decimal"
              required
              value="${
                entry ? escapeHtml(entry.amount) : ""
              }"
            >
          </label>

          ${
            entry
              ? ""
              : `
                <label class="field">
                  Amount for main order (optional)

                  <input
                    id="owner-gcash-main-share"
                    type="number"
                    min="0"
                    step="0.01"
                    inputmode="decimal"
                    placeholder="Automatic allocation"
                  >
                </label>
              `
          }

          <p
            id="owner-gcash-preview"
            style="background:#fff2f7;padding:10px;border-radius:9px;white-space:pre-line"
          ></p>

          <p
            id="owner-gcash-error"
            class="form-error"
            role="alert"
          ></p>

          <div class="modal-actions">

            <button
              id="owner-gcash-cancel"
              class="btn btn-outline"
              type="button"
            >
              Cancel
            </button>

            <button
              id="owner-gcash-save"
              class="btn btn-primary"
              type="submit"
            >
              Save GCash Payment
            </button>

          </div>

        </form>

      </section>
    </div>
  `;

  const form = root.querySelector(
    "#owner-gcash-form"
  );

  const main = form.querySelector(
    "#owner-gcash-main"
  );

  const extra = form.querySelector(
    "#owner-gcash-extra"
  );

  const total = form.querySelector(
    "#owner-gcash-total"
  );

  const share = form.querySelector(
    "#owner-gcash-main-share"
  );

  const description = form.querySelector(
    "#owner-gcash-description"
  );

  const errorBox = form.querySelector(
    "#owner-gcash-error"
  );

  const preview = form.querySelector(
    "#owner-gcash-preview"
  );

  const save = form.querySelector(
    "#owner-gcash-save"
  );

  const findOrder = id =>
    orders.find(
      order => order.id === id
    );

  const close = () =>
    root.replaceChildren();

  form.querySelector(
    "#owner-gcash-cancel"
  ).onclick = close;

  /* PAYMENT ALLOCATION */

  function allocation() {
    const first = findOrder(
      main.value
    );

    const second = extra?.value
      ? findOrder(extra.value)
      : null;

    const entered = parseCents(
      total.value
    );

    const existing = entry
      ? 0
      : toCents(
          paymentFor(first.id)?.amount || 0
        );

    const available = Math.max(
      0,
      toCents(first.total) - existing
    );

    const firstAmount = entry
      ? entered
      : (
          share?.value.trim()
            ? parseCents(share.value)
            : Math.min(
                Number.isFinite(entered)
                  ? entered
                  : 0,
                available
              )
        );

    return {
      first,
      second,
      entered,
      firstAmount,
      secondAmount: entered - firstAmount
    };
  }

  /* PAYMENT PREVIEW */

  function refreshPreview() {
    const a = allocation();

    if (!a.first) return;

    const formatCents = value =>
      pesos(
        Number.isFinite(value)
          ? value / 100
          : 0
      );

    preview.textContent =
      `Order #${a.first.orderNumber}: ` +
      `${formatCents(a.firstAmount)}` +

      (
        a.second
          ? (
              `\nOrder #${a.second.orderNumber}: ` +
              `${formatCents(a.secondAmount)}`
            )
          : ""
      ) +

      `\nTOTAL: ${formatCents(a.entered)}` +
      `\nEach payment must fit the saved order balance.`;
  }

  for (
    const field of [
      main,
      extra,
      total,
      share
    ].filter(Boolean)
  ) {
    field.addEventListener(
      "input",
      refreshPreview
    );
  }

  refreshPreview();

  /* SAVE GCASH */

  form.onsubmit = async event => {
    event.preventDefault();

    const a = allocation();

    const details =
      description.value.trim();

    errorBox.textContent = "";

    if (
      !details ||
      !a.first ||
      !Number.isFinite(a.entered) ||
      a.entered <= 0 ||
      !Number.isFinite(a.firstAmount) ||
      a.firstAmount <= 0 ||
      (
        a.second
          ? (
              !Number.isFinite(a.secondAmount) ||
              a.secondAmount <= 0 ||
              a.first.id === a.second.id
            )
          : a.secondAmount !== 0
      )
    ) {
      errorBox.textContent =
        "Check allocations and select a different additional order when needed.";

      return;
    }

    save.disabled = true;

    const allocations = [
      {
        order: a.first,
        amountCents: a.firstAmount
      }
    ];

    if (a.second) {
      allocations.push({
        order: a.second,
        amountCents: a.secondAmount
      });
    }

    try {
      await authReady;

      const groupId =
        globalThis.crypto?.randomUUID?.() ||
        `gcash-${Date.now()}`;

      await runTransaction(
        db,
        async transaction => {
          const refs = allocations.map(
            item => ({
              order: doc(
                db,
                "orders",
                item.order.id
              ),

              payment: doc(
                db,
                "gcashPayments",
                item.order.id
              )
            })
          );

          /* ALL READS BEFORE WRITES */

          const snapshots = await Promise.all(
            refs.flatMap(item => [
              transaction.get(
                item.order
              ),

              transaction.get(
                item.payment
              )
            ])
          );

          const pending = [];

          for (
            let index = 0;
            index < allocations.length;
            index++
          ) {
            const orderSnapshot =
              snapshots[index * 2];

            const paymentSnapshot =
              snapshots[index * 2 + 1];

            if (!orderSnapshot.exists()) {
              throw Error(
                "Selected order was deleted."
              );
            }

            const order =
              orderSnapshot.data();

            const orderId =
              allocations[index].order.id;

            const previous =
              paymentSnapshot.exists()
                ? toCents(
                    paymentSnapshot.data().amount || 0
                  )
                : 0;

            const next = entry
              ? allocations[index].amountCents
              : previous +
                allocations[index].amountCents;

            if (
              next <= 0 ||
              next > toCents(order.total)
            ) {
              throw Error(
                `Order #${order.orderNumber}: ` +
                `GCash exceeds saved order total ` +
                `${pesos(order.total)}.`
              );
            }

            const history =
              paymentSnapshot.exists() &&
              Array.isArray(
                paymentSnapshot.data().paymentHistory
              )
                ? paymentSnapshot.data().paymentHistory
                : [];

            pending.push({
              refs: refs[index],

              payment: {
                orderId,

                orderNumber: Number(
                  order.orderNumber
                ),

                customerName:
                  order.customerName || "",

                dayKey: orderDate(order),

                amount: rounded(
                  next / 100
                ),

                description: details,

                paymentHistory: [
                  ...history,
                  {
                    action: entry
                      ? "edit-total"
                      : "add",

                    amount:
                      allocations[index].amountCents / 100,

                    previousAmount:
                      previous / 100,

                    newAmount:
                      next / 100,

                    combinedTransfer:
                      a.entered / 100,

                    groupId,
                    description: details,

                    at:
                      new Date().toISOString()
                  }
                ].slice(-60),

                createdAt:
                  paymentSnapshot.exists()
                    ? (
                        paymentSnapshot.data().createdAt ||
                        serverTimestamp()
                      )
                    : serverTimestamp(),

                updatedAt:
                  serverTimestamp()
              },

              amount: next / 100
            });
          }

          /* APPLY TRANSACTION */

          for (const item of pending) {
            transaction.set(
              item.refs.payment,
              item.payment
            );

            transaction.update(
              item.refs.order,
              {
                paymentMethod: "GCash",
                gcashAmount: item.amount
              }
            );
          }
        }
      );

      close();

      showStatus(
        "GCash saved. Finance totals will refresh without adding to Sales twice."
      );

    } catch (error) {
      errorBox.textContent =
        `Save failed: ${error.message}`;

      save.disabled = false;
    }
  };
}

/* INTERCEPT EXISTING GCASH BUTTONS */

document.addEventListener(
  "click",
  event => {
    if (
      event.target.closest(
        "#add-gcash-payment"
      )
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();

      openGcashModal();
      return;
    }

    const button = event.target.closest(
      ".finance-separated-section button"
    );

    if (
      !button ||
      button.textContent.trim() !== "Edit"
    ) {
      return;
    }

    const section = button.closest(
      ".finance-separated-section"
    );

    if (
      !section?.querySelector("h3")
        ?.textContent.startsWith(
          "GCash Payments"
        )
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const row = button.closest("tr");

    const rowIndex = [
      ...section.querySelectorAll(
        "tbody tr"
      )
    ].indexOf(row);

    const page = Number(
      /Page\s+(\d+)/.exec(
        section.querySelector(
          ".table-pagination span"
        )?.textContent || ""
      )?.[1] || 1
    );

    const day =
      $("finance-date")?.value ||
      dayKey();

    const records = state.payments
      .filter(
        payment =>
          paymentDate(payment) === day
      )
      .sort(
        (a, b) =>
          num(b.createdAt?.seconds) -
          num(a.createdAt?.seconds)
      );

    const entry = records[
      (page - 1) * 5 +
      rowIndex
    ];

    if (entry) {
      openGcashModal(entry);
    } else {
      showStatus(
        "GCash entry changed. Refresh and try Edit again.",
        true
      );
    }
  },
  true
);

/* ======================================
   INITIALIZE
====================================== */

setupNavigation();
renderAll();

/* FIRESTORE LIVE LISTENERS */

authReady.then(() => {
  /* SAVED ORDERS */

  onSnapshot(
    collection(
      db,
      "orders"
    ),

    snapshot => {
      state.orders = snapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );

      renderAll();
    },

    error => showStatus(
      `Orders: ${error.message}`,
      true
    )
  );

  /* MENU PRODUCTS */

  onSnapshot(
    collection(
      db,
      "menu"
    ),

    snapshot => {
      state.menu = snapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );

      renderAll();
    },

    error => showStatus(
      `Menu: ${error.message}`,
      true
    )
  );

  /* CATEGORIES */

  onSnapshot(
    collection(
      db,
      "categories"
    ),

    snapshot => {
      state.categories = snapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );

      renderAll();
    },

    error => showStatus(
      `Categories: ${error.message}`,
      true
    )
  );

  /* GCASH PAYMENTS */

  onSnapshot(
    collection(
      db,
      "gcashPayments"
    ),

    snapshot => {
      state.payments = snapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );
    },

    error => showStatus(
      `GCash: ${error.message}`,
      true
    )
  );

  /* OWNER ASSIGNMENTS */

  onSnapshot(
    settingsRef,

    snapshot => {
      state.rules = cleanRules(
        snapshot.exists()
          ? snapshot.data().owners
          : DEFAULTS
      );

      renderAll();
    },

    error => showStatus(
      `Owner settings: ${error.message}`,
      true
    )
  );

}).catch(error => {
  showStatus(
    `Sign-in: ${error.message}`,
    true
  );
});

/* PHILIPPINE MIDNIGHT REFRESH */

let previousDay = dayKey();

setInterval(() => {
  const next = dayKey();

  if (next === previousDay) {
    return;
  }

  for (const owner of OWNERS) {
    for (const field of ["from", "to"]) {
      if (
        state.dates[owner][field] ===
        previousDay
      ) {
        state.dates[owner][field] = next;

        const input = $(
          `owner-${owner}-${field}`
        );

        if (input) {
          input.value = next;
        }
      }
    }
  }

  previousDay = next;

  renderAll();
}, 60000);
