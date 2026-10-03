// Minimal typing for the jsdom surface the fixture scripts use (avoids adding @types/jsdom).
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    readonly window: Window & typeof globalThis;
  }
}
