---
title: Repos
description: The canonical nanohype repos and the role each plays in the factory.
---

Every repo in the org is one of three things: **factory context**, **factory
output**, or the **factory itself**.

## Factory context & the factory

| Repo                 | Role                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `nanohype`           | Templates + composites + standards + the SDK/MCP — the vocabulary    |
| `fab`                | The factory client — orchestration, roster, merge gate, transports   |
| `landing-zone`       | OpenTofu/Terragrunt AWS cloud substrate                              |
| `eks-gitops`         | EKS ArgoCD addon catalog                                             |
| `eks-agent-platform` | k8s-native control plane — the `Platform` CR + operator             |
| `eks-fleet`          | Cluster factory — vends EKS clusters via Crossplane                 |
| `kx`                 | Local kind workspace mirroring the eks-gitops catalog               |
| `portal`             | Self-hosted ops portal over the substrate                          |
| `cloudgov`           | AWS governance CLI (IAM, cost, posture, drift)                     |

## Factory output

Standalone Platform-tenant apps, each a Helm chart + `Platform` CR:

- `competitive-intelligence` — competitor-change radar
- `incident-response` — incident commander
- `digest-pipeline` — weekly newsletter
- `slack-knowledge-bot` — ACL-filtered retrieval

## Design principle

This is a greenfield system: every repo presents as a single-generation design,
architected in its current shape. Shared primitives and tooling presets live in
consumed packages, not per-repo copies that drift.
