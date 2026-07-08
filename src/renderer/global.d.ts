import type { EyeProtectApi } from '../shared/types';

declare global {
  interface Window {
    eyeProtect: EyeProtectApi;
  }
}

export {};
