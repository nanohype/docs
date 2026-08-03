---
title: Identity is bound, not annotated
description: Why a tenant's AWS identity comes from an EKS Pod Identity association the operator creates, and never from a role ARN in the tenant's chart.
---

## The constraint

A tenant's workload needs AWS credentials — to reach its own database, its own
bucket, its own queue, and to invoke a model. Two properties have to hold at once:

1. **A tenant cannot choose its own identity.** If a tenant can name the role it
   runs as, the isolation boundary is whatever the tenant typed.
2. **Nobody pastes a role ARN.** An account-specific string that has to be
   injected into a chart at deploy time is wrong in a way that produces no error —
   the pod starts, the credential resolves to nothing or to something else, and
   the failure surfaces later as a permission denial with no trace of where the
   string came from.

## The shape

The operator creates an **EKS Pod Identity association** through the AWS API,
keyed on `(cluster, namespace, ServiceAccount)`, pointing at the per-Platform IAM
role it also mints. The tenant's ServiceAccount carries no annotation at all.

The role's trust policy is fixed, and short:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "pods.eks.amazonaws.com" },
    "Action": ["sts:AssumeRole", "sts:TagSession"]
  }]
}
```

Notice what is *not* in it. There is no condition naming a namespace or a service
account, because that constraint lives in the association rather than in the
trust policy. The role trusts the EKS service to vend it; the association is what
decides to whom. That split is the whole point: the binding is an object in the
control plane's AWS account, not a field in a repo the tenant owns.

The consequence is that a tenant's chart has no place to name an identity. There
is no value to set, no annotation to render, no ARN to inject. The chart could
not select the wrong role if someone wanted it to.

## Alternatives

**IRSA — annotate the ServiceAccount with `eks.amazonaws.com/role-arn`.** This is
the older and more widely documented path, and it works. The problem is the
string. A role ARN contains the account ID, so it cannot be committed to a chart
that deploys to more than one account; it has to arrive at deploy time from
somewhere else. Every place it passes through is a place it can be wrong, and
wrong is silent. This shape is where the role-arn paste seam comes from, and it
is the specific thing this decision removes.

**A shared node instance role.** Simple, and immediately collapses per-tenant
attribution: every pod on the node is the same principal, so CloudTrail cannot
say which tenant did anything and Bedrock spend cannot be split.

**A credential broker service.** A pod asks a platform service for credentials.
This reintroduces the problem it means to solve — the broker acts under its own
identity, so the audit log names the broker, and a tenant's claim about what it
did can be neither confirmed nor refuted.

## What it costs

**Pod Identity needs an agent on the cluster.** `eks-pod-identity-agent` is an EKS
managed addon, pinned in the cluster component's addon set, so it is present from
the moment the cluster exists. It is still one more component whose absence turns
every credential in the cluster into a timeout.

**The binding is invisible to `kubectl`.** An association is AWS state. Nothing in
the cluster shows whether a tenant's identity is actually bound — a ServiceAccount
with a correct association and one with no association at all are byte-identical.
This is the healthy-control-plane failure in its purest form, so the operator
writes what it bound into the Platform's `status.podIdentity`, and that field is
the only in-cluster evidence the binding happened.

**It binds by name, so it can name nothing.** An association points at a
ServiceAccount string. If the tenant's chart never creates a ServiceAccount by
that name, the association is valid, well-formed, accepted by the API, and
attached to nothing. AWS reports success. The pod runs with no credentials. This
failure is real enough that `eks-gitops` carries a gate asserting that a pod only
names a ServiceAccount its own chart creates.

**Recovery from a bad binding is an AWS operation, not a redeploy.** Rolling the
chart does not fix an association pointing at the wrong name; something has to
delete the association. The operator is idempotent — it lists before it creates —
which means it will not repair a binding it did not consider wrong.

## Where this does not apply

Two identities in the system are IRSA-trusted, and both are bootstrap identities
that exist before the thing that would otherwise mint them:

- **The operator's own role.** Created by `landing-zone`'s `agent-iam` component
  with an `sts:AssumeRoleWithWebIdentity` trust policy scoped to
  `system:serviceaccount:eks-agent-platform:operator`, and bound by a
  ServiceAccount annotation the GitOps ApplicationSet renders from the cluster
  Secret. The operator is what creates Pod Identity associations; it cannot be the
  source of its own.
- **The fleet hub's Crossplane provider.** The `provider-opentofu` pod runs as the
  hub's ambient IRSA identity and assumes a per-cluster vend role from there.

Both are single, cluster-scoped, control-plane identities rather than
per-tenant ones, so neither multiplies and neither is authored by a tenant. The
rule this page describes is about tenant identity, and it holds without exception
there.
