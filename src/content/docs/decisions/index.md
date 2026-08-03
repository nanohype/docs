---
title: Architecture decisions
description: The load-bearing choices — what each one is constrained by, what was chosen, what was rejected, and what the choice costs.
---

Most of this site is generated. The catalog, the resource reference, the agent
contracts and the atlas are all rendered from the definitions the org ships, so
they cannot describe something that does not exist.

This section is the part no generator can write: the reasoning. Six choices shape
everything else here, and each one is a real trade — something was given up to get
the property that was wanted. A page that only states the shape is a page you have
to take on faith. Each of these states the constraint first, then the shape, then
what was rejected and why, and finishes with what the choice costs. The cost
sections are not hedging; they are where the design is actually visible.

| Decision | The property it buys |
| --- | --- |
| [Identity is bound, not annotated](/decisions/identity-binding/) | No role ARN is ever pasted into a tenant's chart |
| [The kill switch changes AWS, not the cluster](/decisions/kill-switch/) | The stop holds when the control plane is the broken thing |
| [A tenant's substrate is a declaration](/decisions/tenant-substrate/) | The store that exists and the policy that reaches it cannot disagree |
| [Layers are drawn by rate of change](/decisions/layer-boundaries/) | A change has one correct home, and it is findable |
| [Crossplane orders the IaC](/decisions/crossplane-ordering/) | Vending is an object with a status, without a second copy of the infrastructure |
| [One account holds a whole product](/decisions/one-account/) | Spend, quota and blast radius stop at the product |

A recurring theme runs through all six, and it is worth naming up front because it
explains choices that otherwise look paranoid. The failure this system is built
against is not the crash. It is the **healthy control plane over a dead data
path**: every manifest valid, every controller reporting `Ready`, and the thing
the system exists to do quietly not happening. That failure produces no error, so
nothing that reads a resource can see it. Several of the decisions below give up
convenience specifically to make that state impossible or loud.
