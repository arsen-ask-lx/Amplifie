import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const makefile = await readFile(new URL("../../Makefile", import.meta.url), "utf8");

function recipe(target) {
  const lines = makefile.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${target}:`));
  assert.notEqual(start, -1, `цель ${target} найдена`);

  return lines
    .slice(start + 1)
    .slice(
      0,
      lines.slice(start + 1).findIndex((line) => /^[A-Za-z_-]+:/.test(line)),
    )
    .filter((line) => line.startsWith(">"))
    .join("\n");
}

test("make work starts dependencies without rebuilding the assembled frontend", () => {
  const declaration = makefile.match(/^work:(.*)$/m)?.[1] ?? "";
  assert.match(declaration, /\bdev-deps\b/);
  assert.doesNotMatch(recipe("work"), /--build/);
  assert.match(recipe("dev-deps"), /postgres api/);
  assert.doesNotMatch(recipe("dev-deps"), /--build/);
});

test("make test-ui rebuilds the assembled Caddy artifact before Playwright", () => {
  const commands = recipe("test-ui");
  assert.match(commands, /up -d --build/);
  assert.ok(commands.indexOf("--build") < commands.indexOf("playwright"));
});

test("runtime probe classifies an explicit server marker instead of a process", async () => {
  const { classifyRuntime } = await import("./dev-status.mjs");
  assert.equal(classifyRuntime("vite-dev"), "Vite");
  assert.equal(classifyRuntime("caddy-static"), "Caddy");
  assert.equal(classifyRuntime(null), "unknown");
});
