// Firebase initialization shared by every page.
// Uses the CDN "modular" SDK so no build step / npm install is required —
// just open the HTML files (or host them) and it works.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBvFxXhe-1nW6fEuHP_YzXJlDwgvm8jEQc",
  authDomain: "chillaxpos-470c3.firebaseapp.com",
  projectId: "chillaxpos-470c3",
  storageBucket: "chillaxpos-470c3.firebasestorage.app",
  messagingSenderId: "876620772801",
  appId: "1:876620772801:web:d660a4b52fa0f12965ab40",
  measurementId: "G-LV284YJK75",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Best-effort offline cache so the POS keeps working through a spotty
// connection. Fails silently in browsers/tabs that don't support it.
try {
  enableIndexedDbPersistence(db).catch(() => {});
} catch (e) {
  /* no-op */
}

// The app has no per-employee accounts — it uses simple shared PINs
// (see js/auth.js). Firestore security rules just require *some*
// signed-in user, so every page signs in anonymously before touching
// the database. This resolves once auth is ready.
export const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      resolve(user);
    } else {
      signInAnonymously(auth).catch((err) => {
        console.error("Anonymous sign-in failed:", err);
      });
    }
  });
});
