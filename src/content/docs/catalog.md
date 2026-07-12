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
  app or module in one shot (e.g. `platform-tenant`, `k8s-app-tenant`).
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

The guardrails live in `standards/*.json`: the language toolchain, version currency,
the platform-tenant contract, the LLM policy, and the quality rubric's dimension
names + canonical lens per dimension. They're what the merge gate grades against.
