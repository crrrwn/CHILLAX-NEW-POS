
/**
 * CHILLAX CAFE — MULTIPLE GCASH PAYMENTS
 *
 * File: js/gcash-multi.js
 *
 * - Select multiple saved orders
 * - Editable GCash amount per order
 * - Hide orders with existing GCash records
 * - Confirm allocations in a styled modal
 * - Save all allocations atomically
 * - Styled success/error notifications
 * - Edit existing GCash payments
 *
 * Load after admin.js and admin-owners.js.
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
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const $ = id =>
  document.getElementById(id);

const data = {
  orders: [],
  payments: [],
  ordersLoaded: false,
  paymentsLoaded: false
};

const money = cents =>
  "₱" + (
    Math.max(0, cents) / 100
  ).toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

const centsOf = value =>
  Math.round(
    (Number(value) + Number.EPSILON) * 100
  );

function parseAmount(value) {
  const text = String(
    value ?? ""
  ).trim();

  return /^\d+(?:\.\d{1,2})?$/.test(text)
    ? centsOf(Number(text))
    : NaN;
}

function phDay(item) {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      item.dayKey || ""
    )
  ) {
    return item.dayKey;
  }

  const date = timestampDate(
    item.createdAt
  );

  return (
    date &&
    Number.isFinite(date.getTime())
  )
    ? dayKey(date)
    : "";
}

function ready() {
  return (
    data.ordersLoaded &&
    data.paymentsLoaded
  );
}

/* HTML HELPERS */

function made(
  tag,
  cls,
  text
) {
  const element =
    document.createElement(tag);

  if (cls) {
    element.className = cls;
  }

  if (text !== undefined) {
    element.textContent =
      String(text);
  }

  return element;
}

function field(label, input) {
  const item = made(
    "label",
    "field"
  );

  item.append(
    made(
      "span",
      "field-label",
      label
    ),
    input
  );

  return item;
}

/* MODAL DESIGN */

const css = made("style");

css.textContent = `
  @media screen {

    .gm-layer {
      position: fixed;
      inset: 0;
      z-index: 2200;

      display: flex;
      align-items: center;
      justify-content: center;

      padding: 14px;

      background: rgba(31,23,25,.62);
    }

    .gm-dialog {
      width: min(640px,96vw);
      max-height: 90dvh;
      overflow: auto;

      padding: 22px;

      border-radius: 18px;
      background: white;
      color: #372b30;

      box-shadow:
        0 20px 70px #130e1459;
    }

    .gm-dialog h2 {
      margin: 0 0 8px;
      font-size: 1.25rem;
    }

    .gm-muted {
      font-size: .83rem;
      color: #79686e;
      line-height: 1.55;
      margin: 0 0 15px;
    }

    .gm-list {
      display: grid;
      gap: 7px;

      max-height: 38dvh;
      overflow: auto;

      padding: 3px;
      margin: 10px 0;
    }

    .gm-order {
      display: grid;

      align-items: center;

      grid-template-columns:
        24px minmax(0,1fr) 116px;

      gap: 10px;
      padding: 11px 10px;

      border: 1px solid #eddae2;
      border-radius: 12px;
    }

    .gm-order input[type=checkbox] {
      width: 19px;
      height: 19px;

      accent-color: #bd4575;
    }

    .gm-order small {
      display: block;
      color: #87747a;
      font-size: .73rem;
      margin-top: 3px;
    }

    .gm-order input[type=number] {
      box-sizing: border-box;

      min-width: 0;
      width: 100%;
      min-height: 38px;

      padding: 7px;

      border: 1px solid #d9becb;
      border-radius: 9px;
    }

    .gm-total {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;

      padding: 13px;

      background: #fff1f6;
      border-radius: 11px;

      margin: 12px 0;
    }

    .gm-total strong {
      font-size: 1.18rem;
      font-variant-numeric: tabular-nums;
    }

    .gm-error {
      font-size: .84rem;
      color: #b42318;
      min-height: 20px;
    }

    .gm-actions {
      display: flex;
      justify-content: flex-end;

      gap: 10px;
      flex-wrap: wrap;

      margin-top: 16px;
    }

    .gm-actions button {
      min-height: 41px;
      padding: 8px 17px;
    }

    .gm-badge {
      display: inline-grid;
      place-items: center;

      width: 48px;
      height: 48px;

      border-radius: 50%;
      background: #fce4ef;
      color: #a93669;

      font-size: 24px;
      font-weight: bold;

      margin-bottom: 10px;
    }

    .gm-confirm-list {
      border: 1px solid #f0dfe6;
      border-radius: 12px;

      padding: 10px 14px;

      max-height: 30dvh;
      overflow: auto;
    }

    .gm-confirm-item {
      display: flex;
      justify-content: space-between;

      gap: 12px;
      padding: 7px 0;

      font-size: .85rem;

      border-bottom:
        1px solid #f4ebef;
    }

    .gm-confirm-item:last-child {
      border-bottom: 0;
    }
  }

  @media screen and (max-width:440px) {

    .gm-dialog {
      padding: 16px;
    }

    .gm-order {
      grid-template-columns:
        22px minmax(0,1fr);
    }

    .gm-order input[type=number] {
      grid-column: 2;
    }

    .gm-actions button {
      flex: 1;
    }
  }

  @media print {
    .gm-layer {
      display: none !important;
    }
  }
`;

