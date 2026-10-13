// Firebase initialization shared by every page.
// Uses the CDN "modular" SDK so no build step / npm install is required —
// just open the HTML files (or host them) and it works.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
// The legacy enableIndexedDbPersistence() API generated a deprecation warning.
// Modern persistence supports multiple open tabs; if initialization is unsupported,
// gracefully fall back to Firestore's default in-memory cache.
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  firestore = getFirestore(app);
}
export const db = firestore;
export const auth = getAuth(app);

// The app has no per-employee accounts — it uses simple shared PINs
// (see js/auth.js). Firestore security rules just require *some*
// signed-in user, so every page signs in anonymously before touching
// the database. This resolves once auth is ready.
// Reject on Firebase failures rather than leaving the PIN screen stuck forever.
export const authReady = new Promise((resolve, reject) => {
  let finished = false;
  const timeout = setTimeout(() => fail(new Error("Firebase sign-in timed out. Check your internet connection and Firebase Authentication settings.")), 12000);
  function done(user) { if (finished) return; finished = true; clearTimeout(timeout); resolve(user); }
  function fail(error) { if (finished) return; finished = true; clearTimeout(timeout); reject(error); }
  onAuthStateChanged(auth, (user) => {
    if (user) return done(user);
    signInAnonymously(auth).then(result => done(result.user)).catch(fail);
  }, fail);
});
