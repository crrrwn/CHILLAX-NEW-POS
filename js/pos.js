import { db, authReady } from "./firebase-config.js";
import { requireRole, logout } from "./auth.js";
import { printOrder } from "./receipt.js";
import { dayKey, pesos, rounded, boxTotal, orderTotal, addonsTotal, isMealItem, lineBoxPrice, boxesForCart } from "./business.js";
import { collection, onSnapshot, query, orderBy, doc, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const session = requireRole(["staff", "admin"]);
if (!session) throw new Error("Sign in is required.");
document.getElementById("logout-btn").addEventListener("click", logout);
document.getElementById("role-pill").textContent = session.role === "admin" ? "Admin" : "Cashier";
if (session.role !== "admin") document.getElementById("admin-link").classList.add("hidden");

const $ = id => document.getElementById(id);
const menuPane = $("item-grid"), tabsEl = $("category-tabs"), cartItemsEl = $("cart-items");
const checkoutBtn = $("checkout-btn"), modalRoot = $("modal-root");
let menuByCategory = new Map(), categoryOrder = [], activeCategory = null;
let cart = [], recentOrders = [], lastOrder = null, submitting = false, searchText = "";
const money = pesos;
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const isDrink = (category, name = "") => /coffee|frapp|frappé|shake|tea|drink|juice|smoothie|soda|lemonade|chocolate|matcha|milktea/i.test(category || "") || /water|coke|cola|juice|soda|iced tea|iced coffee/i.test(name);
const positiveInt = value => Math.max(0, Math.floor(Number(value) || 0));
function currentBoxes() {
  // Counts auto boxes from each meal, plus any manually added extra boxes.
  return boxesForCart(cart, {
    "15": positiveInt($("box-15").value),
    "25": positiveInt($("box-25").value)
  });
}
function currentAddons() {
  const name = $("addon-name").value.trim();
  const qty = positiveInt($("addon-qty").value);
  const unitPrice = Number($("addon-price").value || 0);
  return name && qty > 0 && Number.isFinite(unitPrice) && unitPrice >= 0 ? [{name, qty, unitPrice}] : [];
}
function toast(msg) { const node = $("toast"); node.textContent = msg; node.classList.remove("hidden"); clearTimeout(toast.t); toast.t = setTimeout(() => node.classList.add("hidden"), 3500); }
function connectionError(msg) { const node = $("connection-banner"); node.textContent = msg; node.classList.remove("hidden"); }

function availableOrders() {
  const today = dayKey();
  return recentOrders.filter(o => (o.dayKey || (o.createdAt?.toDate ? dayKey(o.createdAt.toDate()) : "")) === today);
}
function renderExistingOrders() {
  const select = $("existing-order");
  const previous = select.value;
  select.replaceChildren(new Option("New order (new number)", ""));
  availableOrders().forEach(o => select.add(new Option(`#${o.orderNumber} · ${o.customerName || "Walk-in"} · ${money(o.total)}`, o.id)));
  select.value = availableOrders().some(o => o.id === previous) ? previous : "";
  checkoutBtn.textContent = select.value ? "Add to order & print" : "Place order & print";
}

async function listenMenu() {
  await authReady;
  onSnapshot(query(collection(db, "categories"), orderBy("order")), snap => {
    categoryOrder = snap.docs.map(d => d.data().name).flatMap(name => name === "Shake & Frappé" ? ["Shake", "Frappé"] : [name]);
    categoryOrder = [...new Set(categoryOrder)];
    if (categoryOrder.length && !categoryOrder.includes(activeCategory)) activeCategory = categoryOrder[0];
    renderTabs(); renderGrid();
  }, e => connectionError(`Categories failed to load: ${e.message}`));
  onSnapshot(query(collection(db, "menu"), orderBy("sortOrder")), snap => {
    menuByCategory = new Map();
    snap.forEach(d => {
      const item = {id:d.id, ...d.data()};
      let category = item.category || "Uncategorized";
      if (category === "Shake & Frappé") category = /frapp|frappé/i.test(item.name) ? "Frappé" : "Shake";
      item.category = category;
      const list = menuByCategory.get(category) || []; list.push(item); menuByCategory.set(category, list);
    });
    if (!activeCategory && menuByCategory.size) activeCategory = [...menuByCategory.keys()][0];
    renderTabs(); renderGrid();
  }, e => connectionError(`Products failed to load: ${e.message}`));
  onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc")), snap => {
    recentOrders = snap.docs.map(d => ({id:d.id, ...d.data()}));
    renderExistingOrders();
  }, e => connectionError(`Existing orders failed to load: ${e.message}`));
}
function renderTabs() {
  tabsEl.replaceChildren();
  [...new Set([...categoryOrder, ...menuByCategory.keys()])].forEach(cat => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = cat;
    b.className = cat === activeCategory ? "active" : "";
    b.onclick = () => { activeCategory = cat; renderTabs(); renderGrid(); };
    tabsEl.appendChild(b);
  });
}
function renderGrid() {
  const items = searchText
    ? [...menuByCategory.values()].flat().filter(it => `${it.name} ${it.category}`.toLowerCase().includes(searchText))
    : (menuByCategory.get(activeCategory) || []);
  $("item-count").textContent = `${items.length} products${searchText ? " found" : ""}`;
  menuPane.replaceChildren();
  if (!items.length) {menuPane.innerHTML = `<p class="menu-empty">No products found.</p>`; return;}
  items.forEach(it => {
    const b = document.createElement("button"); b.type = "button"; b.disabled = it.available === false;
    b.className = "item-card" + (it.available === false ? " unavailable" : "");
    b.innerHTML = `<span class="name">${escapeHtml(it.name)}</span><span class="product-category">${escapeHtml(it.category)}</span><span class="price">${money(it.price)}${it.priceLarge ? " / " + money(it.priceLarge) : ""}</span>${it.available === false ? '<span class="badge-unavail">Unavailable</span>' : ""}`;
    b.onclick = () => it.priceLarge ? openSizeModal(it) : addToCart(it, null, it.price);
    menuPane.appendChild(b);
  });
}
function addToCart(it, size, unitPrice) {
  cart.push({key: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, menuId:it.id, name:it.name,
    category:it.category, size, unitPrice:Number(unitPrice), qty:1, serveType:$("order-type").value, boxChoice:"auto",
    isAddon:/^add\s*ons?$/i.test(it.category || ""), note:""});
  renderCart();
}
function lineTotal(line) {return Number(line.qty || 0) * Number(line.unitPrice || 0);}
function renderCart() {
  cartItemsEl.replaceChildren();
  if (!cart.length) cartItemsEl.innerHTML = '<div class="cart-empty">Tap a product to start an order.</div>';
  for (const line of cart) {
    const row = document.createElement("div"); row.className = "cart-line";
    const meal = isMealItem(line);
    const boxPrice = lineBoxPrice(line);
    const boxLabel = meal ? `
      <label class="meal-box-label">Box per serving
        <select class="meal-box-select" aria-label="Box type for ${escapeHtml(line.name)}">
          <option value="auto">Automatic (Take Out ₱15 / Dine In ₱0)</option>
          <option value="15">₱15 box</option>
          <option value="25">₱25 box (replace ₱15)</option>
          <option value="0">No box</option>
        </select>
      </label>
      <div class="meal-box-cost">${boxPrice ? `${money(boxPrice)} × ${line.qty} box = ${money(boxPrice * line.qty)}` : "No box charge"}</div>` : "";
    row.innerHTML = `<div class="info"><div class="name">${escapeHtml(line.name)}</div>
      ${line.size ? `<div class="size">Size: ${escapeHtml(line.size)}</div>` : ""}
      <div class="unit">${money(line.unitPrice)} each · ${escapeHtml(line.category)}</div>
      <select class="serve-select" aria-label="Dine in or take out for ${escapeHtml(line.name)}">
        <option value="Dine In">Dine In</option><option value="Take Out">Take Out</option>
      </select>
      ${boxLabel}
      <input class="custom-note" placeholder="Notes (optional)" maxlength="180" value="${escapeHtml(line.note)}" />
      ${line.qty > 1 ? '<button class="split-serve" type="button">Split 1 serving</button>' : ""}
    </div><div class="qty-control"><button type="button" data-act="dec">−</button><span>${line.qty}</span><button type="button" data-act="inc">+</button></div>
    <div class="line-total">${money(lineTotal(line))}</div><button type="button" class="remove-btn" data-act="remove" aria-label="Remove">✕</button>`;
    const sel = row.querySelector(".serve-select"); sel.value = line.serveType;
    sel.onchange = e => {line.serveType = e.target.value; renderCart();};
    const boxSelect = row.querySelector(".meal-box-select");
    if (boxSelect) {
      boxSelect.value = line.boxChoice ?? "auto";
      boxSelect.onchange = e => {line.boxChoice = e.target.value; renderCart();};
    }
    row.querySelector(".custom-note").oninput = e => {line.note = e.target.value;};
    row.querySelector('[data-act="inc"]').onclick = () => {line.qty++; renderCart();};
    row.querySelector('[data-act="dec"]').onclick = () => {line.qty--; if (line.qty <= 0) cart = cart.filter(x => x.key !== line.key); renderCart();};
    row.querySelector('[data-act="remove"]').onclick = () => {cart = cart.filter(x => x.key !== line.key); renderCart();};
    const split = row.querySelector(".split-serve");
    if (split) split.onclick = () => {
      line.qty--;
      cart.push({...line, key:crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, qty:1,
        serveType: line.serveType === "Dine In" ? "Take Out" : "Dine In"}); renderCart();
    };
    cartItemsEl.appendChild(row);
  }
  const boxes = currentBoxes(), extras = currentAddons();
  const subtotal = cart.reduce((sum,x) => sum + lineTotal(x), 0);
  const extraCost = extras.reduce((sum,x) => sum + lineTotal(x), 0);
  const total = rounded(subtotal + boxTotal(boxes) + extraCost);
  $("cart-total").textContent = money(total);
  $("box-fee-label").textContent = `Boxes: ${boxes["15"]}×₱15 + ${boxes["25"]}×₱25 = ${money(boxTotal(boxes))} · Add-ons: ${money(extraCost + cart.filter(x => x.isAddon).reduce((s,x)=>s+lineTotal(x),0))}`;
  $("cart-count").textContent = String(cart.reduce((sum,x) => sum + x.qty, 0));
  checkoutBtn.disabled = submitting || (cart.length === 0 && extraCost === 0 && boxTotal(boxes) === 0);
  checkoutBtn.textContent = $("existing-order").value ? "Add to order & print" : "Place order & print";
}
function openSizeModal(it) {
  let size = "M";
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal-sheet"><h3>${escapeHtml(it.name)}</h3>
    <div class="size-options"><button class="selected" data-size="M" type="button">Medium · ${money(it.price)}</button><button data-size="L" type="button">Large · ${money(it.priceLarge)}</button></div>
    <div class="modal-actions"><button class="btn btn-outline" type="button" id="modal-cancel">Cancel</button><button type="button" class="btn btn-primary" id="modal-add">Add to order</button></div></div></div>`;
  modalRoot.querySelectorAll("[data-size]").forEach(btn => btn.onclick = () => {size=btn.dataset.size; modalRoot.querySelectorAll("[data-size]").forEach(b => b.classList.toggle("selected", b===btn));});
  modalRoot.querySelector("#modal-cancel").onclick = () => modalRoot.replaceChildren();
  modalRoot.querySelector("#modal-add").onclick = () => {addToCart(it,size,size === "L"?it.priceLarge:it.price);modalRoot.replaceChildren();};
  modalRoot.querySelector(".modal-backdrop").onclick = e => {if (e.target.classList.contains("modal-backdrop")) modalRoot.replaceChildren();};
}

$("menu-search").addEventListener("input", e => {searchText=e.target.value.trim().toLowerCase(); renderGrid();});
$("order-type").addEventListener("change", e => {for (const line of cart) line.serveType = e.target.value; renderCart();});
for (const id of ["box-15","box-25","addon-qty","addon-price","addon-name"]) $(id).addEventListener("input", renderCart);
$("existing-order").addEventListener("change", renderCart);
$("reprint-last-btn").onclick = async () => {if(!lastOrder)return; try {await printOrder(lastOrder);}catch(e){toast(e.message);}};
document.addEventListener("keydown", e => {if(e.key==="Escape"&&modalRoot.hasChildNodes())modalRoot.replaceChildren();});

checkoutBtn.addEventListener("click", async () => {
  if (submitting) return;
  let addons = currentAddons(), boxes = currentBoxes();
  const rawName = $("addon-name").value.trim();
  if (rawName && !addons.length) {toast("Enter a valid add-on quantity and price.");return;}
  const items = cart.map(({key,...line}) => ({
    ...line, qty: Number(line.qty), unitPrice:Number(line.unitPrice),
    isDrink:isDrink(line.category,line.name), boxUnitPrice:lineBoxPrice(line)
  }));
  const delta = {items, addons, boxes, packagingFee:boxTotal(boxes)};
  const charge = orderTotal(delta);
  if (!items.length && !addons.length && !boxTotal(boxes)) return;
  submitting = true; renderCart(); checkoutBtn.textContent = "Saving order…";
  try {
    await authReady;
    const selectedId = $("existing-order").value;
    let printPayload;
    if (selectedId) {
      const ref = doc(db,"orders",selectedId);
      printPayload = await runTransaction(db, async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists()) throw Error("Existing order no longer exists.");
        const old = snapshot.data();
        if ((old.dayKey || (old.createdAt?.toDate ? dayKey(old.createdAt.toDate()) : "")) !== dayKey()) throw Error("Only today's orders can receive new add-ons.");
        const next = {
          ...old,
          items:[...(old.items || []), ...items.map(x=>({...x,isAddon:true}))],
          addons:[...(old.addons || []), ...addons],
          boxes:{"15":Number(old.boxes?.["15"]||0)+boxes["15"],"25":Number(old.boxes?.["25"]||0)+boxes["25"]},
        };
        // Preserve existing legacy packaging charges as well.
        next.legacyPackagingFee = Number(old.legacyPackagingFee ?? (old.boxes ? 0 : old.packagingFee || 0));
        next.packagingFee = next.legacyPackagingFee + boxTotal(next.boxes);
        next.total = rounded(Number(old.total || 0) + charge);
        next.addOnTotal = rounded(Number(old.addOnTotal ?? addonsTotal(old)) + items.reduce((s,x)=>s+lineTotal(x),0)+addons.reduce((s,x)=>s+lineTotal(x),0));
        next.updatedAt = serverTimestamp();
        tx.update(ref, {items:next.items, addons:next.addons,boxes:next.boxes,legacyPackagingFee:next.legacyPackagingFee,packagingFee:next.packagingFee,total:next.total,addOnTotal:next.addOnTotal,updatedAt:next.updatedAt});
        return {...delta, items:items.map(x=>({...x,isAddon:true})), orderNumber:old.orderNumber,
          orderType:old.orderType, paymentMethod:old.paymentMethod,customerName:old.customerName,
          dayKey:dayKey(), printedAt:new Date().toISOString(), total:charge, updatedOrderTotal:next.total,receiptMode:"ADD-ON"};
      });
    } else {
      const date = dayKey();
      const ref = doc(db,"counters",`orderNumber-${date}`);
      const orderRef = doc(collection(db,"orders"));
      const order = {
        ...delta, dayKey:date, orderType:items.some(x=>x.serveType==="Take Out") ? "Take Out" : $("order-type").value,
        paymentMethod:$("payment-method").value, customerName:$("customer-name").value.trim(),
        cashierRole:session.role,total:charge,addOnTotal:addonsTotal(delta)
      };
      // First deployment mid-day: continue from existing today's order numbers.
      const maxExistingToday = availableOrders().reduce((n,o)=>Math.max(n,Number(o.orderNumber)||0),0);
      const number = await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const next = Math.max(Number(snap.exists()?snap.data().value:0),maxExistingToday)+1;
        tx.set(ref,{value:next,dayKey:date});
        tx.set(orderRef,{...order,orderNumber:next,createdAt:serverTimestamp()});
        return next;
      });
      printPayload = {...order,orderNumber:number,printedAt:new Date().toISOString()};
    }
    lastOrder=printPayload;
    cart=[]; $("customer-name").value="";$("addon-name").value="";$("addon-price").value="";$("addon-qty").value="1";
    $("box-15").value="0";$("box-25").value="0";
    $("existing-order").value=""; renderCart(); $("reprint-last-btn").disabled=false;
    toast(`Order #${printPayload.orderNumber} saved. Printing 3 copies…`);
    try {await printOrder(printPayload);}catch(printError){console.error(printError);toast("Saved! Printing failed; use Reprint Last.");}
  } catch(e) {console.error("Checkout failed",e);toast(`Not saved: ${e.message}`);}
  finally {submitting=false;renderCart();}
});
let lastBusinessDay = dayKey();
setInterval(() => {
  const today = dayKey();
  if (today === lastBusinessDay) return;
  lastBusinessDay = today;
  renderExistingOrders(); // Remove yesterday's order choices at midnight.
}, 60000);
listenMenu().catch(e => {console.error(e);connectionError(e.message);});
