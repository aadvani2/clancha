import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  loading: boolean;
  error: string | null;
  otpSent: boolean;
}

// Helper to get token safely
const getStoredToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
};

const token = getStoredToken();

const initialState: AuthState = {
  isAuthenticated: !!token,
  token: token,
  loading: false,
  error: null,
  otpSent: false,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    loginStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    loginSuccess: (state, action: PayloadAction<{ token: string }>) => {
      state.loading = false;
      state.isAuthenticated = true;
      state.token = action.payload.token;
      state.error = null;
    },
    loginFailure: (state, action: PayloadAction<string>) => {
      state.loading = false;
      state.error = action.payload;
    },
    logout: (state) => {
      state.isAuthenticated = false;
      state.token = null;
      state.error = null;
    },
    setOtpSent: (state) => {
      state.otpSent = true;
    },
    /** Restore session when we have a valid cookie (e.g. after page refresh). */
    restoreSession: (state) => {
      state.isAuthenticated = true;
      state.loading = false;
      state.error = null;
    },
    resetAuth: (state) => {
      return initialState;
    }
  },
});

export const { loginStart, loginSuccess, loginFailure, logout, setOtpSent, restoreSession, resetAuth } = authSlice.actions;
export default authSlice.reducer;
