
/**
 * CHILLAX CAFE POS — OWNER SALES
 *
 * Kuya Gaa:
 * - Iced Coffee
 * - Hot Coffee
 * - Frappe
 * - Lumpia Shanghai (Alacarte)
 * - Shanghai Silog: P30 per serving
 *
 * Kuya Boss:
 * - Samyang & Ramen
 * - Samyang & Ramen Add Ons
 * - Assigned takeout-box charges
 *
 * Includes:
 * - From / To date
 * - 58mm printing
 * - Live Firebase sales
 * - Custom category and item assignments
 * - Delete saved orders
 */

import {
  db,
  authReady
} from "./firebase-config.js";

import { requireRole } from "./auth.js";

import {
  dayKey,
  timestampDate,
  pesos,
  rounded,
  lineBoxPrice
} from "./business.js";

import {
  printOwnerReport
} from "./receipt.js";

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const user = requireRole(["admin"]);

if (!user || user.role !== "admin") {
  throw Error("Admin login required.");
}

const $ = id => document.getElementById(id);

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

const round = rounded;

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

const owners = ["gaa", "boss"];

const state = {
  orders: [],
  menu: [],
  categories: [],

  assignment: structuredClone(defaults),

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

const configRef = doc(
  db,
  "settings",
  "salesOwners"
);

function feedback(message, fail = false) {
  const box = $("owner-status");

  if (!box) return;

  box.textContent = message;
  box.style.color = fail
    ? "#a32424"
    : "#315e38";
}

const unique = values => [
  ...new Set(
    values.filter(
      value =>
        typeof value === "string" &&
        value.trim()
    )
  )
];

/* LOAD EXISTING ASSIGNMENTS */
function clean(data) {
  const result = {};

  for (const owner of owners) {
    const input = data?.[owner] || defaults[owner];

    result[owner] = {
      categories: unique(input.categories || []),
      items: unique(input.items || [])
    };

    // Always include Shanghai Silog for Kuya Gaa.
    if (owner === "gaa") {
      result.gaa.items = unique([
        ...result.gaa.items,
        keyOf("All Day Breakfast", "Shanghai Silog")
      ]);
    }
  }

  return result;
}

/* ORDER DATE */
function dateOf(order) {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(order.dayKey || "")
  ) {
    return order.dayKey;
  }

  const date = timestampDate(order.createdAt);

  return date && Number.isFinite(date.getTime())
    ? dayKey(date)
    : "";
}

/* RESOLVE CATEGORY */
function groupOf(item) {
  if (item.category) {
    return item.category;
  }

  if (item.menuId) {
    return state.menu.find(
      product => product.id === item.menuId
    )?.category || "";
  }

  const found = state.menu.filter(
    product =>
      norm(product.name) === norm(item.name)
  );

  return found.length === 1
    ? found[0].category
    : "";
}

/* DETERMINE OWNER OF A PRODUCT */
function owns(owner, item) {
  const category = groupOf(item);
  const itemKey = keyOf(category, item.name);

  const assignments = state.assignment;

  const gaaItem =
    assignments.gaa.items.includes(itemKey) ||
    itemKey === keyOf(
      "All Day Breakfast",
      "Shanghai Silog"
    );

  const bossItem =
    assignments.boss.items.includes(itemKey);

  if (gaaItem !== bossItem) {
    return owner === (
      gaaItem ? "gaa" : "boss"
    );
  }

  if (gaaItem && bossItem) {
    return owner === "gaa";
  }

  // Any Samyang or Buldak product belongs to Boss.
  if (
    /\b(samyang|buldak)\b/.test(norm(item.name))
  ) {
    return owner === "boss";
  }

  const gaaCategory = assignments.gaa.categories.some(
    value => norm(value) === norm(category)
  );

  const bossCategory = assignments.boss.categories.some(
    value => norm(value) === norm(category)
  );

  if (owner === "gaa") {
    return gaaCategory;
  }

  return bossCategory && !gaaCategory;
}

/* FROM / TO FILTER */
function inRange(order, owner) {
  const date = dateOf(order);

  const {
    from,
    to
  } = state.dates[owner];

  return Boolean(date) &&
    (!from || date >= from) &&
    (!to || date <= to);
}

