
/**
 * CHILLAX CAFE POS
 * COMPLETE BUSINESS CALCULATIONS
 *
 * DISCOUNT FOR ALL MENU ITEMS
 * - Rice Meals
 * - Alacarte
 * - Burgers
 * - Pasta
 * - Fries and Nachos
 * - Shake and Frappe
 * - Coffee
 * - Milktea and Fruit Tea
 * - Party Boxes and Party Trays
 * - Menu Add Ons
 *
 * Discount options: 0%, 10%, 20%
 * Automatic packaging fees are not discounted.
 */

const dayFormatter = new Intl.DateTimeFormat(
  "en-US",
  {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }
);

// PHILIPPINE BUSINESS DATE
export function dayKey(input = new Date()) {
  const date = input instanceof Date
    ? input
    : new Date(input);

  const fields = Object.fromEntries(
    dayFormatter
      .formatToParts(date)
      .map(part => [
        part.type,
        part.value
      ])
  );

  return (
    `${fields.year}-` +
    `${fields.month}-` +
    `${fields.day}`
  );
}

// PESO FORMAT
export const pesos = value =>
  "₱" + Number(value || 0).toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

// ROUND TO TWO DECIMAL PLACES
export const rounded = value =>
  Math.round(
    (Number(value) + Number.EPSILON) * 100
  ) / 100;

// TAKEOUT BOX TOTAL
export const boxTotal = boxes =>
  Number(boxes?.["15"] || 0) * 15 +
  Number(boxes?.["25"] || 0) * 25;

// NORMALIZE CATEGORY
const normalizeCategory = value =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// REGULAR FOOD — AUTOMATIC ₱15 BOX
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

// SHARING / FAMILY — MANUAL BOX ONLY
const LARGE = new Set([
  "sharing",
  "family combos",
  "family",
  "family meals"
]);

// AUTOMATIC TAKEOUT RATE
export function automaticBoxRate(category) {
  const name = normalizeCategory(category);

  // Sharing and Family have no automatic box.
  // They can still select a manual box.
  return REGULAR.has(name) ? 15 : 0;
}

// CHECK IF ITEM USES A MEAL BOX
export function isMealItem(item) {
  return (
    !item?.isAddon &&
    (
      REGULAR.has(
        normalizeCategory(item?.category)
      ) ||
      LARGE.has(
        normalizeCategory(item?.category)
      )
    )
  );
}

// BOX PRICE FOR EACH ITEM
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

// COUNT AUTOMATIC AND MANUAL BOXES
export function boxesForCart(
  cart,
  extraBoxes = {}
) {
  const counts = {
    "15": Number(
      extraBoxes?.["15"] || 0
    ),

    "25": Number(
      extraBoxes?.["25"] || 0
    )
  };

  for (const item of cart || []) {
    const price = lineBoxPrice(item);

    if (price) {
      counts[String(price)] +=
        Number(item.qty || 0);
    }
  }

  return counts;
}

// CALCULATE ADD-ON SALES
export function addonsTotal(order) {
  const menuAddons = (order.items || [])
    .reduce((sum, item) => {

      const addon =
        item.isAddon ||
        /add\s*ons?/i.test(
          item.category || ""
        );

      if (!addon) {
        return sum;
      }

      return sum +
        Number(item.qty || 0) *
        Number(item.unitPrice || 0);

    }, 0);

  const extraAddons = (order.addons || [])
    .reduce((sum, item) => {

      return sum +
        Number(item.qty || 0) *
        Number(item.unitPrice || 0);

    }, 0);

  return rounded(
    menuAddons + extraAddons
  );
}

/**
 * DISCOUNT ELIGIBILITY
 *
 * The function name is kept for compatibility
 * with existing pos.js and admin.js.
 *
 * All menu items are now discountable,
 * including food, drinks and menu add-ons.
 *
 * Order-level packaging charges remain separate.
 */
export function isDiscountableFood(item) {
  return (
    item != null &&
    typeof item === "object"
  );
}

