// Construit dist-artifact/index.html : la démo complète en un seul fichier.
// Usage : node artifact/build.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "dist-artifact");
mkdirSync(out, { recursive: true });

const globals = {
  name: "react-globals",
  setup(b) {
    b.onResolve({ filter: /^(react|react-dom|react-dom\/client|react\/jsx-runtime)$/ }, (a) => ({ path: a.path, namespace: "g" }));
    b.onLoad({ filter: /.*/, namespace: "g" }, (a) => ({
      contents:
        a.path === "react/jsx-runtime"
          ? `const R = window.React; const mk = (t, p, k) => R.createElement(t, k === undefined ? p : { ...p, key: k });
             module.exports = { jsx: mk, jsxs: mk, Fragment: R.Fragment };`
          : a.path === "react"
            ? "module.exports = window.React;"
            : "module.exports = window.ReactDOM;",
      loader: "js",
    }));
    const shim = (p) => ({ path: path.join(root, "artifact/shims", p) });
    b.onResolve({ filter: /^next\/link$/ }, () => shim("next-link.tsx"));
    // La démo n'utilise jamais Supabase : on évite d'embarquer le SDK
    b.onResolve({ filter: /supabase\/browser$/ }, () => shim("no-supabase.ts"));
    b.onResolve({ filter: /^next\/navigation$/ }, () => shim("next-navigation.ts"));
  },
};

const js = await build({
  entryPoints: [path.join(root, "artifact/main.tsx")],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  absWorkingDir: root,
  tsconfig: path.join(root, "tsconfig.json"),
  plugins: [globals],
  define: {
    "process.env.NEXT_PUBLIC_SUPABASE_URL": '""',
    "process.env.NEXT_PUBLIC_DEMO_MODE": '"true"',
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "error",
});
let bundle = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

execFileSync("npx", ["@tailwindcss/cli", "-i", "src/app/globals.css", "-o", path.join(out, "app.css"), "--minify"], { cwd: root, stdio: "pipe" });
const css = readFileSync(path.join(out, "app.css"), "utf8").replaceAll('"Hanken Grotesk Variable"', '"Hanken Grotesk"');

const html = `<title>Moncleur</title>
<meta name="description" content="Démo interactive de Moncleur : abonnements floraux, espace fleuriste et administration.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300..800&family=Instrument+Serif:ital@0;1&display=swap">
<style>${css}
html,body{background:#fcf3f5;color:#2b1030;color-scheme:light}
</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${bundle}</script>
`;
writeFileSync(path.join(out, "index.html"), html);
console.log("dist-artifact/index.html", (html.length / 1024).toFixed(0) + " KB");
