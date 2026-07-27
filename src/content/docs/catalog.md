---
title: Templates & catalog
description: The template and composite catalog — the factory's vocabulary — and how the SDK and MCP server render it.
---

The [`nanohype`](https://github.com/nanohype/nanohype) repo is the factory's
vocabulary: the template + composite catalog, the standards, the Platform Reference,
and the SDK + MCP server that render it all.

## Templates and composites

- **Templates** (`templates/`) — single building blocks, each with declared
  variables and a rendered output shape.
- **Composites** (`composites/`) — assemblies of templates that scaffold a whole
  app or module in one shot (e.g. `platform-tenant`, `rag-agent`). The
  `platform-tenant` composite pulls in the `k8s-app-tenant` template, which is
  where the chart and the `Platform` CR come from.
- **`catalog.json`** — the index the SDK and MCP resolve against.

## Rendering

Two front doors render the same catalog:

- **`@nanohype/sdk`** — the programmatic path; resolves a template, fills variables,
  and writes the output.
- **`@nanohype/mcp`** — the MCP server, so an agent can `get_template`,
  `get_composite`, `get_standard`, and `search_templates` directly.

## The escape hatch

The default path is k8s. When a workload isn't pod-shaped — Lambda, edge, a static
site — the explicit `infra-aws` template takes the sanctioned AWS/OpenTofu path
instead. (This docs site is one such case.)

## Standards

Ten guardrails live in `standards/*.json`. They're what the merge gate grades
against:

| Standard                    | Covers                                                            |
| --------------------------- | ----------------------------------------------------------------- |
| `language-toolchain`        | build, lint, test, and docs commands per language                 |
| `version-currency`          | current stable runtimes and deps — no inherited defaults          |
| `platform-tenant-contract`  | the three artifacts every k8s deliverable ships                   |
| `llm-policy`                | Claude as the primary model, Bedrock as the delivery path         |
| `quality-rubric-dimensions` | the ten grading dimensions + the canonical lens for each          |
| `testing-rubric`            | the Testing-Trophy distribution and the coverage floor            |
| `observability-slo`         | RED/USE, the golden signals, burn-rate error budgets              |
| `resource-naming`           | the naming grammar for cloud and k8s resources                    |
| `resource-tagging`          | the org-wide tag / label / OTel-attribute taxonomy                |
| `seo-baseline`              | one canonical origin + the discovery artifacts a public site ships |
