
/**
 * CHILLAX CAFE POS
 * 58MM THERMAL RECEIPTS
 * ADMIN / KITCHEN / CUSTOMER
 * ADD-ON RECEIPTS + FINANCE + OWNER REPORTS
 */

import {
  pesos,
  timestampDate,
  lineDiscountAmount
} from "./business.js";

/* =====================================
   SAFE TEXT / FORMAT HELPERS
===================================== */

const html = value =>
  String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

const dateLabel = value => {
  const date = value instanceof Date
    ? value
    : timestampDate(value);

  if (!date || !Number.isFinite(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

const meta = (label, value) => `
  <div class="meta-row">
    <span>${html(label)}</span>
    <strong>${html(value)}</strong>
  </div>
`;

const cost = (label, value, className = "") => `
  <div class="totals-row ${html(className)}">
    <span>${html(label)}</span>
    <strong>${pesos(value)}</strong>
  </div>
`;

/* =====================================
   SERVICE TYPE
===================================== */

function normalizeService(value, fallback = "Dine In") {
  const text = String(value || fallback)
    .trim()
    .toLowerCase();

  if (
    text.includes("take out") ||
    text.includes("takeout") ||
    text.includes("take-out")
  ) {
    return "Take Out";
  }

  return "Dine In";
}

function serviceSummary(order) {
  const services = new Set(
    (order.items || []).map(item =>
      normalizeService(
        item.serveType,
        order.orderType || "Dine In"
      )
    )
  );

  if (services.size > 1) {
    return "Mixed Dine In / Take Out";
  }

  return services.size
    ? [...services][0]
    : normalizeService(order.orderType || "Dine In");
}

/* =====================================
   CATEGORY GROUPING
===================================== */

function groupByCategory(items) {
  const groups = new Map();

  for (const item of items || []) {
    const category = String(
      item.category ||
      (item.isAddon ? "Add Ons" : "Category not recorded")
    ).trim();

    if (!groups.has(category)) {
      groups.set(category, []);
    }

    groups.get(category).push(item);
  }

  return groups;
}

/* =====================================
   RECEIPT PRODUCT ROW
===================================== */

function renderProduct(item) {
  const qty = Number(item.qty || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const lineAmount = qty * unitPrice;
  const boxPrice = Number(item.boxUnitPrice || 0);
  const discountRate = Number(item.discountRate || 0);

  const serviceDetails = [];

  if (item.isAddon) {
    serviceDetails.push("ADD-ON");
  }

  if (boxPrice > 0) {
    serviceDetails.push(`₱${boxPrice} BOX`);
  }

  return `
    <tr class="receipt-product-row">

      <td class="item-name">

        <span class="item-qty">
          ${html(qty)}×
        </span>

        <span class="item-title">
          ${html(item.name)}${item.size ? ` (${html(item.size)})` : ""}
        </span>

        ${serviceDetails.length ? `
          <div class="item-service">
            ${html(serviceDetails.join(" · "))}
          </div>
        ` : ""}

        ${item.note ? `
          <div class="item-note">
            Note: ${html(item.note)}
          </div>
        ` : ""}

        ${discountRate ? `
          <div class="item-note">
            Item discount ${html(discountRate)}%:
            −${pesos(lineDiscountAmount(item))}
          </div>
        ` : ""}

      </td>

      <td class="item-price">
        ${pesos(lineAmount)}
      </td>

    </tr>
  `;
}

/* =====================================
   DINE IN / TAKE OUT PACK GROUPING
===================================== */

function renderItems(items, fallbackService = "Dine In") {
  const serviceGroups = new Map();

  for (const item of items || []) {
    const service = normalizeService(
      item.serveType,
      fallbackService
    );

    if (!serviceGroups.has(service)) {
      serviceGroups.set(service, []);
    }

    serviceGroups.get(service).push(item);
  }

  return [...serviceGroups.entries()].map(
    ([service, serviceItems]) => {

      const serviceLabel = service === "Take Out"
        ? "TAKE OUT - PACK"
        : "DINE IN - PACK";

      const categoryGroups =
        groupByCategory(serviceItems);

      const categoriesHTML =
        [...categoryGroups.entries()].map(
          ([category, lines]) => `
            <tr class="receipt-category">
              <td colspan="2">
                ${html(category.toUpperCase())}
              </td>
            </tr>

            ${lines.map(renderProduct).join("")}
          `
        ).join("");

      return `
        <tr class="receipt-service-heading">
          <td colspan="2">
            ${serviceLabel}
          </td>
        </tr>

        ${categoriesHTML}
      `;
    }
  ).join("");
}

/* =====================================
   ADD-ONS AND TAKEOUT BOXES
===================================== */

function renderExtras(order) {
  const addons = Array.isArray(order.addons)
    ? order.addons
    : [];

  const addonsHTML = addons.length
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

  const hasCounts =
    count15 > 0 || count25 > 0;

  const packagingHTML = hasCounts
    ? `
      ${count15 ? cost(
        `₱15 box × ${count15}`,
        count15 * 15
      ) : ""}

      ${count25 ? cost(
        `₱25 box × ${count25}`,
        count25 * 25
      ) : ""}
    `
    : (
      Number(order.packagingFee || 0)
        ? cost("Packaging", order.packagingFee)
        : ""
    );

  const legacy = Number(
    order.legacyPackagingFee || 0
  );

  const hasPackaging =
    Boolean(packagingHTML || legacy);

  return `
    ${addonsHTML}

    ${hasPackaging ? `
      <div class="receipt-extras-title">
        TAKEOUT BOXES
      </div>
    ` : ""}

    ${packagingHTML}

    ${legacy ? cost(
      "Previous packaging",
      legacy
    ) : ""}
  `;
}

/* =====================================
   ORDER RECEIPT COPY
===================================== */

function orderSection(order, copy) {
  const created =
    timestampDate(order.createdAt) ||
    timestampDate(order.printedAt) ||
    new Date();

  const isAddonReceipt =
    String(order.receiptMode || "")
      .toUpperCase() === "ADD-ON";

  const service = serviceSummary(order);

  const fallbackService = normalizeService(
    order.orderType || service
  );

  const itemsHTML = renderItems(
    order.items || [],
    fallbackService
  );

  const discountAmount = Number(
    order.discountAmount || 0
  );

  return `
    <section
      class="receipt"
      aria-label="${html(copy)} receipt"
    >

      <div class="center">

        <h1>
          ${html(copy)} COPY
        </h1>

        ${isAddonReceipt ? `
          <div class="copy-label">
            ADDITIONAL ITEMS
          </div>
        ` : ""}

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
        "Service",
        service
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

          ${itemsHTML || `
            <tr>
              <td colspan="2">
                No item details
              </td>
            </tr>
          `}

        </tbody>

      </table>

      ${renderExtras(order)}

      ${discountAmount > 0
        ? cost(
            "Selected item discounts",
            -discountAmount
          )
        : ""}

      <div class="rule"></div>

      ${isAddonReceipt
        ? `
          ${cost(
            "NEW CHARGES",
            order.total,
            "addon-total-line addon-new-charges"
          )}

          ${cost(
            "UPDATED ORDER TOTAL",
            order.updatedOrderTotal,
            "addon-total-line addon-updated-total"
          )}
        `
        : cost(
            "TOTAL",
            order.total,
            "grand"
          )}

      <div class="footer-note">
        ${html(copy)} COPY ·
        ${isAddonReceipt
          ? "ADDITIONAL ITEMS"
          : "ORDER COMPLETE"}
      </div>

    </section>
  `;
}

/* =====================================
   PREPARE THREE COPIES
===================================== */

export function prepareReceipts(
  order,
  area = document.getElementById("print-area")
) {
  if (!area) {
    throw new Error("Missing #print-area");
  }

  area.innerHTML = [
    "ADMIN",
    "KITCHEN",
    "CUSTOMER"
  ]
    .map(copy => orderSection(order, copy))
    .join("");
}

/* =====================================
   PRINT ORDER
===================================== */

export async function printOrder(order) {
  prepareReceipts(order);
  window.print();
}

/* =====================================
   ADMIN FINANCE REPORT
===================================== */

export async function printFinanceReport(
  date,
  expenses,
  cashEntries,
  gcashPayments = []
) {
  const area =
    document.getElementById("print-area");

  if (!area) {
    throw new Error("Missing #print-area");
  }

  const expenseRows =
    Array.isArray(expenses) ? expenses : [];

  const cashRows =
    Array.isArray(cashEntries) ? cashEntries : [];

  const gcashRows =
    Array.isArray(gcashPayments) ? gcashPayments : [];

  const totalExpense = expenseRows.reduce(
    (sum, entry) =>
      sum + Number(entry.amount || 0),
    0
  );

  const totalCash = cashRows.reduce(
    (sum, entry) =>
      sum + Number(entry.amount || 0),
    0
  );

  const totalGCash = gcashRows.reduce(
    (sum, entry) =>
      sum + Number(entry.amount || 0),
    0
  );

  const rows = (list, type) =>
    list.map(entry => `
      <div class="finance-print-row">

        <span>
          ${html(type)}:
          ${html(entry.description || "-")}
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

      ${rows(cashRows, "Cash") || "No entries"}

      ${cost(
        "Cash total",
        totalCash,
        "grand"
      )}

      <div class="rule"></div>

      <div class="copy-label">
        EXPENSES
      </div>

      ${rows(expenseRows, "Expense") || "No entries"}

      ${cost(
        "Expense total",
        totalExpense,
        "grand"
      )}

      <div class="rule"></div>

      <div class="copy-label">
        GCASH PAYMENTS
      </div>

      ${gcashRows.map(entry => `
        <div class="finance-print-row">

          <span>
            Order #${html(entry.orderNumber ?? "-")}:
            ${html(entry.description || "GCash")}
          </span>

          <strong>
            ${pesos(entry.amount)}
          </strong>

        </div>
      `).join("") || "No GCash payments"}

      ${cost(
        "GCash total",
        totalGCash,
        "grand"
      )}

      <div class="footer-note">
        ADMIN ONLY · ${html(date)}
      </div>

    </section>
  `;

  window.print();
}

/* =====================================
   OWNER SALES REPORT
===================================== */

function normalizeReportRows(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return Object.entries(value).map(
      ([name, amount]) => ({
        name,

        amount: typeof amount === "object"
          ? Number(
              amount.amount ??
              amount.total ??
              0
            )
          : Number(amount || 0),

        ...(typeof amount === "object"
          ? amount
          : {})
      })
    );
  }

  return [];
}

function reportRowHTML(row) {
  const label =
    row.name ||
    row.label ||
    row.item ||
    row.product ||
    row.description ||
    "Sales";

  const quantity =
    row.qty ??
    row.quantity ??
    row.count;

  const amount =
    row.amount ??
    row.total ??
    row.sales ??
    row.revenue ??
    0;

  return `
    <div class="finance-print-row">

      <span>
        ${html(label)}
        ${quantity == null
          ? ""
          : ` · ${html(quantity)}×`}
      </span>

      <strong>
        ${pesos(amount)}
      </strong>

    </div>
  `;
}

export async function printOwnerReport(report = {}) {
  const area =
    document.getElementById("print-area");

  if (!area) {
    throw new Error("Missing #print-area");
  }

  const sourceRows =
    Array.isArray(report.rows) && report.rows.length
      ? report.rows
      : report.productSales != null
        ? report.productSales
        : report.itemsSold;

  const rows = normalizeReportRows(sourceRows);

  const boxRows = normalizeReportRows(
    report.boxSales
  );

  const rowTotal = rows.reduce(
    (sum, row) =>
      sum + Number(
        row.amount ??
        row.total ??
        row.sales ??
        row.revenue ??
        0
      ),
    0
  );

  let boxTotal = 0;

  if (typeof report.boxSales === "number") {
    boxTotal = report.boxSales;

  } else if (
    report.boxSales &&
    typeof report.boxSales === "object" &&
    !Array.isArray(report.boxSales)
  ) {
    if (
      report.boxSales.amount != null ||
      report.boxSales.total != null
    ) {
      boxTotal = Number(
        report.boxSales.amount ??
        report.boxSales.total
      );

    } else {
      boxTotal =
        Number(report.boxSales["15"] || 0) * 15 +
        Number(report.boxSales["25"] || 0) * 25;
    }

  } else {
    boxTotal = boxRows.reduce(
      (sum, row) =>
        sum + Number(
          row.amount ??
          row.total ??
          row.sales ??
          0
        ),
      0
    );
  }

  const title =
    report.ownerName || "OWNER SALES";

  const from =
    report.from || "-";

  const to =
    report.to || report.from || "-";

  const total =
    report.total == null
      ? rowTotal + boxTotal
      : Number(report.total);

  const orderCount =
    Array.isArray(report.orders)
      ? report.orders.length
      : Number(report.orders || 0);

  area.innerHTML = `
    <section class="receipt">

      <h1 class="center">
        ${html(title)}
      </h1>

      <div class="rule"></div>

      ${meta("From", from)}
      ${meta("To", to)}

      ${orderCount
        ? meta("Orders", orderCount)
        : ""}

      <div class="rule"></div>

      <div class="copy-label">
        PRODUCT SALES
      </div>

      ${rows.map(reportRowHTML).join("") || "No sales rows"}

      ${boxTotal ? `
        <div class="rule"></div>

        <div class="copy-label">
          TAKEOUT BOX SALES
        </div>

        ${cost("Boxes", boxTotal)}
      ` : ""}

      <div class="rule"></div>

      ${cost(
        "TOTAL SALES",
        total,
        "grand"
      )}

      ${report.note ? `
        <div class="footer-note">
          ${html(report.note)}
        </div>
      ` : ""}

      <div class="footer-note">
        ADMIN ONLY · ${html(title)}
      </div>

    </section>
  `;

  window.print();
}
