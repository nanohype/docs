#!/usr/bin/env bash
set -uo pipefail

# Red-state tests for scripts/pin-drift.sh and scripts/plan-severity.jq.
#
# A gate is worth its exit code only if it has been shown to FAIL, and this one
# has two halves that fail differently. The classifier decides what a plan costs;
# the script decides whether the pin could have produced the account at all. Both
# have a silent failure mode that reads as a pass:
#
#   - a classifier that compiles but matches nothing returns [], which the script
#     reads as "clean";
#   - a suppression filter that compares an address against the wrong operand
#     matches nothing either, and a suppression file that never suppresses is
#     worse than none, because the repository reads as though destroys are gated
#     when they are only annotated.
#
# Every case below is a distinct INPUT the gate reacts to, not a second value of
# one input. Nothing here reaches AWS or the network: the module "remote" is a
# bare repository in a temp directory, so L0, L1 and L2 run in full. L3 needs an
# account, and its classifier is exercised directly against plan JSON instead.

here=$(cd "$(dirname "$0")" && pwd)
GATE="${here}/pin-drift.sh"
SEV="${here}/plan-severity.jq"

pass=0
failed=0
check() { # want, got, name
  if [ "$1" = "$2" ]; then
    printf '  PASS  %s\n' "$3"; pass=$((pass + 1))
  else
    printf '  FAIL  %s (want %s, got %s)\n' "$3" "$1" "$2"; failed=$((failed + 1))
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "pin-drift self-test"

# ── the classifier, against plan JSON written by hand ────────────────────────
#
# Written by hand rather than captured from a real plan so each case isolates one
# property. A captured plan proves the classifier handles that plan.
severity_of() { # <plan json on stdin> <address>
  jq -r -f "$SEV" | jq -r --arg a "$1" '.[] | select(.address == $a) | .severity'
}
count_findings() { jq -r -f "$SEV" | jq 'length'; }

deleted='{"resource_changes":[{"address":"aws_cloudwatch_metric_alarm.a",
  "change":{"actions":["delete"],"before":{"alarm_name":"a"},"after":null}}]}'
check DESTRUCTIVE "$(printf '%s' "$deleted" | severity_of aws_cloudwatch_metric_alarm.a)" \
  "a destroy is DESTRUCTIVE"

replaced='{"resource_changes":[{"address":"aws_iam_role.r",
  "change":{"actions":["delete","create"],"before":{"name":"r"},"after":{"name":"r2"}}}]}'
check DESTRUCTIVE "$(printf '%s' "$replaced" | severity_of aws_iam_role.r)" \
  "a replacement is DESTRUCTIVE — the resource still leaves the account"

# The shape all three OIDC instances share: the live document constrains
# repository_id and the proposed one does not.
lost_cond='{"resource_changes":[{"address":"aws_iam_role.deploy","change":{"actions":["update"],
  "before":{"assume_role_policy":"{\"Statement\":[{\"Effect\":\"Allow\",\"Condition\":{\"StringEquals\":{\"token.actions.githubusercontent.com:aud\":\"sts.amazonaws.com\",\"token.actions.githubusercontent.com:repository_id\":\"1\"},\"StringLike\":{\"token.actions.githubusercontent.com:sub\":\"repo:*:ref:refs/heads/main\"}}}]}"},
  "after":{"assume_role_policy":"{\"Statement\":[{\"Effect\":\"Allow\",\"Condition\":{\"StringEquals\":{\"token.actions.githubusercontent.com:aud\":\"sts.amazonaws.com\",\"token.actions.githubusercontent.com:sub\":\"repo:o/n:ref:refs/heads/main\"}}}]}"}}}]}'
check REVERTING "$(printf '%s' "$lost_cond" | severity_of aws_iam_role.deploy)" \
  "an IAM document that loses a condition key is REVERTING"

dropped_stmt='{"resource_changes":[{"address":"aws_iam_role_policy.p","change":{"actions":["update"],
  "before":{"policy":"{\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:GetObject\"},{\"Effect\":\"Allow\",\"Action\":\"sqs:SendMessage\"}]}"},
  "after":{"policy":"{\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:GetObject\"}]}"}}}]}'
check REVERTING "$(printf '%s' "$dropped_stmt" | severity_of aws_iam_role_policy.p)" \
  "an IAM document that loses a statement is REVERTING"

# IAM accepts Statement as a bare object as well as a list, and both forms reach
# a plan verbatim. Reading only the list form scores this ADVANCING.
single_stmt='{"resource_changes":[{"address":"aws_iam_role.s","change":{"actions":["update"],
  "before":{"assume_role_policy":"{\"Statement\":{\"Effect\":\"Allow\",\"Condition\":{\"StringEquals\":{\"k\":\"v\"}}}}"},
  "after":{"assume_role_policy":"{\"Statement\":{\"Effect\":\"Allow\"}}"}}}]}'
