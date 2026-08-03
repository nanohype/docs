---
title: One account holds a whole product
description: Why a product's network, cluster, tenants and data live in a single AWS account, and what the create/adopt modes are for.
---

## The constraint

An AWS account is several things at once: the strongest isolation boundary the
provider offers, the unit of billing, the unit of most service quotas, and the
blast radius of a bad IAM change. Any answer to "how much AWS does one product
need" is really an answer about where those four boundaries should fall.

The pressure runs both ways. Too few accounts and one product's quota exhaustion
becomes everyone's outage. Too many and every account-level thing — the baseline,
the guardrails, the observability wiring, the access model — is paid for many
times before there is anything to isolate.

## The shape

**One account holds a whole product**: its network, its cluster, its Platform
tenants, their datastores, and the observability over all of it. Spend, quotas
and mistakes stop at the product because the account stops them, without anything
having to be configured to make that true.

Within the account, the substrate components carry a **`mode`**, which is how the
same component serves an account that owns its infrastructure and one that joins
someone else's:

- **`create`** — the component provisions the thing. `network` in create mode
  makes the VPC, the subnets, the NAT gateways.
- **`adopt`** — the component resolves an existing one it does not own. An adopted
  VPC's CIDR comes from its owner; the levers that would shape it are rejected
  rather than ignored.

The mode is validated per field, not just declared. Setting `vpc_cidr` alongside
`network_mode = adopt` fails with a message saying so, rather than silently
applying a value that has no effect. That matters more than it sounds: a
create-mode lever quietly accepted in adopt mode is a configuration that reads
correctly, applies cleanly, and does nothing — and someone will later reason from
it as if it were in force.

## Alternatives

**Namespace-only isolation in one shared account.** Cheapest, and adequate for a
long time. The failure mode is that the boundaries that matter under stress are
not namespace boundaries — a service quota is per account, a runaway spend shows
up on one bill, and a scoped-too-wide IAM policy reaches everything. All of those
are invisible until the first time they are not.

**An account per environment per product, from day one.** Real isolation between
`development` and `production`, and the shape most large orgs converge on. It
multiplies the account-level fixed cost by the number of environments before
there is a production workload to protect, and every cross-account seam becomes a
role assumption that has to be built and maintained.

**An account per tenant.** Maximum isolation, and it discards the reason this
platform exists — a `Platform` CR is the tenant boundary precisely so that
onboarding a tenant does not require provisioning an account.

## What it costs

**Account-and-region singletons become contended.** Some AWS services are one per
account per region, and sharing an account across environments makes them shared
whether that was intended or not. Bedrock invocation logging is exactly this: a
single account-region configuration, so a per-environment owner would have each
environment overwriting the others' settings. It is owned once, at the account
level, for that reason — and the general lesson is that any service with this
shape needs a designated owner rather than a copy per environment.

**Blast radius within the account is a policy question, not a structural one.**
Two environments in one account are separated by IAM, tags and naming rather than
by a hard boundary. That separation is real but it is enforced by correctness,
which is a weaker guarantee than the account boundary that surrounds them.

**Names must be unique account-wide, and some of them are global.** S3 bucket
names are globally unique; IAM roles are account-unique. Resource names therefore
carry cluster and environment tokens to keep two installs from colliding, and
those tokens consume characters from limits that are shorter than they look. This
is why naming in the substrate is generated and length-validated rather than
chosen.

**Above one account, this stops.** Organizations, Control Tower, cross-account
roles and a shared-services tier are outside what is built. `adopt` mode is the
seam that would carry the substrate there — a component that can resolve
infrastructure it does not own is most of what a multi-account topology needs from
this layer — but the shared-services substrate that would use it does not exist
yet, and nothing here should be read as implying it does.
