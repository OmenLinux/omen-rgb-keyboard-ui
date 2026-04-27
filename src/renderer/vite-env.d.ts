/// <reference types="vite/client" />

declare global {
  interface Window {
    omenShell?: import("./types").OmenShell;
    omenDriver?: import("./types").OmenDriverApi;
    omenSystem?: import("./types").OmenSystemApi;
  }
}

export {};
