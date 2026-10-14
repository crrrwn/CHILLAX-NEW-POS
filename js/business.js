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
