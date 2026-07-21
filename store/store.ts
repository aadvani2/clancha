import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./authSlice";
import userReducer from "./userSlice";
import channelReducer from "./channelSlice";
import billingReducer from "./billingSlice";

export const makeStore = () => {
  return configureStore({
    reducer: {
      auth: authReducer,
      user: userReducer,
      channel: channelReducer,
      billing: billingReducer,
    },
  });
};

// Infer the type of makeStore
export type AppStore = ReturnType<typeof makeStore>;
// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
