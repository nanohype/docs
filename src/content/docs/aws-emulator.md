---
title: Running against AWS Emulator
description: How to point nanohype's apps, scripts and Terragrunt trees at AWS Emulator without reaching real AWS, what the emulator can and cannot measure, how much of nanohype it covers at v1.0.322, and how to re-measure against a later release.
---

[AWS Emulator](https://github.com/aws/aws-emulator) is AWS's local emulator of the
AWS APIs: one process, HTTPS on a local port, SigV4 checked against keys it mints
for each run, state held in memory. Pointed at it, nanohype's SDK code, CLI scripts
and Terragrunt leaves run without an AWS account.

**Reference point.** Every count and every behaviour on this page was measured
against **AWS Emulator v1.0.322, commit `7753983c`**, and nanohype's repositories
at the commits under [Reference commits](#reference-commits). The files this page
links on `main` hold the guards each repository carries against the defect classes
it describes. A later release moves the numbers;
[Re-measuring against a newer release](#re-measuring-against-a-newer-release) is
the method that produced them.

## Safety first

The emulator is local. Three addresses it returns are not: SQS queue URLs, the EKS
cluster endpoint and the EKS OIDC issuer all name real AWS hosts, and clients follow
them there without being asked to. The first two sections below keep those requests
on the machine. The third makes sure that any request that still escapes carries a
key AWS refuses.

### SQS clients stay on the configured endpoint

Emulator SQS returns queue URLs in AWS's own form,
`https://sqs.<region>.amazonaws.com/<account>/<queue>`. The JavaScript SDK v3 SQS
client sends every call that carries a `QueueUrl` to that URL's host whenever it
differs from the resolved endpoint (`useQueueUrlAsEndpoint`, default `true`). An
explicit `endpoint` in the client config switches that off; an endpoint taken from
`AWS_ENDPOINT_URL` does not. An app pointed at the emulator through the environment
therefore creates its queue locally and sends the next call to AWS, signed with
whatever credentials it holds. The SDK's Node HTTP handler does not read
`HTTPS_PROXY`, so an egress proxy does not contain it.

Set `useQueueUrlAsEndpoint: false` on every SQS client. incident-response
([`src/utils/sqs-client.ts`](https://github.com/nanohype/incident-response/blob/main/src/utils/sqs-client.ts)),
slack-knowledge-bot
([`src/sqs-client.ts`](https://github.com/nanohype/slack-knowledge-bot/blob/main/src/sqs-client.ts))
and the catalog's SQS providers
([`module-queue-ts`](https://github.com/nanohype/nanohype/blob/main/templates/module-queue-ts/skeleton/src/queue/providers/sqs.ts),
[`module-audit-ledger-ts`](https://github.com/nanohype/nanohype/blob/main/templates/module-audit-ledger-ts/skeleton/src/audit/providers/sqs.ts))
build their clients that way. For a run against the emulator, also give each SDK
client a request handler that refuses every host except `127.0.0.1`, so the next
override of this kind fails loudly instead of leaving the machine.

### Terraform runs behind an egress-deny proxy

EKS `DescribeCluster` returns an endpoint of the form
`https://<id>.<suffix>.<region>.eks.amazonaws.com` and an OIDC issuer of the form
`https://oidc.eks.<region>.amazonaws.com/id/<id>`. Both are real AWS hostnames. The
eks module's `tls_certificate` data source fetches the issuer, and the Kubernetes,
Helm and kubectl providers dial the endpoint.

Run OpenTofu and Terragrunt with `HTTPS_PROXY` and `HTTP_PROXY` (both cases) pointing
at an allowlist proxy, which OpenTofu, its providers and Terragrunt all honour:

- **Tunnel** only to what the run downloads: `registry.opentofu.org`, `github.com`,
  `codeload.github.com`, `objects.githubusercontent.com`,
  `release-assets.githubusercontent.com`, and the npm or Go registries if the run
  builds anything.
- **Tunnel** `<12-digit account id>.localhost:<port>` to `127.0.0.1:<port>`, for S3
  Control ([below](#s3-control)).
- **Refuse** everything else, any name containing `amazonaws` included, and plain
  HTTP. Log every decision: the log is the record of what the run tried to reach.

Match `github.com` exactly rather than as a suffix. A suffix rule admits
`api.github.com`, which is where the `integrations/github` provider authenticates,
and with `GITHUB_TOKEN` unset that provider takes the GitHub CLI's token
(`gh auth token`) — so a plan that configures the provider, even with no GitHub
resources, calls the GitHub API as whoever is logged in. Set `GITHUB_TOKEN` to a
dummy value for any tree that configures it.

Where no proxy is meant to be reachable, set the proxy variables to a closed local
port such as `http://127.0.0.1:9`, so that a client honouring them fails closed
rather than going direct. The proxy log records only attempts made through the
proxy; an attempt at the closed port leaves only the client's own error
(`proxyconnect tcp: dial tcp 127.0.0.1:9`).

The emulator's own outbound traffic is outside all of this. `--telemetry off`
turns its telemetry off; beyond that, a container on Docker's default bridge
network can open outbound connections, and nothing here proxies or logs them.

### Dummy keys only

With `--auth on` (the default) the emulator writes a key pair for each run,
`EMULATOR…`, to `<home>/.aws/emulator/<port>/emulator_credentials`, and checks every
signature against it. Use that pair and nothing else:

- Point `AWS_SHARED_CREDENTIALS_FILE` and `AWS_CONFIG_FILE` at the
  `emulator_credentials` and `config` files the emulator writes.
- Unset `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`,
  `AWS_PROFILE`, `AWS_DEFAULT_PROFILE`, `AWS_ROLE_ARN`,
  `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_CONTAINER_CREDENTIALS_FULL_URI` and
  `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, and the Go SDK's aliases
  `AWS_ACCESS_KEY` and `AWS_SECRET_KEY`.
- Set `AWS_EC2_METADATA_DISABLED=true`, which closes the instance-metadata fallback.

Never set a real profile. Nothing on this page needs real credentials, and the
difference matters exactly when something escapes: a request signed with the
emulator's key that reaches AWS is refused as an unknown key (`InvalidClientTokenId`
from SQS, `InvalidAccessKeyId` from S3, `UnrecognizedClientException` from DynamoDB);
one signed with real credentials is not.

## Setup

### Run the emulator

On Linux, install the RPM or Debian package. On macOS and Windows, build the image
from the Dockerfile in AWS's
[Getting started with Docker](https://docs.aws.amazon.com/emulator/latest/userguide/getting-started-docker.html)
guide and run it as that guide shows, with `--telemetry off` added after the image
name. On macOS:

```sh
PORT=9297
docker run --rm --memory=2g --memory-swap=2g -p 127.0.0.1:$PORT:$PORT \
  -e HOME="$HOME" -v "$HOME/.aws/emulator:$HOME/.aws/emulator" \
  aws-emulator -p $PORT --telemetry off
```

- **Publish on `127.0.0.1` only.** `-p $PORT:$PORT` opens the emulator to the whole
  network.
- **On macOS, mount the emulator's directory at the same path.** The emulator writes
  `emulator_credentials`, `config` and `ca.pem` to `<home>/.aws/emulator/<port>/`,
  and its `config` names the CA file by absolute path; the same path on both sides
  of the mount keeps that path true on the host.
- **Check the version.** `aws-emulator --version` (in a container,
  `docker run --rm aws-emulator --version`) prints the version, release date and
  commit. The guide's Dockerfile installs the newest LTS release at the time
  the image is built, so compare before reading this page's numbers against a run.
- **One fresh emulator per measurement.** State lives in memory and goes with the
  process, so a baseline and a candidate each start from the same seeded state.

On Windows, the guide mounts the directory at `/home/emulator/.aws/emulator`, so the
`ca_bundle` in the emulator's `config` names a container path. Set `AWS_CA_BUNDLE`
and `NODE_EXTRA_CA_CERTS` to the host path of `ca.pem`; the environment variable
takes precedence over `ca_bundle` in the CLI and the Python and Go SDKs.

`GET https://127.0.0.1:<port>/__admin/health` answers 200 once it is serving.

### Point clients at it

With `EMU=$HOME/.aws/emulator/<port>`:

| variable | value | read by |
| --- | --- | --- |
| `AWS_ENDPOINT_URL` | `https://127.0.0.1:<port>` | every AWS SDK, the CLI, OpenTofu |
| `AWS_CA_BUNDLE` | `$EMU/ca.pem` | the CLI and the Python and Go SDKs |
| `NODE_EXTRA_CA_CERTS` | `$EMU/ca.pem` | Node |
| `AWS_SHARED_CREDENTIALS_FILE` | `$EMU/emulator_credentials` | every SDK |
| `AWS_CONFIG_FILE` | `$EMU/config` (region, `endpoint_url`, `ca_bundle`) | every SDK |
| `AWS_REGION`, `AWS_DEFAULT_REGION` | `us-east-1` | every SDK |
| `AWS_EC2_METADATA_DISABLED` | `true` | every SDK |
| `HTTPS_PROXY`, `HTTP_PROXY`, `https_proxy`, `http_proxy` | the allowlist proxy, or `http://127.0.0.1:9` | Go and Python clients, the CLI |
| `NO_PROXY`, `no_proxy` | `127.0.0.1` | the same |
| `AWS_ENDPOINT_URL_S3_CONTROL` | `https://localhost:<port>` | Terraform runs; see [S3 Control](#s3-control) |

`NO_PROXY` names `127.0.0.1` and **not** `localhost`: a `localhost` entry also matches
`<account>.localhost`, which would then bypass the proxy rule that maps it to
loopback.

Keep the whole set in one file. Start each run from an empty environment, for
example `env -i HOME="$HOME" PATH="$PATH" bash --noprofile --norc`, and then source
the file, so the run inherits only `HOME` and `PATH` from the shell it started in.
Two inherited variables send calls past the emulator: an `AWS_ENDPOINT_URL_<SERVICE>`
overrides `AWS_ENDPOINT_URL` for that service in every SDK and the CLI, and
`AWS_IGNORE_CONFIGURED_ENDPOINT_URLS=true` makes the CLI, OpenTofu, the Go and
Python SDKs, and the JavaScript SDK where its `@smithy/core` reads the variable
(slack-knowledge-bot's locked 3.33.2 does; incident-response's 3.24.3 does not)
ignore `AWS_ENDPOINT_URL` and the config file's `endpoint_url`. Before the first
run, check that `env | grep '^AWS_'` lists only the file's variables.

### Terraform and Terragrunt

<a id="s3-control"></a>**S3 Control.** The aws provider reads and writes every
bucket's tags through S3 Control (`ListTagsForResource`, `TagResource`). S3 Control's
endpoint rules put the account id in front of the endpoint host, so with
`AWS_ENDPOINT_URL` alone the provider calls `000000000000.127.0.0.1`, which resolves
nowhere. Every `aws_s3_bucket` then fails within seconds where the connection is
refused, and otherwise retries past its own timeout until the run is stopped. Three
settings together make it work:

1. `AWS_ENDPOINT_URL_S3_CONTROL=https://localhost:<port>`, so the prefixed host is
   `<account>.localhost`.
2. A proxy rule that tunnels `<account>.localhost:<port>` to `127.0.0.1:<port>`, and
   `NO_PROXY` without `localhost`.
3. `insecure = true` in the aws provider block of the run's copy, because the
   emulator's certificate names only `localhost`, `127.0.0.1` and `::1`, not
   `<account>.localhost`.

Through `localhost`, S3 Control applies a tagged bucket and
`aws_s3_account_public_access_block`, and re-plans clean.
`skip_requesting_account_id` with `skip_credentials_validation` is not a substitute.
With both set the provider has no account id: it tags buckets with
`PutBucketTagging`, but builds ARNs with an empty account id, reads that depend on
those ARNs fail, and account-level S3 Control resources such as
`aws_s3_account_public_access_block` still fail. `skip_requesting_account_id` alone
changes nothing here, because credential validation still returns the account id
from STS.

**State.** Create each state bucket with the CLI before the first `init`. Use
`000000000000`, the emulator's account id, wherever a tree takes one
(`TERRAGRUNT_ACCOUNT_ID` in landing-zone).

**Work on a copy.** Every edit below goes into an exported copy of the repository
(`git archive` into a scratch directory), never into the checkout.

**What to exclude or change.** Each of these stops an apply that is otherwise
fine:

| in the tree | what the emulator does | in the run's copy |
| --- | --- | --- |
| `aws_default_network_acl`, which terraform-aws-modules/vpc manages | EC2 `CreateTags` answers `InvalidNetworkAclID.NotFound` for the id `DescribeNetworkAcls` lists | plan and apply with OpenTofu's `-exclude` on its address (`module.vpc[0].aws_default_network_acl.this[0]` in landing-zone's network component) |
| `aws_acm_certificate_validation` on a public DNS-validated certificate | the certificate stays `PENDING_VALIDATION` for 72 hours, so the resource waits out its timeout | exclude the validation resource |
| interface endpoints for `eks`, `eks-auth`, `aps-workspaces` | the endpoint service catalog is a fixed list without them | turn those endpoints off |
| EKS node groups that read `/aws/service/bottlerocket/aws-k8s-*` | no Bottlerocket EKS AMI parameters ship, and nothing under `/aws/service/eks` | pin the AMI release |
| a bucket policy with `DenyInsecureTransport` on a bucket an SES receipt rule or a CloudTrail trail writes to | the service-principal check refuses the bucket | drop that statement |
| a VPC whose CIDR comes from an IPAM pool | `AllocateIpamPoolCidr` answers 501, and `CreateVpc` refuses an IPAM pool | give the VPC a fixed CIDR |
| a CloudWatch Logs group encrypted with a KMS key | `CreateLogGroup` refuses a key whose policy does not grant the logs service principal, as AWS does | seed a key whose policy grants it |
| `aws_security_group` in a VPC other than the default | the egress revoke that follows the create is refused ([gap 2](#ranked-gaps)) | nothing; the leaf stops |

**Seed what another stack supplies.** A leaf that reads another stack's outputs or
handoff parameters stops on the missing input before it reaches the emulator's
behaviour. Seed them up front: KMS keys, a VPC with subnets, a route table and a
security group, the GitHub OIDC provider, a hosted zone, a transit gateway, the SSM
parameters one stack writes for another, and `000000000000` for any delegated-admin
account id.

**Re-plan after every apply.** An apply followed by a plan that must be empty is
the cheapest idempotency check there is, and the emulator runs it for free. A
non-empty re-plan is the finding. One shape it takes: two components managing the
same tag key on the same resource — one through `aws_ec2_tag`, the other through the
resource's own `tags` — plan opposite changes forever, against AWS as much as
against the emulator.

## What it measures and what it cannot

Each service nanohype deploys that the emulator has (62 of the 63; Claude Platform
on AWS has no crate, and its one operation counts as not implemented) falls in one
of three tiers, by what the emulator executes for it:

- **runs** — the behaviour callers depend on is executed: delivery, expression
  evaluation, cryptography, policy evaluation, SQL, interpreters. Logic, call counts
  and applies are measurable; timing is not.
- **records** — control-plane state only. Resources are stored and described back,
  and nothing they control exists: no instances, DNS answers, edge, cache, model or
  Kubernetes API. Call counts and applies are measurable; behaviour is not.
- **none** — the answer carries no information about the real service.

| tier | services |
| --- | --- |
| runs | Athena, CloudWatch Logs, DynamoDB, EventBridge, IAM, KMS, Lambda, RDS, S3, Step Functions, SNS, SQS, SSM, STS, EventBridge Scheduler, Secrets Manager, Amazon Managed Service for Prometheus |
| records | ACM, ARC Zonal Shift, Auto Scaling, BCM Data Exports, Backup, Batch, Bedrock (control plane), Budgets, CloudFormation, CloudFront, CloudTrail, CloudWatch, Cognito user pools, Compute Optimizer, Config, Cost Explorer, EC2, ECS, EKS, EKS Auth, ElastiCache, Elastic Load Balancing v2, Glue, GuardDuty, MSK, Organizations, Pricing, RAM, Resource Groups Tagging, Route 53, Route 53 Profiles, Route 53 Resolver, S3 Control, SES, SES v2, IAM Identity Center admin, Security Hub, Service Quotas, Shield, WAF Regional, WAFv2, X-Ray, Amazon Managed Grafana, Identity Store |
| none | Bedrock Runtime |

Counted over the distinct operations nanohype deploys:

| nanohype's operations | runs | records | none | not implemented | total |
| --- | --- | --- | --- | --- | --- |
| all sources | 335 (31.8%) | 601 (57.1%) | 4 (0.4%) | 112 (10.6%) | 1,052 |
| runtime: SDK, CLI, CI and controllers | 152 (39.1%) | 217 (55.8%) | 4 (1.0%) | 16 (4.1%) | 389 |

By optimization need:

| optimization need | measurable? | basis |
| --- | --- | --- |
| API calls per operation: pagination, batching, fan-out, retries | **yes**, counted in the client | AWS's pagination and error codes; the emulator keeps no request log, and CloudTrail records management events from 11 services |
| DynamoDB capacity units | **yes** | `ConsumedCapacity` follows AWS's formula: 3 WCU for a 3 KB put, 1 RCU strongly consistent, 0.5 eventually consistent |
| messages through an event chain | **yes** | EventBridge → Step Functions, SNS → SQS and Scheduler → SQS deliver, and `AWS/Events` and `AWS/States` metrics are published; Scheduler runs one scheduled minute in one second |
| apply, re-plan and destroy behaviour | **yes**, for leaves that apply | see [Terragrunt applies](#terragrunt-applies) |
| S3 objects and bytes stored | **yes** | objects, versions and bytes are stored |
| function logic | **yes** | Lambda runs the real deployment package on the emulator's own Python (RustPython) or JavaScript (QuickJS) interpreter |
| Lambda duration, memory, cold start | no | those interpreters are not AWS's runtimes |
| latency, throughput, concurrency limits | no | every engine is the emulator's own |
| model tokens, cost or quality | no | Bedrock Runtime returns a fixed notice, with token counts from the emulator's own tokenizer: each word cut into pieces of at most 4 characters, each punctuation mark one token |
| spend in dollars | no | Cost Explorer's reporting operations answer 501, and Pricing serves a seeded subset (`a1.medium` is priced, `m7g.large` returns no product) |
| compute rightsizing, bin packing, NAT and data transfer | no | EC2, EKS and VPC record resources with no compute or network behind them |
| cache hit rates, query plans | no | ElastiCache has no data plane; RDS and Athena execute on SQLite |
| least-privilege policies | partly | IAM policy evaluation is enforced for some operations and not others: a user with no policy is denied KMS `ListKeys` but allowed S3 `ListBuckets`, and an explicit `Deny s3:*` does not stop `ListBuckets` |

**Measure in the client.** An SDK middleware that counts requests per operation,
`TF_LOG=debug` request lines for OpenTofu, `--debug` for the CLI. Report the delta
between a baseline and a candidate on the same seed, never an absolute timing.
Multiply measured counts by published prices, or by a repo's own price table, in
your own code rather than through the emulator's Cost Explorer or Pricing.
eks-agent-platform's invocation cost publisher does this with its own price table.
Its Lambda runs in the emulator and computes the estimates, but the guest boto3 has
no paginators, so every invocation is attributed `unknown`; the cost pipeline's
Terraform stops on Cost Explorer `GetTags` ([gap 12](#ranked-gaps)).

## Coverage at v1.0.322

**Implemented** means the operation's source file in the emulator is not marked
`SCAFFOLDED, NOT IMPLEMENTED`; scaffolded operations answer HTTP 501. It does not
mean correct: the [ranked gaps](#ranked-gaps) include implemented operations that
answer unlike AWS. **Fidelity-pass** adds that at least one behavioural or wire test
for the operation passes in the emulator's own published evaluation for v1.0.322.
Templates under `nanohype/templates/` are left out of the service, operation and
call-site counts below, because nothing deploys them as they stand; they call 17
operations in 5 services, all implemented. The component counts include the seven
template families.

### Headline numbers

| measure | numerator / denominator | % | method |
| --- | --- | --- | --- |
| services the emulator has | 62 / 63 | 98.4% | distinct SDK service ids in nanohype's deployed operations that have an emulator service crate; the absent one is Claude Platform on AWS, one of fab's inference transports |
| services with every operation nanohype calls implemented | 45 / 63 | 71.4% | the other 17 present services are partial: Organizations 2/17, Athena 7/14, Backup 19/34, EC2 129/158, and 13 more |
| operations implemented | 940 / 1,052 | 89.4% | distinct (service, operation) pairs over SDK, CLI, CI, Terraform and controller sources |
| … and reachable from a stock SDK configuration | 937 / 1,052 | 89.1% | less the three S3 Control operations behind an account host prefix |
| … and covered by a passing published fidelity test | 895 / 1,052 | 85.1% | the release's `scores.json.gz` and the evaluation suite's manifest |
| runtime operations (SDK, CLI, CI) | 240 / 248 | 96.8% | SDK 170/174, CLI 119/123, CI 1/1 |
| runtime call sites | 600 / 609 | 98.5% | each call site once |
| Terraform operations | 748 / 848 | 88.2% | every operation the aws provider (v6.60.0) may call for the 185 resource and data-source types nanohype deploys |
| Terraform types whose every operation is implemented | 125 / 185 | 67.6% | one unimplemented operation makes a type uncovered |
| controller operations | 223 / 231 | 96.5% | from each controller's upstream source at the chart version the repo pins, or from the IAM grant the repo gives it |
| components run end to end | 24 / 127 | 18.9% | of 146 components, 127 call AWS; 82 are partial (64.6%) and 21 have no emulator path (16.5%) |
| Terragrunt units that apply | 12 / 57 | 21.1% | 10 of the 14 deployable trees (all but the staging and production trees), applied in dependency order |
| operations whose behaviour the emulator executes | 335 / 1,052 | 31.8% | the runs tier; 601 more (57.1%) are stored and described back |

Of the 940 implemented operations, at least 40 still answer 501 for one shape of
input: Config `PutConformancePack` with `TemplateS3Uri`, and EC2 `CreateVpc` with an
IPAM-allocated CIDR, are two that nanohype's applies reach. The count is a lower
bound, because it reads only each operation's own source file.

Four of the 1,052 operations are reached only through IAM grants with no configured
consumer, and all four are implemented: argo-events' grant (S3
`GetBucketNotificationConfiguration` and `PutBucketNotificationConfiguration`, SNS
`ConfirmSubscription`) and the part of external-secrets' grant beyond
`GetSecretValue` (SSM `GetParameters`). cert-manager's Route 53 grant has no DNS-01
issuer either, but every operation it allows is also counted from another source.
Without the four, the operation count is 936 / 1,048 (89.3%).

### By component

A component is a unit someone runs or deploys: a Terraform component in one
deployment context, a service, a CLI command family, a script, a controller, a
template family. Each was read and, where it could run locally, run against the
emulator.

- **end to end** — run against the emulator's endpoint and completed: as deployed
  and with the emulator's keys, except incident-response's integration suite, which
  signs with fixed `fake` keys and so ran on a second emulator started with
  `--auth off`, with the table-state waits that `test/integration/setup.ts` on `main`
  carries;
- **partial** — some of its AWS surface runs, or it was not run; its blockers name
  what does not run;
- **none** — nothing it does against AWS can be exercised;
- **no AWS** — its own code makes no AWS call; outside the percentages.

| repo | end to end | partial | none | no AWS |
| --- | --- | --- | --- | --- |
| cloudgov | 7 | 5 | 1 | 1 |
| competitive-intelligence | 0 | 0 | 2 | 0 |
| digest-pipeline | 2 | 1 | 0 | 1 |
| docs | 0 | 2 | 0 | 0 |
| eks-agent-platform | 1 | 9 | 5 | 3 |
| eks-fleet | 0 | 2 | 0 | 0 |
| eks-gitops | 0 | 11 | 2 | 2 |
| fab | 1 | 1 | 1 | 1 |
| incident-response | 2 | 3 | 0 | 0 |
| landing-zone | 6 | 37 | 8 | 2 |
| nanohype | 1 | 3 | 1 | 3 |
| nanohype.dev | 2 | 3 | 0 | 0 |
| portal | 2 | 3 | 1 | 1 |
| slack-knowledge-bot | 0 | 2 | 0 | 0 |
| .github, clusters, homebrew-tap, kx, tenants | 0 | 0 | 0 | 5 |
| **total (146)** | **24** | **82** | **21** | **19** |

landing-zone components that deploy both in a workload account and in the fleet hub
(cluster, network, cluster-addons, cluster-bootstrap) count once per context,
because their inputs and blockers differ. The nanohype row counts its seven
template families as components.

**End to end (24):** seven cloudgov command families (`inventory`, `storage audit`,
`network audit`, `secrets scan`, `certs` and `lambda audit`, `tags`, `drift`);
landing-zone's secrets, github-oidc, model-import, vpc-flow-logs, shared-backup and
shared-observability; incident-response's integration suite and seed script;
digest-pipeline's API and seed script; nanohype.dev's deploy and evals leaves;
portal's account connection test and artifact store; eks-agent-platform's
eval-runtime; fab's STS session attribution; the catalog's data-store template
family.

**Partial (82)** components mostly stop on one or two gaps, or were not run. The
blockers they list most often are the missing Kubernetes API, Pod Identity or IRSA
(15), Bedrock's missing model (10), S3 Control (10) and the security-group egress
revoke (9). Six would run end to end by their source — the eks-gitops controllers
external-secrets, external-dns, KEDA's SQS scaler, the loki/tempo/argo-workflows/druid
S3 stores and both otel-gateway tiers — but count as partial until run.

**None (21)** falls in three groups and a tail: Kubernetes behind EKS (the three
cluster-bootstrap components, EKS managed add-ons, Cilium ENI IPAM, portal cluster
access, landing-zone's end-to-end script); models (the ModelGateway path,
envoy-ai-gateway, eval-runner, gateway-conformance, competitive-intelligence's
service and evals, the embedding templates, fab's Claude Platform on AWS transport);
Organizations (org-scp, org-backup); and one each for Cost Explorer, IPAM
(shared-network), the security-group egress revoke (agent-egress) and a hard-coded
Pricing host.

### Terragrunt applies

Ten Terragrunt trees were applied: landing-zone's management, network,
shared-services, backup, workload-development and fleet trees, eks-agent-platform's
org and development-platform trees, and the nanohype.dev and docs site trees. The
staging and production trees (landing-zone's workload-staging and
workload-production, eks-agent-platform's staging-platform and production-platform)
were not applied. Each tree ran twice with
`terragrunt run --all --queue-ignore-errors apply`, in dependency order, on one
emulator, with the client, S3 Control and state settings above and none of the
changes in the exclude table. The first pass ran with those settings plus placeholder
fills in the copy (`["000000000000"]` for break-glass's trusted account ids, which
its validation refuses empty, and an example address for alert emails) and applied
10 of 57 units. The second, on the same state, also seeded two KMS keys, a VPC with
subnets, a route table and a security group, the GitHub OIDC provider, a hosted
zone, a transit gateway and `000000000000` as org-backup's delegated-admin account,
but not the SSM handoff parameters, and applied **12 of 57**. What stops the other
45 on the second pass:

| units | what stops them | class |
| --- | --- | --- |
| 18 | AWS-owned data the emulator does not ship: no Bottlerocket EKS AMI parameters (the development cluster and the 11 leaves behind it), and an endpoint catalog without `eks`, `eks-auth` or `aps-workspaces` (the fleet hub network and its 5 dependants) | fixture |
| 15 | an operation that answers 501: IPAM (7 units); Organizations, Config, Security Hub, Backup or Cost Explorer (8 units: org-scp, org-identity, org-backup, org-compliance, org-security, org-cost, the development backup leaf and the cost pipeline) | 501 |
| 6 | an implemented operation that answers unlike AWS: the default network ACL tag (2), ACM validation (2), the egress revoke (1), the service-principal bucket check (1) | behaviour |
| 4 | an input another stack writes: SSM handoff parameters (3), a KMS key policy (1) | input |
| 2 | a real AWS limit the configuration broke: Route 53's ten tags per `ChangeTagsForResource` call | real AWS |

A unit that ran counts once, under the most specific class among its errors (501,
then behaviour, fixture, real AWS, input); a unit that never ran counts under the
unit it waited on, and can hold more blockers of its own. The second pass re-applied
the first pass's 10 units on the same state, and nine of them report no changes.
The tenth, landing-zone's org-networking, creates IPAM pools: the emulator omits
`Locale` on a pool created without one, where AWS returns the string `"None"`, so
every later plan replaces the pool tree, and the replacement stops on
`GetIpamPoolAllocations` (501).

### Ranked gaps

Ranked by how much of nanohype a fix would unblock, weighted by how hard the gap is
to work around. "Leaf plans" counts the Terragrunt leaf plans that create the named
type.

| # | gap | kind | what it stops | workaround |
| --- | --- | --- | --- | --- |
| 1 | **S3 Control unreachable from SDKs.** Endpoint rules prefix the account id to the host; the certificate names only `localhost`, `127.0.0.1`, `::1`. | reachability | every `aws_s3_bucket`, which all four Terragrunt repos deploy (28 leaf plans: 26 in landing-zone, 2 in nanohype.dev) | [the three S3 Control settings](#s3-control) |
| 2 | **`RevokeSecurityGroupEgress` with protocol `-1`.** The provider revokes a security group's default egress rule as protocol `-1`, ports 0–0. Outside the default VPC the emulator compares the ports literally and answers `InvalidPermission.NotFound` although the rule exists; in the default VPC it answers success and leaves the rule in place. | behaviour | every `aws_security_group` create in a VPC other than the default (13 leaf plans: the hub, staging and production network and cluster leaves, druid and pipeline in each of the three workload environments, and development's tenant-substrate; agent-egress stops on it in the applies) | none in config |
| 3 | **EC2 `CreateTags` on the default network ACL.** `InvalidNetworkAclID.NotFound` for the id `DescribeNetworkAcls` lists. | behaviour | every VPC built with terraform-aws-modules/vpc, which manages the default ACL | exclude `aws_default_network_acl` |
| 4 | **EC2 `DescribeTags` answers 501.** | 501 | `aws_ec2_tag` (4 leaf plans) calls it and cannot be created; the provider's tag-read fallback also covers 18 more EC2 types, but it runs only when a read sets no tags, each of their reads sets tags itself, and in the applies only `aws_ec2_tag` called it; Cilium's ENI mode and the VPC CNI call it | none |
| 5 | **IPAM.** `AllocateIpamPoolCidr` and `GetIpamPoolAllocations` answer 501, `CreateVpc` refuses an IPAM pool, and a pool without a locale reads back without `"None"`. | 501 + behaviour | org-networking applies once and never again; the three shared-network leaves and their shared-dns leaves | fixed CIDRs |
| 6 | **VPC endpoint service catalog** (a fixed list of 47 `com.amazonaws` services and one `aws.api` service) lacks `eks`, `eks-auth`, `aps-workspaces`. | fixture | the fleet hub network and its dependants, shared-network | turn those interface endpoints off |
| 7 | **Kubernetes behind EKS.** Clusters go `ACTIVE` with a minted endpoint that serves no Kubernetes API; Pod Identity and IRSA cannot issue credentials. | by design | cluster-bootstrap, EKS managed add-ons, portal cluster access, the end-to-end script, Cilium ENI IPAM | [kx](#kx) for the Kubernetes side |
| 8 | **Service-principal writes vs `DenyInsecureTransport`.** SES receipt rules and CloudTrail trails refuse a bucket whose policy denies `aws:SecureTransport=false`; on AWS those deliveries arrive over TLS and the statement does not apply. | behaviour | any receipt rule or trail writing to a hardened bucket | drop the statement in the copy |
| 9 | **Organizations.** 15 of the 17 operations nanohype calls answer 501 (`CreatePolicy`, `AttachPolicy`, `ListAccounts`, `RegisterDelegatedAdministrator`, `DescribePolicy`, `ListTargetsForPolicy`, …). One account only, so cross-account roles and RAM shares record and mean nothing. | 501 | org-scp and org-backup (none); org-identity, org-security, org-compliance (partial) | none |
| 10 | **Bedrock.** Runtime returns a fixed notice with estimated token counts; embedding models are refused; `ApplyGuardrail` answers 501; invocation logs are never written. | by design | the ModelGateway path, eval-runner, gateway-conformance, the tenant apps' model calls, the embedding templates | mock providers, or real Bedrock |
| 11 | **ACM DNS validation.** Public DNS-validated certificates stay `PENDING_VALIDATION` for 72 hours. | behaviour | both site leaves; the three workload dns leaves create the validation resource | exclude the validation resource |
| 12 | **Cost Explorer.** `GetCostAndUsage`, `GetTags` and the tagging operations answer 501. | 501 | cloudgov `cost diff`, eks-agent-platform's cost pipeline, landing-zone org-cost | the repos' own price tables |
| 13 | **Public fixture data.** No Bottlerocket EKS AMI parameters; 63 AWS-managed IAM policies, without `AmazonEKSWorkerNodePolicy` or `AmazonEC2ContainerRegistryReadOnly`; Pricing seeds a subset. | fixture | every cluster leaf; cloudgov `iam scan` and `audit`; the pricing refresh script | pin AMI ids |
| 14 | **Step Functions `aws-sdk:iam:*`.** IAM is not among the SDK integrations the emulator executes. | behaviour | eks-agent-platform's [kill switch](/decisions/kill-switch/) fires and never detaches a policy | none |
| 15 | **Athena.** Named-query operations answer 501; no Parquet SerDe; the SQLite engine lacks Presto functions such as `element_at` and `date_trunc`. | 501 + behaviour | the cost pipeline's CUR queries | none |
| 16 | **Config, Security Hub and Backup operations** (`PutOrganizationConfigRule`, `PutConformancePack` from S3, `UpdateSecurityHubConfiguration`, `UpdateGlobalSettings`, `PutBackupVaultNotifications`). | 501 | org-compliance, org-security, org-backup, the workload backup leaf | none |

Smaller gaps, each found by a nanohype component: Resource Groups Tagging
`GetResources` covers 10 services, so a teardown that enumerates by tag misses EC2,
EKS and IAM; `DeleteEgressOnlyInternetGateway` and ElastiCache
`DeleteReplicationGroup` answer 501; IAM `GetAccountSummary` is not routed and
answers 400 `InvalidAction`; CloudWatch Logs is not region-keyed, so a 17-region
sweep reports one log group 17 times; the guest Python's boto3 has no paginators;
SES v2 sends to unverified recipients while the account is in the sandbox.

The highest-leverage upstream fixes, in the order above: S3 Control on `localhost`
(or a wildcard certificate name), the protocol `-1` egress revoke, `CreateTags` on
the default network ACL, EC2 `DescribeTags`, service-principal writes to buckets
with `DenyInsecureTransport`, and the fixture data — which alone stops 18 of the 45
units that do not apply.

### What a run catches

Every class below passes `validate`, `plan` and the unit-test mocks, and fails
against AWS. Each is guarded where it lives:

- **A Route 53 zone with more tags than one call can add.** `ChangeTagsForResource`
  takes at most ten tags per call, and the provider sends a zone's whole set at
  once. landing-zone's DNS components tag zones through a provider with no default
  tags ([`route53-tags.tf`](https://github.com/nanohype/landing-zone/blob/main/components/aws/dns/route53-tags.tf))
  and check the count at plan ([`main.tf`](https://github.com/nanohype/landing-zone/blob/main/components/aws/dns/main.tf)).
- **A value AWS's own grammar refuses.** A cost category rule version other than
  `CostCategoryExpression.v1`, and a non-ASCII character in an Identity Center
  permission-set description, both plan cleanly and fail at the API. Both are
  validated at plan
  ([`org-cost`](https://github.com/nanohype/landing-zone/blob/main/components/aws/org-cost/variables.tf),
  [`org-identity`](https://github.com/nanohype/landing-zone/blob/main/components/aws/org-identity/variables.tf)).
- **A postcondition on an attribute the provider never returns.** The route-table
  data source drops VPC-endpoint routes from `routes`, so a check for the S3 gateway
  route there can never pass, and the `network` component's adopt preflight makes no
  such check. The network owner checks the endpoint instead: `endpoint_set_complete`
  requires the S3 gateway endpoint, which `endpoints.tf` associates with the VPC's
  public and private route tables
  ([`components/aws/shared-network/checks.tf`](https://github.com/nanohype/landing-zone/blob/main/components/aws/shared-network/checks.tf)).
- **Region-specific API rules.** `CreateBucket` refuses a `LocationConstraint` of
  `us-east-1`
  ([`scripts/init-backend-aws.sh`](https://github.com/nanohype/landing-zone/blob/main/scripts/init-backend-aws.sh)).
- **Eventual state.** DynamoDB tables sit in `CREATING` and `DELETING` for seconds,
  as on AWS; a suite that does not wait for `ACTIVE` passes on dynamodb-local and
  fails here
  ([`test/integration/setup.ts`](https://github.com/nanohype/incident-response/blob/main/test/integration/setup.ts)).
- **A delivery that never arrives.** A Scheduler target on a FIFO queue without
  `SqsParameters.MessageGroupId` is accepted and never delivered
  ([`src/services/nudge-scheduler.ts`](https://github.com/nanohype/incident-response/blob/main/src/services/nudge-scheduler.ts)).

## How it fits with kx and the local stand-ins

Every stand-in nanohype uses in place of AWS — compose services, CI service
containers, test fakes and mocks, kx's stack — gets one verdict against the
emulator:

| verdict | stand-ins |
| --- | --- |
| the emulator replaces it | 3 |
| complements: each covers something the other cannot | 25 |
| the stand-in wins | 16 |
| **total** | **44** |

<a id="kx"></a>**kx** mirrors the eks-gitops chart catalog on kind, so it holds the
Kubernetes side the emulator lacks, and the emulator holds the AWS side kx stubs
out. Neither replaces the other:

- *Emulator replaces:* external-secrets' `fake` and `kubernetes` SecretStores. The
  production `aws-secrets-manager` ClusterSecretStore and its `dataFrom.extract`
  ExternalSecrets call only Secrets Manager operations the emulator implements.
- *Emulator complements:* MinIO as the velero and druid object store — the emulator
  implements every S3 operation they call and evaluates the IAM and bucket policies
  the production buckets carry, which MinIO used as root never checks, but it needs
  a kind-reachable bind address and its CA in the cluster; loki and tempo filesystem
  backends; the otel-collector's local exporters (the floor tier's `awsemf`,
  `awscloudwatchlogs` and `awsxray` exporters and SigV4 `remote_write` call
  operations the emulator implements); kube-prometheus-stack (emulator Amazon
  Managed Service for Prometheus takes `remote_write` and a PromQL subset, but its
  Grafana workspace API serves only `GET /api/org`); the absence of external-dns,
  which kx leaves to GitOps (the emulator implements every Route 53 operation
  external-dns calls, and its Route 53 serves no DNS); the
  eks-agent-platform operator, run with `--disable-aws`, whose AWS operations are
  all implemented.
- *kx wins:* ingress-nginx over the load balancer controller, kind nodes over
  Karpenter, Cilium `kubernetes` IPAM over ENI mode, local-path over EBS CSI,
  cloudnative-pg over RDS, trust-manager over ACM. For the load balancer controller,
  Karpenter, EBS and ACM the emulator records the resource with nothing behind it;
  Cilium's ENI mode needs EC2 operations that answer 501; emulator RDS executes SQL
  on SQLite.
- *Neither:* Pod Identity and IRSA need an EKS control plane to inject credentials,
  so every controller on kind authenticates with static keys, whichever backend it
  talks to.
- kx's opt-in `bedrock-credentials` slice exports credentials from a named AWS
  profile into the cluster, so the AI-gateway path calls real Bedrock. Leave it off
  for an emulator run; the emulator's Bedrock Runtime returns fixed text and is no
  substitute for the model.

**The other stand-ins**, by verdict:

- *The stand-in wins* wherever an engine, a data plane or speed matters: postgres,
  pgvector, cloudnative-pg and Testcontainers PostgreSQL over emulator RDS (the
  PostgreSQL wire protocol over SQLite, no extensions); Redis containers and
  hand-written Redis fakes over ElastiCache (no data plane); mock LLM, embedder and
  vector-store providers over Bedrock (no embeddings, fixed chat text); MinIO in
  portal (plain HTTP with static keys, where the emulator's TLS-only endpoint needs
  a custom CA that portal's S3 client cannot take on macOS).
- *Complements* wherever the stand-in is a unit-test seam: `aws-sdk-client-mock`
  and `vi.mock` clients, injected fakes, cloudgov's hand-written SDK interface
  mocks, `tofu test` with `mock_provider "aws"`, and Terragrunt `mock_outputs`.
  These stay for speed and failure injection. The emulator adds the wire,
  conditions, encryption-context checks and apply-time refusals the mocks cannot
  see — the classes in [What a run catches](#what-a-run-catches).
- *dynamodb-local* (incident-response's CI) complements: dynamodb-local passes the
  integration suite as it stands at `d994553d`. The emulator passes it once its setup
  waits for each table state, as `test/integration/setup.ts` on `main` does, and only
  under `--auth off`, because that file signs with fixed `fake` keys. With the waits,
  dynamodb-local runs it in a twentieth of the time. Only the
  emulator models table lifecycle states, and only the emulator could take the
  suite, which touches DynamoDB alone, on to SQS, Scheduler and Secrets Manager.
- *Emulator replaces:* eks-agent-platform's in-memory IAM fake — every IAM operation
  the operator's platform reconciler calls is implemented, and its Go SDK takes
  `AWS_ENDPOINT_URL` and `AWS_CA_BUNDLE` — and the coverage exclusion on the
  catalog's untested SQS adapter in `module-queue-ts`, which the emulator runs
  fully. The Bedrock embedders that `data-pipeline` and `module-semantic-cache`
  exclude call embedding models, which the emulator refuses, so those stay with
  mocks.

No nanohype repo uses LocalStack or moto.

## Re-measuring against a newer release

Each step below is a definition first and a procedure second, so a later release
can be measured the same way and compared.

### 1. Pin the release

Record `aws-emulator --version` (version, release date, commit) from the binary
under test, and clone [aws/aws-emulator](https://github.com/aws/aws-emulator) at
the same commit. Every later step reads that checkout or that binary.

### 2. Inventory the emulator

The shared code in `services/common` serves no operation. Each service is a crate,
`services/service-<…>/`. Its `OPERATIONS.md` names the SDK id on a `**SDK id:**`
line; the SDK id is the join key to nanohype's calls. Its `smithy-model/*.json` lists
the model's operations. Each operation the crate serves has a file in `src/ops/` whose header names it
(`//! @op <Operation>`):

- **implemented** — the op file has no line `//! SCAFFOLDED, NOT IMPLEMENTED:`;
- **scaffolded** — the op file has that line, and the operation answers 501;
- **unwired** — listed in `src/ops/SKIPPED_STUBS.md` (`SKIPPED: <Operation>`) with no
  op file, so the router has no entry and the request answers as an unknown action
  (IAM's is 400 `InvalidAction`).

From the checkout's root, the number of op files, then the number of scaffolded
ones:

```sh
ops() {
  find services -path '*/src/ops/*.rs' -print \
    | xargs grep -l '^//! @op '
}
ops | wc -l
ops | xargs grep -l '^//! SCAFFOLDED, NOT IMPLEMENTED:' | wc -l
```

At v1.0.322: 436 crates, 19,449 model operations, 19,390 op files, 8,261
scaffolded, 11,129 implemented, and 59 unwired.

An implemented operation can still refuse one input shape: its op file calls
`Scaffolded::not_implemented("<Operation> with <variant>")` on that branch. Collect
those calls per implemented operation, dropping messages that are the bare
operation name or guard an engine with no state store. A refusal raised in a
shared helper rather than the op file is not seen, so the count is a lower bound.

Fidelity comes from the release's own evaluation: the `scores.json.gz` release
asset and the [evaluation suite](https://github.com/aws/aws-emulator-evaluation-suite)'s
manifest. An operation is fidelity-pass when at least one behavioural or wire test
for it passes.

### 3. List what nanohype calls

Clone every git repo in the org at the commit to measure, or in an existing clone
run `git fetch origin` and `git switch --detach origin/<default branch>`, and record
its commit (`git rev-parse HEAD`): those commits are the measurement's reference point on
nanohype's side. Read each repo from tracked files only (`git ls-files`). A
touchpoint is a call site that names an AWS operation:

- an SDK call in Go, TypeScript, Python or Rust — commands, paginators, waiters,
  presigners and credential providers included;
- an `aws` CLI invocation in a script, Taskfile, Makefile or CI workflow;
- a GitHub Action that calls AWS;
- a Terraform resource or data source a repo deploys. Its operations are every
  operation the aws provider can call while creating, reading, updating or deleting
  it, found by walking the provider's Go source from the type's CRUD functions at
  the locked provider version, plus the provider-configure and S3 backend calls
  once per Terragrunt repo. That is an upper bound on one apply, and the right
  bound for "can this type's whole lifecycle run";
- a Kubernetes controller a repo installs. Its operations are the AWS calls in its
  upstream source at the chart version the repo pins, or, where only the IAM grant
  is known, the operations the grant allows. A granted operation the pinned source
  never calls is dropped.

Count distinct (SDK id, operation) pairs; repeated call sites count once. Test
files count. Templates count separately. Then read each hit back: drop names that
make no call (a test fixture, a string in a config schema), and add calls a static
pass cannot see (a dynamically built client, raw HTTP, an operation name passed as a
string).

### 4. Join and tier

Join step 3's pairs to step 2's inventory by SDK id: implemented, scaffolded,
unwired, or no crate. Pairs on S3 Control's account-prefixed operations count as
implemented but unreachable from a stock SDK configuration. Place each service with
an implemented operation in the runs, records or none tier by what its source
executes, and fail the step if any such service has no tier.

### 5. Run it

- **Components.** For each component, apply or run it against a fresh emulator with
  the [setup](#setup) above (a component that signs with fixed keys, against a second
  emulator started with `--auth off`), and record a verdict (end to end, partial, none, no
  AWS) with its blockers and the evidence. A component read but not run is partial.
- **Applies.** Run `terragrunt run --all --queue-ignore-errors apply` over each
  deployable tree in dependency order, with `--report-file` per tree. Classify each
  error as 501, behaviour, fixture, real AWS or input, and count each unit that ran
  once, under the most specific class among its errors in that order. A unit that
  never ran counts under the unit it waited on. A unit the report marks
  `early exit, ancestor error` that still ran OpenTofu and failed on its own error
  counts under that error. Treat an error line no rule covers as a
  failure of the classifier, not as a new class. Then re-apply the units that
  applied, on the same state, and record every non-empty re-plan.

### 6. Prove every negative

Every "absent", "not used" and "not supported" claim needs a check that is also
shown to find something where something exists:

| claim | positive control |
| --- | --- |
| an operation is not implemented | every 501 seen live is scaffolded in the inventory or is a listed input variant, and no operation the inventory marks implemented answers a bare 501 |
| an operation needs a host prefix | the Smithy-model scan finds S3 Control's `{AccountId}.` prefix, the one seen failing live |
| no Bottlerocket EKS parameters | the same `GetParametersByPath` returns Amazon Linux, ECS and Bottlerocket ECS parameters |
| an endpoint service is missing from the catalog | `s3`, `ecr.api`, `secretsmanager`, `sts` and `logs` resolve by the same lookup |
| a managed policy is missing | `AmazonEKSClusterPolicy` and `AmazonEKS_CNI_Policy` resolve by the same `GetPolicy` |
| the service-principal check refuses `DenyInsecureTransport` | the same bucket policy without that statement passes |
| no crate serves a service | the same search finds the 8 crates with a Bedrock SDK id |
| a repo does not use a stand-in | the same search over every repo finds MinIO in kx and portal |
| nothing reached AWS through the proxy | the proxy's log records allowed registry tunnels and refused AWS hosts, so logging works |
| a smoke test passes for a reason | the same script with a wrong expected value fails |

### What moves first

Re-check the [ranked gaps](#ranked-gaps) in order. Gaps 2, 3, 5, 6, 8, 9, 11, 12,
13 and 16 each stop a unit first in the applies, and the fixture data among them,
gaps 6 and 13, stops the largest group (18 units). A fix to one of these moves its
units on to their next blocker, or applies them. The applies ran with gap 1's
workaround in place. Gaps 4, 7, 10, 14 and 15 stop no unit first, so a fix to one
of them moves component verdicts, and moves the apply count only once the gaps in
front of it are fixed.

The operation percentage moves least, because at v1.0.322 it is already 89.4%. The
distance from there to the 18.9% of components that run end to end is spread across
every kind of gap. The gaps the emulator has by design weigh most: Kubernetes behind
EKS and models account for 15 of the 21 components with no emulator path, and the
missing Kubernetes API (15) and Bedrock's missing model (10) are among the blockers
partial components list most often. The rest are S3 Control's host prefix,
behaviour, fixture data, and the 501s concentrated in IPAM, Organizations and the
cost and compliance services.

## Reference commits

The nanohype side of every number on this page, one commit per repository:

| repository | commit |
| --- | --- |
| .github | `9911d295` |
| cloudgov | `8d9d246c` |
| clusters (private) | `62dfd121` |
| competitive-intelligence | `552747b1` |
| digest-pipeline | `bfed4faa` |
| docs | `9d013043` |
| eks-agent-platform | `6f3062ae` |
| eks-fleet | `e42e88fc` |
| eks-gitops | `a6ee6151` |
| fab | `e5479cc1` |
| homebrew-tap | `9ee8a0bc` |
| incident-response | `d994553d` |
| kx | `e6e7b6de` |
| landing-zone | `fe9646b0` |
| nanohype | `d7ba03fa` |
| nanohype.dev (private) | `76b820ca` |
| portal | `d44856e3` |
| slack-knowledge-bot | `ae7c62b8` |
| tenants (private) | `5cdfd779` |

The Terraform operation map was built from terraform-provider-aws v6.60.0, the
version landing-zone and eks-agent-platform locked at those commits.
