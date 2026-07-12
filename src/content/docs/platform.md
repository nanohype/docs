---
title: Platform tenants
description: The Platform CR — the tenant boundary the eks-agent-platform operator reconciles.
---

Every factory-built app runs as a **Platform tenant** on
[`eks-agent-platform`](https://github.com/nanohype/eks-agent-platform), the
k8s-native control plane.

## The boundary

A `Platform` custom resource draws the tenant boundary. The operator reconciles it
into:

- **IRSA / Pod Identity** — a scoped AWS identity for the tenant's workloads
- **ResourceQuota** — the tenant's compute envelope
- **NetworkPolicy** — default-deny egress with the allowances the app declares
- **AppProject** — the ArgoCD project the tenant deploys within

Model access is declared in `spec.identity` and reconciled to the tenant's IAM by
the operator — never pasted as an inline role.

## The deploy trio

The `Platform` CR is one of three artifacts every app ships:

1. the **Helm chart** (`<app>/chart/`)
2. the **`Platform` CR** (the boundary)
3. the **ApplicationSet entry** (the GitOps home)

## Runtime shapes

Two agent-runtime CRDs sit on the platform:

- **AgentFleet** — kagent + agentgateway, managed
- **AgentSandbox** — the `fab` SdkRuntime, direct, attributable

Pick the shape by whether the workload needs the managed gateway or a direct,
attributable runtime.
