---
title: Layers are drawn by rate of change
description: Why the same change has exactly one correct repo, and how to tell which one without asking.
---

## The constraint

A platform this size can absorb the same change in four different places. Adding a
VPC endpoint could plausibly be cloud infrastructure, a cluster addon's
prerequisite, or a line in the application's own Terraform. All three work. Two
of them are wrong in a way that only becomes visible a year later, when the third
team hits the same need and adds a fourth copy.

The constraint is not "keep things tidy." It is that a change needs **one findable
home**, and the rule for finding it has to be applicable by someone who has not
read the whole system.

## The shape

The line is drawn by **what moves at the same rate under the same lifecycle**.

| Layer | Repo | Changes when |
| --- | --- | --- |
| Cloud substrate | `landing-zone` | The account's shape changes — VPC, base IAM, KMS, DNS, cluster vending |
| Agent-platform AWS substrate | `eks-agent-platform/terraform` | The platform's own AWS services change — Bedrock logging, cost pipeline, kill-switch bus |
| Cluster addons | `eks-gitops` | What ArgoCD installs changes — cert-manager, external-secrets, Kyverno, observability |
| Cluster factory | `eks-fleet` | How a cluster is vended changes |
| Tenant boundary | `eks-agent-platform` CRDs | What a tenant *is* changes |
| Application logic | the tenant's own repo | The product changes |

The useful property of "rate of change" as the criterion is that it is observable
without understanding the architecture. A VPC changes when the account's shape
changes, which is rarely and for everyone. An application's routes change daily
and for one team. Those two things do not belong in the same repository no matter
how conceptually related they seem, because the review, the blast radius and the
rollback story are all different.

There is one test that catches most mistakes:

> If you are adding cloud resources inside a Helm chart, or infrastructure code
> inside an application repo, you are in the wrong layer.

It catches the common error, which is not misfiling a change — it is a team
solving its own problem locally because the correct layer is someone else's repo.
That impulse is reasonable and it is exactly what produces the fourth copy.

## Alternatives

**Colocate infrastructure with the application.** Genuinely faster for the team
doing it, and the standard advice for a single service. It fails on the *N*th
copy: every app grows its own opinion about VPC endpoints, log retention and
bucket encryption, and they drift silently because nothing compares them. The org
has one foundation precisely so that a shared primitive lives in one consumed
place rather than in per-repo copies.

**A monorepo.** Removes the cross-repo seams entirely, which is a real benefit —
most of the gates described below would not need to exist. It also puts a VPC
change and a copy edit through the same review, the same CI and the same blast
radius, and it collapses the public/private line the org needs for a substrate
that ships publicly and tenants that do not.

**Organize by team.** Boundaries follow the org chart until the org chart changes,
and then the repos are wrong and nobody can say why.

## What it costs

**Cross-layer work is several PRs, in order, across several repos.** Not one.
Wiring a new addon that a tenant needs can mean a `landing-zone` component, an
`eks-gitops` catalog entry, and a CRD field — three reviews, three CI runs, and a
sequence that has to be respected. This is the direct cost of the boundary and it
is paid on every change that genuinely spans layers.

**The seams become string contracts, and strings can be wrong silently.** Layers
that cannot import each other communicate by name: an SSM parameter path, a
cluster-Secret annotation, an EventBridge `source`, a ServiceAccount name. Every
one of those is a place where two repos can disagree, and none of them produce an
error when they do — the reader simply finds nothing and carries on. That is why
a disproportionate share of this org's CI is not testing behaviour but asserting
that a name on one side of a boundary matches the name on the other.

**A boundary is only as real as its enforcement.** Nothing structurally prevents
someone from adding an `aws_s3_bucket` to a chart's Terraform. The rule holds
because reviews and gates hold it, not because the layering makes the wrong thing
impossible.

**Finding the right layer requires knowing the map.** The test above catches the
common case, but a genuinely novel change — where does GPU scheduling policy
live? — still needs someone who knows the system. The layer map is documentation,
not a type system.
