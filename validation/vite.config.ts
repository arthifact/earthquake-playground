// A second dev server for the validation runner (port 5178): the app's own files, plus /__save, which writes the
// runner's seismograms to validation/out/qv/. Start it with: npx vite --config validation/vite.config.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out", "qv");

export default defineConfig({
  root: path.resolve(here, ".."),
  server: { port: 5178, strictPort: true },
  plugins: [{
    name: "validation-save",
    configureServer(server) {
      server.middlewares.use("/__save", (req, res) => {
        const name = new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "";
        if (!/^[\w.@-]+$/.test(name)) { res.statusCode = 400; res.end("bad name"); return; }
        const parts: Buffer[] = [];
        req.on("data", (b: Buffer) => parts.push(b));
        req.on("end", () => {
          fs.mkdirSync(out, { recursive: true });
          fs.writeFileSync(path.join(out, name), Buffer.concat(parts));
          res.end("ok");
        });
      });
    },
  }],
});