/* LIVE SALES CALCULATIONS */
function calculations(owner) {
  const groups = new Map();

  let matchedOrders = 0;
  let boxRevenue = 0;

  for (const order of state.orders) {
    if (!inRange(order, owner)) {
      continue;
    }

    const products = Array.isArray(order.items)
      ? order.items
      : [];

    const extras = Array.isArray(order.addons)
      ? order.addons
      : [];

    const all = [
      ...products,
      ...extras
    ];

    const grossAll = all.reduce(
      (sum, item) =>
        sum +
        Number(item.qty || 0) *
        Number(item.unitPrice || 0),
      0
    );

    const legacyDiscount = Number(
      order.discountMode === "perItem"
        ? order.legacyDiscountAmount || 0
        : order.discountAmount || 0
    );

    let matched = false;
    let assignedBoxValue = 0;
    let totalItemBoxes = 0;

    for (const line of all) {
      const qty = Number(line.qty || 0);
      const price = Number(line.unitPrice || 0);

      if (
        !line.name ||
        !Number.isFinite(qty) ||
        qty <= 0 ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        continue;
      }

      const category = groupOf(line);
      const gross = qty * price;

      // Identify the box charged to this particular item.
      let itemBox = 0;

      if (line.serveType === "Take Out") {
        const rate = Number(
          line.boxUnitPrice ??
          lineBoxPrice(line)
        );

        if ([15, 25].includes(rate)) {
          itemBox = qty * rate;
        }
      }

      totalItemBoxes += itemBox;

      if (!owns(owner, line)) {
        continue;
      }

      matched = true;

      let net = gross;

      /*
       * SHANGHAI SILOG
       * Fixed P30 per serving for Kuya Gaa.
       */
      if (
        owner === "gaa" &&
        norm(line.name) === "shanghai silog" &&
        norm(category) === "all day breakfast"
      ) {
        net = 30 * qty;
      } else {
        const itemDiscount =
          order.discountMode === "perItem"
            ? gross *
              Number(line.discountRate || 0) / 100
            : 0;

        const allocatedLegacy =
          grossAll > 0
            ? legacyDiscount * gross / grossAll
            : 0;

        net = Math.max(
          0,
          round(
            gross -
            itemDiscount -
            allocatedLegacy
          )
        );
      }

      const name =
        `${line.name}${
          line.size ? ` (${line.size})` : ""
        }`;

      const groupKey = keyOf(category, name);

      const entry = groups.get(groupKey) || {
        category: category || "Uncategorized",
        name,
        qty: 0,
        sales: 0,
        boxes: 0
      };

      entry.qty += qty;

      entry.sales = round(
        entry.sales + net
      );

      if (owner === "boss") {
        entry.boxes = round(
          entry.boxes + itemBox
        );

        assignedBoxValue += itemBox;
      }

      groups.set(groupKey, entry);
    }

    if (matched) {
      matchedOrders++;
    }

    /* KUYA BOSS TAKEOUT BOX SALES */
    if (owner === "boss" && matched) {
      const main = products.filter(
        item => !item.isAddon
      );

      const soleOwner =
        main.length > 0 &&
        main.every(item =>
          owns("boss", item)
        );

      const hasTakeout = main.some(
        item => item.serveType === "Take Out"
      );

      const savedBoxTotal =
        Number(order.boxes?.["15"] || 0) * 15 +
        Number(order.boxes?.["25"] || 0) * 25;

      const extra = Math.max(
        0,
        savedBoxTotal - totalItemBoxes
      );

      boxRevenue += assignedBoxValue;

      /*
       * Unassigned manual boxes are counted
       * only if every main item belongs to Boss
       * and at least one is Take Out.
       */
      if (soleOwner && hasTakeout) {
        boxRevenue += extra;
      }
    }
  }

  const rows = [...groups.values()].sort(
    (a, b) =>
      b.sales - a.sales ||
      a.name.localeCompare(b.name)
  );

  return {
    rows,

    quantity: rows.reduce(
      (sum, row) => sum + row.qty,
      0
    ),

    sales: round(
      rows.reduce(
        (sum, row) => sum + row.sales,
        0
      )
    ),

    boxes: round(boxRevenue),

    orders: matchedOrders
  };
}

