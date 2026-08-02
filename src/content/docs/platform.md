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

- **Pod Identity** — a scoped AWS identity, bound to the tenant's service account
  through the EKS API. No role-arn annotation, no OIDC provider
- **ResourceQuota** — the tenant's compute envelope
- **NetworkPolicy** — default-deny egress with the allowances the app declares
- **AppProject** — the ArgoCD project the tenant deploys within

Model access is declared in `spec.identity` and reconciled to the tenant's IAM by
the operator — never pasted as an inline role. The tenant's stateful substrate is
declared the same way, in `spec.datastores`: databases, buckets, queues, caches and
streams are a list on the CR, and the access policy scoped to them is generated
from that list. Adding a tenant is a declaration, not a hand-written component.

## The deploy trio

The `Platform` CR is one of three artifacts every app ships:

1. the **Helm chart** (`<app>/chart/`)
2. the **`Platform` CR** (the boundary)
3. the **ApplicationSet entry** (the GitOps home)

## Runtime shapes

Agent work runs in one of four shapes, picked by how long a unit of work lives:

- **AgentFleet** — a Deployment per agent, scaled by KEDA, behind a per-fleet
  NetworkPolicy. For work that is always on.
- **AgentSandbox** — one hardened pod for one session, TTL'd afterward, optionally
  on an isolating `RuntimeClass`. For work that is untrusted or one-shot.
- **SandboxPool** — workers draining a Managed Agents self-hosted environment's
  queue, so Anthropic runs the agent loop and the cluster runs the tool calls.
- **BatchJob** — one Bedrock batch-inference job, S3 in and S3 out. For work that
  does not need to be online at all.

All four run in the tenant's namespace, and the first two carry the tenant's
identity: an `AgentFleet` Deployment and an `AgentSandbox` pod both run the
tenant's own image under the tenant's ServiceAccount. There is no
platform-supplied agent runtime and no shared tool server, which is the point —
an action an agent takes is taken *as the tenant*, and the Kubernetes audit log
records the tenant's identity against it. A tool server would break that: it
executes the agent's actions under its own identity, and once the audit log names
the tool server, an agent's claim about what it did can be neither confirmed nor
refuted.

A `SandboxPool` worker is the deliberate exception. It runs the platform's
sandbox-worker image with no ServiceAccount token mounted at all, because the code
it executes arrives from Anthropic's loop rather than from the tenant's build —
untrusted, and so given nothing to be trusted with.

Model access goes through the tenant's **ModelGateway** — a per-Platform gateway
that fronts Bedrock behind named routes. An agent is given a route name; the
operator resolves it to an endpoint and a wire format. Anything that speaks that
format is a valid agent, whatever framework is inside the image.

Every field of every one of these is in the
[resource reference](/platform/resources/), generated from the CRDs the operator
ships.