document.head.append(css);

/* MODAL HELPERS */

function root() {
  const element = $("modal-root");

  if (!element) {
    throw Error(
      "Missing #modal-root in admin.html."
    );
  }

  return element;
}

function modal(title, description) {
  const layer = made(
    "div",
    "gm-layer"
  );

  const dialog = made(
    "section",
    "gm-dialog"
  );

  dialog.setAttribute(
    "role",
    "dialog"
  );

  dialog.setAttribute(
    "aria-modal",
    "true"
  );

  dialog.setAttribute(
    "aria-label",
    title
  );

  dialog.append(
    made("h2", "", title),
    made(
      "p",
      "gm-muted",
      description
    )
  );

  layer.append(dialog);

  root().replaceChildren(layer);

  return dialog;
}

function close() {
  root().replaceChildren();
}

function action(
  text,
  primary,
  callback
) {
  const button = made(
    "button",
    primary
      ? "btn btn-primary"
      : "btn btn-outline",
    text
  );

  button.type = "button";

  button.addEventListener(
    "click",
    callback
  );

  return button;
}

/* STYLED SUCCESS / ERROR MESSAGE */

function banner(
  title,
  description,
  successful = true
) {
  const box = modal(
    title,
    description
  );

  box.prepend(
    made(
      "span",
      "gm-badge",
      successful ? "✓" : "!"
    )
  );

  const actions = made(
    "div",
    "gm-actions"
  );

  actions.append(
    action(
      "OK",
      true,
      close
    )
  );

  box.append(actions);

  actions.firstChild.focus();
}

/* CHECK ALREADY RECORDED ORDERS */

function paidSet() {
  return new Set(
    data.payments.flatMap(
      payment => [
        payment.id,
        payment.orderId
      ].filter(Boolean)
    )
  );
}

function available(day) {
  const paid = paidSet();

  return data.orders
    .filter(
      order =>
        phDay(order) === day &&
        !paid.has(order.id)
    )
    .sort(
      (a, b) =>
        Number(a.orderNumber || 0) -
        Number(b.orderNumber || 0)
    );
}

function selectedDay() {
  return (
    $("finance-date")?.value ||
    dayKey()
  );
}

/* =====================================
   ADD MULTIPLE GCASH PAYMENTS
===================================== */

