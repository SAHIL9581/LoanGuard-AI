import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { auth } from "../lib/firebase";

const googleProvider = new GoogleAuthProvider();

export const authService = {
  // Sign in with email and password
  signInWithEmail: async (email: string, password: string) => {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      return result.user;
    } catch (error: any) {
      throw new Error(error.message);
    }
  },

  // Sign in with Google
  signInWithGoogle: async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    } catch (error: any) {
      throw new Error(error.message);
    }
  },

  // Sign up with email and password
  signUpWithEmail: async (email: string, password: string) => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      return result.user;
    } catch (error: any) {
      throw new Error(error.message);
    }
  },

  // Sign out
  logout: async () => {
    try {
      await signOut(auth);
    } catch (error: any) {
      throw new Error(error.message);
    }
  },

  // Get current user
  getCurrentUser: () => {
    return auth.currentUser;
  },
};