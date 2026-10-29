
/**
 * CHILLAX Cafe POS
 * COMPLETE MULTIPLE-ORDER GCASH MODULE
 *
 * File: js/gcash-multi.js
 *
 * Load AFTER admin.js and admin-owners.js.
 *
 * - Multiple saved orders per GCash transfer
 * - Editable amount per order
 * - Hide orders with existing GCash records
 * - Prevent duplicate GCash records
 * - Atomic Firestore transaction
 * - Existing GCash amounts remain editable
 * - Does NOT add payment amounts to Sales
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
  pesos,
  rounded,
  timestampDate
} from "./business.js";

import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ADMIN AUTH */

const session = requireRole(["admin"]);

if (!session || session.role !== "admin") {
  throw Error("Admin required.");
}

/* HELPERS */

const $ = id => document.getElementById(id);

const state = {
  orders: [],
  payments: [],
  ordersReady: false,
  paymentsReady: false
};

const money = pesos;

const toCents = value =>
  Math.round(
    (Number(value) + Number.EPSILON) * 100
  );

const positiveAmount = raw => {
  const value = String(raw ?? "").trim();

  return /^\d+(?:\.\d{1,2})?$/.test(value)
    ? toCents(Number(value))
    : NaN;
};

const formatCents = value =>
  money((Number(value) || 0) / 100);

/* ORDER DATE */

const orderDay = order => {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      order.dayKey || ""
    )
  ) {
    return order.dayKey;
  }

  const created = timestampDate(
    order.createdAt
  );

  return created &&
    Number.isFinite(created.getTime())
      ? dayKey(created)
      : "";
};

/* CHECK WHICH ORDERS ALREADY HAVE GCASH */

const paidOrderIds = () =>
  new Set(
    state.payments.flatMap(
      payment => [
        payment.orderId,
        payment.id
      ].filter(Boolean)
    )
  );

/* NOTIFICATION */

function notify(message, error = false) {
  const target =
    $("owner-status") ||
    $("connection-banner");

  if (target) {
    target.textContent = message;

    target.classList?.remove(
      "hidden"
    );

    target.style.color = error
      ? "#b42318"
      : "#23643f";

  } else if (error) {
    alert(message);
  }
}

/* MODAL STATE */

const mountedModal = {
  updateList: null
};

function closeModal() {
  mountedModal.updateList = null;

  $("modal-root")?.replaceChildren();
}

/* CREATE ELEMENT */

function make(
  tag,
  className,
  text
) {
  const node =
    document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text != null) {
    node.textContent = String(text);
  }

  return node;
}

/* CREATE MODAL */

function modalBase(title, hint) {
  const root = $("modal-root");

  if (!root) {
    throw Error(
      "Missing #modal-root in admin.html"
    );
  }

  const shade = make(
    "div",
    "modal-backdrop multi-gcash-shade"
  );

  const sheet = make(
    "section",
    "modal-sheet finance-modal multi-gcash-sheet"
  );

  sheet.setAttribute(
    "role",
    "dialog"
  );

  sheet.setAttribute(
    "aria-modal",
    "true"
  );

  sheet.setAttribute(
    "aria-label",
    title
  );

  sheet.append(
    make("h3", "", title),
    make("p", "modal-subtitle", hint)
  );

  shade.append(sheet);

  shade.addEventListener(
    "click",
    event => {
      if (event.target === shade) {
        closeModal();
      }
    }
  );

  root.replaceChildren(shade);

  return sheet;
}

/* FORM FIELD */

function addField(
  labelText,
  control
) {
  const label = make(
    "label",
    "field"
  );

  label.append(
    make(
      "span",
      "field-label",
      labelText
    ),
    control
  );

  return label;
}

/* DESIGN */

