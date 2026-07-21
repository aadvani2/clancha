import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface BillingInfo {
  status: 'active' | 'past_due' | 'canceled' | 'none';
  plan: 'basic' | 'pro'; // basic: £14.99, pro: includes add-ons
  nextBillingDate?: string;
  hasImageAddon: boolean;
}

interface BillingState {
  billingInfo: BillingInfo | null;
  loading: boolean;
  error: string | null;
}

const initialState: BillingState = {
  billingInfo: null,
  loading: false,
  error: null,
};

const billingSlice = createSlice({
  name: "billing",
  initialState,
  reducers: {
    setBillingLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setBillingInfo: (state, action: PayloadAction<BillingInfo>) => {
      state.billingInfo = action.payload;
      state.loading = false;
      state.error = null;
    },
    updateImageAddon: (state, action: PayloadAction<boolean>) => {
      if (state.billingInfo) {
        state.billingInfo.hasImageAddon = action.payload;
      }
    },
    setBillingError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    }
  },
});

export const { setBillingLoading, setBillingInfo, updateImageAddon, setBillingError } = billingSlice.actions;
export default billingSlice.reducer;
