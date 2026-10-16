
/**
 * CHILLAX POS
 * ADMIN EDIT ORDER DISCOUNT BUTTONS
 *
 * No Discount / 10% / 20%
 *
 * Loaded by business.js on admin.html.
 * Compatible with the existing admin.js editor.
 */

import {
  db,
  authReady
} from "./firebase-config.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let selectedOrderId = "";
let loadToken = 0;
let currentStatus = "idle";
let savedRate = 0;
let loadError = "";

const validRate = value =>
  [0, 10, 20].includes(Number(value))
    ? Number(value)
    : 0;

const currency = amount =>
  "₱" + Number(amount || 0).toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

/* SET SELECTED DISCOUNT */

function setRate(form, rate) {
  rate = validRate(rate);

  const input = form.querySelector(
    "#edit-discount-rate"
  );

  if (!input) return;

  input.value = String(rate);

  form.querySelectorAll(
    "[data-discount-option]"
  ).forEach(button => {
    const selected =
      Number(button.dataset.discountOption) === rate;

    button.classList.toggle(
      "selected",
      selected
    );

    button.setAttribute(
      "aria-pressed",
      String(selected)
    );
  });

  // Trigger the existing admin.js total calculation.
  input.dispatchEvent(
    new Event("input", {
      bubbles: true
    })
  );

  updateAmount(form);
}

/* DISPLAY DISCOUNT AMOUNT */

function updateAmount(form) {
  const info = form.querySelector(
    "#edit-discount-message"
  );

  if (!info) return;

  if (currentStatus === "loading") {
    info.textContent = "Loading saved discount…";
    return;
  }

  if (currentStatus === "error") {
    info.textContent =
      "Could not verify saved discount: " + loadError;
    return;
  }

  const itemRows = [
    ...form.querySelectorAll("[data-edit-item]")
  ];

  const addonRows = [
    ...form.querySelectorAll("[data-edit-addon]")
  ];

  const subtotal = [
    ...itemRows,
    ...addonRows
  ].reduce((sum, row) => {
    const quantity = Number(
      row.querySelector(
        '[data-field="qty"]'
      )?.value
    );

    const price = Number(
      row.querySelector(
        '[data-field="unitPrice"]'
      )?.value
    );

    const lineTotal = quantity * price;

    return sum + (
      Number.isFinite(lineTotal)
        ? lineTotal
        : 0
    );
  }, 0);

  const rate = validRate(
    form.querySelector(
      "#edit-discount-rate"
    )?.value
  );

  const amount = Math.round(
    (subtotal * rate / 100 + Number.EPSILON) * 100
  ) / 100;

  info.textContent = rate
    ? `Discount (${rate}%): -${currency(amount)} · Takeout boxes not discounted`
    : "No discount · Takeout boxes not discounted";
}

/* ENABLE/DISABLE CONTROLS DURING LOADING */

function applyLoadingState(form) {
  const saveButton = form.querySelector(
    "#edit-order-save"
  );

  if (saveButton) {
    saveButton.disabled = currentStatus !== "ready";
  }

  form.querySelectorAll(
    "[data-discount-option]"
  ).forEach(button => {
    button.disabled = currentStatus !== "ready";
  });

  if (currentStatus === "ready") {
    setRate(form, savedRate);
  } else {
    updateAmount(form);
  }
}

/* DISCOUNT BUTTON DESIGN */

