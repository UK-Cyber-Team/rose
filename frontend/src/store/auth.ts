import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
  isAuthenticated: boolean;
  authRequired: boolean;
  isLoading: boolean;
}

const initialState: AuthState = {
  isAuthenticated: false,
  authRequired: false,
  isLoading: true,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuthStatus: (state, action: PayloadAction<{ authenticated: boolean; auth_required: boolean }>) => {
      state.isAuthenticated = action.payload.authenticated;
      state.authRequired = action.payload.auth_required;
      state.isLoading = false;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    logout: (state) => {
      state.isAuthenticated = false;
      state.isLoading = false;
    },
  },
});

export const { setAuthStatus, setLoading, logout } = authSlice.actions;
export default authSlice.reducer;