/** Pure POS calculations. Business day is midnight to midnight Asia/Manila. */
const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"
});
export function dayKey(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  const fields = Object.fromEntries(dayFormatter.formatToParts(d).map(x => [x.type, x.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
export const pesos = value => "₱" + Number(value || 0).toLocaleString("en-PH", {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const rounded = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const boxTotal = boxes => Number(boxes?.["15"] || 0) * 15 + Number(boxes?.["25"] || 0) * 25;

// Only meal categories receive an automatic ₱15 box when served Take Out.
// Edit the categories here if your cafe adds new meal categories.
const MEAL_CATEGORIES = new Set([
  "rice meals", "flavored chicken", "alacarte", "burger", "pasta",
  "all day breakfast", "samyang & ramen", "sharing", "family combos", "salad"
]);
export function isMealItem(item) {
  return !item?.isAddon && MEAL_CATEGORIES.has(String(item?.category || "").trim().toLowerCase());
}
export function lineBoxPrice(item) {
  if (!isMealItem(item)) return 0;
  // Auto = ₱15 per Take Out meal, free for Dine In.
  if (item.boxChoice == null || item.boxChoice === "auto") {
    return item.serveType === "Take Out" ? 15 : 0;
  }
  const price = Number(item.boxChoice);
  return [0, 15, 25].includes(price) ? price : 0;
}
export function boxesForCart(cart, extraBoxes = {}) {
  const counts = {
    "15": Number(extraBoxes?.["15"] || 0),
    "25": Number(extraBoxes?.["25"] || 0)
  };
  for (const item of cart || []) {
    const price = lineBoxPrice(item);
    if (price) counts[String(price)] += Number(item.qty || 0);
  }
  return counts;
}

export function addonsTotal(order) {
  return rounded((order.items || []).reduce((sum, x) => sum + ((x.isAddon || /^add\s*ons?$/i.test(x.category || "")) ? Number(x.qty || 0) * Number(x.unitPrice || 0) : 0), 0)
    + (order.addons || []).reduce((sum, x) => sum + Number(x.qty || 0) * Number(x.unitPrice || 0), 0));
}
export function orderTotal(order) {
  return rounded((order.items || []).reduce((sum, x) => sum + Number(x.qty || 0) * Number(x.unitPrice || 0), 0)
    + (order.addons || []).reduce((sum, x) => sum + Number(x.qty || 0) * Number(x.unitPrice || 0), 0)
    + (order.boxes ? boxTotal(order.boxes) : Number(order.packagingFee || 0)));
}
export function orderBoxes(order) {
  return order.boxes ? boxTotal(order.boxes) + Number(order.legacyPackagingFee || 0) : Number(order.packagingFee || 0);
}
export function timestampDate(value) {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return null;
}
export function countRevenue(orders) {
  return orders.reduce((s, order) => {
    s.sales += Number(order.total || 0);
    s.boxes += orderBoxes(order);
    s.addons += order.addOnTotal == null ? addonsTotal(order) : Number(order.addOnTotal || 0);
    s.orders += 1;
    return s;
  }, {sales:0, boxes:0, addons:0, orders:0});
}

/** Calculate manually punched boxes from a saved order without duplicating the
 * per-meal automatic boxes when the admin edits quantities or service types. */
export function manualBoxesForOrder(order) {
  const automatic = boxesForCart(order.items || []);
  return {
    "15": Math.max(0, Number(order.boxes?.["15"] || 0) - automatic["15"]),
    "25": Math.max(0, Number(order.boxes?.["25"] || 0) - automatic["25"])
  };
}

/** Recompute an existing order after an authorized admin edits line items.
 * Keeps the original order number, creation date and financial history date.
 * Does not mutate the input document or silently change the catalog prices. */
export function repriceEditedOrder(original, changes) {
  const validMoney = (value, label) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000)
      throw Error(`${label} must be between ₱0 and ₱1,000,000.`);
    return rounded(amount);
  };
  const validQty = (value, label) => {
    const qty = Number(value);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999)
      throw Error(`${label} quantity must be a whole number from 1 to 999.`);
    return qty;
  };
  const validBoxes = (value, label) => {
    const qty = Number(value);
    if (!Number.isInteger(qty) || qty < 0 || qty > 999)
      throw Error(`${label} box quantity must be from 0 to 999.`);
    return qty;
  };
  const items = (changes.items || []).map((item, i) => {
    const name = String(item.name || "").trim();
    const category = String(item.category || "").trim();
    if (!name || name.length > 120 || !category || category.length > 80)
      throw Error(`Item ${i + 1} needs a name and category.`);
    const serveType = item.serveType === "Take Out" ? "Take Out" : "Dine In";
    const boxChoice = ["auto", "0", "15", "25"].includes(String(item.boxChoice ?? "auto"))
      ? String(item.boxChoice ?? "auto") : "auto";
    const normalized = {
      ...item, name, category,
      size: String(item.size || "").trim().slice(0, 40) || null,
      note: String(item.note || "").trim().slice(0, 180),
      qty: validQty(item.qty, name), unitPrice: validMoney(item.unitPrice, name),
      serveType, boxChoice,
      isAddon: Boolean(item.isAddon || /^add\s*ons?$/i.test(category))
    };
    normalized.boxUnitPrice = lineBoxPrice(normalized);
    return normalized;
  });
  const addons = (changes.addons || []).map((addon, i) => {
    const name = String(addon.name || "").trim();
    if (!name || name.length > 120) throw Error(`Add-on ${i + 1} needs a name.`);
    return { ...addon, name, qty: validQty(addon.qty, name), unitPrice: validMoney(addon.unitPrice, name) };
  });
  const manuallyPunched = {
    "15": validBoxes(changes.manualBoxes?.["15"] ?? 0, "₱15"),
    "25": validBoxes(changes.manualBoxes?.["25"] ?? 0, "₱25")
  };
  const boxes = boxesForCart(items, manuallyPunched);
  const legacyPackagingFee = validMoney(original.legacyPackagingFee ??
    (original.boxes ? 0 : original.packagingFee || 0), "Previous packaging");
  const orderType = ["Dine In", "Take Out"].includes(changes.orderType) ? changes.orderType : original.orderType;
  const paymentMethod = ["Cash", "GCash"].includes(changes.paymentMethod) ? changes.paymentMethod : original.paymentMethod;
  if (!["Dine In", "Take Out"].includes(orderType) || !["Cash", "GCash"].includes(paymentMethod))
    throw Error("Select a valid order type and payment method.");
  const customerName = String(changes.customerName || "").trim().slice(0, 100);
  if (!items.length && !addons.length && !boxes["15"] && !boxes["25"])
    throw Error("An order must contain at least one item, add-on or box.");
  const payload = {
    items, addons, boxes, legacyPackagingFee,
    packagingFee: rounded(boxTotal(boxes) + legacyPackagingFee),
    customerName, orderType, paymentMethod
  };
  payload.addOnTotal = addonsTotal(payload);
  payload.total = rounded(items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0)
    + addons.reduce((sum, it) => sum + it.qty * it.unitPrice, 0)
    + payload.packagingFee);
  return payload;
}
