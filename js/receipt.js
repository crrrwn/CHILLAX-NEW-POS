
/**
 * CHILLAX CAFE POS
 * COMPLETE 58MM PRINTING
 *
 * ADMIN COPY
 * KITCHEN COPY
 * CUSTOMER COPY
 *
 * OWNER SALES REPORTS
 * FINANCE REPORTS
 */

import {
  pesos,
  timestampDate,
  lineDiscountAmount
} from "./business.js";

const esc = value =>
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

const money = pesos;

const dated = date =>
  date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

const meta = (label, value) => `
  <div class="meta-row">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
  </div>
`;

const totalRow = (
  label,
  value,
  big = false
) => `
  <div class="totals-row${big ? " grand" : ""}">
    <span>${esc(label)}</span>
    <strong>${money(value)}</strong>
  </div>
`;

const divider = '<div class="rule"></div>';

/* IDENTIFY INDIVIDUAL SERVICE */
function serviceOf(line, order) {
  if (line.serveType === "Take Out") {
    return "Take Out";
  }

  if (line.serveType === "Dine In") {
    return "Dine In";
  }

  return order.orderType === "Take Out"
    ? "Take Out"
    : "Dine In";
}

/* GROUP ITEMS BY DINE IN / TAKE OUT */
function itemsHtml(order) {
  const all = Array.isArray(order.items)
    ? order.items
    : [];

  return ["Dine In", "Take Out"].map(service => {
    const lines = all.filter(
      line => serviceOf(line, order) === service
    );

    if (!lines.length) {
      return "";
    }

    const grouped = new Map();

    for (const line of lines) {
      const category = String(
        line.category ||
        (
          line.isAddon
            ? "Add Ons"
            : "Other"
        )
      ).trim();

      if (!grouped.has(category)) {
        grouped.set(category, []);
      }

      grouped.get(category).push(line);
    }

    const heading = service === "Take Out"
      ? "TAKE OUT - PACK"
      : "DINE IN - SERVE";

    return `
      <tr class="receipt-service-heading">
        <td colspan="2">
          ${heading}
        </td>
      </tr>

      ${[...grouped].map(([category, group]) => `
        <tr class="receipt-category">
          <td colspan="2">
            ${esc(category.toUpperCase())}
          </td>
        </tr>

        ${group.map(line => {
          const qty = Number(line.qty || 0);
          const rate = Number(line.discountRate || 0);

          const linePrice =
            qty * Number(line.unitPrice || 0);

          const box = Number(
            line.boxUnitPrice || 0
          );

          let discount = 0;

          try {
            discount = lineDiscountAmount(line);
          } catch {
            discount = 0;
          }

          return `
            <tr class="receipt-product-row">

              <td class="item-name">

                <span class="item-qty">
                  ${esc(qty)}×
                </span><span class="item-title">${esc(line.name)}${
                  line.size
                    ? ` (${esc(line.size)})`
                    : ""
                }</span>

                <div class="item-service">
                  ${service.toUpperCase()}

                  ${
                    box
                      ? ` · ${money(box)} BOX/PC`
                      : ""
                  }

                  ${
                    line.isAddon
                      ? " · ADD-ON"
                      : ""
                  }
                </div>

                ${
                  line.note
                    ? `
                      <div class="item-note">
                        ${esc(line.note)}
                      </div>
                    `
                    : ""
                }

                ${
                  rate && discount
                    ? `
                      <div class="item-note">
                        DISCOUNT ${rate}%:
                        -${money(discount)}
                      </div>
                    `
                    : ""
                }

              </td>

              <td class="item-price">
                ${money(linePrice)}
              </td>

            </tr>
          `;
        }).join("")}
      `).join("")}
    `;
  }).join("");
}

/* ADD-ONS / PACKAGING */
function extrasHtml(order) {
  const addons = Array.isArray(order.addons)
    ? order.addons
    : [];

  const addonHtml = addons.length
    ? `
      <div class="receipt-extras-title">
        EXTRA ADD-ONS
      </div>

      ${addons.map(addon =>
        totalRow(
          `${addon.qty}x ${addon.name}`,
          Number(addon.qty || 0) *
          Number(addon.unitPrice || 0)
        )
      ).join("")}
    `
    : "";

  const count15 = Number(
    order.boxes?.["15"] || 0
  );

  const count25 = Number(
    order.boxes?.["25"] || 0
  );

  const hasBoxes =
    order.boxes &&
    typeof order.boxes === "object";

  let packaging = "";

  if (hasBoxes) {
    if (count15) {
      packaging += totalRow(
        `P15 BOX x ${count15}`,
        count15 * 15
      );
    }

    if (count25) {
      packaging += totalRow(
        `P25 BOX x ${count25}`,
        count25 * 25
      );
    }

    if (Number(order.legacyPackagingFee || 0)) {
      packaging += totalRow(
        "Other packaging",
        Number(order.legacyPackagingFee)
      );
    }

  } else if (Number(order.packagingFee || 0)) {
    packaging = totalRow(
      "Takeout boxes",
      Number(order.packagingFee)
    );
  }

  return `
    ${addonHtml}

    ${
      packaging
        ? `
          <div class="receipt-extras-title">
            TAKEOUT BOXES
          </div>
          ${packaging}
        `
        : ""
    }
  `;
}