function installStyles() {
  const style = make("style");

  style.textContent = `
    @media screen {

      .multi-gcash-sheet {
        width: min(650px, 96vw) !important;
        max-height: 90dvh;
        overflow-y: auto;
      }

      .multi-gcash-choices {
        display: grid;
        gap: 9px;
        margin: 10px 0;
        max-height: 43dvh;
        overflow-y: auto;
        padding: 3px;
      }

      .multi-gcash-order {
        display: grid;
        grid-template-columns:
          24px minmax(0, 1fr) minmax(95px, 125px);

        align-items: center;
        gap: 10px;
        padding: 10px;

        border: 1px solid #eadcd3;
        border-radius: 11px;
        background: #fff;
      }

      .multi-gcash-order input[type=checkbox] {
        width: 19px;
        height: 19px;
        accent-color: #c3477e;
      }

      .multi-gcash-order .order-label {
        min-width: 0;
        overflow-wrap: anywhere;
        font-size: .82rem;
      }

      .multi-gcash-order .order-label small {
        display: block;
        color: #806c60;
        font-size: .72rem;
        margin-top: 3px;
      }

      .multi-gcash-order input[type=number] {
        width: 100%;
        min-width: 0;
        min-height: 39px;
        padding: 7px;

        border: 1px solid #dfc9bd;
        border-radius: 8px;
        box-sizing: border-box;
      }

      .multi-gcash-total {
        padding: 12px;
        background: #fff3f8;
        border-radius: 10px;
        font-size: .85rem;
        line-height: 1.5;
        margin: 11px 0;
      }

      .multi-gcash-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        flex-wrap: wrap;
        margin-top: 12px;
      }

      .multi-gcash-actions button {
        min-height: 40px;
      }

      .multi-gcash-error {
        color: #b42318;
        font-size: .82rem;
        min-height: 16px;
      }
    }

    @media screen and (max-width: 450px) {
      .multi-gcash-order {
        grid-template-columns:
          22px 1fr;
      }

      .multi-gcash-order input[type=number] {
        grid-column: 2;
      }
    }

    @media print {
      .multi-gcash-shade {
        display: none !important;
      }
    }
  `;

  document.head.append(style);
}

/* CHECK FIRESTORE IS LOADED */

function ready() {
  return (
    state.ordersReady &&
    state.paymentsReady
  );
}

/* AVAILABLE ORDERS ONLY */

function availableOrders(day) {
  const paid = paidOrderIds();

  return state.orders
    .filter(
      order =>
        orderDay(order) === day &&
        !paid.has(order.id)
    )
    .sort(
      (a, b) =>
        Number(a.orderNumber || 0) -
        Number(b.orderNumber || 0)
    );
}

/* =====================================
   ADD GCASH — MULTIPLE ORDERS
===================================== */

