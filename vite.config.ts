import { createRequire } from "node:module";
import path from "path";
import type { Connect } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);

function devServerMachineModel(): string {
  try {
    const { getMachineModelLabel } = require("./electron/machineModel.js") as {
      getMachineModelLabel: () => string;
    };
    return getMachineModelLabel() + " Laptop";
  } catch {
    return "This PC";
  }
}

const devMachineModelMiddleware: () => Connect.NextHandleFunction = () => (req, res, next) => {
  const url = req.url ?? "";
  if (!url.startsWith("/__omen_dev/machine-model") || req.method !== "GET") {
    next();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ model: devServerMachineModel() }));
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: "omen-dev-machine-model",
      configureServer(server) {
        server.middlewares.use(devMachineModelMiddleware());
      },
    },
  ],
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
});