function installStyle() {
  if (
    document.getElementById(
      "admin-discount-buttons-style"
    )
  ) {
    return;
  }

  const styles = document.createElement("style");

  styles.id = "admin-discount-buttons-style";

  styles.textContent = `
    .admin-discount-choice {
      min-width: 0;
    }

    .admin-discount-choice .discount-title {
      display: block;
      font-size: .78rem;
      font-weight: 800;
      margin-bottom: 6px;
      color: #674635;
    }

    .admin-discount-buttons {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
    }

    .admin-discount-buttons button {
      border: 1px solid #d7c5b9;
      background: #fff;
      border-radius: 9px;
      padding: 9px 12px;
      cursor: pointer;
      font-weight: 800;
      color: #5a3b30;
      min-width: 75px;
    }

    .admin-discount-buttons button.selected {
      background: #c34279;
      border-color: #c34279;
      color: #fff;
    }

    .admin-discount-buttons button:focus-visible {
      outline: 3px solid #743e60;
      outline-offset: 2px;
    }

    .admin-discount-buttons button:disabled {
      opacity: .6;
      cursor: wait;
    }

    #edit-discount-message {
      font-size: .75rem;
      line-height: 1.35;
      color: #6d4b3f;
      margin-top: 5px;
      min-height: 1.2em;
    }

    @media (max-width: 720px) {
      .admin-discount-choice {
        grid-column: 1 / -1;
      }
    }
  `;

  document.head.appendChild(styles);
}

/* INSERT BUTTONS INTO ADMIN EDIT ORDER */

function attachToEditor() {
  const form = document.getElementById(
    "order-edit-form"
  );

  if (
    !form ||
    form.querySelector("#edit-discount-rate")
  ) {
    return;
  }

  const fields = form.querySelector(
    ".edit-top-fields"
  );

  if (!fields) return;

  installStyle();

  const section = document.createElement("div");

  section.className =
    "field admin-discount-choice";

  section.innerHTML = `
    <span class="discount-title">
      Discount on products &amp; add-ons
    </span>

    <div
      class="admin-discount-buttons"
      role="group"
      aria-label="Order discount"
    >
      <button
        type="button"
        data-discount-option="0"
      >
        No discount
      </button>

      <button
        type="button"
        data-discount-option="10"
      >
        10%
      </button>

      <button
        type="button"
        data-discount-option="20"
      >
        20%
      </button>
    </div>

    <input
      type="hidden"
      id="edit-discount-rate"
      value="0"
    >

    <div
      id="edit-discount-message"
      aria-live="polite"
    ></div>
  `;

  fields.appendChild(section);

  section.querySelectorAll(
    "[data-discount-option]"
  ).forEach(button => {
    button.addEventListener("click", () => {
      if (currentStatus !== "ready") return;

      setRate(
        form,
        Number(button.dataset.discountOption)
      );
    });
  });

  form.addEventListener("input", event => {
    if (event.target.id !== "edit-discount-rate") {
      updateAmount(form);
    }
  });

  form.addEventListener(
    "change",
    () => updateAmount(form)
  );

  applyLoadingState(form);
}

/* DETECT WHEN ADMIN OPENS AN EDIT ORDER MODAL */

new MutationObserver(
  attachToEditor
).observe(document.body, {
  childList: true,
  subtree: true
});

attachToEditor();

/* LOAD SAVED ORDER'S EXISTING DISCOUNT */

document.addEventListener(
  "click",
  async event => {
    const button = event.target.closest(
      "[data-edit-order]"
    );

    if (!button) return;

    selectedOrderId = button.dataset.editOrder;

    const orderId = selectedOrderId;
    const token = ++loadToken;

    currentStatus = "loading";
    savedRate = 0;
    loadError = "";

    const modal = document.getElementById(
      "order-edit-form"
    );

    if (modal) {
      applyLoadingState(modal);
    }

    try {
      await authReady;

      const snapshot = await getDoc(
        doc(db, "orders", orderId)
      );

      if (token !== loadToken) return;

      if (!snapshot.exists()) {
        throw Error(
          "The order no longer exists."
        );
      }

      savedRate = validRate(
        snapshot.data().discountRate ?? 0
      );

      currentStatus = "ready";

    } catch (error) {
      if (token !== loadToken) return;

      loadError =
        error.message ||
        "Please check Firebase access.";

      currentStatus = "error";

      console.error(
        "Could not read original order discount:",
        error
      );
    }

    if (token === loadToken) {
      const form = document.getElementById(
        "order-edit-form"
      );

      if (form) {
        applyLoadingState(form);
      }
    }
  },
  true
);
