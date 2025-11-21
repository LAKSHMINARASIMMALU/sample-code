// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported } from "firebase/analytics";

// --- Firebase configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyDvJWbiavuxDM6SmypyA6oi3_iVAcyqxyo",
  authDomain: "project-1782344751410240495.firebaseapp.com",
  projectId: "project-1782344751410240495",
  storageBucket: "project-1782344751410240495.firebasestorage.app",
  messagingSenderId: "1084541300631",
  appId: "1:1084541300631:web:1dffdbd82e1ee3cf921ed2",
  measurementId: "G-ZD1GDKJ5KC",
};

// --- Initialize Firebase (safe for Next.js hot reload) ---
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// --- Initialize analytics only on the client (optional) ---
let analytics: ReturnType<typeof getAnalytics> | null = null;
if (typeof window !== "undefined") {
  isSupported().then((yes) => {
    if (yes) analytics = getAnalytics(app);
  });
}

export { app, auth, db, storage, analytics };
