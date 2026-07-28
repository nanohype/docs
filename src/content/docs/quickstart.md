---
title: Quickstart
description: Scaffold your first artifact from the nanohype catalog, and see how it becomes a Platform tenant.
---

The fastest way into nanohype is to scaffold something from the catalog and watch
how it lands as a Platform tenant.

## Prerequisites

- Node.js (latest LTS)
- The `@nanohype/sdk` package, or the `@nanohype/mcp` server if you are driving this from an agent

## Scaffold from the catalog

The SDK ships a `nanohype` binary. Install it once:

```sh
npm install -g @nanohype/sdk
```

Pick a template or composite and render it:

```sh
# list what the catalog offers
nanohype list

# and the composites
nanohype list --composites

# scaffold a new tenant app into ./my-app
nanohype scaffold k8s-app-tenant \
  --var AppName=my-app \
  --var AppMetric=my_app \
  --var Tenant=growth \
  --var Image=ghcr.io/your-org/my-app \
  -o my-app
```

`AppName`, `Tenant` and `Image` are required. `AppMetric` is the metric-name
prefix and defaults to `AppName` — single-word names need nothing, but a
hyphenated name has to be given in its underscored form, since metric names
cannot contain dashes.

Without a global install, run it through the package:

```sh
npx --package=@nanohype/sdk nanohype list
```

Every factory-built app ships as the same trio:

1. A **Helm chart** in `<app>/chart/` — the application.
2. A **`Platform` CR** — the tenant boundary (Pod Identity, ResourceQuota, NetworkPolicy, AppProject).
3. An **ApplicationSet entry** referenced by the right GitOps repo.

## What comes next

- To understand the pipeline that turns a brief into merged code, read
  [How the factory works](/factory/).
- To see the boundary your app runs inside, read [Platform tenants](/platform/).
- Cloud gaps land as `landing-zone` components; new addons land in `eks-gitops` —
  never as in-app infra. See [The substrate](/substrate/).
