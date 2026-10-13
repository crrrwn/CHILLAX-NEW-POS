// One-time seed data, built from the Chillax Café menu list.
// `price` is the small/regular price. Drinks that come in Medium/Large
// also carry `priceLarge`. This only ever runs once — see maybeSeedMenu()
// in js/admin.js — after that, the admin panel is the source of truth.

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
  "Shake & Frappé",
  "All Day Breakfast",
  "Sharing",
  "Family Combos",
  "Samyang & Ramen",
  "Salad",
  "Add Ons",
];

export const SEED_MENU = [
  // Rice Meals
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

  // Flavored Chicken
  { category: "Flavored Chicken", name: "Garlic Parmesan Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Buffalo Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Sweet Chili Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Buffalo Garlic Mayo Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Salted Egg Chicken", price: 169 },
  { category: "Flavored Chicken", name: "Classic Chicken", price: 159 },

  // Alacarte
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

  // Burger
  { category: "Burger", name: "Overload Burger", price: 229 },
  { category: "Burger", name: "Bacon Burger", price: 219 },
  { category: "Burger", name: "Chicken Fillet Burger", price: 189 },
  { category: "Burger", name: "Onion Burger", price: 209 },
  { category: "Burger", name: "Aloha Burger", price: 229 },

  // Pasta
  { category: "Pasta", name: "Shrimp Pasta", price: 169 },
  { category: "Pasta", name: "Seafood Pasta", price: 169 },
  { category: "Pasta", name: "Chicken Carbonara", price: 169 },
  { category: "Pasta", name: "Chicken Spaghetti", price: 169 },
  { category: "Pasta", name: "Tuna Pasta", price: 159 },

  // Fries & Nachos
  { category: "Fries & Nachos", name: "Bacon Fries", price: 169 },
  { category: "Fries & Nachos", name: "Beef Fries", price: 169 },
  { category: "Fries & Nachos", name: "Overload Nachos", price: 169 },
  { category: "Fries & Nachos", name: "Overload Fries", price: 169 },

  // Iced Coffee (16oz)
  { category: "Iced Coffee (16oz)", name: "Spanish Latte", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Matcha Latte", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Caramel Macchiato", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Mocha", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Salted Caramel", price: 129 },
  { category: "Iced Coffee (16oz)", name: "Iced Americano", price: 109 },

  // Hot Coffee (12oz)
  { category: "Hot Coffee (12oz)", name: "Spanish Latte", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Matcha Latte", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Caramel Macchiato", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Mocha", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Salted Caramel", price: 89 },
  { category: "Hot Coffee (12oz)", name: "Cafe Americano", price: 89 },

  // Milktea (M / L)
  { category: "Milktea", name: "Wintermelon", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Cookies & Cream", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Taro", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Chocolate", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Okinawa", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Matcha", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Caramel", price: 85, priceLarge: 95 },
  { category: "Milktea", name: "Red Velvet", price: 85, priceLarge: 95 },

  // Fruit Tea (M / L)
  { category: "Fruit Tea", name: "Green Apple", price: 85, priceLarge: 95 },
  { category: "Fruit Tea", name: "Strawberry", price: 85, priceLarge: 95 },
  { category: "Fruit Tea", name: "Blueberry", price: 85, priceLarge: 95 },
  { category: "Fruit Tea", name: "Passion Fruit", price: 85, priceLarge: 95 },

  // Shake & Frappé
  { category: "Shake & Frappé", name: "Dark Chocolate Shake", price: 129 },
  { category: "Shake & Frappé", name: "Fresh Mango Shake", price: 149 },
  { category: "Shake & Frappé", name: "Coffee Shake", price: 129 },
  { category: "Shake & Frappé", name: "Fresh Avocado Shake", price: 149 },
  { category: "Shake & Frappé", name: "Cookies & Cream Shake", price: 129 },
  { category: "Shake & Frappé", name: "Cucumber Shake", price: 129 },
  { category: "Shake & Frappé", name: "Cookies & Cream Frappé", price: 149 },
  { category: "Shake & Frappé", name: "Matcha Frappé", price: 149 },
  { category: "Shake & Frappé", name: "Strawberry Frappé", price: 149 },

  // All Day Breakfast
  { category: "All Day Breakfast", name: "Cornsilog", price: 149 },
  { category: "All Day Breakfast", name: "Shanghai Silog", price: 129 },
  { category: "All Day Breakfast", name: "Longsilog", price: 149 },
  { category: "All Day Breakfast", name: "Spamsilog", price: 169 },
  { category: "All Day Breakfast", name: "Hungarian Silog", price: 159 },
  { category: "All Day Breakfast", name: "Chick Silog", price: 149 },
  { category: "All Day Breakfast", name: "Combo 1 Breakfast", price: 279 },
  { category: "All Day Breakfast", name: "Combo 2 Breakfast", price: 249 },

  // Sharing
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

  // Family Combos (good for 4-5 pax)
  {
    category: "Family Combos",
    name: "Pinoy Favorite Combo 1 — Half Crispy Chicken, Chopsuey, Pork Sinigang, 4 Cups Rice, 1 Pitcher Iced Tea",
    price: 1199,
  },
  {
    category: "Family Combos",
    name: "Pinoy Favorite Combo 2 — 6pcs Fried Chicken, Pakbet, Shrimp Sinigang, 4 Cups Rice, 1 Pitcher Iced Tea",
    price: 2299,
  },
  {
    category: "Family Combos",
    name: "Pinoy Favorite Combo 3 — 7-Bone Steak, Creamy Beef Broccoli, Salmon Sinigang, 4 Cups Rice, 1 Pitcher Iced Tea",
    price: 1799,
  },

  // Samyang & Ramen
  { category: "Samyang & Ramen", name: "Creamy Buldak Ramen", price: 169 },
  { category: "Samyang & Ramen", name: "Cheesy Samyang Carbonara", price: 145 },

  // Salad
  { category: "Salad", name: "Vegetable Salad", price: 189 },
  { category: "Salad", name: "Cheesy Potato Croquette", price: 149 },

  // Add Ons
  { category: "Add Ons", name: "Garlic Mayo", price: 29 },
  { category: "Add Ons", name: "Ketchup", price: 20 },
  { category: "Add Ons", name: "Cheese Sauce", price: 29 },
  { category: "Add Ons", name: "Mayonnaise", price: 25 },
  { category: "Add Ons", name: "Plain Rice", price: 20 },
  { category: "Add Ons", name: "Java Rice", price: 25 },
  { category: "Add Ons", name: "Fried Rice", price: 30 },
  { category: "Add Ons", name: "Mineral Water 250ml", price: 20 },
  { category: "Add Ons", name: "Coke In Can", price: 49 },
  { category: "Add Ons", name: "Pineapple Juice In Can", price: 49 },
  { category: "Add Ons", name: "Take Out Box", price: 15 },
].map((item, i) => ({ ...item, sortOrder: i, available: true }));
