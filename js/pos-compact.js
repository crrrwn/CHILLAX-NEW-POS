
/**
 * CHILLAX CAFE POS
 * COMPLETE COMPACT CURRENT ORDER DESIGN
 *
 * File: js/pos-compact.js
 *
 * Shows immediately:
 * - Product name
 * - Dine In / Take Out
 * - Minus quantity
 * - Plus quantity
 * - Item price
 * - Remove button
 *
 * Advanced controls under Details:
 * - Service selection
 * - Takeout box
 * - Discount
 * - Notes
 * - Split serving
 *
 * Designed for HONOR Pad 10 landscape.
 *
 * Does not replace POS checkout logic,
 * Firestore saving, receipt printing,
 * or the Waiting List.
 */

const cartArea = document.getElementById(
  "cart-items"
);

const cartPanel =
  document.getElementById(
    "current-order-panel"
  ) ||
  document.querySelector(
    ".cart-pane"
  );

const customerDetails =
  document.getElementById(
    "order-details"
  );

/* TRACK EXPANDED ITEM DETAILS */

const openRows = new Set();

/* ======================================
   COMPACT DESIGN
====================================== */

function installCompactStyles() {
  const style = document.createElement(
    "style"
  );

  style.id =
    "chillax-pos-compact-css";

  style.textContent = `
    @media screen {

      /* CURRENT ORDER HEADER */

      .cart-pane .cart-header {
        padding: 8px 12px 6px !important;
      }

      .cart-pane .cart-header h2 {
        font-size: 1.03rem !important;
        margin: 0 !important;
      }

      .cart-pane .cart-header .order-no {
        font-size: .68rem !important;
        margin-top: 2px !important;
      }

      /* DEFAULT ORDER TYPE */

      .cart-pane .service-main-control {
        padding: 5px 11px !important;
        min-height: 35px;
      }

      .cart-pane .service-main-control select {
        min-height: 31px !important;
      }

      /* COLLAPSIBLE CUSTOMER FIELDS */

      .cart-pane .order-details > summary {
        padding: 7px 11px !important;
        font-size: .78rem !important;
      }

      /* SCROLLABLE CURRENT ORDERS */

      .cart-pane .cart-items {
        flex: 1 1 auto !important;

        min-height: 0 !important;
        max-height: none !important;

        overflow-y: auto !important;
        overscroll-behavior: contain;

        padding: 0 10px !important;
      }

      /* SERVICE SHOWN PER ITEM */

      .cart-pane .cart-service-group {
        display: none !important;
      }

      /* COMPACT ITEM ROW */

      .cart-pane .cart-line {
        display: grid !important;

        grid-template-columns:
          minmax(0, 1fr)
          82px
          63px
          29px !important;

        column-gap: 5px !important;
        row-gap: 4px !important;

        align-items: center !important;

        min-height: 56px !important;

        padding: 5px 0 !important;
        margin: 0 !important;

        border-bottom:
          1px solid #ece5df !important;
      }

      /* NAME AND DETAILS AREA */

      .cart-pane .cart-line > .info {
        grid-column: 1 !important;
        grid-row: 1 !important;

        min-width: 0 !important;

        display: flex !important;
        flex-direction: column !important;

        align-items: flex-start !important;

        gap: 2px !important;
      }

      /* PRODUCT NAME */

      .cart-pane .cart-line .info > .name {
        display: -webkit-box !important;

        max-width: 100%;
        min-width: 0;

        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;

        overflow: hidden;
        overflow-wrap: anywhere;

        font-size: .77rem !important;
        line-height: 1.15 !important;

        font-weight: 800 !important;
      }

      /* SERVICE BADGE */

      .cart-pane .cart-line
      .cart-quick-service {
        display: inline-block;

        font-size: .61rem;
        font-weight: 750;

        line-height: 1.15;

        color: #785849;
      }

      .cart-pane .cart-line
      .cart-quick-service.is-takeout {
        color: #a82b57;
      }

      /* DETAILS BUTTON */

      .cart-pane .cart-line
      .cart-detail-toggle {
        display: inline-block;

        background: none;
        border: none;

        padding: 0 !important;
        margin: 0 !important;

        font-size: .66rem !important;
        line-height: 1.15;

        color: #b63870 !important;
        text-decoration: underline;

        cursor: pointer;
      }

      /*
       * HIDE ADVANCED FIELDS BY DEFAULT.
       * They are still in the DOM and
       * retain their existing events.
       */

      .cart-pane .cart-line:not(.is-expanded)
      .info > :not(.name)
      :not(.cart-quick-service)
      :not(.cart-detail-toggle) {
        display: none !important;
      }

      /* QUANTITY CONTROL */

      .cart-pane .cart-line > .qty-control {
        grid-column: 2 !important;
        grid-row: 1 !important;

        display: flex !important;
        align-items: center !important;

        justify-self: center !important;

        gap: 3px !important;

        white-space: nowrap !important;
      }

      /* MINUS AND PLUS BUTTONS */

      .cart-pane .cart-line
      > .qty-control button {
        display: inline-flex !important;

        align-items: center;
        justify-content: center;

        width: 26px !important;
        height: 29px !important;

        min-width: 26px !important;
        min-height: 29px !important;

        padding: 0 !important;

        font-size: 1.05rem !important;

        border-radius: 7px !important;
      }

      /* QUANTITY NUMBER */

      .cart-pane .cart-line
      > .qty-control span {
        display: inline-block;

        min-width: 13px;
        text-align: center;

        font-size: .79rem !important;
        font-weight: 750;
      }

      /* PRICE */

      .cart-pane .cart-line
      > .line-total {
        grid-column: 3 !important;
        grid-row: 1 !important;

        min-width: 0 !important;

        align-self: center !important;
        justify-self: end !important;

        text-align: right !important;

        font-size: .72rem !important;
        font-weight: 800 !important;

        white-space: nowrap !important;
      }

      /* REMOVE BUTTON ALWAYS VISIBLE */

      .cart-pane .cart-line
      > .remove-btn {
        grid-column: 4 !important;
        grid-row: 1 !important;

        display: inline-flex !important;

        align-items: center;
        justify-content: center;

        width: 28px !important;
        height: 30px !important;

        padding: 0 !important;

        min-width: 28px !important;

        border-radius: 7px !important;
      }

      /* ==================================
         EXPANDED ITEM DETAILS
      ================================== */

      .cart-pane .cart-line.is-expanded
      > .info {
        grid-column: 1 / -1 !important;
        grid-row: 1 !important;
      }

      .cart-pane .cart-line.is-expanded
      > .qty-control,

      .cart-pane .cart-line.is-expanded
      > .line-total,

      .cart-pane .cart-line.is-expanded
      > .remove-btn {
        grid-row: 2 !important;
      }

      .cart-pane .cart-line.is-expanded
      .info > :not(.name)
      :not(.cart-quick-service)
      :not(.cart-detail-toggle) {
        display: block !important;

        max-width: 100%;
        box-sizing: border-box;
      }

      /* DISCOUNT OPTIONS */

      .cart-pane .cart-line.is-expanded
      .info .line-discount-control {
        display: flex !important;
      }

      .cart-pane .cart-line.is-expanded
      .info .item-discount-check {
        display: inline-flex !important;
      }

      /* SERVICE, BOX AND NOTES */

      .cart-pane .cart-line.is-expanded
      .info .item-discount-rate,

      .cart-pane .cart-line.is-expanded
      .info .serve-select,

      .cart-pane .cart-line.is-expanded
      .info .meal-box-select,

      .cart-pane .cart-line.is-expanded
      .info .custom-note {
        width: 100% !important;
        max-width: 100% !important;

        min-height: 31px !important;

        margin: 3px 0 !important;
        padding: 5px !important;
      }

      .cart-pane .cart-line.is-expanded
      .info .meal-box-label {
        width: 100% !important;
      }

      /* ==================================
         COMPACT CHECKOUT FOOTER
      ================================== */

      .cart-pane .cart-footer {
        padding: 7px 11px 9px !important;
      }

      .cart-pane .cart-total-row {
        margin-bottom: 5px !important;
      }

      .cart-pane .cart-total-row .amount {
        font-size: 1.17rem !important;
      }

      .cart-pane .cart-footer
      #checkout-btn {
        min-height: 37px !important;
        padding: 6px !important;
      }

      /* WAITING LIST BUTTONS */

      .cart-pane .wait-actions {
        margin-top: 5px !important;
        gap: 5px !important;
      }

      .cart-pane .wait-actions button {
        min-height: 30px !important;

        padding: 5px !important;

        font-size: .7rem !important;
      }
    }

    /* ==================================
       HONOR PAD LANDSCAPE
    ================================== */

    @media screen
    and (min-width: 700px)
    and (orientation: landscape) {

      .pos-layout .cart-pane {
        display: flex !important;

        min-height: 0 !important;

        overflow: hidden !important;
      }

      .pos-layout .cart-pane .cart-items {
        flex: 1 1 auto !important;

        overflow-y: auto !important;
      }
    }

    /* SMALL SCREEN */

    @media screen
    and (max-width: 400px) {

      .cart-pane .cart-line {
        grid-template-columns:
          minmax(0, 1fr)
          77px
          55px
          26px !important;

        column-gap: 3px !important;
      }

      .cart-pane .cart-line
      > .qty-control button {
        width: 23px !important;
        min-width: 23px !important;
      }

      .cart-pane .cart-line
      > .remove-btn {
        width: 25px !important;
        min-width: 25px !important;
      }

      .cart-pane .cart-line
      > .line-total {
        font-size: .67rem !important;
      }
    }

    @media print {
      #chillax-pos-compact-css {
        display: none !important;
      }
    }
  `;

  document.head.append(style);
}

