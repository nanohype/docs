---
title: Crossplane orders the IaC
description: Why vending a cluster is a Kubernetes object that runs the OpenTofu modules, rather than a second definition of the same infrastructure.
---

## The constraint

Vending a cluster is a long, ordered, partly-failing sequence: a network, then a
control plane, then an identity layer, then the addons that make it usable — and
several steps cannot start until an earlier one has published a value that did not
exist when the sequence began.

Two things are wanted from that:

1. **An object with a status.** Something to `kubectl get`, something a controller
   re-drives when a step fails, something a portal can watch.
2. **No second copy of the infrastructure.** The substrate is already defined as
   OpenTofu modules that people run, review and reason about. A second definition
   in a different language is a second thing to keep true.

Most tools give you one or the other.

## The shape

A namespaced `Cluster` resource is the API. A Crossplane composition renders it
into two `provider-opentofu` `Workspace`s, each pointing at a **`landing-zone`
module** — `cluster-stack` for the network and control plane, `cluster-bootstrap`
for identity and the ArgoCD/Cilium layer. The bootstrap Workspace only renders
once `cluster-stack` has published an endpoint to the composite's status, so it
never plans against an empty one. When both converge, the `Cluster` goes ready.

The modules are unchanged. They are the same OpenTofu a person runs with
Terragrunt, from the same repo, at a **pinned commit SHA**. Crossplane contributes
ordering, readiness, re-drive and a status field — and contributes nothing to the
definition of what a cluster is.

That is the whole decision: **Crossplane is the ordering API over the IaC, not a
replacement for it.** If Crossplane were removed tomorrow, the modules would still
describe every resource, and a person could still apply them by hand.

## Alternatives

**Crossplane managed resources (`provider-aws`) for everything.** The idiomatic
Crossplane answer, and it means the VPC, the cluster and the node groups are all
declared as Kubernetes objects. It also means the infrastructure is now defined
twice — once in the modules everyone else runs, once in compositions — in two
languages with two drift stories. The two copies agree until the first time
someone changes only one.

**Cluster API for AWS (CAPA).** A mature, purpose-built cluster API with real
community weight. It is a genuinely reasonable alternative and the trade is
specific: CAPA owns the cluster but not the account's VPC, IAM, KMS or DNS, so a
cluster and the substrate it sits in come from two different systems with two
different reconciliation models. Running the substrate's own modules keeps the
cluster and everything under it in one lineage.

**A CI pipeline that runs Terragrunt.** Simplest thing that works, and the org
still does exactly this for the account-level substrate. What it does not give you
is an object: no status to watch, no controller to re-drive a failed step, no way
for the portal to show a vend in progress without scraping logs.

## What it costs

**The module ref is pinned to a SHA, and that is not a nicety.**
`provider-opentofu` caches modules by ref and never re-pulls, so a moving ref like
`?ref=main` is not reproducible — two vends of the "same" configuration can
produce different infrastructure. Pinning means bumping the substrate is an
explicit commit, and the composition's default and the XRD's default have to move
together or a vend silently uses the older one.

**A second control plane is a second thing that can be down.** Crossplane, the
provider, and the function pipeline are all real components with real failure
modes. The sharpest one is operational rather than architectural: cycling the
provider pod mid-apply can leave a Workspace wedged in a state that needs manual
intervention on both the Kubernetes and AWS sides.

**Debugging crosses a language boundary.** A failure surfaces as a condition on a
`Workspace`, and the actual error is OpenTofu output inside it. Reading it means
understanding both the Crossplane object model and the module — one more layer
between the symptom and the cause than either alone.

**Composition logic is templating, and templating has sharp edges.** The
composition renders Workspace variables with Go templates: scalars as quoted
strings that tofu coerces, lists JSON-encoded so they arrive as real lists. Spec
lookups use `dig` rather than `default`, specifically so that an explicit `false`,
`0`, or empty list is honoured instead of collapsing back to a default. That is a
correct and deliberate detail, and it is also the kind of thing that is wrong
before anyone notices, because the wrong value is a *valid* value.
