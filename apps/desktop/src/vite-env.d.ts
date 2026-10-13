/// <reference types="vite/client" />

/** App version, injected at build time from package.json (Vite `define`). */
declare const __APP_VERSION__: string;

/** Colour custom properties generated from `shared/theme/palette.ts` (`vite/paletteCss.ts`). */
declare module 'virtual:palette.css';
