
/**
 * CHILLAX CAFE POS
 * COMPLETE CASH COMPUTATION
 * AND ADMIN SIDEBAR HIGHLIGHT FIX
 *
 * File: js/cash-computation.js
 *
 * FEATURES:
 *
 * 1. Only ONE sidebar button is active.
 * 2. Old highlight is removed on every click.
 * 3. Removes lingering mouse focus outline.
 * 4. Supports dynamically added sidebar buttons.
 * 5. Keeps all existing Admin sections working.
 * 6. Live Firestore cash computation.
 * 7. From / To date filters.
 *
 * FORMULA:
 *
 * Total Sales
 * + Cash on Hand
 * - Expenses
 * - GCash Payments
 * = Expected Cash
 */

import {
  db,
  authReady
} from "./firebase-config.js";

import {
  dayKey,
  timestampDate
} from "./business.js";

import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* =====================================
   HELPERS
===================================== */

const $ = id =>
  document.getElementById(id);

const toCents = value =>
  Math.round(
    (Number(value) || 0) * 100
  );

const money = cents => {
  const formatted = (
    Math.abs(cents) / 100
  ).toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

  return (
    (cents < 0 ? "−₱" : "₱") +
    formatted
  );
};

/* =====================================
   FIRESTORE STATE
===================================== */

const state = {
  orders: [],
  cashEntries: [],
  expenses: [],
  gcashPayments: [],

  ready: new Set(),

  errors: {}
};

const collections = [
  "orders",
  "cashEntries",
  "expenses",
  "gcashPayments"
];

/* =====================================
   PHILIPPINE DATE
===================================== */

function recordDay(record) {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      record.dayKey || ""
    )
  ) {
    return record.dayKey;
  }

  const date = timestampDate(
    record.createdAt
  );

  return (
    date &&
    Number.isFinite(date.getTime())
  )
    ? dayKey(date)
    : "";
}

/* =====================================
   DATE FILTER
===================================== */

function relevant(record) {
  const date = recordDay(record);

  const from =
    $("cashcalc-from")?.value || "";

  const to =
    $("cashcalc-to")?.value || "";

  return Boolean(date) &&
    (!from || date >= from) &&
    (!to || date <= to);
}

/* =====================================
   SUM COLLECTION
===================================== */

function collectionTotal(
  collectionName,
  field
) {
  return state[collectionName]
    .filter(relevant)
    .reduce(
      (sum, record) =>
        sum + toCents(record[field]),
      0
    );
}

/* =====================================
   CASH COMPUTATION
===================================== */

function compute() {
  const sales = collectionTotal(
    "orders",
    "total"
  );

  const cash = collectionTotal(
    "cashEntries",
    "amount"
  );

  const expenses = collectionTotal(
    "expenses",
    "amount"
  );

  const gcash = collectionTotal(
    "gcashPayments",
    "amount"
  );

  return {
    sales,
    cash,
    expenses,
    gcash,

    expected:
      sales +
      cash -
      expenses -
      gcash
  };
}

/* =====================================
   COMPLETE SIDEBAR AND PAGE DESIGN
===================================== */

