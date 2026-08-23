/**
 * Asserts that every `view-transition-name` this site declares resolves to
 * exactly one element, on every route.
 *
 * A `view-transition-name` must be unique within a document. A second claimant
 * does not degrade that one group — it aborts the whole transition, so every
 * animation on the page stops and the site cross-fades nowhere. The site opts
 * into transitions through `src/components/Head.astro`, which mounts Astro's
 * ClientRouter, so this is a live surface rather than a latent one.
 *
 * Nothing else here can see it. The names come from the design system's
 * stylesheet, the elements that collide come from Starlight's own nesting and
 * from the `figcaption.header` expressive-code emits per code frame, and the
 * two meet only in a rendered page. A build where every transition is dead
 * passes `astro check`, Biome, the unit tier and both postbuild gates.
 *
 * So it measures rather than reads: headless Chrome over CDP, walking every
 * element of every built route and reading `getComputedStyle(el)
 * .viewTransitionName`. Computed style is the ground truth — the name can
 * arrive through any selector in the cascade, and a stylesheet cannot tell you
 * which elements a rule found.
 *
 * Two ways to fail, and both matter:
 *
 *   1. A name claimed more than once on any route.
 *   2. No route declaring a name of its own — a stylesheet that dropped the
 *      rules entirely would otherwise read as the cleanest possible pass.
 *      `root` does not count towards that: the browser gives the document
 *      element that name whether or not any stylesheet asks, so a site naming
 *      nothing still reports one.
 *
 * Run it against a build of a version known to be broken before trusting a
 * green run. A check that has never failed is a claim about the checker, not
 * about the site.
 *
 * Usage: `node scripts/check-transitions.ts [dist-dir]`
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";

const DIST = process.argv[2] ?? "dist";

/**
 * Where Chrome is. `CHROME_PATH` first, so a runner that ships it elsewhere can
 * say so; otherwise the install paths of the platforms this repo is built on.
 * An absent browser fails — a transition check that skips itself reports a
 * green build it never looked at.
 */
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function resolveChrome(): string {
  const named = process.env.CHROME_PATH;
  if (named) {
    if (existsSync(named)) return named;
    throw new Error(`CHROME_PATH names ${named}, which does not exist.`);
  }
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (found) return found;
  throw new Error(
    ["No Chrome found. Set CHROME_PATH, or install one of:", ...CHROME_CANDIDATES].join("\n  "),
  );
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

/**
 * The tally, evaluated in the page. Elements only: a pseudo-element cannot be
 * enumerated, and the names this theme declares are all on real elements.
 */
const TALLY = `(() => {
  const claimed = {};
  for (const el of document.querySelectorAll("*")) {
    const name = getComputedStyle(el).viewTransitionName;
    if (!name || name === "none") continue;
    const classes =
      typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\\s+/).join(".")
        : "";
    (claimed[name] ||= []).push(el.tagName.toLowerCase() + classes);
  }
  return JSON.stringify(claimed);
})()`;

interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: unknown;
}

const chromePath = resolveChrome();

const files = await walk(DIST);
const routes = files
  .filter((file) => file.endsWith(".html"))
  .map((file) => `/${relative(DIST, file).replace(/index\.html$/, "")}`)
  .sort();

if (routes.length === 0) {
  console.error(`No pages under ${DIST}/ — run \`pnpm build\` first.`);
  process.exit(1);
}

// Served rather than opened as file:// — the built pages load their stylesheets
// by absolute path, and under file:// those resolve to the filesystem root.
const server = createServer((request, response) => {
  let path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  if (path.endsWith("/")) path += "index.html";
  readFile(join(DIST, path))
    .then((body) => {
      response.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
      });
      response.end(body);
    })
    .catch(() => {
      response.writeHead(404);
      response.end("not found");
    });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("the server has no port");
