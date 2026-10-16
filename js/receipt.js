
/**
 * CHILLAX POS
 * COMPLETE 58MM RECEIPT SYSTEM
 *
 * ADMIN / KITCHEN / CUSTOMER
 * Category labels, takeout boxes,
 * add-ons and discounts.
 */

import {
  pesos,
  timestampDate
} from "./business.js";

const html = value =>
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

function dateLabel(date) {
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function meta(label, value) {
  return `
    <div class="meta-row">
      <span>${html(label)}</span>
      <strong>${html(value)}</strong>
    </div>
  `;
}

function cost(label, value, highlight = false) {
  return `
    <div class="totals-row${highlight ? " grand" : ""}">
      <span>${html(label)}</span>
      <strong>${pesos(value)}</strong>
    </div>
  `;
}

/* CATEGORY-GROUPED ORDER ITEMS */
function renderItems(items) {
  const groups = new Map();

  for (const item of items || []) {
    const category = String(
      item.category ||
      (
        item.isAddon
          ? "Add Ons"
          : "Category not recorded"
      )
    ).trim();

    if (!groups.has(category)) {
      groups.set(category, []);
    }

    groups.get(category).push(item);
  }

  return [...groups].map(([category, lines]) => `
    <tr class="receipt-category">
      <td colspan="2">
        ${html(category.toUpperCase())}
      </td>
    </tr>

    ${lines.map(item => {
      const quantity = Number(item.qty || 0);
      const unitPrice = Number(item.unitPrice || 0);
      const lineTotal = quantity * unitPrice;

      return `
        <tr class="receipt-product-row">
          <td class="item-name">
            <span class="item-qty">${
              html(quantity)
            }×</span><span class="item-title">${
              html(item.name)
            }${
              item.size
                ? ` (${html(item.size)})`
                : ""
            }</span>

            <div class="item-service">
              ${html(item.serveType || "Dine In")}
              ${item.isAddon ? " · ADD-ON" : ""}
              ${
                Number(item.boxUnitPrice || 0)
                  ? ` · ₱${Number(item.boxUnitPrice)} box`
                  : ""
              }
            </div>

            ${
              item.note
                ? `<div class="item-note">
                     Note: ${html(item.note)}
                   </div>`
                : ""
            }
          </td>

          <td class="item-price">
            ${pesos(lineTotal)}
          </td>
        </tr>
      `;
    }).join("")}
  `).join("");
}

/* ADD-ONS AND PACKAGING */
function renderExtras(order) {
  const addons = Array.isArray(order.addons)
    ? order.addons
    : [];

  const addonLines = addons.length
    ? `
      <div class="receipt-extras-title">
        ADD ONS
      </div>

      ${addons.map(addon => `
        <div class="totals-row">
          <span>
            ${html(addon.qty)}×
            ${html(addon.name)} (add-on)
          </span>

          <strong>
            ${pesos(
              Number(addon.qty || 0) *
              Number(addon.unitPrice || 0)
            )}
          </strong>
        </div>
      `).join("")}
    `
    : "";

  const boxes = order.boxes || {};

  const count15 = Number(boxes["15"] || 0);
  const count25 = Number(boxes["25"] || 0);

  const hasCounts = count15 || count25;

  const packaging = hasCounts
    ? `
      ${
        count15
          ? cost(
              `₱15 box × ${count15}`,
              count15 * 15
            )
          : ""
      }

      ${
        count25
          ? cost(
              `₱25 box × ${count25}`,
              count25 * 25
            )
          : ""
      }
    `
    : (
      Number(order.packagingFee || 0)
        ? cost(
            "Packaging",
            order.packagingFee
          )
        : ""
    );

  const legacy = Number(
    order.legacyPackagingFee || 0
  );

  return `
    ${addonLines}

    ${
      packaging || legacy
        ? `<div class="receipt-extras-title">
             TAKEOUT BOXES
           </div>`
        : ""
    }

    ${packaging}

    ${
      legacy
        ? cost("Previous packaging", legacy)
        : ""
    }
  `;
}

/* ONE PRINT COPY */
function orderSection(order, copy) {
  const created =
    timestampDate(order.createdAt) ||
    timestampDate(order.printedAt) ||
    new Date();

  const isAdditional =
    order.receiptMode === "ADD-ON";

  const discountRate = Number(
    order.discountRate || 0
  );

  const discountAmount = Number(
    order.discountAmount || 0
  );

  const discountLabel = discountRate
    ? `Discount (${discountRate}%)`
    : "Discount";

  return `
    <section
      class="receipt"
      aria-label="${html(copy)} receipt"
    >

      <div class="center">
        <h1>${html(copy)} COPY</h1>

        ${
          isAdditional
            ? `<div class="copy-label">
                 ADD-ON / ADDITIONAL CHARGES
               </div>`
            : ""
        }
      </div>

      <div class="rule"></div>

      ${meta(
        "Order #",
        `#${order.orderNumber ?? "-"}`
      )}

      ${meta(
        "Date",
        dateLabel(created)
      )}

      ${meta(
        "Customer",
        order.customerName || "Walk-in"
      )}

      ${meta(
        "Payment",
        order.paymentMethod || "Cash"
      )}

      <div class="rule"></div>

      <table class="receipt-items">
        <colgroup>
          <col style="width:67%">
          <col style="width:33%">
        </colgroup>

        <tbody>
          ${renderItems(order.items)}
        </tbody>
      </table>

      ${renderExtras(order)}

      <div class="rule"></div>

      ${
        discountAmount > 0
          ? `
            <div class="totals-row">
              <span>${html(discountLabel)}</span>
              <strong>-${pesos(discountAmount)}</strong>
            </div>
          `
          : ""
      }

      ${cost(
        isAdditional ? "NEW CHARGES" : "TOTAL",
        order.total,
        true
      )}

      ${
        isAdditional
          ? cost(
              "UPDATED ORDER TOTAL",
              order.updatedOrderTotal,
              true
            )
          : ""
      }

      <div class="footer-note">
        ${html(copy)} COPY ·
        ${
          isAdditional
            ? "ADDITIONAL ITEMS"
            : "ORDER COMPLETE"
        }
      </div>

    </section>
  `;
}

/* GENERATE ALL THREE RECEIPTS */
export function prepareReceipts(
  order,
  area = document.getElementById("print-area")
) {
  if (!area) {
    throw new Error("Missing #print-area.");
  }

  area.innerHTML = [
    "ADMIN",
    "KITCHEN",
    "CUSTOMER"
  ].map(copy => orderSection(order, copy)).join("");
}

/* PRINT ORDER */
export async function printOrder(order) {
  prepareReceipts(order);
  window.print();
}

/* ADMIN DAILY FINANCE REPORT */
export async function printFinanceReport(
  date,
  expenses,
  cashEntries,
  gcashPayments = []
) {
  const area = document.getElementById(
    "print-area"
  );

  if (!area) {
    throw new Error("Missing #print-area.");
  }

  const totalExpense = expenses.reduce(
    (sum, entry) =>
      sum + Number(entry.amount || 0),
    0
  );

  const totalCash = cashEntries.reduce(
    (sum, entry) =>
      sum + Number(entry.amount || 0),
    0
  );

  const totalGCash = gcashPayments.reduce(
    (sum, entry) =>
      sum + Number(entry.amount || 0),
    0
  );

  const rows = (list, type) =>
    list.map(entry => `
      <div class="finance-print-row">
        <span>
          ${html(type)}:
          ${html(entry.description)}
        </span>

        <strong>
          ${pesos(entry.amount)}
        </strong>
      </div>
    `).join("");

  area.innerHTML = `
    <section class="receipt">

      <h1 class="center">
        ADMIN FINANCE REPORT
      </h1>

      <div class="rule"></div>

      ${meta("Date (PH)", date)}

      <div class="rule"></div>

      <div class="copy-label">
        CASH ON HAND
      </div>

      ${rows(cashEntries, "Cash") || "No entries"}

      ${cost(
        "Cash total",
        totalCash,
        true
      )}

      <div class="rule"></div>

      <div class="copy-label">
        EXPENSES
      </div>

      ${rows(expenses, "Expense") || "No entries"}

      ${cost(
        "Expense total",
        totalExpense,
        true
      )}

      <div class="rule"></div>

      <div class="copy-label">
        GCASH PAYMENTS
      </div>

      ${
        gcashPayments.map(entry => `
          <div class="finance-print-row">
            <span>
              Order #${html(entry.orderNumber)}:
              ${html(entry.description)}
            </span>

            <strong>
              ${pesos(entry.amount)}
            </strong>
          </div>
        `).join("") || "No GCash payments"
      }

      ${cost(
        "GCash total",
        totalGCash,
        true
      )}

      <div class="footer-note">
        ADMIN ONLY · ${html(date)}
      </div>

    </section>
  `;

  window.print();
}