/* ONE RECEIPT COPY */
function receiptHtml(order, copy) {
  const date =
    timestampDate(order.createdAt) ||
    timestampDate(order.printedAt) ||
    new Date();

  const additional =
    order.receiptMode === "ADD-ON";

  const lines = Array.isArray(order.items)
    ? order.items
    : [];

  const services = new Set(
    lines.map(line =>
      serviceOf(line, order)
    )
  );

  const service =
    services.size > 1
      ? "MIXED"
      : (
          services.values().next().value ||
          order.orderType ||
          "Dine In"
        );

  return `
    <section
      class="receipt"
      aria-label="${esc(copy)} copy"
    >

      <h1 class="center">
        ${esc(copy)} COPY
      </h1>

      ${
        additional
          ? `
            <div class="copy-label">
              ADDITIONAL ITEMS
            </div>
          `
          : ""
      }

      ${divider}

      ${meta(
        "Order #",
        "#" + (order.orderNumber ?? "-")
      )}

      ${meta("Date", dated(date))}
      ${meta("Customer", order.customerName || "Walk-in")}
      ${meta("Service", service)}
      ${meta("Payment", order.paymentMethod || "Cash")}

      ${divider}

      <table class="receipt-items">
        <colgroup>
          <col style="width:67%">
          <col style="width:33%">
        </colgroup>

        <tbody>
          ${itemsHtml(order)}
        </tbody>
      </table>

      ${extrasHtml(order)}

      ${
        Number(order.discountAmount || 0)
          ? totalRow(
              "ITEM DISCOUNTS",
              -Number(order.discountAmount)
            )
          : ""
      }

      ${divider}

      ${totalRow(
        additional ? "NEW CHARGES" : "TOTAL",
        Number(order.total || 0),
        true
      )}

      ${
        additional &&
        order.updatedOrderTotal != null
          ? totalRow(
              "UPDATED ORDER TOTAL",
              Number(order.updatedOrderTotal),
              true
            )
          : ""
      }

      <div class="footer-note">
        ${esc(copy)} COPY ·
        ${
          additional
            ? "ADDITIONAL ITEMS"
            : "ORDER COMPLETE"
        }
      </div>

    </section>
  `;
}

/* ADMIN / KITCHEN / CUSTOMER */
export function prepareReceipts(
  order,
  area = document.getElementById("print-area")
) {
  if (!area) {
    throw Error("Missing #print-area");
  }

  area.innerHTML = [
    "ADMIN",
    "KITCHEN",
    "CUSTOMER"
  ].map(
    copy => receiptHtml(order, copy)
  ).join("");
}

export async function printOrder(order) {
  prepareReceipts(order);
  window.print();
}

/* ADMIN FINANCE REPORT */
export async function printFinanceReport(
  day,
  expenses = [],
  cashEntries = [],
  gcashPayments = []
) {
  const area = document.getElementById(
    "print-area"
  );

  if (!area) {
    throw Error("Missing #print-area");
  }

  const entries = (label, rows) => `
    <div class="receipt-extras-title">
      ${esc(label)}
    </div>

    ${
      rows.length
        ? rows.map(row =>
            totalRow(
              `${
                row.orderNumber
                  ? "#" + row.orderNumber + " "
                  : ""
              }${row.description || ""}`,
              Number(row.amount || 0)
            )
          ).join("")
        : "<div>No entries</div>"
    }

    ${totalRow(
      label + " TOTAL",
      rows.reduce(
        (sum, entry) =>
          sum + Number(entry.amount || 0),
        0
      ),
      true
    )}
  `;

  area.innerHTML = `
    <section class="receipt">

      <h1 class="center">
        ADMIN FINANCE REPORT
      </h1>

      ${divider}
      ${meta("Date", day)}
      ${divider}

      ${entries("CASH ON HAND", cashEntries)}
      ${divider}

      ${entries("EXPENSES", expenses)}
      ${divider}

      ${entries("GCASH PAYMENTS", gcashPayments)}

      <div class="footer-note">
        ADMIN ONLY
      </div>

    </section>
  `;

  window.print();
}

/* KUYA GAA / KUYA BOSS SALES PRINTING */
export function printOwnerReport({
  ownerName,
  from,
  to,

  rows = [],

  itemsSold = 0,
  orders = 0,

  productSales = 0,
  boxSales = 0,

  note = ""
}) {
  const area = document.getElementById(
    "print-area"
  );

  if (!area) {
    throw Error("Missing #print-area");
  }

  const total =
    Number(productSales) +
    Number(boxSales);

  area.innerHTML = `
    <section class="receipt">

      <h1 class="center">
        ${esc(ownerName)} SALES
      </h1>

      ${divider}

      ${meta("From", from)}
      ${meta("To", to)}
      ${meta("Orders", orders)}

      ${divider}

      ${
        rows.length
          ? rows.map(row => `
              <div class="receipt-extras-title">
                ${esc(row.category)}
              </div>

              ${totalRow(
                `${row.qty}x ${row.name}`,
                row.sales
              )}
            `).join("")
          : `
              <div>
                No sales for these dates.
              </div>
            `
      }

      ${divider}

      ${meta("Items sold", itemsSold)}

      ${totalRow(
        "PRODUCT SALES",
        productSales
      )}

      ${
        boxSales
          ? totalRow(
              "TAKEOUT BOXES",
              boxSales
            )
          : ""
      }

      ${totalRow(
        "TOTAL",
        total,
        true
      )}

      ${
        note
          ? `
            <div class="footer-note">
              ${esc(note)}
            </div>
          `
          : ""
      }

      <div class="footer-note">
        ADMIN OWNER REPORT
      </div>

    </section>
  `;

  window.print();
}
