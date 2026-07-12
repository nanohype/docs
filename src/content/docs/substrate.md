---
title: The substrate
description: Where cloud and cluster live — landing-zone, eks-gitops, eks-fleet — and the boundaries between them.
---

The substrate is everything the platform runs on. Knowing which layer owns a change
is the single most useful thing to get right.

## The layers

| Layer                          | Repo                 | Owns                                                    |
| ------------------------------ | -------------------- | ------------------------------------------------------ |
| Cloud substrate (AWS)          | `landing-zone`       | VPC, base IAM, KMS, DNS, cluster vending, per-app infra |
| Cluster addons & policies      | `eks-gitops`         | cert-manager, external-secrets, Kyverno, observability |
| Cluster factory (the hub)      | `eks-fleet`          | vends EKS clusters via Crossplane → CAPA day-2          |
| Local dev cluster              | `kx`                 | kind, mirrors the eks-gitops chart catalog             |

`landing-zone` is **OpenTofu + Terragrunt**, AWS-only. `eks-gitops` is an ArgoCD
App-of-Apps addon catalog. `eks-fleet` vends clusters from a namespaced `Cluster`
resource the way the platform vends tenants.

## Where boundaries sit

- **Slow-moving cloud infra** (VPC, base IAM, KMS, DNS, per-app substrate) →
  `landing-zone`
- **Per-tenant fast-moving AWS state** (tenant IAM roles, KMS grants, bucket
  policies, model access) → the `eks-agent-platform` operator, via the AWS SDK
- **Cluster addons & policies** → `eks-gitops`
- **Application logic** → the tenant's own repo

If you find yourself adding cloud resources inside a chart or app-level infra code,
you're likely in the wrong layer.
