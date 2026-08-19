import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * Asserts that the commands this repo declares, documents and runs are the
 * same set.
 *
 * Three artifacts describe the same thing and are maintained separately:
 * `package.json`'s scripts, the command block in each of the three files a
 * contributor or an agent reads, and the `run:` steps in `ci.yml`. Nothing
 * couples them, and they have already come apart in both directions.
 *
 * Once a gate was documented and not run: `pnpm check` was declared as a
 * script and named in all three files as the type gate, and appeared zero
 * times in `ci.yml`. A TypeScript 7 bump then merged green while asserting the
 * repo "typechecks with it directly", because no job was in a position to
 * contradict it. Assertion 3 below fails on that commit.
 *
 * Once a gate was run and not documented: `pnpm test` was added with a unit
 * tier and wired into CI, and none of the three files learned about it — one
 * of them still described the repo as having no test surface. Assertion 1
 * fails on that.
 *
 * This lives beside check-links.ts and check-vocabulary.ts because it asserts
 * something about the repo rather than about a function, which is where a
 * reader looks for that. It runs under vitest rather than in postbuild because
 * it reads source, not `dist/`, so it needs no build.
 */

interface PackageJson {
  scripts: Record<string, string>;
}

const pkg: PackageJson = JSON.parse(readFileSync("package.json", "utf8"));

/**
 * Commands a contributor is expected to run by hand, and which every file that
 * enumerates commands must therefore name.
 *
 * Explicit rather than derived from `pkg.scripts`, so that adding a script does
 * not silently acquire a documentation obligation — `prebuild` and `postbuild`
 * are lifecycle hooks npm runs on your behalf and belong in no command block.
 * The list is the declaration: dropping an entry is a deliberate act with a
 * diff, which is the property that makes this hold.
 */
const CONTRIBUTOR_FACING = ["dev", "build", "lint", "format", "check", "test", "preview"];

/**
 * The subset CI has to actually run. A gate nobody invokes is not a gate, and
 * the failure is invisible precisely because everything else about it — the
 * script, the docs, the reviewer's memory — still says it exists.
 */
const GATES = ["test", "build", "check", "lint"];

/** Every file that enumerates commands. All three must agree. */
const DOCS = ["README.md", "AGENTS.md", "CLAUDE.md"];

/**
 * pnpm's own subcommands. They appear in the docs beside the scripts and are
 * not scripts, so assertion 2 has to know the difference rather than reporting
 * `pnpm install` as an undeclared command.
 */
const PNPM_BUILTINS = new Set(["install", "add", "remove", "up", "dlx", "exec", "why", "view"]);

/** Every `pnpm <name>` a piece of text mentions, in either spelling. */
function pnpmCommandsIn(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/\bpnpm (?:run )?([a-z][a-z0-9:-]*)/g)].map((match) => match[1]),
  );
}

/**
 * The shell of every `run:` step in a workflow.
 *
 * Parsed, not grepped, and the distinction is the point. `ci.yml` mentions
 * `pnpm format` in a comment explaining that CI deliberately never writes, so
 * a text search for it reports a gate as wired that nothing invokes — the
 * right string in the wrong place. Reading `run:` values is what makes
 * assertion 3 able to tell "the gate runs" from "the gate is named somewhere
 * in this file". Do not simplify this to a grep.
 */
function runSteps(workflow: string): string[] {
  const parsed = parse(readFileSync(workflow, "utf8")) as {
    jobs: Record<string, { steps?: { run?: string }[] }>;
  };
  return Object.values(parsed.jobs).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => (step.run ? [step.run] : [])),
  );
}

/**
 * The lists above are only worth what their accuracy is worth. A name that has
 * been renamed or removed in package.json would make every assertion below
 * pass while checking a command nobody can run.
 */
describe("the declarations", () => {
  it.each([...CONTRIBUTOR_FACING, ...GATES])("names %s, which package.json declares", (name) => {
    expect(Object.keys(pkg.scripts)).toContain(name);
  });
});

describe("1. every contributor-facing command is documented", () => {
  it.each(DOCS)("%s enumerates commands at all", (doc) => {
    // Guards the scan itself. If the shape of these files ever changes so that
    // no `pnpm` invocation is found, every assertion below it would pass by
    // matching nothing — the failure mode this whole file exists to catch.
    expect(pnpmCommandsIn(readFileSync(doc, "utf8")).size).toBeGreaterThan(0);
  });

  for (const doc of DOCS) {
    it.each(CONTRIBUTOR_FACING)(`${doc} documents pnpm %s`, (script) => {
      expect([...pnpmCommandsIn(readFileSync(doc, "utf8"))]).toContain(script);
    });
  }
});

describe("2. every documented command exists", () => {
  it.each(DOCS)("%s names no command this repo cannot run", (doc) => {
    const named = [...pnpmCommandsIn(readFileSync(doc, "utf8"))];
    const unknown = named.filter((name) => !PNPM_BUILTINS.has(name) && !(name in pkg.scripts));
    expect(unknown).toEqual([]);
  });
});

describe("3. every gate runs in CI", () => {
  const steps = runSteps(".github/workflows/ci.yml");

  it("finds run steps to check", () => {
    // Same guard as assertion 1's. A workflow that parsed to zero run steps —
    // a renamed `jobs:` key, a restructure — would pass every gate check below
    // by having nothing to disagree with.
    expect(steps.length).toBeGreaterThan(0);
  });

  it.each(GATES)("ci.yml runs pnpm %s", (gate) => {
    const invoked = steps.some((step) => pnpmCommandsIn(step).has(gate));
    expect(invoked).toBe(true);
  });
});