function openAdd() {
  if (!ready()) {
    banner(
      "GCash still loading",
      "Orders and payment records have not finished loading.",
      false
    );

    return;
  }

  const day = selectedDay();

  const orders = available(day);

  if (!orders.length) {
    banner(
      "No available orders",
      "There are no unpaid orders on the selected date. Paid orders are hidden; use Edit to correct a recorded GCash amount.",
      false
    );

    return;
  }

  const dialog = modal(
    "Add GCash Payment",
    "Select as many saved orders as needed. Each order receives its own GCash allocation. Orders that already have a GCash record are hidden."
  );

  const form = made(
    "form",
    "modal-form"
  );

  /* DESCRIPTION */

  const description =
    made("input");

  description.type = "text";
  description.required = true;
  description.maxLength = 160;

  description.placeholder =
    "e.g. GCash transfer reference #123";

  form.append(
    field(
      "Description / GCash reference",
      description
    )
  );

  form.append(
    made(
      "strong",
      "",
      "Select orders and amounts"
    )
  );

  const list = made(
    "div",
    "gm-list"
  );

  const selected = new Map();

  let saving = false;

  const totalPreview = made(
    "div",
    "gm-total"
  );

  const errorBox = made(
    "p",
    "gm-error"
  );

  errorBox.setAttribute(
    "role",
    "alert"
  );

  const actions = made(
    "div",
    "gm-actions"
  );

  const cancel = action(
    "Cancel",
    false,
    close
  );

  const save = made(
    "button",
    "btn btn-primary",
    "Review Selected Payments"
  );

  save.type = "submit";

  actions.append(
    cancel,
    save
  );

  form.append(
    list,
    totalPreview,
    errorBox,
    actions
  );

  dialog.append(form);

  /* TOTAL PREVIEW */

  function preview() {
    let total = 0;

    for (
      const value of selected.values()
    ) {
      const amount = parseAmount(
        value
      );

      if (
        Number.isFinite(amount) &&
        amount > 0
      ) {
        total += amount;
      }
    }

    totalPreview.replaceChildren(
      made(
        "span",
        "",
        `${selected.size} selected order(s)`
      ),

      made(
        "strong",
        "",
        money(total)
      )
    );
  }

  /* DRAW ORDER CHECKBOXES */

  function draw() {
    if (
      saving ||
      !root().contains(dialog)
    ) {
      return;
    }

    const current = available(day);

    const availableIds = new Set(
      current.map(
        item => item.id
      )
    );

    let removed = false;

    for (
      const id of selected.keys()
    ) {
      if (!availableIds.has(id)) {
        selected.delete(id);
        removed = true;
      }
    }

    if (removed) {
      errorBox.textContent =
        "An order received a GCash record elsewhere and was removed from your selection.";
    }

    list.replaceChildren();

    for (const order of current) {
      const row = made(
        "div",
        "gm-order"
      );

      const check =
        made("input");

      check.type = "checkbox";

      check.checked = selected.has(
        order.id
      );

      check.setAttribute(
        "aria-label",
        `Select order #${order.orderNumber}`
      );

      /* ORDER NAME */

      const text = made(
        "div",
        "",
        `#${order.orderNumber} · ` +
        `${order.customerName || "Walk-in"}`
      );

      text.append(
        made(
          "small",
          "",
          `Saved total: ${money(centsOf(order.total))}`
        )
      );

      /* AMOUNT FIELD */

      const amount =
        made("input");

      amount.type = "number";
      amount.step = "0.01";
      amount.min = "0.01";
      amount.max = String(
        order.total
      );

      amount.inputMode =
        "decimal";

      amount.placeholder =
        "GCash ₱";

      amount.disabled =
        !check.checked;

      amount.value =
        selected.get(order.id) ?? "";

      amount.setAttribute(
        "aria-label",
        `GCash amount for order #${order.orderNumber}`
      );

      /* SELECT / DESELECT */

      check.onchange = () => {
        if (check.checked) {
          const defaultAmount = Number(
            order.total
          ).toFixed(2);

          selected.set(
            order.id,
            defaultAmount
          );

          amount.value =
            defaultAmount;

          amount.disabled = false;

          amount.focus();

        } else {
          selected.delete(
            order.id
          );

          amount.disabled = true;

          amount.value = "";
        }

        errorBox.textContent = "";

        preview();
      };

      /* UPDATE PAYMENT AMOUNT */

      amount.oninput = () => {
        if (check.checked) {
          selected.set(
            order.id,
            amount.value
          );
        }

        preview();
      };

      row.append(
        check,
        text,
        amount
      );

      list.append(row);
    }

    if (!current.length) {
      list.append(
        made(
          "p",
          "gm-muted",
          "All orders on this date already have GCash payments."
        )
      );
    }

    preview();
  }

  /* LIVE REFRESH */

  const refresh = () => {
    if (root().contains(dialog)) {
      draw();
    }
  };

  openModalRefresh = refresh;

  draw();

  /* REVIEW BEFORE SAVING */

  form.onsubmit = async event => {
    event.preventDefault();

    if (saving) return;

    const desc =
      description.value.trim();

    const entries = [
      ...selected
    ].map(
      ([id, raw]) => ({
        order: data.orders.find(
          order => order.id === id
        ),

        amount:
          parseAmount(raw)
      })
    );

    if (
      !desc ||
      !entries.length
    ) {
      errorBox.textContent =
        "Enter a description and select at least one order.";

      return;
    }

    if (entries.length > 30) {
      errorBox.textContent =
        "Maximum 30 orders in one save.";

      return;
    }

    for (const item of entries) {
      if (
        !item.order ||
        !Number.isInteger(item.amount) ||
        item.amount <= 0 ||
        item.amount >
          centsOf(item.order.total)
      ) {
        errorBox.textContent =
          `Invalid amount for Order #${item.order?.orderNumber || "?"}. ` +
          "It cannot exceed the saved total.";

        return;
      }
    }

    const sum = entries.reduce(
      (total, item) =>
        total + item.amount,
      0
    );

    /* STYLED CONFIRMATION MODAL */

    const confirmation = made(
      "div",
      "gm-layer"
    );

    confirmation.style.zIndex =
      "2300";

    const confirmBox = made(
      "section",
      "gm-dialog"
    );

    confirmBox.setAttribute(
      "role",
      "alertdialog"
    );

    confirmBox.setAttribute(
      "aria-modal",
      "true"
    );

    confirmBox.setAttribute(
      "aria-label",
      "Confirm GCash allocations"
    );

    confirmBox.append(
      made(
        "span",
        "gm-badge",
        "₱"
      ),

      made(
        "h2",
        "",
        "Confirm GCash Payments"
      ),

      made(
        "p",
        "gm-muted",
        "Review all allocations before saving. Each selected order will be recorded once."
      )
    );

    const summary = made(
      "div",
      "gm-confirm-list"
    );

    for (const item of entries) {
      const row = made(
        "div",
        "gm-confirm-item"
      );

      row.append(
        made(
          "span",
          "",
          `Order #${item.order.orderNumber}`
        ),

        made(
          "strong",
          "",
          money(item.amount)
        )
      );

      summary.append(row);
    }

    const totalRow = made(
      "div",
      "gm-total"
    );

    totalRow.append(
      made(
        "span",
        "",
        "TOTAL GCASH TO SAVE"
      ),

      made(
        "strong",
        "",
        money(sum)
      )
    );

    const confirmError = made(
      "p",
      "gm-error"
    );

    confirmError.setAttribute(
      "role",
      "alert"
    );

    const buttons = made(
      "div",
      "gm-actions"
    );

    const back = action(
      "Back to Edit",
      false,
      () => confirmation.remove()
    );

    const confirm = action(
      "Confirm & Save",
      true,
      async () => {
        if (saving) return;

        saving = true;

        confirm.disabled = true;
        back.disabled = true;

        confirm.textContent =
          "Saving…";

        try {
          await authReady;

          const groupId =
            crypto.randomUUID?.() ||
            `gcash-${Date.now()}`;

          await runTransaction(
            db,
            async tx => {
              const refs = entries.map(
                item => ({
                  orderRef: doc(
                    db,
                    "orders",
                    item.order.id
                  ),

                  paymentRef: doc(
                    db,
                    "gcashPayments",
                    item.order.id
                  )
                })
              );

              /* READ ALL BEFORE WRITING */

              const snaps =
                await Promise.all(
                  refs.flatMap(ref => [
                    tx.get(ref.orderRef),
                    tx.get(ref.paymentRef)
                  ])
                );

              /* VALIDATE EACH ORDER */

              for (
                let index = 0;
                index < entries.length;
                index++
              ) {
                const savedOrder =
                  snaps[index * 2];

                const payment =
                  snaps[index * 2 + 1];

                if (!savedOrder.exists()) {
                  throw Error(
                    `Order #${entries[index].order.orderNumber} was deleted.`
                  );
                }

                if (payment.exists()) {
                  throw Error(
                    `Order #${entries[index].order.orderNumber} already has a GCash payment.`
                  );
                }

                if (
                  phDay(savedOrder.data()) !== day
                ) {
                  throw Error(
                    "An order's saved date changed."
                  );
                }

                if (
                  entries[index].amount >
                    centsOf(
                      savedOrder.data().total
                    )
                ) {
                  throw Error(
                    `Order #${entries[index].order.orderNumber} amount exceeds current order total.`
                  );
                }
              }

              /* SAVE ALL PAYMENTS */

              for (
                let index = 0;
                index < entries.length;
                index++
              ) {
                const entry =
                  entries[index];

                const current =
                  snaps[index * 2].data();

                const refsForRow =
                  refs[index];

                const allocated =
                  entry.amount / 100;

                tx.set(
                  refsForRow.paymentRef,
                  {
                    orderId:
                      entry.order.id,

                    orderNumber:
                      current.orderNumber,

                    customerName:
                      current.customerName || "",

                    dayKey: day,

                    description: desc,

                    amount: allocated,

                    groupId,

                    combinedTransfer:
                      sum / 100,

                    paymentHistory: [{
                      action: "add",
                      amount: allocated,
                      at: new Date().toISOString(),
                      groupId,
                      description: desc
                    }],

                    createdAt:
                      serverTimestamp(),

                    updatedAt:
                      serverTimestamp()
                  }
                );

                tx.update(
                  refsForRow.orderRef,
                  {
                    paymentMethod: "GCash",
                    gcashAmount: allocated
                  }
                );
              }
            }
          );

          openModalRefresh = null;

          /* STYLED SUCCESS MESSAGE */

          banner(
            "GCash Payments Saved",
            `${entries.length} order(s) recorded successfully. ` +
            `Total GCash: ${money(sum)}. ` +
            "These orders will no longer appear in Add Payment.",
            true
          );

        } catch (error) {
          saving = false;

          confirm.disabled = false;
          back.disabled = false;

          confirm.textContent =
            "Confirm & Save";

          confirmError.textContent =
            `Save failed: ${error.message}`;
        }
      }
    );

    buttons.append(
      back,
      confirm
    );

    confirmBox.append(
      summary,
      totalRow,
      confirmError,
      buttons
    );

    confirmation.append(
      confirmBox
    );

    root().append(
      confirmation
    );

    confirm.focus();
  };
}

