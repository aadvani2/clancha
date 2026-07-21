import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type UserRole = 'user' | 'moderator' | 'admin' | 'super_admin' | 'viewer';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  name?: string;
  phone?: string;
  profileImageUrl?: string;
  maxChannels: number;
  isSubscribed: boolean;
  isPictureAddonEnabled: boolean;
  subscriptionQuantity: number;
  receivingHoursStart?: string | null;
  receivingHoursEnd?: string | null;
  timezone?: string;
}

interface UserState {
  currentUser: User | null;
  loading: boolean;
  error: string | null;
}

// Helper to get user from localStorage safely
const getStoredUser = (): User | null => {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem("user");
  if (!stored) return null;
  try {
    const user = JSON.parse(stored);
    return {
      ...user,
      subscriptionQuantity: user.subscriptionQuantity ?? 0
    };
  } catch {
    return null;
  }
};

const initialState: UserState = {
  currentUser: getStoredUser(),
  loading: false,
  error: null,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    setUserLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setUser: (state, action: PayloadAction<User>) => {
      state.currentUser = action.payload;
      state.loading = false;
      state.error = null;
    },
    setUserError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    },
    clearUser: (state) => {
      state.currentUser = null;
    }
  },
});

export const { setUserLoading, setUser, setUserError, clearUser } = userSlice.actions;
export default userSlice.reducer;
