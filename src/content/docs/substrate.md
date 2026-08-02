---
title: The substrate
description: Where cloud and cluster live — landing-zone, eks-gitops, eks-fleet — and the boundaries between them.
---

The substrate is everything the platform runs on. Knowing which layer owns a change
is the single most useful thing to get right.

## The layers

| Layer                          | Repo                          | Owns                                                          |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------- |
| Cloud substrate (AWS)          | `landing-zone`                | VPC, base IAM, KMS, DNS, cluster vending, tenant datastores    |
| Agent-platform AWS substrate   | `eks-agent-platform/terraform` | Bedrock logging + guardrails, cost pipeline, kill-switch bus  |
| Cluster addons & policies      | `eks-gitops`                  | cert-manager, external-secrets, Kyverno, observability         |
| Cluster factory (the hub)      | `eks-fleet`                   | vends EKS clusters via Crossplane + provider-opentofu          |
| Local dev cluster              | `kx`                          | kind, mirrors the eks-gitops chart catalog                     |

`landing-zone` is **OpenTofu + Terragrunt**, AWS-only. `eks-gitops` is an ArgoCD
App-of-Apps addon catalog. `eks-fleet` vends clusters from a namespaced `Cluster`
resource the way the platform vends tenants: a Crossplane v2 composition renders a
`provider-opentofu` `Workspace` that runs the `landing-zone` modules, then writes the
cluster's endpoint, CA, and OIDC issuer back to the `Cluster`'s status. The IaC stays
the source of truth; Crossplane is the ordering API on top of it.

## Where boundaries sit

- **Slow-moving cloud infra** (VPC, base IAM, KMS, DNS, cluster vending) →
  `landing-zone`
- **Per-tenant stateful substrate** (databases, buckets, queues, caches, streams) →
  declared in the `Platform` CR's `spec.datastores`, provisioned from that same
  declaration by `landing-zone`'s generic `tenant-substrate` component. There is no
  per-app substrate component to write; adding a tenant is a declaration
- **Per-tenant identity and access** (the tenant IAM role, the datastore policy
  generated from `spec.datastores`, KMS grants, Bedrock model access) → the
  `eks-agent-platform` operator, via the AWS SDK. The operator holds no delete
  permission on any datastore: the isolation boundary is enforced by permission,
  not by finalizer logic
- **Cluster addons & policies** → `eks-gitops`
- **Application logic** → the tenant's own repo

If you find yourself adding cloud resources inside a chart or app-level infra code,
you're likely in the wrong layer.
