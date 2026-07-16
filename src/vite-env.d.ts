/// <reference types="vite/client" />

import type { QdnRequest } from './qdnRequest';

declare const __APP_VERSION__: string;

declare global {
  interface Window {
    qdnRequest?: <T = unknown>(request: QdnRequest) => Promise<T>;
  }
}
