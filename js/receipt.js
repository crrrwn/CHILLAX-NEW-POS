/** Shared printable receipts for the cashier and admin reprint view. */
const html = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const money = value => "PHP " + Number(value || 0).toLocaleString("en-PH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function prepareReceipts(order, printArea = document.getElementById("print-area")) {
  if (!printArea) throw new Error("Receipt print area is missing.");
  const items = Array.isArray(order.items) ? order.items : [];
  const date = order.createdAt?.toDate?.() || (order.printedAt ? new Date(order.printedAt) : new Date());
  const dateText = date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
  const lineItems = items.map(item => `
    <tr><td class="qty">${html(item.qty)}x</td>
      <td class="item-name">${html(item.name)}${item.size ? ` (${html(item.size)})` : ""}
        ${item.note ? `<div class="item-note">Note: ${html(item.note)}</div>` : ""}</td>
      <td class="item-price">${money(Number(item.unitPrice || 0) * Number(item.qty || 0))}</td></tr>`).join("");
  const kitchenItems = items.map(item => `
    <tr><td class="qty">${html(item.qty)}x</td><td class="item-name" colspan="2">
    ${html(item.name)}${item.size ? ` (${html(item.size)})` : ""}
    ${item.note ? `<div class="item-note">Note: ${html(item.note)}</div>` : ""}</td></tr>`).join("");
  const meta = (label, value) => `<div class="meta-row"><span>${html(label)}</span><strong>${html(value)}</strong></div>`;
  printArea.innerHTML = `
    <section class="receipt" aria-label="Cashier receipt">
      <div class="center"><img class="logo-print" src="assets/logo.jpg" alt="" />
      <h1>CHILLAX CAFE</h1><p class="sub">Sto. Nino, Calapan, Oriental Mindoro</p>
      <p class="sub">0977 702 3674</p></div>
      <div class="rule"></div><div class="copy-label">CASHIER / CUSTOMER COPY</div>
      ${meta("ORDER #", order.orderNumber ?? "-")}${meta("Date", dateText)}
      ${meta("Type", order.orderType || "Dine In")}
      ${meta("Customer", order.customerName || "Walk-in")}
      ${meta("Payment", order.paymentMethod || "Cash")}
      <div class="rule"></div><table class="receipt-items"><tbody>${lineItems}</tbody></table>
      <div class="rule"></div>
      <div class="totals-row"><span>Packaging</span><strong>${money(order.packagingFee)}</strong></div>
      <div class="totals-row grand"><span>TOTAL</span><strong>${money(order.total)}</strong></div>
      <p class="footer-note">Thank you for visiting Chillax!</p>
    </section>
    <section class="receipt receipt-kitchen" aria-label="Kitchen copy">
      <h1 class="center">KITCHEN COPY</h1><div class="rule"></div>
      ${meta("ORDER #", order.orderNumber ?? "-")}${meta("Time", dateText)}
      ${meta("Type", order.orderType || "Dine In")}${meta("Customer", order.customerName || "Walk-in")}
      <div class="rule"></div><table class="receipt-items"><tbody>${kitchenItems}</tbody></table>
      <div class="rule"></div><p class="footer-note">END OF KITCHEN COPY</p>
    </section>`;
}

export async function printOrder(order) {
  prepareReceipts(order);
  // Give the logo time to load before opening the native printer dialog.
  const logos = [...document.querySelectorAll("#print-area img")];
  await Promise.all(logos.map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 2000);
    });
  }));
  window.print();
}