/**
 * DISCOUNT FOR ONE ORDER ITEM
 *
 * Applies to:
 * - Food
 * - Drinks
 * - Shakes
 * - Coffee
 * - Frappes
 * - Party Boxes
 * - Menu Add-ons
 *
 * Rate must be 0, 10, or 20 percent.
 */
export function lineDiscountAmount(line) {
  const rate = Number(
    line?.discountRate || 0
  );

  if (![0, 10, 20].includes(rate)) {
    throw Error(
      "Invalid item discount. " +
      "Choose 0%, 10%, or 20%."
    );
  }

  if (
    rate &&
    !isDiscountableFood(line)
  ) {
    throw Error(
      "Discount requires an order item."
    );
  }

  const quantity = Number(
    line?.qty || 0
  );

  const price = Number(
    line?.unitPrice || 0
  );

  return rounded(
    quantity * price * rate / 100
  );
}

// TOTAL OF ALL SELECTED ITEM DISCOUNTS
export function itemDiscountTotal(items = []) {
  return rounded(
    items.reduce((sum, item) => {
      return sum +
        lineDiscountAmount(item);
    }, 0)
  );
}

/**
 * COMPLETE ORDER TOTAL
 *
 * Subtotal = Products + Extra Add-ons
 *
 * Final Total =
 * Subtotal + Packaging - Item Discounts
 */
export function orderTotal(order) {
  const products = (order.items || [])
    .reduce((sum, item) => {

      return sum +
        Number(item.qty || 0) *
        Number(item.unitPrice || 0);

    }, 0);

  const extras = (order.addons || [])
    .reduce((sum, item) => {

      return sum +
        Number(item.qty || 0) *
        Number(item.unitPrice || 0);

    }, 0);

  const packaging = order.boxes
    ? (
        boxTotal(order.boxes) +
        Number(
          order.legacyPackagingFee || 0
        )
      )
    : Number(
        order.packagingFee || 0
      );

  // Keep historical discounts
  // on previously saved orders.
  const discount =
    order.discountMode === "perItem"
      ? (
          itemDiscountTotal(
            order.items || []
          ) +
          Number(
            order.legacyDiscountAmount || 0
          )
        )
      : Number(
          order.discountAmount || 0
        );

  return rounded(
    products +
    extras +
    packaging -
    discount
  );
}

// TAKEOUT BOX REVENUE
export function orderBoxes(order) {
  return order.boxes
    ? (
        boxTotal(order.boxes) +
        Number(
          order.legacyPackagingFee || 0
        )
      )
    : Number(
        order.packagingFee || 0
      );
}

// FIREBASE TIMESTAMP TO DATE
export function timestampDate(value) {
  if (value?.toDate) {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return new Date(value);
  }

  return null;
}

// ADMIN SALES REPORT
export function countRevenue(orders) {
  return orders.reduce((result, order) => {

    result.sales += Number(
      order.total || 0
    );

    result.boxes += orderBoxes(order);

    result.addons +=
      order.addOnTotal == null
        ? addonsTotal(order)
        : Number(
            order.addOnTotal || 0
          );

    result.orders += 1;

    return result;

  }, {
    sales: 0,
    boxes: 0,
    addons: 0,
    orders: 0
  });
}

/**
 * MANUALLY ADDED TAKEOUT BOXES
 *
 * Keeps automatic boxes separate
 * from manually selected extra boxes.
 */
export function manualBoxesForOrder(order) {
  const remaining = {
    "15": Math.max(
      0,
      Number(
        order.boxes?.["15"] || 0
      )
    ),

    "25": Math.max(
      0,
      Number(
        order.boxes?.["25"] || 0
      )
    )
  };

  for (const item of order.items || []) {
    const saved =
      item.boxUnitPrice == null
        ? lineBoxPrice(item)
        : Number(item.boxUnitPrice);

    if (
      saved === 15 ||
      saved === 25
    ) {
      remaining[String(saved)] =
        Math.max(
          0,
          remaining[String(saved)] -
          Number(item.qty || 0)
        );
    }
  }

  return remaining;
}

/**
 * ADMIN EDIT ORDER
 *
 * Recalculate edited products, quantities,
 * discount percentages, add-ons and boxes.
 *
 * Preserves original order number and date.
 */