function installStyles() {
  if (
    $("cash-computation-styles")
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "cash-computation-styles";

  style.textContent = `
    @media screen {

      /* ==================================
         SIDEBAR ACTIVE STATE FIX
      ================================== */

      body.admin-page
      .admin-nav > button[data-tab]:not(.active) {
        background: transparent !important;
        color: #383532 !important;
        font-weight: 550 !important;
      }

      body.admin-page
      .admin-nav > button[data-tab].active {
        background: #f5edf1 !important;
        color: #703b50 !important;
        font-weight: 750 !important;

        box-shadow: none !important;
      }

      /* REMOVE OLD MOUSE CLICK OUTLINE */

      body.admin-page
      .admin-nav > button[data-tab]:focus:not(:focus-visible) {
        outline: none !important;
        box-shadow: none !important;
        border-color: transparent !important;
      }

      /* KEEP KEYBOARD FOCUS ACCESSIBLE */

      body.admin-page
      .admin-nav > button[data-tab]:focus-visible {
        outline: 2px solid #c04a7d;
        outline-offset: 2px;
      }

      /* CASH COMPUTATION ICON */

      .admin-nav .cashcalc-icon {
        width: 19px;
        height: 19px;

        flex: 0 0 19px;

        color: #686868;
      }

      /* CASH COMPUTATION CONTENT */

      #section-cash-computation
      .cashcalc-wrap {
        max-width: 900px;
      }

      #section-cash-computation
      .cashcalc-filter {
        display: flex;
        flex-wrap: wrap;

        align-items: end;

        gap: 12px;
        margin-bottom: 16px;
      }

      #section-cash-computation
      .cashcalc-filter label {
        display: grid;

        gap: 5px;

        color: #675147;

        font-weight: 700;
        font-size: .83rem;
      }

      #section-cash-computation
      .cashcalc-filter input {
        min-height: 39px;

        padding: 8px 10px;

        border: 1px solid #ddcbc1;
        border-radius: 9px;

        background: white;
        color: #3d302a;
      }

      #section-cash-computation
      .cashcalc-filter button {
        min-height: 39px;
      }

      /* CARD */

      #section-cash-computation
      .cashcalc-card {
        padding: 16px;

        background: white;

        border: 1px solid #eaded6;
        border-radius: 14px;
      }

      /* COMPUTATION ROWS */

      #section-cash-computation
      .cashcalc-row {
        display: flex;

        align-items: center;
        justify-content: space-between;

        gap: 12px;

        padding: 13px 0;

        border-bottom:
          1px solid #f0e9e4;
      }

      #section-cash-computation
      .cashcalc-row .description {
        display: flex;
        align-items: center;

        gap: 9px;

        color: #624e43;
      }

      #section-cash-computation
      .cashcalc-sign {
        display: grid;
        place-items: center;

        width: 24px;
        height: 24px;

        border-radius: 7px;

        background: #f7f0ec;

        font-weight: 800;
      }

      #section-cash-computation
      .cashcalc-row strong {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      /* FINAL AMOUNT */

      #section-cash-computation
      .cashcalc-final {
        display: flex;

        align-items: center;
        justify-content: space-between;

        flex-wrap: wrap;

        gap: 10px;

        margin-top: 15px;
        padding: 16px;

        border-radius: 12px;

        background: #f8eff3;
        color: #653449;
      }

      #section-cash-computation
      .cashcalc-final strong {
        font-size:
          clamp(1.3rem, 2vw, 1.9rem);

        font-variant-numeric: tabular-nums;

        overflow-wrap: anywhere;
      }

      /* DESCRIPTION */

      #section-cash-computation
      .cashcalc-note {
        margin-top: 12px;

        font-size: .82rem;
        line-height: 1.5;

        color: #7b6b62;
      }

      #section-cash-computation
      .cashcalc-state {
        min-height: 20px;
        margin-top: 10px;

        font-size: .81rem;
      }

    }

    @media print {

      #section-cash-computation {
        display: none !important;
      }

    }
  `;

  document.head.append(style);
}

/* =====================================
   FIX SIDEBAR HIGHLIGHT
===================================== */

/**
 * IMPORTANT FIX
 *
 * admin.js captures sidebar buttons
 * when the script initially loads.
 *
 * Cash Computation and Not Available
 * Today are added later by JS.
 *
 * Those buttons are missing from the
 * original static button list.
 *
 * This listener checks ALL buttons
 * whenever any sidebar tab is clicked.
 */

function installSidebarHighlightFix(nav) {
  window.addEventListener(
    "click",
    event => {
      if (
        !(event.target instanceof Element)
      ) {
        return;
      }

      const clicked =
        event.target.closest(
          ".admin-nav button[data-tab]"
        );

      if (
        !clicked ||
        !nav.contains(clicked)
      ) {
        return;
      }

      /*
       * Run after existing Admin and
       * owner navigation handlers.
       *
       * This avoids changing their
       * original section logic.
       */

      queueMicrotask(() => {
        if (!clicked.isConnected) {
          return;
        }

        const buttons =
          nav.querySelectorAll(
            "button[data-tab]"
          );

        /*
         * Remove highlight from
         * EVERY other sidebar button.
         */

        buttons.forEach(button => {
          const isActive =
            button === clicked;

          button.classList.toggle(
            "active",
            isActive
          );

          if (isActive) {
            button.setAttribute(
              "aria-current",
              "page"
            );

          } else {
            button.removeAttribute(
              "aria-current"
            );
          }
        });

        /*
         * Remove lingering focus after
         * mouse/touch selection.
         *
         * Keyboard focus remains visible.
         */

        if (event.detail > 0) {
          clicked.blur();
        }
      });
    }
  );
}

/* =====================================
   CASH COMPUTATION SIDEBAR
===================================== */

function setup() {
  const nav =
    document.querySelector(
      ".admin-nav"
    );

  const content =
    document.querySelector(
      ".admin-main"
    );

  if (
    !nav ||
    !content
  ) {
    return false;
  }

  if (
    nav.querySelector(
      '[data-tab="cash-computation"]'
    )
  ) {
    return false;
  }

  /* CREATE SIDEBAR BUTTON */

  const button =
    document.createElement("button");

  button.type = "button";

  button.dataset.tab =
    "cash-computation";

  button.innerHTML = `
    <svg
      class="sidebar-icon cashcalc-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect
        x="4"
        y="2"
        width="16"
        height="20"
        rx="2"
      />

      <path
        d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2"
      />
    </svg>

    <span>Cash Computation</span>
  `;

  /* PLACE BELOW EXPENSES & CASH */

  const financeTab =
    nav.querySelector(
      '[data-tab="finances"]'
    );

  if (financeTab) {
    financeTab.after(button);

  } else {
    nav.append(button);
  }

  /* =====================================
     CASH COMPUTATION CONTENT
  ===================================== */

  const panel =
    document.createElement("section");

  panel.id =
    "section-cash-computation";

  panel.className =
    "hidden";

  panel.innerHTML = `
    <div class="section-head">
      <div>
        <p class="eyebrow">
          ADMIN · CASH RECONCILIATION
        </p>

        <h2>Cash Computation</h2>

        <p class="section-description">
          Live totals from saved Firestore
          orders and finance records.
        </p>
      </div>
    </div>

    <div class="cashcalc-wrap">

      <div class="cashcalc-filter">

        <label>
          From

          <input
            id="cashcalc-from"
            type="date"
          >
        </label>

        <label>
          To

          <input
            id="cashcalc-to"
            type="date"
          >
        </label>

        <button
          id="cashcalc-today"
          class="btn btn-outline"
          type="button"
        >
          Today
        </button>

        <button
          id="cashcalc-all"
          class="btn btn-outline"
          type="button"
        >
          All Time
        </button>

      </div>

      <div class="cashcalc-card">

        <div class="cashcalc-row">

          <span class="description">
            <span class="cashcalc-sign">+</span>
            Total Sales
          </span>

          <strong id="cashcalc-sales">
            ₱0.00
          </strong>

        </div>

        <div class="cashcalc-row">

          <span class="description">
            <span class="cashcalc-sign">+</span>
            Cash on Hand
          </span>

          <strong id="cashcalc-cash">
            ₱0.00
          </strong>

        </div>

        <div class="cashcalc-row">

          <span class="description">
            <span class="cashcalc-sign">−</span>
            Expenses
          </span>

          <strong id="cashcalc-expenses">
            ₱0.00
          </strong>

        </div>

        <div class="cashcalc-row">

          <span class="description">
            <span class="cashcalc-sign">−</span>
            GCash Payments
          </span>

          <strong id="cashcalc-gcash">
            ₱0.00
          </strong>

        </div>

        <div class="cashcalc-final">

          <span>
            <strong>EXPECTED CASH</strong>

            <div style="font-size:.76rem">
              Sales + Cash − Expenses − GCash
            </div>
          </span>

          <strong id="cashcalc-result">
            ₱0.00
          </strong>

        </div>

        <div
          id="cashcalc-status"
          class="cashcalc-state"
          role="status"
          aria-live="polite"
        >
          Loading data…
        </div>

      </div>

      <p class="cashcalc-note">
        This is the requested computation,
        not an independently verified cash count.

        If Cash on Hand already includes
        sales receipts, adding Total Sales
        again can double-count money.
      </p>

    </div>
  `;

  content.append(panel);

  /* =====================================
     DATE FILTERS
  ===================================== */

  const from =
    $("cashcalc-from");

  const to =
    $("cashcalc-to");

  from.value = dayKey();
  to.value = dayKey();

  from.addEventListener(
    "change",
    render
  );

  to.addEventListener(
    "change",
    render
  );

  /* TODAY BUTTON */

  $("cashcalc-today").onclick = () => {
    from.value = dayKey();
    to.value = dayKey();

    render();
  };

  /* ALL TIME BUTTON */

  $("cashcalc-all").onclick = () => {
    from.value = "";
    to.value = "";

    render();
  };

  /* =====================================
     CASH COMPUTATION NAVIGATION
  ===================================== */

  nav.addEventListener(
    "click",
    event => {
      const clicked =
        event.target.closest(
          "button[data-tab]"
        );

      if (
        !clicked ||
        !nav.contains(clicked)
      ) {
        return;
      }

      /*
       * Clicking another section
       * hides Cash Computation.
       */

      if (clicked !== button) {
        panel.classList.add(
          "hidden"
        );

        return;
      }

      /*
       * Clicking Cash Computation
       * hides the other sections.
       */

      const sections =
        content.querySelectorAll(
          '[id^="section-"]'
        );

      sections.forEach(section => {
        section.classList.toggle(
          "hidden",
          section !== panel
        );
      });

      content.scrollTo(0, 0);

      render();
    }
  );

  /* INSTALL CENTRAL HIGHLIGHT FIX */

  installSidebarHighlightFix(nav);

  render();

  return true;
}

/* =====================================
   UPDATE CASH COMPUTATION DISPLAY
===================================== */

function render() {
  if (
    !$("cashcalc-sales")
  ) {
    return;
  }

  const from =
    $("cashcalc-from").value;

  const to =
    $("cashcalc-to").value;

  const status =
    $("cashcalc-status");

  /* INVALID DATE RANGE */

  if (
    from &&
    to &&
    from > to
  ) {
    status.textContent =
      "Invalid date range. From must be on or before To.";

    status.style.color =
      "#b42318";

    return;
  }

  const result = compute();

  /* UPDATE ALL AMOUNTS */

  const fields = [
    ["sales", "cashcalc-sales"],
    ["cash", "cashcalc-cash"],
    ["expenses", "cashcalc-expenses"],
    ["gcash", "cashcalc-gcash"],
    ["expected", "cashcalc-result"]
  ];

  for (
    const [field, id] of fields
  ) {
    $(id).textContent =
      money(result[field]);
  }

  /* FIRESTORE LOAD STATUS */

  const pending = collections.filter(
    name =>
      !state.ready.has(name)
  );

  const errors = Object.values(
    state.errors
  ).filter(Boolean);

  status.style.color =
    errors.length
      ? "#b42318"
      : "#657369";

  if (errors.length) {
    status.textContent =
      `Unable to update: ${errors.join(" | ")}`;

  } else if (pending.length) {
    status.textContent =
      `Loading ${pending.join(", ")}…`;

  } else {
    status.textContent =
      "Live from Firestore. Amounts recalculate automatically.";
  }
}

/* =====================================
   START APPLICATION
===================================== */

installStyles();

if (setup()) {

  /* LIVE FIRESTORE LISTENERS */

  authReady.then(() => {
    collections.forEach(name => {
      onSnapshot(
        collection(db, name),

        snapshot => {
          state[name] = snapshot.docs.map(
            item => ({
              id: item.id,
              ...item.data()
            })
          );

          state.ready.add(name);

          delete state.errors[name];

          render();
        },

        error => {
          state.errors[name] =
            `${name}: ${error.message}`;

          render();
        }
      );
    });

  }).catch(error => {
    state.errors.auth =
      error.message;

    render();
  });

  /* =====================================
     PHILIPPINE MIDNIGHT REFRESH
  ===================================== */

  let previousDay = dayKey();

  setInterval(
    () => {
      const current = dayKey();

      if (current === previousDay) {
        return;
      }

      if (
        $("cashcalc-from").value ===
          previousDay &&
        $("cashcalc-to").value ===
          previousDay
      ) {
        $("cashcalc-from").value =
          current;

        $("cashcalc-to").value =
          current;
      }

      previousDay = current;

      render();
    },
    60000
  );
}
