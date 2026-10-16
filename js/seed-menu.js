
/**
 * CHILLAX CAFE POS
 * COMPLETE SEED MENU
 *
 * Separate categories:
 * 1. Add Ons
 * 2. Samyang & Ramen Add Ons
 *
 * Existing products and prices are preserved
 * in this seed catalog.
 */

export const SEED_CATEGORIES = [
  "Rice Meals",
  "Flavored Chicken",
  "Alacarte",
  "Burger",
  "Pasta",
  "Fries & Nachos",
  "Iced Coffee (16oz)",
  "Hot Coffee (12oz)",
  "Milktea",
  "Fruit Tea",
  "Shake",
  "Frappé",
  "All Day Breakfast",
  "Sharing",
  "Family Combos",
  "Samyang & Ramen",
  "Samyang & Ramen Add Ons",
  "Salad",
  "Add Ons",
  "Party Box on the Go",
  "Party Trays — Noodles & Pastas",
  "Party Trays — Meat & Vegetables",
  "Party Trays — Chicken & Seafood",
  "Party Trays — Desserts"
];

// ADDITIONAL MENU PRODUCTS
export const EXTRA_MENU = [

  // FRIES & NACHOS
  {
    category: "Fries & Nachos",
    name: "Cheese Fries",
    price: 109
  },
  {
    category: "Fries & Nachos",
    name: "Sour & Cream Fries",
    price: 109
  },
  {
    category: "Fries & Nachos",
    name: "BBQ Fries",
    price: 109
  },
  {
    category: "Fries & Nachos",
    name: "Plain Fries",
    price: 99
  },

  // SAMYANG COMBINATIONS
  {
    category: "Samyang & Ramen",
    name: "Cheesy Samyang Carbonara W/ Egg",
    price: 169
  },
  {
    category: "Samyang & Ramen",
    name: "Cheesy Samyang Carbonara W/ Hungarian",
    price: 189
  },
  {
    category: "Samyang & Ramen",
    name: "Cheesy Samyang Carbonara W/ Spam",
    price: 179
  },

  // SAMYANG & RAMEN ADD ONS
  {
    category: "Samyang & Ramen Add Ons",
    name: "Egg",
    price: 15,
    isAddon: true
  },
  {
    category: "Samyang & Ramen Add Ons",
    name: "Spam",
    price: 20,
    isAddon: true
  },
  {
    category: "Samyang & Ramen Add Ons",
    name: "Hungarian",
    price: 49,
    isAddon: true
  },
  {
    category: "Samyang & Ramen Add Ons",
    name: "Nori Seaweed",
    price: 25,
    isAddon: true
  },
  {
    category: "Samyang & Ramen Add Ons",
    name: "Dumplings (3pcs)",
    price: 45,
    isAddon: true
  },
  {
    category: "Samyang & Ramen Add Ons",
    name: "Extra Cheese",
    price: 30,
    isAddon: true
  },

  // PARTY BOX SET A
  {
    category: "Party Box on the Go",
    name: "Party Box Set A",
    price: 2200,
    description:
      "Good for 15 pax. FREE 1.5L Coke. " +
      "Write the customer's chosen dishes before adding.",
    comboOptions: [
      "Pansit Canton",
      "Spaghetti",
      "Pansit Bihon",
      "Baked Mac",
      "Lumpia (30 pcs)",
      "Classic Chicken (15 pcs)"
    ]
  },

  // PARTY BOX SET B
  {
    category: "Party Box on the Go",
    name: "Party Box Set B",
    price: 2600,
    description:
      "Good for 15 pax. FREE 1.5L Coke + 1 tub Graham. " +
      "Write the customer's chosen dishes before adding.",
    comboOptions: [
      "Carbonara",
      "Seafood Pasta",
      "Cordon Bleu",
      "Buffalo Wings",
      "Buttered Shrimp",
      "Fish Fillet"
    ]
  },

  // PARTY TRAYS - NOODLES & PASTAS
  {
    category: "Party Trays — Noodles & Pastas",
    name: "Sotanghon Canton",
    price: 1350,
    variants: [
      { label: "Large", price: 1350 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Noodles & Pastas",
    name: "Cheesy Lasagna with Mix Veggies",
    price: 1399,
    variants: [
      { label: "Large", price: 1399 },
      { label: "XL", price: 1799 }
    ]
  },
  {
    category: "Party Trays — Noodles & Pastas",
    name: "Creamy Carbonara",
    price: 699,
    variants: [
      { label: "Small", price: 699 },
      { label: "Medium", price: 999 },
      { label: "Large", price: 1399 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Noodles & Pastas",
    name: "Pansit Bihon",
    price: 1100,
    variants: [
      { label: "Large", price: 1100 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Noodles & Pastas",
    name: "Cheesy Spaghetti",
    price: 699,
    variants: [
      { label: "Small", price: 699 },
      { label: "Medium", price: 999 },
      { label: "Large", price: 1399 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Noodles & Pastas",
    name: "Seafood Pasta",
    price: 799,
    variants: [
      { label: "Small", price: 799 },
      { label: "Medium", price: 999 },
      { label: "Large", price: 1399 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Noodles & Pastas",
    name: "Baked Mac",
    price: 699,
    variants: [
      { label: "Small", price: 699 },
      { label: "Medium", price: 999 },
      { label: "Large", price: 1399 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Noodles & Pastas",
    name: "Palabok Special",
    price: 1350,
    variants: [
      { label: "Large", price: 1350 },
      { label: "XL", price: 1699 }
    ]
  },

  // PARTY TRAYS - MEAT & VEGETABLES
  {
    category: "Party Trays — Meat & Vegetables",
    name: "Pork Caldereta",
    price: 1499,
    variants: [
      { label: "Large", price: 1499 },
      { label: "XL", price: 1999 }
    ]
  },
  {
    category: "Party Trays — Meat & Vegetables",
    name: "Menudo",
    price: 1599,
    variants: [
      { label: "Large", price: 1599 },
      { label: "XL", price: 1999 }
    ]
  },
  {
    category: "Party Trays — Meat & Vegetables",
    name: "Creamy Beef Broccoli",
    price: 1699,
    variants: [
      { label: "Large", price: 1699 },
      { label: "XL", price: 1899 }
    ]
  },
  {
    category: "Party Trays — Meat & Vegetables",
    name: "Chopsuey",
    price: 1300,
    variants: [
      { label: "Large", price: 1300 },
      { label: "XL", price: 1599 }
    ]
  },
  {
    category: "Party Trays — Meat & Vegetables",
    name: "Lumpiang Shanghai",
    price: 950,
    variants: [
      { label: "Medium", price: 950 },
      { label: "Large", price: 1200 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Meat & Vegetables",
    name: "Cordon Bleu",
    price: 899,
    variants: [
      { label: "Medium", price: 899 },
      { label: "Large", price: 1699 },
      { label: "XL", price: 2099 }
    ]
  },

  // PARTY TRAYS - CHICKEN & SEAFOOD
  {
    category: "Party Trays — Chicken & Seafood",
    name: "Assorted Chicken",
    price: 899,
    variants: [
      { label: "24 pcs", price: 899 },
      { label: "40 pcs", price: 1399 },
      { label: "60 pcs", price: 1599 }
    ]
  },
  {
    category: "Party Trays — Chicken & Seafood",
    name: "Fried Chicken",
    price: 999,
    variants: [
      { label: "Medium", price: 999 },
      { label: "Large", price: 1399 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Chicken & Seafood",
    name: "Fish Fillet",
    price: 999,
    variants: [
      { label: "Medium", price: 999 },
      { label: "Large", price: 1399 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Chicken & Seafood",
    name: "Buttered Shrimp",
    price: 1399,
    variants: [
      { label: "Large", price: 1399 },
      { label: "XL", price: 1699 }
    ]
  },
  {
    category: "Party Trays — Chicken & Seafood",
    name: "Mixed Seafoods",
    price: 2200,
    variants: [
      { label: "Large", price: 2200 },
      { label: "XL", price: 2699 }
    ]
  },

  // PARTY TRAYS - DESSERTS
  {
    category: "Party Trays — Desserts",
    name: "Puto Cheese Special",
    price: 1000,
    variants: [
      { label: "100 pcs", price: 1000 }
    ]
  }

];

// COMPLETE MAIN MENU
export const SEED_MENU = [

  // RICE MEALS
  { category: "Rice Meals", name: "Crispy Chicken", price: 199 },
  { category: "Rice Meals", name: "Creamy Beef", price: 189 },
  { category: "Rice Meals", name: "Burger Steak", price: 219 },
  { category: "Rice Meals", name: "Pork Adobo", price: 189 },
  { category: "Rice Meals", name: "Fried Liempo", price: 189 },
  { category: "Rice Meals", name: "Buffalo Shrimp", price: 199 },
  { category: "Rice Meals", name: "Breaded Pork Chop", price: 189 },
  { category: "Rice Meals", name: "Beef Tapa", price: 179 },
  { category: "Rice Meals", name: "Fried Bangus", price: 189 },
  { category: "Rice Meals", name: "Buttered Squid", price: 179 },

  // FLAVORED CHICKEN
  { category: "Flavored Chicken", name: "Garlic Parmesan Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Buffalo Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Sweet Chili Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Buffalo Garlic Mayo Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Salted Egg Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Classic Chicken", price: 159 },

  // ALACARTE
  { category: "Alacarte", name: "Salted Egg", price: 219 },
  { category: "Alacarte", name: "Buffalo Garlic Mayo", price: 229 },
  { category: "Alacarte", name: "Garlic Parmesan", price: 219 },
  { category: "Alacarte", name: "Sweet Chili", price: 219 },
  { category: "Alacarte", name: "Buffalo", price: 219 },
  { category: "Alacarte", name: "Classic", price: 209 },
  { category: "Alacarte", name: "Tempura", price: 279 },
  { category: "Alacarte", name: "Buffalo Shrimp", price: 279 },
  { category: "Alacarte", name: "Lumpia Shanghai", price: 149 },
  { category: "Alacarte", name: "Buttered Squid", price: 249 },

  // BURGER
  { category: "Burger", name: "Overload Burger", price: 229 },
  { category: "Burger", name: "Bacon Burger", price: 219 },
  { category: "Burger", name: "Chicken Fillet Burger", price: 189 },
  { category: "Burger", name: "Onion Burger", price: 209 },
  { category: "Burger", name: "Aloha Burger", price: 229 },

  // PASTA
  { category: "Pasta", name: "Shrimp Pasta", price: 169 },
  { category: "Pasta", name: "Seafood Pasta", price: 169 },
  { category: "Pasta", name: "Chicken Carbonara", price: 169 },
  { category: "Pasta", name: "Chicken Spaghetti", price: 169 },
  { category: "Pasta", name: "Tuna Pasta", price: 159 },

  // FRIES & NACHOS
  { category: "Fries & Nachos", name: "Bacon Fries", price: 169 },
  { category: "Fries & Nachos", name: "Beef Fries", price: 169 },
  { category: "Fries & Nachos", name: "Overload Nachos", price: 169 },
  { category: "Fries & Nachos", name: "Overload Fries", price: 169 },

  // ICED COFFEE
  { category: "Iced Coffee (16oz)", name: "Spanish Latte", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Matcha Latte", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Caramel Macchiato", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Mocha", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Salted Caramel", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Iced Americano", price: 109 },

  // HOT COFFEE
  { category: "Hot Coffee (12oz)", name: "Spanish Latte", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Matcha Latte", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Caramel Macchiato", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Mocha", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Salted Caramel", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Cafe Americano", price: 89 },

  // MILKTEA
  { category: "Milktea", name: "Wintermelon", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Cookies & Cream", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Taro", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Chocolate", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Okinawa", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Matcha", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Caramel", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Red Velvet", price: 85, priceLarge: 95 },

  // FRUIT TEA
  { category: "Fruit Tea", name: "Green Apple", price: 85, priceLarge: 95 },
  { category: "Fruit Tea", name: "Strawberry", price: 85, priceLarge: 95 },
  { category: "Fruit Tea", name: "Blueberry", price: 85, priceLarge: 95 },
  { category: "Fruit Tea", name: "Passion Fruit", price: 85, priceLarge: 95 },

  // SHAKE
  { category: "Shake", name: "Dark Chocolate Shake", price: 129 },
  { category: "Shake", name: "Fresh Mango Shake", price: 149 },
  { category: "Shake", name: "Coffee Shake", price: 129 },
  { category: "Shake", name: "Fresh Avocado Shake", price: 149 },
  { category: "Shake", name: "Cookies & Cream Shake", price: 129 },
  { category: "Shake", name: "Cucumber Shake", price: 129 },

  // FRAPPE
  { category: "Frappé", name: "Cookies & Cream Frappé", price: 149 },
  { category: "Frappé", name: "Matcha Frappé", price: 149 },
  { category: "Frappé", name: "Strawberry Frappé", price: 149 },

  // ALL DAY BREAKFAST
  { category: "All Day Breakfast", name: "Cornsilog", price: 149 },
  { category: "All Day Breakfast", name: "Shanghai Silog", price: 129 },
  { category: "All Day Breakfast", name: "Longsilog", price: 149 },
  { category: "All Day Breakfast", name: "Spamsilog", price: 169 },
  { category: "All Day Breakfast", name: "Hungarian Silog", price: 159 },
  { category: "All Day Breakfast", name: "Chick Silog", price: 149 },
  { category: "All Day Breakfast", name: "Combo 1 Breakfast", price: 279 },
  { category: "All Day Breakfast", name: "Combo 2 Breakfast", price: 249 },

  // SHARING
  { category: "Sharing", name: "Canton Special", price: 279 },
  { category: "Sharing", name: "Bihon Special", price: 279 },
  { category: "Sharing", name: "Pakbet", price: 299 },
  { category: "Sharing", name: "Creamy Beef Broccoli", price: 319 },
  { category: "Sharing", name: "Chopsuey", price: 319 },
  { category: "Sharing", name: "6pcs Fried Chicken", price: 419 },
  { category: "Sharing", name: "Shrimp Sinigang", price: 399 },
  { category: "Sharing", name: "Pork Sinigang", price: 349 },
  { category: "Sharing", name: "Half Crispy Chicken", price: 349 },
  { category: "Sharing", name: "Yang Chow Rice", price: 279 },
  { category: "Sharing", name: "Java Rice", price: 189 },
  { category: "Sharing", name: "Egg Fried Rice", price: 199 },
  { category: "Sharing", name: "Tocino Rice", price: 229 },

  // FAMILY COMBOS
  {
    category: "Family Combos",
    name: "Pinoy Favorite Combo 1 — Half Crispy Chicken, Chopsuey, Pork Sinigang, 4 Cups Rice, 1 Pitcher Iced Tea",
    price: 1199
  },
  {
    category: "Family Combos",
    name: "Pinoy Favorite Combo 2 — 6pcs Fried Chicken, Pakbet, Shrimp Sinigang, 4 Cups Rice, 1 Pitcher Iced Tea",
    price: 2299
  },
  {
    category: "Family Combos",
    name: "Pinoy Favorite Combo 3 — 7-Bone Steak, Creamy Beef Broccoli, Salmon Sinigang, 4 Cups Rice, 1 Pitcher Iced Tea",
    price: 1799
  },

  // SAMYANG & RAMEN MAIN ITEMS
  {
    category: "Samyang & Ramen",
    name: "Creamy Buldak Ramen",
    price: 169
  },
  {
    category: "Samyang & Ramen",
    name: "Cheesy Samyang Carbonara",
    price: 145
  },

  // SALAD
  {
    category: "Salad",
    name: "Vegetable Salad",
    price: 189
  },
  {
    category: "Salad",
    name: "Cheesy Potato Croquette",
    price: 149
  },

  // GENERAL ADD ONS
  {
    category: "Add Ons",
    name: "Garlic Mayo",
    price: 29
  },
  {
    category: "Add Ons",
    name: "Ketchup",
    price: 20
  },
  {
    category: "Add Ons",
    name: "Cheese Sauce",
    price: 29
  },
  {
    category: "Add Ons",
    name: "Mayonnaise",
    price: 25
  },
  {
    category: "Add Ons",
    name: "Plain Rice",
    price: 20
  },
  {
    category: "Add Ons",
    name: "Java Rice",
    price: 25
  },
  {
    category: "Add Ons",
    name: "Fried Rice",
    price: 30
  },
  {
    category: "Add Ons",
    name: "Mineral Water 250ml",
    price: 20
  },
  {
    category: "Add Ons",
    name: "Coke In Can",
    price: 49
  },
  {
    category: "Add Ons",
    name: "Pineapple Juice In Can",
    price: 49
  },
  {
    category: "Add Ons",
    name: "Take Out Box",
    price: 15
  }

]
.concat(EXTRA_MENU)
.map((item, index) => ({
  ...item,

  description:
    item.description ||
    (
      item.category.startsWith("Party Trays")
        ? "Ready to serve platter. Trays serve approximately 12–20 pax."
        : ""
    ),

  sortOrder: index,

  available: true
}));