function openAddGcash() {
  if (!ready()) {
    notify(
      "Orders and GCash records are still loading. Retry shortly.",
      true
    );

    return;
  }

  const day =
    $("finance-date")?.value ||
    dayKey();

  const choices = availableOrders(day);

  if (!choices.length) {
    notify(
      "Walang available na order: lahat ng orders sa date na ito ay may GCash record na, o walang saved orders.",
      true
    );

    return;
  }

  const sheet = modalBase(
    "Add GCash Payment — Multiple Orders",

    "Pumili ng maraming order. Ang may existing GCash record ay HINDI na kasama sa listahan. Ilagay ang aktuwal na GCash amount para sa bawat napili."
  );

  const form = make(
    "form",
    "modal-form"
  );

  /* DESCRIPTION */

  const description = make("input");

  description.type = "text";
  description.maxLength = 160;
  description.required = true;

  description.placeholder =
    "Hal. One transfer for Orders #18, #23, #24";

  form.append(
    addField(
      "GCash description / reference",
      description
    )
  );

  /* ORDER SELECTION */

  const listTitle = make(
    "strong",
    "",
    "Select saved orders (multiple)"
  );

  form.append(listTitle);

  const list = make(
    "div",
    "multi-gcash-choices"
  );

  form.append(list);

  /* TOTAL PREVIEW */

  const total = make(
    "div",
    "multi-gcash-total",
    "Selected orders: 0 · Total GCash: ₱0.00"
  );

  total.setAttribute(
    "aria-live",
    "polite"
  );

  form.append(total);

  /* ERROR */

  const error = make(
    "p",
    "multi-gcash-error"
  );

  error.setAttribute(
    "role",
    "alert"
  );

  form.append(error);

  /* ACTIONS */

  const actions = make(
    "div",
    "multi-gcash-actions"
  );

  const cancel = make(
    "button",
    "btn btn-outline",
    "Cancel"
  );

  cancel.type = "button";
  cancel.onclick = closeModal;

  const save = make(
    "button",
    "btn btn-primary",
    "Save Selected Payments"
  );

  save.type = "submit";

  actions.append(
    cancel,
    save
  );

  form.append(actions);
  sheet.append(form);

  /*
   * Map:
   * order Firestore ID -> entered GCash amount
   */

  const selected = new Map();

  let saving = false;

  /* COMPUTE TOTAL */

  function totals() {
    let sum = 0;

    const details = [];

    for (
      const [id, rawAmount] of selected
    ) {
      const order = state.orders.find(
        item => item.id === id
      );

      const amount =
        positiveAmount(rawAmount);

      details.push({
        order,
        amount
      });

      if (
        Number.isFinite(amount) &&
        amount > 0
      ) {
        sum += amount;
      }
    }

    total.textContent =
      `Selected orders: ${selected.size} · ` +
      `Total GCash: ${formatCents(sum)}`;

    return details;
  }

  /* RENDER AVAILABLE ORDERS */

  function drawOrders() {
    if (saving) return;

    const available =
      availableOrders(day);

    const ids = new Set(
      available.map(
        order => order.id
      )
    );

    const previouslySelected = [
      ...selected.keys()
    ];

    /*
     * Remove any selected order that
     * gained a GCash payment elsewhere.
     */

    for (const id of previouslySelected) {
      if (!ids.has(id)) {
        selected.delete(id);
      }
    }

    if (
      previouslySelected.some(
        id => !ids.has(id)
      )
    ) {
      error.textContent =
        "May order na nagkaroon na ng GCash payment sa ibang session. Inalis ito sa selection.";
    }

    list.replaceChildren();

    if (!available.length) {
      list.append(
        make(
          "p",
          "",
          "Wala nang orders na puwedeng piliin para sa araw na ito."
        )
      );

      save.disabled = true;

      totals();
      return;
    }

    save.disabled = false;

    for (const order of available) {
      const row = make(
        "div",
        "multi-gcash-order"
      );

      /* CHECKBOX */

      const check = make("input");

      check.type = "checkbox";

      check.checked =
        selected.has(order.id);

      check.setAttribute(
        "aria-label",
        `Select order #${order.orderNumber}`
      );

      /* ORDER LABEL */

      const label = make(
        "div",
        "order-label",
        `Order #${order.orderNumber} · ` +
        `${order.customerName || "Walk-in"}`
      );

      label.append(
        make(
          "small",
          "",
          `Order total: ${money(order.total)}`
        )
      );

      /* EDITABLE GCASH AMOUNT */

      const allocation = make("input");

      allocation.type = "number";
      allocation.min = "0.01";
      allocation.max = String(order.total);
      allocation.step = "0.01";
      allocation.inputMode = "decimal";

      allocation.placeholder = "GCash ₱";

      allocation.disabled =
        !check.checked;

      allocation.value =
        selected.get(order.id) ?? "";

      allocation.setAttribute(
        "aria-label",
        `GCash for order #${order.orderNumber}`
      );

      /* CHECK / UNCHECK */

      check.addEventListener(
        "change",
        () => {
          if (check.checked) {
            /*
             * Default to order total.
             * Can be changed for split payment.
             */

            selected.set(
              order.id,
              Number(order.total).toFixed(2)
            );

            allocation.value =
              selected.get(order.id);

            allocation.disabled = false;

            allocation.focus();

          } else {
            selected.delete(order.id);

            allocation.value = "";

            allocation.disabled = true;
          }

          error.textContent = "";

          totals();
        }
      );

      /* UPDATE AMOUNT */

      allocation.addEventListener(
        "input",
        () => {
          if (check.checked) {
            selected.set(
              order.id,
              allocation.value
            );
          }

          totals();
        }
      );

      row.append(
        check,
        label,
        allocation
      );

      list.append(row);
    }

    totals();
  }

  /* LIVE REFRESH WHILE MODAL IS OPEN */

  mountedModal.updateList =
    drawOrders;

  drawOrders();

  /* =================================
     SAVE MULTIPLE GCASH RECORDS
  ================================= */

  form.addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      if (saving) return;

      error.textContent = "";

      const desc =
        description.value.trim();

      const entries = totals();

      if (
        !desc ||
        !entries.length
      ) {
        error.textContent =
          "Enter a description and select at least one order.";

        return;
      }

      /* VALIDATE EVERY ALLOCATION */

      for (const { order, amount } of entries) {
        if (
          !order ||
          !Number.isInteger(amount) ||
          amount <= 0 ||
          amount > toCents(order.total)
        ) {
          error.textContent =
            `Invalid GCash amount for Order #${order?.orderNumber || "?"}. ` +
            "Maximum is the saved order total.";

          return;
        }
      }

      if (entries.length > 40) {
        error.textContent =
          "Select up to 40 orders per GCash transaction.";

        return;
      }

      /* CONFIRM BEFORE SAVING */

      const summary = entries
        .map(
          ({ order, amount }) =>
            `#${order.orderNumber}: ` +
            formatCents(amount)
        )
        .join("\n");

      const sum = entries.reduce(
        (value, item) =>
          value + item.amount,
        0
      );

      if (
        !confirm(
          `Confirm ONE GCash transfer of ` +
          `${formatCents(sum)} allocated to:\n\n` +
          `${summary}\n\nSave all records?`
        )
      ) {
        return;
      }

      saving = true;

      save.disabled = true;
      save.textContent =
        "Saving payments…";

      try {
        await authReady;

        const groupId =
          crypto.randomUUID?.() ||
          `gcash-${Date.now()}`;

        await runTransaction(
          db,
          async transaction => {
            /*
             * ALL FIRESTORE READS FIRST.
             */

            const references = entries.map(
              ({ order }) => ({
                orderRef: doc(
                  db,
                  "orders",
                  order.id
                ),

                paymentRef: doc(
                  db,
                  "gcashPayments",
                  order.id
                )
              })
            );

            const snapshots =
              await Promise.all(
                references.flatMap(
                  reference => [
                    transaction.get(
                      reference.orderRef
                    ),

                    transaction.get(
                      reference.paymentRef
                    )
                  ]
                )
              );

            const writes = [];

            /* VALIDATE SAVED ORDERS */

            for (
              let i = 0;
              i < entries.length;
              i++
            ) {
              const orderSnap =
                snapshots[i * 2];

              const paymentSnap =
                snapshots[i * 2 + 1];

              if (!orderSnap.exists()) {
                throw Error(
                  `Order #${entries[i].order.orderNumber} was removed.`
                );
              }

              /*
               * PREVENT DUPLICATE GCASH
               * EVEN FROM DIFFERENT DEVICES.
               */

              if (paymentSnap.exists()) {
                throw Error(
                  `Order #${entries[i].order.orderNumber} already has a GCash payment.`
                );
              }

              const savedOrder =
                orderSnap.data();

              const allocation =
                entries[i].amount;

              if (
                orderDay(savedOrder) !== day
              ) {
                throw Error(
                  `Order #${savedOrder.orderNumber} has another date.`
                );
              }

              if (
                allocation <= 0 ||
                allocation >
                  toCents(savedOrder.total)
              ) {
                throw Error(
                  `Order #${savedOrder.orderNumber} allocation exceeds order total.`
                );
              }

              writes.push({
                ...references[i],

                amount: rounded(
                  allocation / 100
                ),

                orderNumber: Number(
                  savedOrder.orderNumber
                ),

                customerName:
                  savedOrder.customerName || ""
              });
            }

            const at =
              new Date().toISOString();

            /*
             * SAVE ALL PAYMENTS TOGETHER.
             */

            for (const write of writes) {
              transaction.set(
                write.paymentRef,
                {
                  orderId:
                    write.orderRef.id,

                  orderNumber:
                    write.orderNumber,

                  customerName:
                    write.customerName,

                  dayKey: day,

                  description: desc,

                  amount:
                    write.amount,

                  groupId,

                  combinedTransfer:
                    rounded(sum / 100),

                  paymentHistory: [{
                    action: "add",

                    amount:
                      write.amount,

                    groupId,
                    at,

                    description: desc
                  }],

                  createdAt:
                    serverTimestamp(),

                  updatedAt:
                    serverTimestamp()
                }
              );

              transaction.update(
                write.orderRef,
                {
                  paymentMethod: "GCash",

                  gcashAmount:
                    write.amount
                }
              );
            }
          }
        );

        closeModal();

        notify(
          `${entries.length} GCash allocations saved: ` +
          `${formatCents(sum)} total. ` +
          "Hindi idinagdag ulit sa Sales."
        );

      } catch (errorMessage) {
        error.textContent =
          `Save failed: ${errorMessage.message}`;

        saving = false;

        save.disabled = false;

        save.textContent =
          "Save Selected Payments";
      }
    }
  );
}