/* DISPLAY SALES REPORT */
function renderOwner(owner) {
  const report = calculations(owner);

  const total =
    report.sales +
    (owner === "boss" ? report.boxes : 0);

  $(`owner-${owner}-sales`).textContent =
    pesos(total);

  $(`owner-${owner}-qty`).textContent =
    String(report.quantity);

  $(`owner-${owner}-orders`).textContent =
    String(report.orders);

  const title = $(`owner-${owner}-sales`)
    .closest(".stat-card")
    ?.querySelector(".label");

  if (title) {
    title.textContent = owner === "boss"
      ? "Products + Takeout Boxes"
      : "Assigned sales";
  }

  const body = $(`owner-${owner}-body`);

  body.replaceChildren();

  const maxPage = Math.max(
    1,
    Math.ceil(report.rows.length / 5)
  );

  state.page[owner] = Math.min(
    maxPage,
    Math.max(1, state.page[owner])
  );

  const page = state.page[owner];

  for (
    const item of report.rows.slice(
      (page - 1) * 5,
      page * 5
    )
  ) {
    const row = document.createElement("tr");

    for (
      const value of [
        item.category,
        item.name,
        String(item.qty),
        pesos(item.sales)
      ]
    ) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }

    body.append(row);
  }

  if (!body.children.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 4;
    cell.textContent =
      "No matching sales for selected dates.";

    row.append(cell);
    body.append(row);
  }

  $(`owner-${owner}-page`).textContent =
    `Page ${page} of ${maxPage} ` +
    `(${report.rows.length} items)`;

  $(`owner-${owner}-prev`).disabled =
    page === 1;

  $(`owner-${owner}-next`).disabled =
    page === maxPage;

  const boxId = `owner-${owner}-extra-summary`;

  let box = $(boxId);

  if (!box) {
    box = document.createElement("p");
    box.id = boxId;
    box.className = "owner-note";

    $(`owner-${owner}-body`)
      .closest(".owner-card")
      .querySelector(".owner-stats")
      ?.insertAdjacentElement("afterend", box);
  }

  if (box) {
    box.textContent = owner === "boss"
      ? (
          `Products: ${pesos(report.sales)} · ` +
          `Boss Takeout Boxes: ${pesos(report.boxes)} · ` +
          `Combined: ${pesos(total)}`
        )
      : (
          "Shanghai Silog counts ₱30 per serving " +
          "for Kuya Gaa, not its full selling price."
        );
  }
}

/* SHOW ASSIGNED CATEGORIES AND ITEMS */
function renderRules(owner) {
  const box = $(`owner-${owner}-rules`);

  box.replaceChildren();

  for (const type of ["categories", "items"]) {
    for (
      const rule of state.assignment[owner][type]
    ) {
      const chip = document.createElement("span");
      chip.className = "owner-rule";

      const label = type === "categories"
        ? `Category: ${rule}`
        : `Item: ${rule.replace("|", " · ")}`;

      chip.append(
        document.createTextNode(label + " ")
      );

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";

      remove.setAttribute(
        "aria-label",
        `Remove ${label}`
      );

      remove.addEventListener(
        "click",
        () => changeRule(owner, type, rule, false)
      );

      chip.append(remove);
      box.append(chip);
    }
  }
}

/* DROPDOWN HELPER */
function fillSelect(id, choices, placeholder) {
  const select = $(id);
  const oldValue = select.value;

  select.replaceChildren(
    new Option(placeholder, "")
  );

  choices.forEach(choice => {
    select.add(
      new Option(choice.text, choice.value)
    );
  });

  if (
    [...select.options].some(
      option => option.value === oldValue
    )
  ) {
    select.value = oldValue;
  }
}