export function repriceEditedOrder(
  original,
  changes
) {

  // VALIDATE PRICES
  const validMoney = (value, label) => {
    const amount = Number(value);

    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1000000
    ) {
      throw Error(
        `${label} must be between ` +
        "₱0 and ₱1,000,000."
      );
    }

    return rounded(amount);
  };

  // VALIDATE QUANTITY
  const validQty = (value, label) => {
    const qty = Number(value);

    if (
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > 999
    ) {
      throw Error(
        `${label} quantity must be ` +
        "from 1 to 999."
      );
    }

    return qty;
  };

  // VALIDATE BOX COUNT
  const validBoxes = (value, label) => {
    const qty = Number(value);

    if (
      !Number.isInteger(qty) ||
      qty < 0 ||
      qty > 999
    ) {
      throw Error(
        `${label} box quantity ` +
        "must be from 0 to 999."
      );
    }

    return qty;
  };

  // VALIDATE ORDER ITEMS
  const items = (changes.items || [])
    .map((item, index) => {

      const name = String(
        item.name || ""
      ).trim();

      const category = String(
        item.category || ""
      ).trim();

      if (
        !name ||
        name.length > 120 ||
        !category ||
        category.length > 80
      ) {
        throw Error(
          `Item ${index + 1} needs ` +
          "a name and category."
        );
      }

      const serveType =
        item.serveType === "Take Out"
          ? "Take Out"
          : "Dine In";

      const boxChoice =
        ["auto", "0", "15", "25"].includes(
          String(
            item.boxChoice ?? "auto"
          )
        )
          ? String(
              item.boxChoice ?? "auto"
            )
          : "auto";

      const normalized = {
        ...item,

        name,
        category,

        size: String(
          item.size || ""
        ).trim().slice(0, 40) || null,

        note: String(
          item.note || ""
        ).trim().slice(0, 180),

        qty: validQty(
          item.qty,
          name
        ),

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

        discountRate:
          [0, 10, 20].includes(
            Number(
              item.discountRate || 0
            )
          )
            ? Number(
                item.discountRate || 0
              )
            : 0
      };

      normalized.boxUnitPrice =
        lineBoxPrice(normalized);

      return normalized;

    });

  // VALIDATE EXTRA ADD-ONS
  const addons = (changes.addons || [])
    .map((addon, index) => {

      const name = String(
        addon.name || ""
      ).trim();

      if (
        !name ||
        name.length > 120
      ) {
        throw Error(
          `Add-on ${index + 1} ` +
          "needs a name."
        );
      }

      return {
        ...addon,

        name,

        qty: validQty(
          addon.qty,
          name
        ),

        unitPrice: validMoney(
          addon.unitPrice,
          name
        )
      };

    });

  // MANUAL EXTRA BOXES
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

  // AUTOMATIC + MANUAL BOXES
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
    !["Dine In", "Take Out"].includes(
      orderType
    ) ||
    !["Cash", "GCash"].includes(
      paymentMethod
    )
  ) {
    throw Error(
      "Select a valid order type " +
      "and payment method."
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
    throw Error(
      "An order must contain at least " +
      "one item, add-on or box."
    );
  }

  // COMPLETE UPDATED ORDER
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
      boxTotal(boxes) +
      legacyPackagingFee
    ),

    customerName,
    orderType,
    paymentMethod
  };

  // ADD-ON REVENUE
  payload.addOnTotal =
    addonsTotal(payload);

  // DISCOUNT ON SELECTED ITEMS
  payload.discountAmount = rounded(
    itemDiscountTotal(items) +
    payload.legacyDiscountAmount
  );

  // NEW ORDER TOTAL
  payload.total = rounded(
    items.reduce(
      (sum, item) =>
        sum +
        item.qty * item.unitPrice,
      0
    ) +

    addons.reduce(
      (sum, item) =>
        sum +
        item.qty * item.unitPrice,
      0
    ) +

    payload.packagingFee -
    payload.discountAmount
  );

  return payload;
}