/* =====================================
   EDIT EXISTING GCASH PAYMENT
===================================== */

function openEditGcash(payment) {
  const order = state.orders.find(
    item =>
      item.id === payment.orderId
  );

  if (!order) {
    notify(
      "Linked saved order not found; cannot edit payment.",
      true
    );

    return;
  }

  const sheet = modalBase(
    `Edit GCash — Order #${order.orderNumber}`,

    "Existing GCash records are excluded from Add Payment. To correct an amount, use Edit here instead."
  );

  const form = make(
    "form",
    "modal-form"
  );

  /* DESCRIPTION */

  const desc = make("input");

  desc.type = "text";
  desc.required = true;
  desc.maxLength = 160;

  desc.value =
    payment.description || "GCash";

  /* CORRECTED AMOUNT */

  const amount = make("input");

  amount.type = "number";
  amount.required = true;

  amount.min = "0.01";
  amount.max = String(order.total);
  amount.step = "0.01";

  amount.value = String(
    payment.amount ?? ""
  );

  form.append(
    addField("Description", desc),

    addField(
      "Corrected GCash received (₱)",
      amount
    )
  );

  /* PAYMENT SUMMARY */

  const help = make(
    "p",
    "multi-gcash-total",

    `Order total: ${money(order.total)} · ` +
    `Previous GCash: ${money(payment.amount)}`
  );

  const error = make(
    "p",
    "multi-gcash-error"
  );

  const actions = make(
    "div",
    "multi-gcash-actions"
  );

  const cancel = make(
    "button",
    "btn btn-outline",
    "Cancel"
  );

  cancel.type = "button";
  cancel.onclick = closeModal;

  const save = make(
    "button",
    "btn btn-primary",
    "Save Correction"
  );

  save.type = "submit";

  actions.append(
    cancel,
    save
  );

  form.append(
    help,
    error,
    actions
  );

  sheet.append(form);

  /* SAVE CORRECTED AMOUNT */

  form.addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      const value =
        positiveAmount(amount.value);

      if (
        !Number.isInteger(value) ||
        value <= 0 ||
        value > toCents(order.total) ||
        !desc.value.trim()
      ) {
        error.textContent =
          "Enter a valid amount up to the current order total and a description.";

        return;
      }

      save.disabled = true;

      try {
        await authReady;

        const orderRef = doc(
          db,
          "orders",
          order.id
        );

        const paymentRef = doc(
          db,
          "gcashPayments",
          order.id
        );

        await runTransaction(
          db,
          async transaction => {
            const [
              orderSnap,
              paymentSnap
            ] = await Promise.all([
              transaction.get(orderRef),
              transaction.get(paymentRef)
            ]);

            if (
              !orderSnap.exists() ||
              !paymentSnap.exists()
            ) {
              throw Error(
                "Order or payment was deleted."
              );
            }

            if (
              value >
                toCents(orderSnap.data().total)
            ) {
              throw Error(
                "Amount exceeds updated order total."
              );
            }

            const old =
              paymentSnap.data();

            const at =
              new Date().toISOString();

            transaction.update(
              paymentRef,
              {
                amount:
                  rounded(value / 100),

                description:
                  desc.value.trim(),

                dayKey:
                  orderDay(orderSnap.data()),

                paymentHistory: [
                  ...(
                    Array.isArray(
                      old.paymentHistory
                    )
                      ? old.paymentHistory
                      : []
                  ),

                  {
                    action: "edit-total",

                    previousAmount:
                      Number(old.amount || 0),

                    newAmount:
                      rounded(value / 100),

                    at,

                    description:
                      desc.value.trim()
                  }
                ].slice(-60),

                updatedAt:
                  serverTimestamp()
              }
            );

            transaction.update(
              orderRef,
              {
                paymentMethod: "GCash",

                gcashAmount:
                  rounded(value / 100)
              }
            );
          }
        );

        closeModal();

        notify(
          `GCash for Order #${order.orderNumber} updated.`
        );

      } catch (errorMessage) {
        error.textContent =
          `Save failed: ${errorMessage.message}`;

        save.disabled = false;
      }
    }
  );
}