/* =====================================
   EDIT EXISTING GCASH PAYMENT
===================================== */

function openEdit(payment) {
  const order = data.orders.find(
    item =>
      item.id === payment.orderId
  );

  if (!order) {
    banner(
      "Cannot edit GCash",
      "The linked saved order was not found.",
      false
    );

    return;
  }

  const dialog = modal(
    `Edit GCash — Order #${order.orderNumber}`,
    "Correct the existing amount. Paid orders are not selectable in Add Payment."
  );

  const form = made(
    "form",
    "modal-form"
  );

  const desc = made("input");

  desc.type = "text";
  desc.required = true;
  desc.maxLength = 160;

  desc.value =
    payment.description || "GCash";

  const amount = made("input");

  amount.type = "number";
  amount.min = "0.01";
  amount.step = "0.01";

  amount.max = String(
    order.total
  );

  amount.required = true;

  amount.value = String(
    payment.amount ?? ""
  );

  const error = made(
    "p",
    "gm-error"
  );

  const buttons = made(
    "div",
    "gm-actions"
  );

  const cancel = action(
    "Cancel",
    false,
    close
  );

  const save = made(
    "button",
    "btn btn-primary",
    "Save Correction"
  );

  save.type = "submit";

  form.append(
    field("Description", desc),

    field(
      "Corrected GCash amount (₱)",
      amount
    ),

    made(
      "p",
      "gm-muted",
      `Saved order total: ${money(centsOf(order.total))}`
    ),

    error
  );

  buttons.append(
    cancel,
    save
  );

  form.append(buttons);

  dialog.append(form);

  /* SAVE CORRECTION */

  form.onsubmit = async event => {
    event.preventDefault();

    const next =
      parseAmount(amount.value);

    if (
      !Number.isInteger(next) ||
      next <= 0 ||
      next > centsOf(order.total) ||
      !desc.value.trim()
    ) {
      error.textContent =
        "Enter a valid amount up to the saved order total.";

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
        async tx => {
          const [
            savedOrder,
            savedPayment
          ] = await Promise.all([
            tx.get(orderRef),
            tx.get(paymentRef)
          ]);

          if (
            !savedOrder.exists() ||
            !savedPayment.exists()
          ) {
            throw Error(
              "The order or payment no longer exists."
            );
          }

          if (
            next >
              centsOf(
                savedOrder.data().total
              )
          ) {
            throw Error(
              "GCash exceeds updated saved order total."
            );
          }

          const previous =
            savedPayment.data();

          tx.update(
            paymentRef,
            {
              amount: next / 100,

              description:
                desc.value.trim(),

              updatedAt:
                serverTimestamp(),

              paymentHistory: [
                ...(
                  Array.isArray(
                    previous.paymentHistory
                  )
                    ? previous.paymentHistory
                    : []
                ),

                {
                  action: "edit-total",

                  previousAmount:
                    Number(
                      previous.amount || 0
                    ),

                  newAmount:
                    next / 100,

                  description:
                    desc.value.trim(),

                  at:
                    new Date().toISOString()
                }
              ].slice(-60)
            }
          );

          tx.update(
            orderRef,
            {
              paymentMethod: "GCash",
              gcashAmount: next / 100
            }
          );
        }
      );

      banner(
        "GCash Payment Updated",
        `Order #${order.orderNumber} now has ${money(next)} recorded in GCash.`,
        true
      );

    } catch (errorMessage) {
      error.textContent =
        `Save failed: ${errorMessage.message}`;

      save.disabled = false;
    }
  };
}