function renderChoices(owner) {
  const names = [
    ...new Set([
      ...state.categories.map(
        category => category.name
      ),
      ...state.menu.map(
        product => product.category
      )
    ].filter(Boolean))
  ].sort();

  fillSelect(
    `owner-${owner}-category`,
    names.map(name => ({
      text: name,
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
          `${a.category} ${a.name}`.localeCompare(
            `${b.category} ${b.name}`
          )
      )
      .map(product => ({
        text:
          `${product.category} · ${product.name}`,

        value: keyOf(
          product.category,
          product.name
        )
      })),

    "Choose item"
  );

  renderRules(owner);
}

function renderAll() {
  for (const owner of owners) {
    renderOwner(owner);
    renderChoices(owner);
  }
}

/* SAVE CUSTOM ASSIGNMENTS */
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
        const snapshot = await transaction.get(
          configRef
        );

        const next = clean(
          snapshot.exists()
            ? snapshot.data().owners
            : defaults
        );

        next[owner][type] = add
          ? [
              ...new Set([
                ...next[owner][type],
                value
              ])
            ]
          : next[owner][type].filter(
              item => item !== value
            );

        transaction.set(configRef, {
          owners: next,
          updatedAt: serverTimestamp()
        });
      }
    );

    feedback(
      "Assignments saved. Reports update automatically."
    );

  } catch (error) {
    feedback(
      `Could not save assignment: ${error.message}`,
      true
    );
  }
}

/* SIDEBAR + FROM/TO + PRINTING */
function installUI() {
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

  // Move owner tabs below Expenses & Cash.
  if (finance && gaa && boss) {
    finance.after(gaa);
    gaa.after(boss);
  }

  for (const owner of owners) {
    const section = $(`section-owner-${owner}`);

    const custom = $(`owner-${owner}-custom`);
    const range = $(`owner-${owner}-range`);

    // Remove the old range dropdown.
    // Show FROM and TO directly.
    if (range) {
      range.closest("label")?.remove();
    }

    if (custom) {
      custom.hidden = false;
      custom.style.display = "flex";
      custom.style.flexWrap = "wrap";
      custom.style.gap = "10px";
    }

    for (const part of ["from", "to"]) {
      const input = $(`owner-${owner}-${part}`);

      input.value = state.dates[owner][part];

      input.addEventListener(
        "change",
        () => {
          state.dates[owner][part] = input.value;
          state.page[owner] = 1;
          renderOwner(owner);
        }
      );
    }

    // 58MM OWNER REPORT PRINT BUTTON
    const filter = section.querySelector(
      ".owner-filters"
    );

    const print = document.createElement("button");

    print.type = "button";
    print.className = "btn btn-primary";
    print.textContent = "Print 58mm Sales Report";

    print.onclick = () => printReport(owner);

    filter?.append(print);

    $(`owner-${owner}-prev`).onclick = () => {
      state.page[owner]--;
      renderOwner(owner);
    };

    $(`owner-${owner}-next`).onclick = () => {
      state.page[owner]++;
      renderOwner(owner);
    };

    $(`owner-${owner}-add-category`).onclick = () =>
      changeRule(
        owner,
        "categories",
        $(`owner-${owner}-category`).value,
        true
      );

    $(`owner-${owner}-add-product`).onclick = () =>
      changeRule(
        owner,
        "items",
        $(`owner-${owner}-product`).value,
        true
      );

    const tab = nav?.querySelector(
      `[data-tab="owner-${owner}"]`
    );

    tab?.addEventListener(
      "click",
      () => {
        document.querySelectorAll(
          '[id^="section-owner-"]'
        ).forEach(element =>
          element.classList.add("hidden")
        );

        for (
          const id of [
            "dashboard",
            "menu",
            "finances",
            "settings"
          ]
        ) {
          $(`section-${id}`)?.classList.add("hidden");
        }

        section.classList.remove("hidden");

        document.querySelector(
          ".admin-main"
        )?.scrollTo(0, 0);
      }
    );
  }

  // Hide owner sections on regular Admin tabs.
  for (
    const button of
    nav?.querySelectorAll("button[data-tab]") || []
  ) {
    if (
      button.dataset.tab.startsWith("owner-")
    ) {
      continue;
    }

    button.addEventListener(
      "click",
      () => {
        owners.forEach(owner => {
          $(`section-owner-${owner}`)
            ?.classList.add("hidden");
        });
      }
    );
  }
}