const origin = `http://127.0.0.1:${address.port}`;

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "check-transitions-"))}`,
    // The renderer sandbox isolates the host from untrusted page content. Every
    // page here is this repo's own build, served from loopback, so it guards
    // nothing — and it needs user namespaces a CI runner may withhold, which
    // stops the browser before it prints an endpoint. Dropped there and kept
    // everywhere else; it changes nothing this script measures.
    ...(process.env.CI ? ["--no-sandbox"] : []),
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

// Chrome prints the endpoint of the port it chose to stderr. Asked for rather
// than fixed at 9222, so a second run — or anything else already listening —
// cannot attach this one to the wrong browser.
const endpoint = await new Promise<string>((resolve, reject) => {
  let printed = "";
  const timer = setTimeout(() => reject(new Error("Chrome printed no debugging endpoint")), 30_000);
  chrome.stderr.on("data", (chunk) => {
    printed += chunk;
    const found = printed.match(/ws:\/\/\S+/);
    if (found) {
      clearTimeout(timer);
      resolve(found[0]);
    }
  });
});

const socket = new WebSocket(endpoint);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

let lastId = 0;
const replies = new Map<
  number,
  { resolve: (value: Record<string, unknown>) => void; reject: (reason: Error) => void }
>();
const listeners: { matches: (message: CdpMessage) => boolean; resolve: () => void }[] = [];

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as CdpMessage;
  const reply = message.id === undefined ? undefined : replies.get(message.id);
  if (reply && message.id !== undefined) {
    replies.delete(message.id);
    if (message.error) reply.reject(new Error(JSON.stringify(message.error)));
    else reply.resolve(message.result ?? {});
    return;
  }
  for (let index = listeners.length - 1; index >= 0; index--) {
    const listener = listeners[index];
    if (listener.matches(message)) {
      listeners.splice(index, 1);
      listener.resolve();
    }
  }
});

function send(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const id = ++lastId;
  return new Promise((resolve, reject) => {
    replies.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

function nextEvent(matches: (message: CdpMessage) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = { matches, resolve };
    listeners.push(listener);
    setTimeout(() => {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
        reject(new Error("Chrome never reported the page as loaded"));
      }
    }, 30_000);
  });
}

const { targetId } = (await send("Target.createTarget", { url: "about:blank" })) as {
  targetId: string;
};
const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as {
  sessionId: string;
};
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);

const claimants = new Map<string, Map<string, string[]>>();
for (const route of routes) {
  const loaded = nextEvent(
    (message) => message.sessionId === sessionId && message.method === "Page.loadEventFired",
  );
  await send("Page.navigate", { url: origin + route }, sessionId);
  await loaded;
  const evaluated = (await send(
    "Runtime.evaluate",
    { expression: TALLY, returnByValue: true, awaitPromise: true },
    sessionId,
  )) as { result: { value: string }; exceptionDetails?: unknown };
  if (evaluated.exceptionDetails) {
    throw new Error(`${route}: ${JSON.stringify(evaluated.exceptionDetails)}`);
  }
  claimants.set(route, new Map(Object.entries(JSON.parse(evaluated.result.value))));
}

socket.close();
chrome.kill();
server.close();

const declared = new Set([...claimants.values()].flatMap((names) => [...names.keys()]));

// `root` is the browser's, not the site's: the document element carries it with
// no stylesheet involved. Counting it would make the guard below unfailable,
// which is the shape of defect this whole script exists to catch.
const authored = [...declared].filter((name) => name !== "root");

if (authored.length === 0) {
  console.error(
    [`No route under ${DIST}/ declares a view-transition-name of its own.`, ""].join("\n"),
  );
  console.error(
    [
      "Every name resolving to at most one element is trivially true of a site",
      "that names nothing, so this run proved nothing. Either the design system",
      "stopped declaring them, or the stylesheet it declares them in stopped",
      "reaching the page.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const contested = [...claimants]
  .map(([route, names]) => ({
    route,
    disputed: [...names].filter(([, elements]) => elements.length > 1),
  }))
  .filter((entry) => entry.disputed.length > 0);

if (contested.length > 0) {
  const worst = contested
    .map((entry) => Math.max(...entry.disputed.map(([, elements]) => elements.length)))
    .sort((left, right) => right - left)[0];
  console.error(
    `${contested.length} of ${claimants.size} route(s) claim a view-transition-name more than once,` +
      ` up to ${worst} times:`,
  );
  for (const { route, disputed } of contested.slice(0, 10)) {
    for (const [name, elements] of disputed) {
      console.error(`  ${route}  ${name} claimed by ${elements.length}`);
      for (const element of elements.slice(0, 8)) console.error(`      ${element}`);
      if (elements.length > 8) console.error(`      ... ${elements.length - 8} more`);
    }
  }
  if (contested.length > 10) console.error(`  ... ${contested.length - 10} more route(s)`);
  console.error(
    [
      "",
      "A contested name aborts the entire transition, not the group that lost:",
      "every animation on the page stops. Narrow the selector until it can find",
      "only the element it means.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `transitions ok — each of ${[...declared].sort().join(", ")} resolves to exactly one element` +
    ` on all ${claimants.size} route(s).`,
);
