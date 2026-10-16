
/**
 * CHILLAX POS — Business Calculations
 * Philippine business day and 58mm POS calculations
 */

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function dayKey(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const fields = Object.fromEntries(
    dayFormatter.formatToParts(date).map(x => [x.type, x.value])
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export const pesos = value =>
  "₱" + Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

export const rounded = value =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const boxTotal = boxes =>
  Number(boxes?.["15"] || 0) * 15 +
  Number(boxes?.["25"] || 0) * 25;

/* DISCOUNTS */
export function discountDetails(subtotal, percent = 0) {
  const rate = Number(percent);

  if (![0, 10, 20].includes(rate)) {
    throw Error("Discount must be 0%, 10%, or 20%.");
  }

  const eligible = rounded(subtotal);

  if (!Number.isFinite(eligible) || eligible < 0) {
    throw Error("Invalid discount base.");
  }

  return {
    discountRate: rate,
    discountAmount: rounded(eligible * rate / 100)
  };
}

/* TAKEOUT BOX CATEGORIES */
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
  "family combos",
  "family",
  "family meals"
]);

/*
 * IMPORTANT:
 * Sharing and Family no longer have automatic boxes.
 * They can still use manually selected boxes.
 */
export function automaticBoxRate(category) {
  const categoryName = normalizeCategory(category);

  return REGULAR.has(categoryName) ? 15 : 0;
}

export function isMealItem(item) {
  const categoryName = normalizeCategory(item?.category);

  return !item?.isAddon && (
    REGULAR.has(categoryName) ||
    LARGE.has(categoryName)
  );
}

export function lineBoxPrice(item) {
  if (!isMealItem(item)) return 0;

  if (
    item.boxChoice == null ||
    item.boxChoice === "auto"
  ) {
    return item.serveType === "Take Out"
      ? automaticBoxRate(item.category)
      : 0;
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

    if (price) {
      counts[String(price)] += Number(item.qty || 0);
    }
  }

  return counts;
}

/* ADD-ON CALCULATION */
export function addonsTotal(order) {
  const itemAddons = (order.items || []).reduce(
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

  return rounded(itemAddons + extraAddons);
}

/* COMPLETE ORDER TOTAL WITH DISCOUNT */
export function orderTotal(order) {
  const products = (order.items || []).reduce(
    (sum, item) =>
      sum +
      Number(item.qty || 0) *
      Number(item.unitPrice || 0),
    0
  );

  const addons = (order.addons || []).reduce(
    (sum, item) =>
      sum +
      Number(item.qty || 0) *
      Number(item.unitPrice || 0),
    0
  );

  const eligible = rounded(products + addons);

  const discount = discountDetails(
    eligible,
    order.discountRate ?? 0
  ).discountAmount;

  const packaging = order.boxes
    ? boxTotal(order.boxes)
    : Number(order.packagingFee || 0);

  return rounded(eligible + packaging - discount);
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

/* ADMIN SALES REPORT */
export function countRevenue(orders) {
  return orders.reduce((result, order) => {
    result.sales += Number(order.total || 0);
    result.boxes += orderBoxes(order);

    result.addons += order.addOnTotal == null
      ? addonsTotal(order)
      : Number(order.addOnTotal || 0);

    result.orders += 1;
    return result;
  }, {
    sales: 0,
    boxes: 0,
    addons: 0,
    orders: 0
  });
}

/* PRESERVE MANUALLY ADDED BOXES */
export function manualBoxesForOrder(order) {
  const remaining = {
    "15": Math.max(0, Number(order.boxes?.["15"] || 0)),
    "25": Math.max(0, Number(order.boxes?.["25"] || 0))
  };

  for (const item of order.items || []) {
    const saved = item.boxUnitPrice == null
      ? lineBoxPrice(item)
      : Number(item.boxUnitPrice);

    if (saved === 15 || saved === 25) {
      remaining[String(saved)] = Math.max(
        0,
        remaining[String(saved)] - Number(item.qty || 0)
      );
    }
  }

  return remaining;
}

/* ADMIN ORDER EDIT — FULL REPRICING */
export function repriceEditedOrder(original, changes) {
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

  const items = (changes.items || []).map((item, index) => {
    const name = String(item.name || "").trim();
    const category = String(item.category || "").trim();

    if (
      !name ||
      name.length > 120 ||
      !category ||
      category.length > 80
    ) {
      throw Error(
        `Item ${index + 1} needs a name and category.`
      );
    }

    const serveType = item.serveType === "Take Out"
      ? "Take Out"
      : "Dine In";

    const boxChoice = ["auto", "0", "15", "25"].includes(
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
      unitPrice: validMoney(item.unitPrice, name),

      serveType,
      boxChoice,

      isAddon: Boolean(
        item.isAddon ||
        /add\s*ons?/i.test(category)
      )
    };

    normalized.boxUnitPrice = lineBoxPrice(normalized);
    return normalized;
  });

  const addons = (changes.addons || []).map(
    (addon, index) => {
      const name = String(addon.name || "").trim();

      if (!name || name.length > 120) {
        throw Error(
          `Add-on ${index + 1} needs a name.`
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

  const boxes = boxesForCart(items, manuallyPunched);

  const legacyPackagingFee = validMoney(
    original.legacyPackagingFee ??
    (
      original.boxes
        ? 0
        : original.packagingFee || 0
    ),
    "Previous packaging"
  );

  const orderType = [
    "Dine In",
    "Take Out"
  ].includes(changes.orderType)
    ? changes.orderType
    : original.orderType;

  const paymentMethod = [
    "Cash",
    "GCash"
  ].includes(changes.paymentMethod)
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

  const adminDiscountField =
    typeof document !== "undefined"
      ? document.getElementById("edit-discount-rate")
      : null;

  const selectedRate =
    changes.discountRate ??
    adminDiscountField?.value ??
    original.discountRate ??
    0;

  const productSubtotal = items.reduce(
    (sum, item) =>
      sum + item.qty * item.unitPrice,
    0
  );

  const addonSubtotal = addons.reduce(
    (sum, item) =>
      sum + item.qty * item.unitPrice,
    0
  );

  const discount = discountDetails(
    productSubtotal + addonSubtotal,
    selectedRate
  );

  const payload = {
    items,
    addons,
    boxes,
    ...discount,

    legacyPackagingFee,

    packagingFee: rounded(
      boxTotal(boxes) + legacyPackagingFee
    ),

    customerName,
    orderType,
    paymentMethod
  };

  payload.addOnTotal = addonsTotal(payload);

  payload.total = rounded(
    productSubtotal +
    addonSubtotal +
    payload.packagingFee -
    payload.discountAmount
  );

  return payload;
}

/*
 * Load the Admin discount selector automatically
 * without changing existing admin.html or admin.js.
 */
if (
  typeof document !== "undefined" &&
  /\/admin\.html$/i.test(location.pathname)
) {
  import("./admin-discount-ui.js").catch(error => {
    console.error(
      "Admin discount selector could not load:",
      error
    );
  });
}