/* CURRENT MODAL REFRESH CALLBACK */

let openModalRefresh = null;

/* =====================================
   INTERCEPT EXISTING GCASH BUTTONS
===================================== */

window.addEventListener(
  "click",
  event => {
    const target =
      event.target;

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

      openAdd();

      return;
    }

    /* EDIT EXISTING GCASH */

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
        ?.textContent.startsWith(
          "GCash Payments"
        )
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const row =
      button.closest("tr");

    const text =
      row?.cells?.[0]?.textContent || "";

    const orderNumber = Number(
      /#\s*(\d+)/.exec(text)?.[1]
    );

    const found =
      data.payments.filter(
        payment =>
          Number(
            payment.orderNumber
          ) === orderNumber &&
          phDay(payment) === selectedDay()
      );

    if (found.length === 1) {
      openEdit(found[0]);

    } else {
      banner(
        "GCash record not identified",
        "Please reload the Finance section and try Edit again.",
        false
      );
    }
  },
  true
);

/* =====================================
   LIVE FIRESTORE DATA
===================================== */

authReady.then(() => {

  /* ORDERS */

  onSnapshot(
    collection(db, "orders"),

    snapshot => {
      data.orders =
        snapshot.docs.map(
          item => ({
            id: item.id,
            ...item.data()
          })
        );

      data.ordersLoaded = true;

      openModalRefresh?.();
    },

    error => {
      banner(
        "Orders unavailable",
        error.message,
        false
      );
    }
  );

  /* GCASH PAYMENTS */

  onSnapshot(
    collection(db, "gcashPayments"),

    snapshot => {
      data.payments =
        snapshot.docs.map(
          item => ({
            id: item.id,
            ...item.data()
          })
        );

      data.paymentsLoaded = true;

      openModalRefresh?.();
    },

    error => {
      banner(
        "GCash unavailable",
        error.message,
        false
      );
    }
  );

}).catch(error => {
  banner(
    "Connection error",
    error.message,
    false
  );
});
