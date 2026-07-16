/// <reference types="vite/client" />

import type { QdnRequest } from './qdnRequest';

declare const __APP_VERSION__: string;

declare global {
  interface Window {
    _qdnIdentifier?: unknown;
    _qdnName?: unknown;
    _qdnService?: unknown;
    qdnRequest?: <T = unknown>(request: QdnRequest) => Promise<T>;
  }
}
