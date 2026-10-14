/** Three unbranded 58mm copies, plus an admin-only finance report. */
import { pesos, timestampDate } from "./business.js";
const html = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const dateLabel = date => date.toLocaleString("en-PH",{timeZone:"Asia/Manila",year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
const meta = (label,value) => `<div class="meta-row"><span>${html(label)}</span><strong>${html(value)}</strong></div>`;
const cost = (label,value,highlight=false) => `<div class="totals-row${highlight?' grand':''}"><span>${html(label)}</span><strong>${pesos(value)}</strong></div>`;
function renderItems(items) {
  return (items || []).map(item => `<tr><td class="qty">${html(item.qty)}×</td>
    <td class="item-name">${html(item.name)}${item.size?` (${html(item.size)})`:''}
    <div class="item-service">${html(item.serveType || "Dine In")}${item.isAddon ? " · ADD-ON" : ""}${Number(item.boxUnitPrice || 0) ? ` · Box ₱${Number(item.boxUnitPrice)} each` : ""}</div>
    ${item.note?`<div class="item-note">Note: ${html(item.note)}</div>`:""}</td>
    <td class="item-price">${pesos(Number(item.qty || 0)*Number(item.unitPrice||0))}</td></tr>`).join("");
}
function renderExtras(order) {
  const list = (order.addons || []).map(a=>`<div class="totals-row"><span>${html(a.qty)}× ${html(a.name)} (add-on)</span><strong>${pesos(Number(a.qty||0)*Number(a.unitPrice||0))}</strong></div>`).join("");
  const boxes = order.boxes || {};
  const hasCounts = Number(boxes["15"]||0) || Number(boxes["25"]||0);
  const packaging = hasCounts ?
    `${Number(boxes["15"]||0)?cost(`₱15 box × ${boxes["15"]}`,Number(boxes["15"])*15):""}
     ${Number(boxes["25"]||0)?cost(`₱25 box × ${boxes["25"]}`,Number(boxes["25"])*25):""}` :
    (Number(order.packagingFee||0) ? cost("Packaging",order.packagingFee) : "");
  const legacy = Number(order.legacyPackagingFee || 0);
  return list + packaging + (legacy ? cost("Previous packaging",legacy) : "");
}
function orderSection(order, copy) {
  const created = timestampDate(order.createdAt) || timestampDate(order.printedAt) || new Date();
  const update = order.receiptMode === "ADD-ON";
  return `<section class="receipt" aria-label="${html(copy)} receipt">
    <div class="center"><h1>${html(copy)} COPY</h1>${update?'<div class="copy-label">ADD-ON / ADDITIONAL CHARGES</div>':''}</div>
    <div class="rule"></div>
    ${meta("Order #",`#${order.orderNumber ?? "-"}`)}
    ${meta("Date",dateLabel(created))}
    ${meta("Customer",order.customerName || "Walk-in")}
    ${meta("Payment",order.paymentMethod || "Cash")}
    <div class="rule"></div>
    <table class="receipt-items"><tbody>${renderItems(order.items)}</tbody></table>
    ${renderExtras(order)}
    <div class="rule"></div>
    ${cost(update?"NEW CHARGES":"TOTAL",order.total,true)}
    ${update?cost("UPDATED ORDER TOTAL",order.updatedOrderTotal,true):""}
    <div class="footer-note">${copy} COPY · ${update?"ADDITIONAL ITEMS":"ORDER COMPLETE"}</div>
  </section>`;
}
export function prepareReceipts(order, area=document.getElementById("print-area")) {
  if(!area) throw Error("Missing #print-area");
  area.innerHTML = ["ADMIN","KITCHEN","CUSTOMER"].map(copy=>orderSection(order,copy)).join("");
}
export async function printOrder(order) {
  prepareReceipts(order);
  window.print();
}
export async function printFinanceReport(date, expenses, cashEntries) {
  const area = document.getElementById("print-area");
  if(!area) throw Error("Missing #print-area");
  const totalExpense = expenses.reduce((sum,e)=>sum+Number(e.amount||0),0);
  const totalCash = cashEntries.reduce((sum,e)=>sum+Number(e.amount||0),0);
  const rows = (list,type) => list.map(e=>`<div class="finance-print-row"><span>${html(type)}: ${html(e.description)}</span><strong>${pesos(e.amount)}</strong></div>`).join("");
  area.innerHTML = `<section class="receipt"><h1 class="center">ADMIN FINANCE REPORT</h1>
    <div class="rule"></div>${meta("Date (PH)",date)}<div class="rule"></div>
    <div class="copy-label">CASH ON HAND</div>${rows(cashEntries,"Cash")||"No entries"}
    ${cost("Cash total",totalCash,true)}<div class="rule"></div>
    <div class="copy-label">EXPENSES</div>${rows(expenses,"Expense")||"No entries"}
    ${cost("Expense total",totalExpense,true)}<div class="rule"></div>
    ${cost("Cash less expenses",totalCash-totalExpense,true)}
    <div class="footer-note">ADMIN ONLY · ${html(date)}</div></section>`;
  window.print();
}
