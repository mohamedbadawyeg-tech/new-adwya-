
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getMessaging, getToken, Messaging } from "firebase/messaging";
import { getAuth, signInAnonymously, User, Auth } from "firebase/auth";
import { getFirestore, doc, setDoc, onSnapshot, Firestore, Timestamp, updateDoc } from "firebase/firestore";

// Using the provided configuration
const firebaseConfig = {
  apiKey: "AIzaSyAlVZh0qq-eUApGeTbJhNc2lFHKtBjHNIY",
  authDomain: "adwya-87233196-127d6.firebaseapp.com",
  projectId: "adwya-87233196-127d6",
  storageBucket: "adwya-87233196-127d6.firebasestorage.app",
  messagingSenderId: "110998205930",
  appId: "1:110998205930:web:deead644b90bf28522ae93"
};

let app: FirebaseApp;
let db: Firestore | null = null;
let messaging: Messaging | null = null;
let auth: Auth | null = null;

try {
  // Fix: Initializing Firebase modularly and ensuring all components are correctly typed
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
  auth = getAuth(app);
  
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext) {
    try {
      messaging = getMessaging(app);
    } catch (e) {
      console.warn("FCM registration skipped or not supported:", e);
    }
  }
} catch (error) {
  console.error("Firebase Service Initialization Failure:", error);
}

export { db, messaging };

/**
 * Authenticates the user anonymously to allow Firestore and FCM usage.
 */
export const authenticateAnonymously = async (): Promise<User | null> => {
  if (!auth) return null;
  try {
    const result = await signInAnonymously(auth);
    return result.user;
  } catch (error) {
    console.error("Firebase Anonymous Auth failed:", error);
    return null;
  }
};

/**
 * Requests permission for push notifications and returns the FCM token.
 */
export const requestNotificationPermission = async (): Promise<string | null> => {
  if (!messaging) {
    console.warn("Messaging not initialized.");
    return null;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      return await getToken(messaging, {
        vapidKey: 'BAHsKe2WSUDaXMcroeNScTprRmE2NTIBDyv9fYmVsuUddhERvybIKM7EBNgSHnuZ91Q9QU9V034IXnVDbeEG9oQ'
      });
    }
  } catch (error) {
    console.error("FCM Token Retrieval Error:", error);
  }
  return null;
};

/**
 * Syncs patient data to the cloud.
 */
export const syncPatientData = async (patientId: string, data: any) => {
  if (!db || !patientId) return;
  try {
    const patientDoc = doc(db, "patients", patientId);
    await setDoc(patientDoc, {
      ...data,
      lastUpdated: Timestamp.now()
    }, { merge: true });
  } catch (error) {
    console.error("Firestore data sync failed:", error);
  }
};

/**
 * Sends a nudge (notification trigger) to the patient.
 */
export const sendNudge = async (patientId: string, message: string) => {
  if (!db || !patientId) return;
  try {
    const patientDoc = doc(db, "patients", patientId);
    await updateDoc(patientDoc, {
      lastNudge: {
        message,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.error("Failed to send nudge:", error);
  }
};

/**
 * Listens for real-time updates to a patient's document.
 */
export const listenToPatient = (patientId: string, callback: (data: any) => void) => {
  if (!db || !patientId) return () => {};
  try {
    const patientDoc = doc(db, "patients", patientId);
    return onSnapshot(patientDoc, (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.data());
      } else {
        callback(null);
      }
    }, (error) => {
      console.error("Firestore listener error:", error);
    });
  } catch (e) {
    console.error("Failed to establish listener:", e);
    return () => {};
  }
};
