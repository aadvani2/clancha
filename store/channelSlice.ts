import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface Channel {
  id: string;
  name: string;
  status: 'active' | 'view-only' | 'cancelled';
  user1Id: string;
  user2Id: string;
  assignedPhoneNumber?: string;
  childrenRefs?: string[];
  createdAt: string;
}

interface ChannelState {
  channels: Channel[];
  loading: boolean;
  error: string | null;
  selectedChannelId: string | null;
}

const initialState: ChannelState = {
  channels: [],
  loading: false,
  error: null,
  selectedChannelId: null,
};

const channelSlice = createSlice({
  name: "channel",
  initialState,
  reducers: {
    setChannelLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setChannels: (state, action: PayloadAction<Channel[]>) => {
      state.channels = action.payload;
      state.loading = false;
      state.error = null;
    },
    addChannel: (state, action: PayloadAction<Channel>) => {
      state.channels.push(action.payload);
    },
    updateChannelStatus: (state, action: PayloadAction<{ id: string, status: Channel['status'] }>) => {
      const channel = state.channels.find(c => c.id === action.payload.id);
      if (channel) {
        channel.status = action.payload.status;
      }
    },
    setSelectedChannel: (state, action: PayloadAction<string>) => {
      state.selectedChannelId = action.payload;
    },
    setChannelError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    }
  },
});

export const { setChannelLoading, setChannels, addChannel, updateChannelStatus, setSelectedChannel, setChannelError } = channelSlice.actions;
export default channelSlice.reducer;
