---
title: Quickstart
description: Scaffold your first artifact from the nanohype catalog, and see how it becomes a Platform tenant.
---

The fastest way into nanohype is to scaffold something from the catalog and watch
how it lands as a Platform tenant.

## Prerequisites

- Node.js (latest LTS) and `pnpm`
- Access to the catalog via the `@nanohype/sdk` package or the `@nanohype/mcp` server

## Scaffold from the catalog

Pick a template or composite and render it:

```sh
# list what the catalog offers
npx @nanohype/sdk list

# scaffold a new tenant app
npx @nanohype/sdk scaffold k8s-app-tenant --name my-app
```

Every factory-built app ships as the same trio:

1. A **Helm chart** in `<app>/chart/` — the application.
2. A **`Platform` CR** — the tenant boundary (IRSA, ResourceQuota, NetworkPolicy, AppProject).
3. An **ApplicationSet entry** referenced by the right GitOps repo.

## What comes next

- To understand the pipeline that turns a brief into merged code, read
  [How the factory works](/factory/).
- To see the boundary your app runs inside, read [Platform tenants](/platform/).
- Cloud gaps land as `landing-zone` components; new addons land in `eks-gitops` —
  never as in-app infra. See [The substrate](/substrate/).