check REVERTING "$(printf '%s' "$single_stmt" | severity_of aws_iam_role.s)" \
  "a single-object Statement is read like a list"

gained_cond='{"resource_changes":[{"address":"aws_iam_role.t","change":{"actions":["update"],
  "before":{"assume_role_policy":"{\"Statement\":[{\"Condition\":{\"StringEquals\":{\"a\":\"1\"}}}]}"},
  "after":{"assume_role_policy":"{\"Statement\":[{\"Condition\":{\"StringEquals\":{\"a\":\"1\",\"b\":\"2\"}}}]}"}}}]}'
check ADVANCING "$(printf '%s' "$gained_cond" | severity_of aws_iam_role.t)" \
  "an IAM document that gains a condition key is ADVANCING"

created='{"resource_changes":[{"address":"aws_sns_topic.n",
  "change":{"actions":["create"],"before":null,"after":{"name":"n"}}}]}'
check ADVANCING "$(printf '%s' "$created" | severity_of aws_sns_topic.n)" \
  "a create is ADVANCING"

# A document that is unknown until apply cannot be compared with the live one,
# and guessing REVERTING there would fire on every policy embedding an ARN.
unknown_doc='{"resource_changes":[{"address":"aws_s3_bucket_policy.b","change":{"actions":["update"],
  "before":{"policy":"{\"Statement\":[{\"Condition\":{\"StringEquals\":{\"a\":\"1\"}}}]}"},
  "after":{"policy":null}}}]}'
check ADVANCING "$(printf '%s' "$unknown_doc" | severity_of aws_s3_bucket_policy.b)" \
  "a document unknown until apply is ADVANCING, not REVERTING"

revision_only='{"resource_changes":[{"address":"aws_sns_topic.n","change":{"actions":["update"],
  "before":{"tags":{"Revision":"aaaaaaa"}},"after":{"tags":{"Revision":"bbbbbbb"}}}}]}'
check 0 "$(printf '%s' "$revision_only" | count_findings)" \
  "a Revision-tag-only change is not a finding"

other_tag='{"resource_changes":[{"address":"aws_sns_topic.n","change":{"actions":["update"],
  "before":{"tags":{"Revision":"aaaaaaa","Owner":"a"}},"after":{"tags":{"Revision":"bbbbbbb","Owner":"b"}}}}]}'
check 1 "$(printf '%s' "$other_tag" | count_findings)" \
  "a change to a tag other than Revision is a finding"

read_action='{"resource_changes":[{"address":"data.aws_iam_policy_document.d",
  "change":{"actions":["read"],"before":null,"after":{"json":"{}"}}}]}'
check 0 "$(printf '%s' "$read_action" | count_findings)" \
  "a data source being resolved is not a finding"

# ── a module remote, and a live tree that pins it ────────────────────────────
#
# `file://` is a git transport, so `git ls-remote` and go-getter both read this
# the way they read GitHub, and L1 and L2 run for real.
mod="${work}/module"
mkdir -p "${mod}/mod"
cat >"${mod}/mod/main.tf" <<'TF'
variable "required_one" { type = string }
variable "optional_one" {
  type    = string
  default = "unset"
}
output "echo" { value = "${var.required_one}-${var.optional_one}" }
TF
git -C "$mod" init -q
git -C "$mod" -c user.email=t@t -c user.name=t add -A
git -C "$mod" -c user.email=t@t -c user.name=t commit -qm one
git -C "$mod" tag -a v1.0.0 -m 'annotated'          # annotated: ls-remote peels it
git -C "$mod" tag lightweight-v1.0.0                # lightweight: no peeled line
sed -i.bak 's/required_one/required_two/g' "${mod}/mod/main.tf" && rm -f "${mod}/mod/main.tf.bak"
git -C "$mod" -c user.email=t@t -c user.name=t commit -qam two
git -C "$mod" tag -a v2.0.0 -m 'annotated'
remote="file://${mod}/.git"

tree="${work}/live"
mkdir -p "${tree}/unit"
cat >"${tree}/root.hcl" <<'HCL'
inputs = {
  injected_by_root = "a value no component has to declare"
}
HCL

unit_with() { # <source>
  cat >"${tree}/unit/terragrunt.hcl" <<HCL
include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "$1"
}

inputs = {
  required_one = "supplied"
}
HCL
}

run_gate() { "$GATE" "$tree" >"${work}/out" 2>&1; echo $?; }

# The tree as pinned has to pass, or no red case below means anything.
unit_with "git::${remote}//mod?ref=v1.0.0"
check 0 "$(run_gate)" "a pin that resolves and whose inputs align passes"

