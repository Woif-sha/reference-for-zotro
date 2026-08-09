import { defineConfig } from "zotero-plugin-scaffold";
import { readFile, rm, writeFile } from "node:fs/promises";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/latest/download/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",
  server: {
    asProxy: false,
  },
  build: {
    assets: ["addon/**/*.*", "NOTICE"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    esbuildOptions: [
      {
        entryPoints: [{ in: "src/index.ts", out: pkg.config.addonRef }],
        define: {
          __env__: `"${process.env.NODE_ENV ?? "production"}"`,
        },
        bundle: true,
        target: "firefox115",
        outdir: "build/addon/chrome/content/scripts",
      },
    ],
    makeUpdateJson: {
      hash: false,
    },
    hooks: {
      async "build:bundle"({ dist }) {
        const manifestPath = `${dist}/addon/manifest.json`;
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          applications?: { zotero?: { update_url?: string } };
        };
        if (manifest.applications?.zotero) {
          delete manifest.applications.zotero.update_url;
        }
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      },
      async "build:makeUpdateJSON"({ dist }) {
        await Promise.all([
          rm(`${dist}/update.json`, { force: true }),
          rm(`${dist}/update-beta.json`, { force: true }),
        ]);
      },
    },
  },
});