/* PRINT OWNER SALES USING 58MM RECEIPT */
function printReport(owner) {
  const report = calculations(owner);

  const {
    from,
    to
  } = state.dates[owner];

  if (from && to && from > to) {
    feedback(
      "From date cannot be after To date.",
      true
    );
    return;
  }

  try {
    printOwnerReport({
      ownerName:
        owner === "gaa"
          ? "KUYA GAA"
          : "KUYA BOSS",

      from: from || "All",
      to: to || "All",

      rows: report.rows,

      itemsSold: report.quantity,
      orders: report.orders,

      productSales: report.sales,

      boxSales:
        owner === "boss"
          ? report.boxes
          : 0,

      note:
        owner === "gaa"
          ? "Shanghai Silog = P30 per serving"
          : "Boxes from assigned Take Out items"
    });
  } catch (error) {
    feedback(
      `Print failed: ${error.message}`,
      true
    );
  }
}

/* DELETE ORDER FROM RECENT ORDERS */
const recent = $("recent-orders-body");

function installDeleteButtons() {
  for (
    const edit of recent.querySelectorAll(
      "[data-edit-order]"
    )
  ) {
    const parent = edit.parentElement;

    if (
      !parent ||
      parent.querySelector(
        "[data-owner-delete]"
      )
    ) {
      continue;
    }

    const button = document.createElement("button");

    button.type = "button";

    button.className =
      "btn btn-sm btn-outline order-delete-btn";

    button.textContent = "Delete";

    button.dataset.ownerDelete =
      edit.dataset.editOrder;

    parent.append(button);
  }
}

new MutationObserver(
  installDeleteButtons
).observe(recent, {
  subtree: true,
  childList: true
});

recent.addEventListener(
  "click",
  async event => {
    const button = event.target.closest(
      "[data-owner-delete]"
    );

    if (!button) return;

    const id = button.dataset.ownerDelete;

    const order = state.orders.find(
      item => item.id === id
    );

    const label = order?.orderNumber ?? id;

    if (
      prompt(
        `Delete Order #${label} permanently? ` +
        "Type DELETE to confirm."
      ) !== "DELETE"
    ) {
      return;
    }

    button.disabled = true;

    try {
      await authReady;

      const payments = await getDocs(
        query(
          collection(db, "gcashPayments"),
          where("orderId", "==", id)
        )
      );

      const linked = new Map(
        payments.docs.map(item => [
          item.id,
          item.ref
        ])
      );

      linked.set(
        id,
        doc(db, "gcashPayments", id)
      );

      await runTransaction(
        db,
        async transaction => {
          const orderRef = doc(
            db,
            "orders",
            id
          );

          const documents = await Promise.all([
            transaction.get(orderRef),

            ...[...linked.values()].map(
              reference => transaction.get(reference)
            )
          ]);

          if (!documents[0].exists()) {
            throw Error("Order no longer exists.");
          }

          for (
            let index = 1;
            index < documents.length;
            index++
          ) {
            if (!documents[index].exists()) {
              continue;
            }

            const payment = documents[index].data();

            if (
              payment.orderId &&
              payment.orderId !== id
            ) {
              throw Error(
                "Mismatched GCash payment."
              );
            }

            transaction.delete(
              linked.get(documents[index].id)
            );
          }

          transaction.delete(orderRef);
        }
      );

      feedback(
        `Deleted Order #${label}. Sales will update automatically.`
      );

    } catch (error) {
      button.disabled = false;

      feedback(
        `Delete failed: ${error.message}`,
        true
      );
    }
  }
);

/* START */
installUI();
installDeleteButtons();
renderAll();

authReady.then(() => {
  onSnapshot(
    query(collection(db, "orders")),
    snapshot => {
      state.orders = snapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );

      renderAll();
    },

    error => feedback(
      `Orders: ${error.message}`,
      true
    )
  );

  onSnapshot(
    collection(db, "menu"),
    snapshot => {
      state.menu = snapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );

      renderAll();
    }
  );

  onSnapshot(
    collection(db, "categories"),
    snapshot => {
      state.categories = snapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );

      renderAll();
    }
  );

  onSnapshot(
    configRef,
    snapshot => {
      state.assignment = clean(
        snapshot.exists()
          ? snapshot.data().owners
          : defaults
      );

      renderAll();
    },

    error => feedback(
      `Assignments: ${error.message}`,
      true
    )
  );

}).catch(error => {
  feedback(error.message, true);
});
