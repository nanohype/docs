---
title: How this fails
description: The failure class a Kubernetes platform actually has — every object valid, every controller healthy, and the path through them dead — with the shapes it takes here, what to look at, and what healthy looks like.
---

Most platform documentation describes the working state. This describes the
broken ones, because they are not obvious and because the interesting ones do
not announce themselves.

## The dominant class

The failure this system has is not a crash. It is:

> **every object is valid, every controller is healthy, and the path through them
> is dead.**

Nodes are `Ready`. Pods are `Running`. Applications are `Synced`. The manifests
pass schema validation, the formatters pass, the policy engine admits everything,
and a request — or a credential, or a telemetry export, or a reconcile — does not
arrive.

This class dominates because of what a manifest gate can see. A gate reads
whether an object is *well-formed and internally consistent*. Whether the object
does anything is a different question, and answering it requires the object to
exist somewhere with the things it refers to.

Two properties make it worse than an ordinary bug:

- **Silence is the default symptom.** A dropped telemetry export looks exactly
  like no traffic. A policy that matches nothing looks exactly like a policy with
  nothing to deny.
- **The report names the wrong component.** Whatever was waiting reports its own
  subject, which is rarely the thing that failed.

## The shapes it takes here

### A value that is legal in the manifest and illegal where it lands

A field typed `string` in a CRD schema accepts any string. The place that string
eventually goes may have a grammar the schema does not know about.

A Kubernetes **label value** is `[A-Za-z0-9]` joined by `-`, `_` or `.`, at most
63 characters. A slash is legal in a label *key's* prefix and in an AWS tag
value, and nowhere else. So the same logical dimension — the repository a
resource came from — is spelled `org/name` as an AWS tag and `org.name` as a
label, and a single canonical spelling would be wrong on one of the two
surfaces. The [tagging standard](/catalog/standards/) states the per-surface
transform for exactly this reason.

The same shape appears where a component reserves a namespace for itself: the
EBS CSI driver refuses to start if `--extra-tags` contains a `kubernetes.io/`
key, because it manages that prefix. Configuration that sets one is valid YAML,
valid Terraform, and fatal.

**What to look at.** Whether the *consumer* of a value has a grammar, and
whether anything checks the value against that grammar rather than against the
schema's type. **Healthy looks like** a gate that applies the consumer's own
rule — for labels, the API server's — to values the repo writes.

### A limit that is not part of the manifest

An object can be entirely valid and still be refused by the thing asked to
process it, on grounds the object cannot express.

ArgoCD's repo-server will not render a directory source whose combined file size
exceeds a configured ceiling. A CRD bundle carrying full OpenAPI schemas runs to
tens of megabytes. The Application manifest is valid, its ordering is correct,
and it produces nothing — reporting a comparison error, not a sync error, which
means it never reaches the stage most eyes are on.

**What to look at.** `ComparisonError` and `InvalidSpecError` conditions on
Applications, which are distinct from sync status and are how "cannot render"
presents. An Application stuck at `sync: Unknown` has not failed to apply; it has
failed to produce anything to apply.

**Healthy looks like** no Application carrying either condition. `OutOfSync` and
`Progressing` are ordinary convergence; `Unknown` is not.

### A control whose consumer is never installed

Half a wiring is indistinguishable from none, and reads as complete.

A read-only deploy key registered for a private repository is inert unless
something is installed that pulls from it. An ApplicationSet parked in a
directory the app-of-apps does not recurse into is a file, not a control. Each
half looks right in review; the pair does nothing.

This is why the substrate stamps the enabling label, the repository URL, and the
credential **under one condition**. Not for tidiness — so the three cannot
arrive apart, and so a cluster cannot carry a label whose annotation is missing.

**What to look at.** For any credential, grant, or opt-in: name the thing that
consumes it, and confirm that thing is installed on the cluster in question.
**Healthy looks like** one condition governing the whole wiring.

### Two controls that assert opposite things

Two independently-correct checks over the same object can be mutually
exclusive, and neither author sees it because neither runs.

The tenant IAM role is a live example of the ground truth being subtle: the
operator **generates** scoped inline policies on it — a model-scoping policy on
every reconcile, plus datastore, capability, secret and key policies as the
Platform declares them. Inline policies are the mechanism, not a violation of
it. A check asserting "no inline policies" therefore passes only on a role the
operator never finished reconciling, and contradicts the audit that requires the
model scope to be present.

**What to look at.** When two gates cover one object, whether they can both be
satisfied at once. **Healthy looks like** one owner of the rule — here the audit
owns the allowlist, and anything else asserts a property that audit does not.

### A checker that reads a narrower slice of reality than the contract

A conformance check is itself a control, and can be wired to the wrong object.

Tenant egress containment exists as one of two kinds depending on the cluster's
network engine: a `networking.k8s.io` NetworkPolicy, or a `cilium.io`
CiliumNetworkPolicy. The writers are mutually exclusive. A checker reading only
the first reports "no egress containment" on every cluster running the second —
and does so at critical severity, about a configuration that is in fact
*stronger*, because the Cilium form can express egress to the Pod Identity
credential endpoint as a reserved entity and a vanilla `ipBlock` cannot.

