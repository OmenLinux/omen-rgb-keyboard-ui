/// <reference types="vite/client" />

declare global {
  interface Window {
    omenShell?: import("./types").OmenShell;
    omenDriver?: import("./types").OmenDriverApi;
    omenSystem?: import("./types").OmenSystemApi;
    omenOptimus?: import("./types").OmenOptimusApi;
    omenUpdater?: import("./types").OmenUpdaterApi;
  }
}

export {};
