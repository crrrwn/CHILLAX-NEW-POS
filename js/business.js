
/**
 * CHILLAX CAFE POS
 * COMPLETE BUSINESS CALCULATIONS
 *
 * Regular food Take Out: P15
 * Sharing Take Out: P25
 * Family Combos: manual box
 * All menu items: 0%, 10%, 20% discount
 */

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function dayKey(input = new Date()) {
  const date = input instanceof Date
    ? input
    : new Date(input);

  const parts = Object.fromEntries(
    dayFormatter.formatToParts(date)
      .map(part => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const pesos = value =>
  "₱" + Number(value || 0).toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

export const rounded = value =>
  Math.round(
    (Number(value) + Number.EPSILON) * 100
  ) / 100;

export const boxTotal = boxes =>
  Number(boxes?.["15"] || 0) * 15 +
  Number(boxes?.["25"] || 0) * 25;

const normalizeCategory = value =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const REGULAR = new Set([
  "rice meals",
  "flavored chicken",
  "alacarte",
  "a la carte",
  "burger",
  "pasta",
  "fries and nachos",
  "fries nachos",
  "all day breakfast",
  "samyang and ramen",
  "salad"
]);

const LARGE = new Set([
  "sharing",
  "for sharing",
  "family combos",
  "family",
  "family meals"
]);

/*
 * SHARING = P25 AUTOMATIC
 * FAMILY = MANUAL ONLY
 */
export function automaticBoxRate(category) {
  const name = normalizeCategory(category);

  if (name === "sharing" || name === "for sharing") {
    return 25;
  }

  return REGULAR.has(name) ? 15 : 0;
}

export function isMealItem(item) {
  const name = normalizeCategory(item?.category);

  return (
    !item?.isAddon &&
    (
      REGULAR.has(name) ||
      LARGE.has(name)
    )
  );
}

export function lineBoxPrice(item) {
  if (!isMealItem(item)) {
    return 0;
  }

  if (
    item.boxChoice == null ||
    item.boxChoice === "auto"
  ) {
    return item.serveType === "Take Out"
      ? automaticBoxRate(item.category)
      : 0;
  }

  const price = Number(item.boxChoice);

  return [0, 15, 25].includes(price)
    ? price
    : 0;
}

export function boxesForCart(
  cart,
  extraBoxes = {}
) {
  const counts = {
    "15": Number(extraBoxes?.["15"] || 0),
    "25": Number(extraBoxes?.["25"] || 0)
  };

  for (const item of cart || []) {
    const price = lineBoxPrice(item);

    if (price) {
      counts[String(price)] += Number(item.qty || 0);
    }
  }

  return counts;
}

/* ADD-ON REVENUE */
export function addonsTotal(order) {
  const menuAddons = (order.items || []).reduce(
    (sum, item) => {
      const isAddon =
        item.isAddon ||
        /add\s*ons?/i.test(item.category || "");

      return sum + (
        isAddon
          ? Number(item.qty || 0) *
            Number(item.unitPrice || 0)
          : 0
      );
    },
    0
  );

  const extraAddons = (order.addons || []).reduce(
    (sum, item) =>
      sum +
      Number(item.qty || 0) *
      Number(item.unitPrice || 0),
    0
  );

  return rounded(menuAddons + extraAddons);
}

/* ALL MENU ITEMS ARE DISCOUNTABLE */
export function isDiscountableFood(item) {
  return item != null &&
    typeof item === "object";
}

export function lineDiscountAmount(line) {
  const rate = Number(line?.discountRate || 0);

  if (![0, 10, 20].includes(rate)) {
    throw Error(
      "Invalid discount: choose 0%, 10%, or 20%."
    );
  }

  if (rate && !isDiscountableFood(line)) {
    throw Error("Discount requires an order item.");
  }

  return rounded(
    Number(line.qty || 0) *
    Number(line.unitPrice || 0) *
    rate / 100
  );
}

export function itemDiscountTotal(items = []) {
  return rounded(
    items.reduce(
      (sum, item) =>
        sum + lineDiscountAmount(item),
      0
    )
  );
}

/* TOTAL AFTER ITEM DISCOUNTS */
export function orderTotal(order) {
  const items = (order.items || []).reduce(
    (sum, item) =>
      sum +
      Number(item.qty || 0) *
      Number(item.unitPrice || 0),
    0
  );

  const extras = (order.addons || []).reduce(
    (sum, item) =>
      sum +
      Number(item.qty || 0) *
      Number(item.unitPrice || 0),
    0
  );

  const packaging = order.boxes
    ? boxTotal(order.boxes) +
      Number(order.legacyPackagingFee || 0)
    : Number(order.packagingFee || 0);

  const discount =
    order.discountMode === "perItem"
      ? itemDiscountTotal(order.items || []) +
        Number(order.legacyDiscountAmount || 0)
      : Number(order.discountAmount || 0);

  return rounded(
    items + extras + packaging - discount
  );
}

export function orderBoxes(order) {
  return order.boxes
    ? boxTotal(order.boxes) +
      Number(order.legacyPackagingFee || 0)
    : Number(order.packagingFee || 0);
}

export function timestampDate(value) {
  if (value?.toDate) return value.toDate();

  if (value instanceof Date) return value;

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return new Date(value);
  }

  return null;
}

/* ADMIN SALES SUMMARY */
export function countRevenue(orders) {
  return orders.reduce(
    (result, order) => {
      result.sales += Number(order.total || 0);
      result.boxes += orderBoxes(order);

      result.addons +=
        order.addOnTotal == null
          ? addonsTotal(order)
          : Number(order.addOnTotal || 0);

      result.orders++;
      return result;
    },
    {
      sales: 0,
      boxes: 0,
      addons: 0,
      orders: 0
    }
  );
}

/* PRESERVE MANUAL BOXES IN ADMIN EDITOR */
export function manualBoxesForOrder(order) {
  const remaining = {
    "15": Math.max(
      0,
      Number(order.boxes?.["15"] || 0)
    ),
    "25": Math.max(
      0,
      Number(order.boxes?.["25"] || 0)
    )
  };

  for (const item of order.items || []) {
    const saved = item.boxUnitPrice == null
      ? lineBoxPrice(item)
      : Number(item.boxUnitPrice);

    if (saved === 15 || saved === 25) {
      remaining[String(saved)] = Math.max(
        0,
        remaining[String(saved)] -
        Number(item.qty || 0)
      );
    }
  }

  return remaining;
}

/* FULL ADMIN ORDER RECALCULATION */
export function repriceEditedOrder(
  original,
  changes
) {
  const validMoney = (value, label) => {
    const amount = Number(value);

    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1000000
    ) {
      throw Error(
        `${label} must be between ₱0 and ₱1,000,000.`
      );
    }

    return rounded(amount);
  };

  const validQty = (value, label) => {
    const qty = Number(value);

    if (
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > 999
    ) {
      throw Error(
        `${label} quantity must be from 1 to 999.`
      );
    }

    return qty;
  };

  const validBoxes = (value, label) => {
    const qty = Number(value);

    if (
      !Number.isInteger(qty) ||
      qty < 0 ||
      qty > 999
    ) {
      throw Error(
        `${label} box quantity must be from 0 to 999.`
      );
    }

    return qty;
  };

  const items = (changes.items || []).map(
    (item, index) => {
      const name = String(item.name || "").trim();
      const category = String(item.category || "").trim();

      if (
        !name ||
        name.length > 120 ||
        !category ||
        category.length > 80
      ) {
        throw Error(
          `Item ${index + 1} requires name and category.`
        );
      }

      const serveType =
        item.serveType === "Take Out"
          ? "Take Out"
          : "Dine In";

      const boxChoice =
        ["auto", "0", "15", "25"].includes(
          String(item.boxChoice ?? "auto")
        )
          ? String(item.boxChoice ?? "auto")
          : "auto";

      const normalized = {
        ...item,
        name,
        category,

        size: String(item.size || "")
          .trim()
          .slice(0, 40) || null,

        note: String(item.note || "")
          .trim()
          .slice(0, 180),

        qty: validQty(item.qty, name),

        unitPrice: validMoney(
          item.unitPrice,
          name
        ),

        serveType,
        boxChoice,

        isAddon: Boolean(
          item.isAddon ||
          /add\s*ons?/i.test(category)
        ),

        discountRate: [0, 10, 20].includes(
          Number(item.discountRate || 0)
        )
          ? Number(item.discountRate || 0)
          : 0
      };

      normalized.boxUnitPrice =
        lineBoxPrice(normalized);

      return normalized;
    }
  );

  const addons = (changes.addons || []).map(
    (addon, index) => {
      const name = String(addon.name || "").trim();

      if (!name || name.length > 120) {
        throw Error(
          `Add-on ${index + 1} requires a name.`
        );
      }

      return {
        ...addon,
        name,
        qty: validQty(addon.qty, name),
        unitPrice: validMoney(addon.unitPrice, name)
      };
    }
  );

  const manuallyPunched = {
    "15": validBoxes(
      changes.manualBoxes?.["15"] ?? 0,
      "₱15"
    ),
    "25": validBoxes(
      changes.manualBoxes?.["25"] ?? 0,
      "₱25"
    )
  };

  const boxes = boxesForCart(
    items,
    manuallyPunched
  );

  const legacyPackagingFee = validMoney(
    original.legacyPackagingFee ??
    (
      original.boxes
        ? 0
        : original.packagingFee || 0
    ),
    "Previous packaging"
  );

  const orderType =
    ["Dine In", "Take Out"].includes(
      changes.orderType
    )
      ? changes.orderType
      : original.orderType;

  const paymentMethod =
    ["Cash", "GCash"].includes(
      changes.paymentMethod
    )
      ? changes.paymentMethod
      : original.paymentMethod;

  if (
    !["Dine In", "Take Out"].includes(orderType) ||
    !["Cash", "GCash"].includes(paymentMethod)
  ) {
    throw Error(
      "Select a valid order type and payment method."
    );
  }

  const customerName = String(
    changes.customerName || ""
  ).trim().slice(0, 100);

  if (
    !items.length &&
    !addons.length &&
    !boxes["15"] &&
    !boxes["25"]
  ) {
    throw Error("Order cannot be empty.");
  }

  const payload = {
    items,
    addons,
    boxes,
    legacyPackagingFee,

    discountMode: "perItem",
    discountRate: 0,

    legacyDiscountAmount: Number(
      original.legacyDiscountAmount ||
      (
        original.discountMode !== "perItem"
          ? original.discountAmount || 0
          : 0
      )
    ),

    packagingFee: rounded(
      boxTotal(boxes) + legacyPackagingFee
    ),

    customerName,
    orderType,
    paymentMethod
  };

  payload.addOnTotal = addonsTotal(payload);

  payload.discountAmount = rounded(
    itemDiscountTotal(items) +
    payload.legacyDiscountAmount
  );

  payload.total = rounded(
    items.reduce(
      (sum, item) =>
        sum + item.qty * item.unitPrice,
      0
    ) +
    addons.reduce(
      (sum, item) =>
        sum + item.qty * item.unitPrice,
      0
    ) +
    payload.packagingFee -
    payload.discountAmount
  );

  return payload;
}