**What to look at.** Whether a check enumerates the kinds a thing can take, or
only the one its author had in front of them. **Healthy looks like** a check
that reports missing only when *no* variant is present.

### A test that holds the defect in place

When a suite passes on a path that has never executed, the assertions are
suspects rather than evidence.

An assertion written to match observed output encodes whatever that output was.
If the output was wrong, the test now requires it to stay wrong, and fixing the
defect turns the suite red — which reads as a regression.

**What to look at.** For each assertion on an unexercised path, ask what it
would have to say for the broken behaviour to be *wrong*. If it says nothing
about that, it is describing, not checking.

### A wait that reports its own subject

Any `wait-for-X` reports X. When X depends on a chain, the report names the
last link rather than the broken one — so an addon catalog that installed
nothing surfaces as whichever addon was waited on first, and a missing CRD
surfaces as the workload that needed it.

**Healthy looks like** asserting the precondition before waiting on anything
downstream of it, so the failure names the Application that could not render
rather than the Deployment that never appeared.

### A field with no reader

A field an operator can set, sees accepted, and believes is in force — that
nothing reads — is a control in name only. The substrate enforces this
structurally: every field a tenant object declares must be read by a resource in
the component that declares it, and a field with no reader fails the build.

## What to check on a cluster that looks fine

In rough order of how much they explain:

```bash
# Applications that cannot render — distinct from, and worse than, OutOfSync
kubectl -n argocd get applications \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.sync.status}{"\n"}{end}' \
  | awk -F'\t' '$2=="Unknown"'

# Does the catalog exist at all, or is the parent healthy over nothing
kubectl -n argocd get applications --no-headers | grep -cv '^app-of-apps '

# Unhealthy pods. NOT --field-selector=status.phase!=Running: a
# CrashLoopBackOff pod is phase Running, so that selector reports a
# crashlooping cluster as clean.
kubectl get pods -A --no-headers \
  | awk '{split($3,r,"/"); if ($4!="Running" || r[1]!=r[2] || $5+0>0) print}'

# Why a container died, rather than why the current one is unhappy
kubectl -n <ns> logs <pod> -c <container> --previous
```

The last two matter together: the state that explains a restart is gone from the
running container, so the diagnostic has to ask for the previous one.

## Runbooks

Per-repo, for the failures that have a procedure rather than a shape:

**Cluster addons** — [addon sync degraded](https://github.com/nanohype/eks-gitops/blob/main/docs/runbooks/addon-sync-degraded.md) ·
[render-gate failures](https://github.com/nanohype/eks-gitops/blob/main/docs/runbooks/render-gate-failures.md) ·
[rollback](https://github.com/nanohype/eks-gitops/blob/main/docs/runbooks/rollback.md) ·
[observability tier](https://github.com/nanohype/eks-gitops/blob/main/docs/runbooks/observability-tier.md) ·
[general troubleshooting](https://github.com/nanohype/eks-gitops/blob/main/docs/runbooks/troubleshooting.md)

**Agent platform** — [kill switch fired](https://github.com/nanohype/eks-agent-platform/blob/main/docs/runbooks/kill-switch-fired.md) ·
[platform suspended](https://github.com/nanohype/eks-agent-platform/blob/main/docs/runbooks/platform-suspended.md) ·
[SLO burn-rate hold](https://github.com/nanohype/eks-agent-platform/blob/main/docs/runbooks/slo-burn-rate-hold.md) ·
[reconcile latency](https://github.com/nanohype/eks-agent-platform/blob/main/docs/runbooks/reconcile-latency.md) ·
[cluster failover](https://github.com/nanohype/eks-agent-platform/blob/main/docs/runbooks/cluster-failover.md) ·
[cross-region fallback](https://github.com/nanohype/eks-agent-platform/blob/main/docs/runbooks/cross-region-fallback.md)

**Cluster fleet** — [vend failure](https://github.com/nanohype/eks-fleet/blob/main/docs/runbooks/vend-failure.md) ·
[teardown](https://github.com/nanohype/eks-fleet/blob/main/docs/runbooks/teardown.md)

**Substrate** — [landing-zone runbooks](https://github.com/nanohype/landing-zone/blob/main/docs/runbooks.md)

**Portal** — [portal runbook](https://github.com/nanohype/portal/blob/main/docs/runbook.md)

## The one habit that finds these

Ask, of anything on a request path: **if this were wrong, what would report
unhealthy?**

If the answer is nothing, no static gate covers it. Write a check that asserts
the specific value — the port, the prefix, the namespace, the kind — and spell
the expected value out independently rather than referencing the same constant
the code uses. Two references to one constant agree with each other no matter
what either says.

Then prove the check fails. A gate nobody has watched go red is a comment.
