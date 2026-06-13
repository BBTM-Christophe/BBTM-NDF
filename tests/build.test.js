const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("package exposes the build command expected by the deploy platform", () => {
  assert.equal(packageJson.scripts.build, "node scripts/build.js");
});

test("Cloudflare Pages uses the generated dist directory", () => {
  const wrangler = fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
  assert.match(wrangler, /pages_build_output_dir\s*=\s*"dist"/);
});

test("Netlify serves the generated dist directory and keeps functions enabled", () => {
  const netlify = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  assert.match(netlify, /publish\s*=\s*"dist"/);
  assert.match(netlify, /functions\s*=\s*"netlify\/functions"/);
});