check 1 "$(grep -c 'injected_by_root' "${work}/out")" \
  "a root-injected input the module ignores is reported, not failed"

unit_with "git::${remote}//mod?ref=lightweight-v1.0.0"
check 0 "$(run_gate)" "a lightweight tag resolves — ls-remote emits no peeled line for one"

unit_with "git::${remote}//mod?ref=v9.9.9"
check 1 "$(run_gate)" "a ref that does not exist on the remote -> exit 1"

unit_with "git::${remote}//mod?ref=main"
check 1 "$(run_gate)" "a ref naming a branch -> exit 1"

unit_with "git::${remote}//mod"
check 1 "$(run_gate)" "a remote source with no ?ref= -> exit 1"

# The bump that renamed a required variable, with the unit left as it was. This
# is the whole of L2's blocking half, and it runs with no credentials.
unit_with "git::${remote}//mod?ref=v2.0.0"
check 1 "$(run_gate)" "a pin whose module renamed a required variable -> exit 1"
check 1 "$(grep -c 'required_two' "${work}/out")" "and it names the variable"

# `ref` is one query parameter among several and carries no guaranteed position.
# Asserted on the ref L1 REPORTS rather than on a successful fetch, so the case
# tests this script's parsing and not go-getter's clone.
unit_with "git::${remote}//mod?depth=1&ref=v9.9.9"
run_gate >/dev/null
check 1 "$(grep -c '?ref=v9.9.9 does not exist' "${work}/out")" \
  "ref is read from any position in the query string"

# ── the lock ─────────────────────────────────────────────────────────────────
unit_with "git::${remote}//mod?ref=v1.0.0"
"$GATE" "$tree" --write-lock >/dev/null 2>&1
check 0 "$(run_gate)" "a lock written from the remote matches it"

sha=$(git -C "$mod" rev-list -n1 v1.0.0)
check 1 "$(jq -r --arg k "${remote}#v1.0.0" --arg s "$sha" '.[$k] == $s' "${tree}/module-pins.lock" | grep -c true)" \
  "the lock records the tag's peeled commit"

jq --arg k "${remote}#v1.0.0" '.[$k] = "0000000000000000000000000000000000000000"' \
  "${tree}/module-pins.lock" >"${work}/l" && mv "${work}/l" "${tree}/module-pins.lock"
check 1 "$(run_gate)" "a tag repointed under the pin -> exit 1"

echo '{}' >"${tree}/module-pins.lock"
check 1 "$(run_gate)" "a pin absent from the lock -> exit 1"
rm -f "${tree}/module-pins.lock"

# ── the expectations file ────────────────────────────────────────────────────
#
# Its schema is enforced before any unit reads it, so a malformed file fails even
# on a tree whose plans would all have been clean. A suppression whose defects
# surface only on the day it is needed is the failure the file exists to prevent.
expect="${work}/plan-expected.json"
run_gate_expect() { PIN_EXPECT="$expect" "$GATE" "$tree" >"${work}/out" 2>&1; echo $?; }

printf '{"unit": [{"address": "aws_iam_user.u", "expires": "2999-01-01", "reason": "retiring it"}]}\n' >"$expect"
check 0 "$(run_gate_expect)" "a well-formed expectations file is accepted"

printf '{"unit": [{"address": "aws_iam_user.u", "reason": "retiring it"}]}\n' >"$expect"
check 2 "$(run_gate_expect)" "an entry with no expires -> exit 2"

printf '{"unit": [{"address": "aws_iam_user.u", "expires": "2999-01-01"}]}\n' >"$expect"
check 2 "$(run_gate_expect)" "an entry with no reason -> exit 2"

printf '{"unit": [{"expires": "2999-01-01", "reason": "retiring it"}]}\n' >"$expect"
check 2 "$(run_gate_expect)" "an entry with no address -> exit 2"

printf '{"unit": [{"address": "aws_iam_user.u", "expires": "soon", "reason": "retiring it"}]}\n' >"$expect"
check 2 "$(run_gate_expect)" "an expires that is not a date -> exit 2"

printf '[]\n' >"$expect"
check 2 "$(run_gate_expect)" "an expectations file that is not an object -> exit 2"

# ── discovery ────────────────────────────────────────────────────────────────
#
# A walk that finds nothing exits 0 in every shell, and reports the same green as
# a run that read every unit.
empty="${work}/empty"
mkdir -p "$empty"
"$GATE" "$empty" >/dev/null 2>&1
check 2 "$?" "a tree with no unit -> exit 2, never a pass"

printf '\n%s passed, %s failed\n' "$pass" "$failed"
[ "$failed" -eq 0 ]
