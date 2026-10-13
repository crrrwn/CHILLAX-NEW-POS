
/**
 * CHILLAX CAFÉ POS
 * 58MM THERMAL RECEIPT
 *
 * CASHIER / CUSTOMER COPY
 * KITCHEN COPY WITH PRICES
 *
 * Works with POS checkout and Admin reprint.
 */

const html = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]
  );

// PRICE FORMAT
const money = value =>
  "PHP " + Number(value || 0).toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

// GENERATE RECEIPTS
export function prepareReceipts(
  order,
  printArea = document.getElementById("print-area")
) {

  if (!printArea) {
    throw new Error(
      "Receipt print area is missing."
    );
  }

  const items = Array.isArray(order.items)
    ? order.items
    : [];

  const date =
    order.createdAt?.toDate?.() ||
    (
      order.printedAt
        ? new Date(order.printedAt)
        : new Date()
    );

  const dateText = date.toLocaleString(
    "en-PH",
    {
      dateStyle: "medium",
      timeStyle: "short"
    }
  );

  // EACH PRODUCT WITH PRICE
  const lineItems = items.map(item => {

    const qty = Number(item.qty || 0);

    const unitPrice = Number(
      item.unitPrice || 0
    );

    const itemTotal = qty * unitPrice;

    return `
      <tr>
        <td class="qty">
          ${html(qty)}x
        </td>

        <td class="item-name">
          ${html(item.name)}

          ${
            item.size
              ? `(${html(item.size)})`
              : ""
          }

          ${
            item.note
              ? `
                <div class="item-note">
                  Note: ${html(item.note)}
                </div>
              `
              : ""
          }
        </td>

        <td class="item-price">
          ${money(itemTotal)}
        </td>
      </tr>
    `;

  }).join("");

  // KITCHEN COPY - WITH PRICES
  const kitchenItems = items.map(item => {

    const qty = Number(item.qty || 0);

    const unitPrice = Number(
      item.unitPrice || 0
    );

    const itemTotal = qty * unitPrice;

    return `
      <tr>
        <td class="qty">
          ${html(qty)}x
        </td>

        <td class="item-name">
          ${html(item.name)}

          ${
            item.size
              ? `(${html(item.size)})`
              : ""
          }

          ${
            item.note
              ? `
                <div class="item-note">
                  Note: ${html(item.note)}
                </div>
              `
              : ""
          }
        </td>

        <td class="item-price">
          ${money(itemTotal)}
        </td>
      </tr>
    `;

  }).join("");

  // ORDER INFORMATION
  const meta = (label, value) => `
    <div class="meta-row">
      <span>${html(label)}</span>
      <strong>${html(value)}</strong>
    </div>
  `;

  const packagingFee = Number(
    order.packagingFee || 0
  );

  const total = Number(order.total || 0);

  // PRINT HTML
  printArea.innerHTML = `

    <!-- CUSTOMER / CASHIER RECEIPT -->

    <section
      class="receipt"
      aria-label="Cashier receipt"
    >

      <div class="center">

        <img
          class="logo-print"
          src="assets/logo.jpg"
          alt=""
        />

        <h1>CHILLAX CAFE</h1>

        <p class="sub">
          Sto. Nino, Calapan,
          Oriental Mindoro
        </p>

        <p class="sub">
          0977 702 3674
        </p>

      </div>

      <div class="rule"></div>

      <div class="copy-label">
        CASHIER / CUSTOMER COPY
      </div>

      ${meta(
        "ORDER #",
        order.orderNumber ?? "-"
      )}

      ${meta("Date", dateText)}

      ${meta(
        "Type",
        order.orderType || "Dine In"
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
        <tbody>
          ${lineItems}
        </tbody>
      </table>

      <div class="rule"></div>

      <div class="totals-row">
        <span>Packaging</span>
        <strong>
          ${money(packagingFee)}
        </strong>
      </div>

      <div class="totals-row grand">
        <span>TOTAL</span>
        <strong>
          ${money(total)}
        </strong>
      </div>

      <p class="footer-note">
        Thank you for visiting Chillax!
      </p>

    </section>


    <!-- KITCHEN COPY WITH PRICES -->

    <section
      class="receipt receipt-kitchen"
      aria-label="Kitchen copy"
    >

      <h1 class="center">
        KITCHEN COPY
      </h1>

      <div class="rule"></div>

      ${meta(
        "ORDER #",
        order.orderNumber ?? "-"
      )}

      ${meta("Time", dateText)}

      ${meta(
        "Type",
        order.orderType || "Dine In"
      )}

      ${meta(
        "Customer",
        order.customerName || "Walk-in"
      )}

      <div class="rule"></div>

      <table class="receipt-items">
        <tbody>
          ${kitchenItems}
        </tbody>
      </table>

      <div class="rule"></div>

      <!-- PACKAGING FEE -->
      <div class="totals-row">
        <span>Packaging</span>
        <strong>
          ${money(packagingFee)}
        </strong>
      </div>

      <!-- GRAND TOTAL -->
      <div class="totals-row grand">
        <span>TOTAL</span>
        <strong>
          ${money(total)}
        </strong>
      </div>

      <div class="rule"></div>

      <p class="footer-note">
        END OF KITCHEN COPY
      </p>

    </section>

  `;

}

// PRINT ORDER
export async function printOrder(order) {

  prepareReceipts(order);

  const logos = [
    ...document.querySelectorAll(
      "#print-area img"
    )
  ];

  // WAIT FOR LOGO
  await Promise.all(
    logos.map(img => {

      if (img.complete) {
        return Promise.resolve();
      }

      return new Promise(resolve => {

        img.addEventListener(
          "load",
          resolve,
          { once: true }
        );

        img.addEventListener(
          "error",
          resolve,
          { once: true }
        );

        setTimeout(resolve, 2000);

      });

    })
  );

  // OPEN THERMAL PRINT DIALOG
  window.print();

}
