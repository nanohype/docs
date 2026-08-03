---
title: The kill switch changes AWS, not the cluster
description: Why stopping a runaway tenant detaches an IAM policy and tags a role, and leaves the operator to notice rather than to act.
---

## The constraint

An agent that has gone wrong spends money continuously, and the thing that stops
it has to work in the case that matters: when the cluster or the control plane is
itself the broken part. A stop that depends on a healthy operator is a stop that
is unavailable exactly when it is needed.

Two properties, and the second is the one that is easy to miss:

1. **The stop must not need the control plane.** If the operator is crashlooping,
   wedged on a cache sync, or simply behind, spend has to stop anyway.
2. **The stop must survive the control plane.** A reconciler whose job is to make
   reality match the spec will *undo* an out-of-band stop, in seconds, and report
   success while doing it.

## The shape

The budget reconciler publishes a `BudgetBreach` event to an EventBridge bus when
a tenant's spend crosses its `BudgetPolicy` threshold by 20%. A rule routes it to
a Step Functions state machine, which does three things in order:

1. **Detaches** the Bedrock-invoke baseline policy from the tenant's IAM role.
2. **Tags** that role `platform.nanohype.dev/suspended=true`, plus a
   `suspended-reason`.
3. **Publishes** a `ScaleToZero` event for the operator to drain the tenant's
   `AgentFleet`s.

Step one is the stop, and it is complete on its own. The tenant's credentials
still resolve, the pods still run, and every model call fails at IAM. Nothing in
the cluster had to cooperate.

Step two is what makes it stick. The operator's normal behaviour is to notice a
missing baseline policy and reattach it — which would undo the stop within a
reconcile interval. So on each pass it reads the role's tags first, and on seeing
the suspension marker it returns early: no managed-policy attach, no baseline
repair, and the Platform's status carries `Suspended` and the reason through to
the CR.

That inversion is the decision. **The operator's job is to notice the stop, not to
perform it.** The tag is not a status annotation describing something that
happened elsewhere; it is the load-bearing instruction that stops the reconciler
from fighting.

## Alternatives

**Scale the Deployments to zero.** The obvious move, and it fails precisely when
needed: it requires a working operator with cluster access. If the operator is the
broken thing, nothing stops. It is also slower than it looks — a pod already
mid-request finishes that request, and a tenant with valid credentials and a
running pod keeps spending until it is actually gone.

**Revoke at the model gateway.** Attractive because the gateway is already on the
egress path and it is one config change. But each tenant's gateway runs in that
tenant's own namespace, under that tenant's identity — it is inside the blast
radius, not outside it. A stop should not be enforced by a component the thing
being stopped could affect.

**Delete the tenant role outright.** Total, and unrecoverable. It also destroys
the evidence: the tags on a suspended role are the record of why the platform
acted, and the role is what a recovery reattaches to.

## What it costs

**Ordering is load-bearing, and the window between steps is real.** If the tag
write fails after the detach succeeds, the tenant is stopped but the operator will
undo it on its next pass. The state machine normalizes its input before the first
action for exactly this reason — a hand-crafted or replayed breach event missing
`detail.reason` would otherwise resolve fine through the detach and then hit a
path error on the tag, leaving the worst of both states. Both steps retry with
backoff and route to a terminal failure state rather than dropping.

**Recovery is manual and deliberately so.** Nothing un-suspends automatically. An
operator removes the tags, and the next reconcile reattaches the baseline. An
automatic un-suspend would be a loop that can re-arm a runaway.

**The event source is a cross-repo string contract.** EventBridge matches
`source` exactly. The Terraform rule pattern and the operator's Go constant have
to agree character for character, and if they drift the breach event is published,
accepted, and matched by nothing — the kill switch does not fire, and no component
reports an error. A contract test parses the Terraform event pattern and fails the
build if the two disagree, because nothing at runtime would.

**A stop that fails leaves no alarm on the state machine itself.** The safety net
is the operator's own effect-verifying check, which looks for a breach that never
resulted in a suspended tenant. That is deliberate — an alarm on the state machine
proves the machine ran, which is not the property anyone actually wants proven.

**The suspension is on the IAM role, so it is per-Platform, not per-workload.** A
tenant running several fleets is stopped entirely. There is no partial suspend.
