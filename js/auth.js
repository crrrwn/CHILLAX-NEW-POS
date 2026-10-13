import { db, authReady } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const SESSION_KEY = "chillax_session"; // { role: "admin" | "staff", name, at }
const PINS_DOC = doc(db, "settings", "pins");

// Default PINs used only the very first time the app runs (no doc yet).
// Change them from Admin → Settings once you're set up.
const DEFAULT_PINS = { adminPin: "1234", staffPin: "0000" };

export async function getPins() {
  await authReady;
  const snap = await getDoc(PINS_DOC);
  if (snap.exists()) {
    const data = snap.data();
    return {
      adminPin: String(data.adminPin || DEFAULT_PINS.adminPin),
      staffPin: String(data.staffPin || DEFAULT_PINS.staffPin),
    };
  }
  await setDoc(PINS_DOC, DEFAULT_PINS);
  return DEFAULT_PINS;
}

export async function setPins(pins) {
  await authReady;
  await setDoc(PINS_DOC, pins, { merge: true });
}

export function getSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!session || !["admin", "staff"].includes(session.role) ||
        !Number.isFinite(session.at) || Date.now() - session.at > 12 * 60 * 60 * 1000) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function setSession(role, name) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ role, name: name || "", at: Date.now() }),
  );
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Call at the top of a protected page. If the signed-in role isn't allowed
 * here, bounces back to the login screen.
 * @param {("admin"|"staff")[]} allowedRoles
 */
export function requireRole(allowedRoles) {
  const session = getSession();
  if (!session || !allowedRoles.includes(session.role)) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

export function logout() {
  clearSession();
  window.location.href = "index.html";
}