/* ======================================
   MAKE EVERY CART ITEM COMPACT
====================================== */

function compactRows() {
  if (!cartArea) return;

  const rows = [
    ...cartArea.querySelectorAll(
      ":scope > .cart-line"
    )
  ];

  rows.forEach(
    (row, index) => {
      if (
        row.dataset.quickReady === "yes"
      ) {
        return;
      }

      row.dataset.quickReady = "yes";

      const info = row.querySelector(
        ":scope > .info"
      );

      if (!info) return;

      const serveSelect = info.querySelector(
        ".serve-select"
      );

      /* SHOW SERVICE */

      const quickService =
        document.createElement("span");

      quickService.className =
        "cart-quick-service";

      const service =
        serveSelect?.value ||
        "Dine In";

      quickService.textContent =
        service === "Take Out"
          ? "TAKE OUT"
          : "DINE IN";

      quickService.classList.toggle(
        "is-takeout",
        service === "Take Out"
      );

      /* DETAILS TOGGLE */

      const toggle =
        document.createElement("button");

      toggle.type = "button";

      toggle.className =
        "cart-detail-toggle";

      const isOpen =
        openRows.has(index);

      row.classList.toggle(
        "is-expanded",
        isOpen
      );

      toggle.textContent = isOpen
        ? "Hide details ▴"
        : "Details ▾";

      toggle.setAttribute(
        "aria-expanded",
        String(isOpen)
      );

      /* OPEN / CLOSE ADVANCED OPTIONS */

      toggle.addEventListener(
        "click",
        () => {
          const open =
            !row.classList.contains(
              "is-expanded"
            );

          if (open) {
            openRows.add(index);
          } else {
            openRows.delete(index);
          }

          row.classList.toggle(
            "is-expanded",
            open
          );

          toggle.textContent = open
            ? "Hide details ▴"
            : "Details ▾";

          toggle.setAttribute(
            "aria-expanded",
            String(open)
          );
        }
      );

      /* ADD SHORT SERVICE + DETAILS */

      const name = info.querySelector(
        ".name"
      );

      if (name) {
        name.after(
          quickService,
          toggle
        );
      } else {
        info.prepend(
          quickService,
          toggle
        );
      }
    }
  );
}

/* ======================================
   INITIALIZE COMPACT CURRENT ORDER
====================================== */

if (cartArea && cartPanel) {
  installCompactStyles();

  /*
   * Collapse Customer & Add-ons at start
   * to give the Current Order more height.
   *
   * Cashier may still open it anytime.
   */

  if (customerDetails) {
    customerDetails.open = false;
  }

  compactRows();

  /*
   * Main POS recreates rows on quantity,
   * remove, discount and service changes.
   *
   * This observer makes new rows compact
   * without replacing any POS functions.
   */

  new MutationObserver(
    compactRows
  ).observe(
    cartArea,
    {
      childList: true
    }
  );

  /* TABLET ROTATION */

  window.addEventListener(
    "orientationchange",
    () => {
      if (customerDetails) {
        customerDetails.open = false;
      }
    }
  );
}
