---
title: How the factory works
description: From an intake brief to merge-gated, shipped software — the fab pipeline and its phases.
---

`fab` is the factory client — the open-source reference orchestrator. It takes an
**intake brief** and drives it through a phased pipeline to shipped, merge-gated
software.

## The pipeline

Work moves through phase-scoped sessions, each with its own slice of an ~80-role
roster (curator/engineer naming; flat, no coordinator). The phases run from intake
and design through implementation, and every change meets an **evidence-bound merge
gate** before it lands.

## The merge gate

Four gate roles vote with transcripts and citations:

| Role              | Checks                                       |
| ----------------- | -------------------------------------------- |
| pr-reviewer       | correctness, scope, convention adherence     |
| qa-security       | security posture, test coverage              |
| build-verifier    | the build + gates actually pass              |
| artifact-auditor  | the output matches the contract              |

A verdict without evidence is auto-downgraded to a reject. Claims don't ship;
evidence does.

## Transports

`fab` runs on four transports, selected by `FAB_RUNTIME`:

- **Managed Agents** (default)
- the in-process `sdk` loop
- per-session-isolated `sdk-k8s`
- `claude-cli`

Inference backend is separate (`FAB_INFERENCE`): the Anthropic API, Bedrock, or
Claude Platform on AWS.

## The standards

The bar every output is graded against lives in the catalog's standards — language
toolchain, version currency, the platform-tenant contract, the LLM policy, and the
quality rubric's ten dimensions. Anyone reading the public surface gets the bar
**and** a working factory.