/* =====================================
   INTERCEPT EXISTING GCASH BUTTONS
===================================== */

/*
 * WINDOW CAPTURE executes before the
 * old admin.js and admin-owners.js
 * click handlers.
 *
 * This prevents two modals from opening.
 */

window.addEventListener(
  "click",
  event => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    /* ADD GCASH */

    if (
      target.closest(
        "#add-gcash-payment"
      )
    ) {
      event.preventDefault();

      event.stopImmediatePropagation();

      openAddGcash();
      return;
    }

    /* GCASH TABLE EDIT BUTTON */

    const button = target.closest(
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
        ?.textContent.trim()
        .startsWith("GCash Payments")
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const row = button.closest("tr");

    const label =
      row?.cells?.[0]?.textContent || "";

    const orderNo = Number(
      /#\s*(\d+)/.exec(label)?.[1]
    );

    const date =
      $("finance-date")?.value ||
      dayKey();

    const matching = state.payments.filter(
      payment => {
        const created = timestampDate(
          payment.createdAt
        );

        const paymentDay =
          payment.dayKey ||
          (
            created
              ? dayKey(created)
              : ""
          );

        return (
          Number(payment.orderNumber) ===
            orderNo &&
          paymentDay === date
        );
      }
    );

    if (matching.length !== 1) {
      notify(
        "GCash record could not be uniquely identified; reload the Finance table.",
        true
      );

      return;
    }

    openEditGcash(matching[0]);
  },
  true
);

/* =====================================
   START FIRESTORE LISTENERS
===================================== */

installStyles();

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

      state.ordersReady = true;

      mountedModal.updateList?.();
    },

    error => notify(
      `Orders: ${error.message}`,
      true
    )
  );

  /* GCASH RECORDS */

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

      state.paymentsReady = true;

      /*
       * Instantly hide orders that receive
       * GCash payments while the Add
       * Payment modal is open.
       */

      mountedModal.updateList?.();
    },

    error => notify(
      `GCash: ${error.message}`,
      true
    )
  );

}).catch(error => {
  notify(
    `Sign-in: ${error.message}`,
    true
  );
});
