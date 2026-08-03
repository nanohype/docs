---
title: A tenant's substrate is a declaration
description: Why databases, buckets, queues, caches and streams are a list on the Platform CR rather than a hand-written component per app.
---

## The constraint

Every application needs stateful stores, and every store needs an access policy
scoped to it. That is two artifacts that have to agree — the thing that exists,
and the permission that reaches it — written in two languages, in two repos, by
two different processes.

They agree on the day they are written. The interesting question is what keeps
them agreeing on day two hundred, across a dozen tenants, when a bucket is renamed
and the policy that named it is somewhere else.

## The shape

A `Platform` CR declares what its tenant needs, as a list:

```yaml
spec:
  datastores:
    - name: sessions
      kind: keyValue
    - name: artifacts
      kind: objectStore
```

Six kinds are available — `relational`, `keyValue`, `objectStore`, `queue`,
`cache`, `stream` — mapping to Aurora Serverless v2, DynamoDB, S3, SQS,
ElastiCache and MSK Serverless.

That single list has two consumers:

- **`landing-zone`'s generic `tenant-substrate` component** provisions the stores
  from it. There is no per-app component to write; the `tenants` map is rendered
  from the Platform CRs rather than authored.
- **The `eks-agent-platform` operator** generates the tenant's IAM access policy
  from the same list, scoped to exactly those resources, and publishes each
  store's endpoint and credentials-secret name back onto the CR's status.

One declaration, two consumers. The store that exists and the policy that reaches
it are derived from the same source, so they cannot disagree — not because someone
keeps them in sync, but because there is only one of them.

Adding a tenant is a declaration, not a component.

## The permission boundary is a permission

The split between those two consumers is not arbitrary. The component owns the
heavy stateful resources and their security groups. The operator owns identity and
access — and holds **no delete permission on any datastore whatsoever**. Its IAM
policy does not name `rds`, `s3`, `dynamodb`, `elasticache` or `kafka` at all; it
manages IAM roles under the tenant path and Pod Identity associations, and nothing
else.

So the isolation boundary is enforced by the credential the operator runs under,
not by the correctness of its reconcile logic. A bug in the operator cannot delete
a tenant's database, because the identity it holds could not perform that call if
the code asked for it. A finalizer with a mistake in it is a bad afternoon rather
than a data-loss incident.

Tenant workloads sit under a separate ceiling. The permissions boundary attached
to every tenant role permits data-plane operations only — `dynamodb:DeleteItem`,
`s3:DeleteObject`, `sqs:DeleteMessage` — and no control-plane call that could
remove the store itself, regardless of what a `Platform` CR requests.

## Alternatives

**A component per application.** The default instinct, and it works for the first
two apps. By the tenth there are ten components that were copies of each other on
the day they were made, each with its own drift, and adding a tenant means writing
infrastructure code and getting it reviewed. Worse, the access policy lives beside
each one as hand-written JSON, which is the copy that goes stale first — a policy
naming a bucket that was renamed is valid, appliable, and grants nothing.

**Let the operator create AWS resources directly.** Attractive because the CR is
already there. It requires giving the operator broad create *and delete* authority
on every data service, at which point the isolation boundary becomes "the operator
has no bugs." That is a much weaker claim than "the operator cannot make that
call."

**Crossplane managed resources for the stores.** Same objection as above, plus a
second definition of the infrastructure in a different language than the one the
rest of the substrate is written in. See
[Crossplane orders the IaC](/decisions/crossplane-ordering/) — the same reasoning
lands the same way here.

## What it costs

**The kinds are a closed set.** Six, mapped to six specific AWS services with
specific opinions baked in — Aurora is Serverless v2, streams are MSK Serverless.
A tenant needing something outside that set does not get an escape hatch; the
component has to be extended, deliberately, for everyone. That ceiling is the
point, and it is a real constraint on a tenant that wants something unusual.

**Deletion is genuinely hard, and that is on purpose.** A component holding real
data cannot be casually destroyed. Buckets have versioning on, so lifecycle
expiry writes delete markers that are themselves current versions; Aurora refuses
to go without a final-snapshot decision. `force_destroy` is always on in
development and opt-in elsewhere, as a two-act change. The consequence is that
tearing down a tenant is a deliberate operation with a deliberate flag, not a
`terragrunt destroy`.

**The two halves move at different speeds.** The stores are provisioned by an
apply; the policy is reconciled by a controller in seconds. A datastore added to a
CR gets its IAM grant well before the store exists, so the tenant sees permission
to reach something that is not there yet. The CR's per-datastore status phase —
`Pending`, `Provisioning`, `Ready` — is what a tenant should read, rather than
assuming a grant implies a store.
