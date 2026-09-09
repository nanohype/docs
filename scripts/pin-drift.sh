#!/usr/bin/env bash
#
# Fails when a unit's tracked module version cannot be the version its account is
# running.
#
#   pin-drift.sh <live-tree-root> [--plan] [--write-lock]
#
# State records which resources exist, never which module version produced them,
# so "what is this account running" is unanswerable from a repository and a state
# bucket alone. A unit whose pin is behind the version that was applied plans a
# REVERSAL — resources the applied module declares and the pinned one does not
# are proposed for deletion — and every gate that stops at resolving Terragrunt
# config reports that unit green.
#
# Four layers, cheapest first, each with a different bill:
#
#   L0  shape          no network, no credentials
#   L1  ref resolves   read on the module remote (`git ls-remote --tags`)
#   L2  inputs align   the same, plus a module fetch; still no AWS
#   L3  plan           a read-only role in the account the tree targets (--plan)
#
# L0 through L2 rule out pins that CANNOT be what the account runs. Only L3 reads
# the account, and only L3 catches the class outright.
#
# Written for bash 3.2, which is what macOS ships, so it runs where the tree is
# edited as well as in CI. Nothing here writes to AWS.
#
# Exit: 0 clean, 1 findings, 2 the gate could not run. 2 is distinct on purpose —
# a gate that examined nothing must not report the same green as one that
# examined everything.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: pin-drift.sh <live-tree-root> [--plan] [--write-lock]

  --plan        additionally plan every unit and classify what it proposes.
                Needs a read-only role in the account the tree targets.
  --write-lock  rewrite <live-tree-root>/module-pins.lock from what the module
                remotes currently resolve each pinned tag to, then exit. Review
                the diff: a line that changes without its ?ref= changing is a tag
                that was moved under a pin.

environment
  PIN_LOCK           override the lock path     (default <root>/module-pins.lock)
  PIN_EXPECT         override the expectations  (default <root>/plan-expected.json)
  PIN_SEVERITY_JQ    override the classifier    (default <script dir>/plan-severity.jq)
USAGE
  exit 2
}

live_root=${1:-}
[ -n "$live_root" ] || usage
case "$live_root" in -*) usage ;; esac
[ -d "$live_root" ] || { echo "pin-drift: ${live_root} is not a directory" >&2; exit 2; }
shift

do_plan=0
write_lock=0
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) do_plan=1 ;;
    --write-lock) write_lock=1 ;;
    -h|--help) usage ;;
    *) echo "pin-drift: unknown argument ${1}" >&2; usage ;;
  esac
  shift
done

live_root=${live_root%/}
script_dir=$(cd "$(dirname "$0")" && pwd)
lock=${PIN_LOCK:-${live_root}/module-pins.lock}
expect=${PIN_EXPECT:-${live_root}/plan-expected.json}
sev_jq=${PIN_SEVERITY_JQ:-${script_dir}/plan-severity.jq}

export TG_NON_INTERACTIVE=true
export TG_NO_COLOR=true

# --no-dependency-outputs lets a unit whose dependency holds no state still
# resolve its own source, which is the whole input L0 and L1 need. It is an
# experiment flag, so it has to be enabled explicitly — and enabled ONLY on the
# render call. Exported for the whole script it reaches L3 as well, where a unit
# with a `dependency` block then plans against unresolved outputs and dies on
# `There is no variable named "dependency"`. That failure lands on healthy units
# and reads exactly like the one this gate exists to report.
render_experiment=(--experiment optional-dependency-outputs)

for tool in terragrunt jq git awk; do
  command -v "$tool" >/dev/null 2>&1 || { echo "pin-drift: ${tool} is not on PATH" >&2; exit 2; }
done
if [ "$do_plan" -eq 1 ] && [ ! -f "$sev_jq" ]; then
  echo "pin-drift: --plan needs the classifier at ${sev_jq}" >&2; exit 2
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/tags"

fail=0
today=$(date -u +%Y-%m-%d)
esc=$(printf '\033')
: >"$tmp/unused"

# GitHub renders `::error file=...::` as an annotation on the offending file.
# Everywhere else it is noise, so the same finding is printed plainly — this runs
# on a laptop as often as on a runner.
err() { # <file> <message>
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error file=${1}::${2}"; else echo "FAIL  ${1}"; echo "      ${2}"; fi
  fail=1
}
note() { # <message>
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::notice::${1}"; else echo "note  ${1}"; fi
}
indent() { sed 's/^/      /'; }
plain()  { sed "s/${esc}\\[[0-9;]*m//g"; }

# The variable names terragrunt lists under one of its input-validation headings.
# Each arrives as "HH:MM:SS.mmm LEVEL \t- name", and the list ends at the next
# heading. Extracted with awk rather than grep because an empty list is a normal
# result and grep reports it as a failure, which `pipefail` then turns into the
# script's exit code.
named_after() { # <heading> <file>
  awk -v m="$1" '
    !on && index($0, m) { on = 1; next }
    on && /inputs/      { exit }
    on && /- [^[:space:]]/ { sub(/^.*- /, ""); print }
  ' "$2"
}

# ── the module remote's tags, fetched once per remote ────────────────────────
#
# bash 3.2 has no associative array, so the cache is one file per remote under
# $tmp/tags, keyed by a filename-safe form of the remote URL.
tag_file() { printf '%s/tags/%s' "$tmp" "$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '_')"; }

load_tags() { # <remote>
  local remote=$1 f
  f=$(tag_file "$remote")
  [ -f "${f}.status" ] && return 0
  # A remote that cannot be reached is not a remote with no tags. Failing to
  # separate those turns "this runner holds no read key" into "every pin in this
  # repository names a tag that does not exist" — a wrong answer, delivered loudly.
  if ! git ls-remote --tags "$remote" >"${f}.raw" 2>"${f}.err"; then
    echo "unreachable" >"${f}.status"
    return 0
  fi
  # Prefer the PEELED target of an annotated tag, and fall back to the object the
  # ref names, which is all a lightweight tag has. Reading only peeled lines
  # reports every lightweight tag as missing.
  awk '
    { ref = $2; sub(/^refs\/tags\//, "", ref)
      if (ref ~ /\^\{\}$/) { sub(/\^\{\}$/, "", ref); peeled[ref] = $1 }
      else                 { direct[ref] = $1 } }
    END { for (t in direct) print ((t in peeled) ? peeled[t] : direct[t]) "\t" t
          for (t in peeled) if (!(t in direct)) print peeled[t] "\t" t }
  ' "${f}.raw" >"$f"
  echo "ok" >"${f}.status"
}

tags_reachable() { [ "$(cat "$(tag_file "$1").status" 2>/dev/null)" = "ok" ]; }
tags_error()     { cat "$(tag_file "$1").err" 2>/dev/null; }
sha_for_tag()    { awk -v t="$2" -F'\t' '$2 == t { print $1; exit }' "$(tag_file "$1")"; }

# ── source parsing ───────────────────────────────────────────────────────────
#
# A go-getter source is `[git::]<remote>[//<subdir>][?k=v&k=v]`. The `//` that
# separates the remote from the subdirectory is not the one in `https://`, so the
# scheme is masked before the split rather than matched around.
source_remote() { # <source>
  local body probe
  body=${1%%\?*}
  body=${body#git::}
  probe=${body/:\/\//:@@@}
  probe=${probe%%//*}
  printf '%s' "${probe/:@@@/://}"
}

# `ref` is one query parameter among several and carries no guaranteed position.
source_ref() { # <source>
  local query param oldifs
  case "$1" in *\?*) query=${1#*\?} ;; *) return 0 ;; esac
  oldifs=$IFS; IFS='&'
  for param in $query; do
    case "$param" in ref=*) IFS=$oldifs; printf '%s' "${param#ref=}"; return 0 ;; esac
  done
  IFS=$oldifs
}

# `git ls-remote` needs a URL. go-getter also accepts `github.com/owner/repo`,
# which it alone knows how to expand.
normalise_remote() { # <remote>
  case "$1" in
    *://*|*@*) printf '%s' "$1" ;;
    *)         printf 'https://%s' "$1" ;;
  esac
}

is_remote_source() { # <source>
  case "$1" in
    git::*|*://*|github.com/*|bitbucket.org/*) return 0 ;;
    *) return 1 ;;
  esac
}

is_sha40() { # <ref>
  case "$1" in
    *[!0-9a-f]*) return 1 ;;
    *) [ ${#1} -eq 40 ] ;;
  esac
}

# ── the expectations file, validated once, before any unit reads it ──────────
#
# An entry with no expiry is a permanently disabled gate wearing a gate's name.
# The schema refuses one, and it refuses it here rather than at the unit that
# would have used it — a suppression file whose defects surface only on the day
# it is needed is the failure this check exists to prevent.
if [ -f "$expect" ]; then
  if ! jq -e 'type == "object"' "$expect" >/dev/null 2>&1; then
    echo "pin-drift: ${expect} must be a JSON object mapping a unit path to its expected findings" >&2
    exit 2
  fi
  bad=$(jq -r '
    to_entries[]
    | .key as $unit
    | (if (.value | type) != "array" then "\($unit): value is not an array" else empty end),
      (.value[]?
       | if (type != "object") then "\($unit): entry is not an object"
         elif (has("address") | not) then "\($unit): entry has no address"
         elif (has("expires") | not) then "\($unit): entry \(.address) has no expires date"
         elif (has("reason") | not) then "\($unit): entry \(.address) has no reason"
         elif ((.expires | tostring) | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$") | not)
           then "\($unit): entry \(.address) has expires \"\(.expires)\", which is not YYYY-MM-DD"
         else empty end)' "$expect")
  if [ -n "$bad" ]; then
    echo "pin-drift: ${expect} is malformed — every entry needs address, reason and an expires date:" >&2
    printf '%s\n' "$bad" | sed 's/^/  /' >&2
    exit 2
  fi
  expect_file=$expect
else
  echo '{}' >"$tmp/no-expectations.json"
  expect_file="$tmp/no-expectations.json"
fi

# ── discovery ────────────────────────────────────────────────────────────────
#
# Walked, never listed. A unit added to the tree is gated with no second edit,
# and a walk that finds nothing fails: `for` over an empty set exits 0 and reports
# the same green as a run that read every unit.
find "$live_root" -name terragrunt.hcl -not -path '*/.terragrunt-cache/*' \
  -exec dirname {} \; | sort >"$tmp/units"
if [ ! -s "$tmp/units" ]; then
  echo "pin-drift: no unit found under ${live_root} — this tree was reported as gated and was not" >&2
  exit 2
fi

# ── --write-lock ─────────────────────────────────────────────────────────────
if [ "$write_lock" -eq 1 ]; then
  : >"$tmp/pins"
  while IFS= read -r unit; do
    src=$(terragrunt render "${render_experiment[@]}" --json --no-dependency-outputs --no-tips \
            --working-dir "$unit" 2>/dev/null | jq -r '.terraform.source // empty') || src=""
    [ -n "$src" ] || continue
    is_remote_source "$src" || continue
    ref=$(source_ref "$src") || ref=""
    [ -n "$ref" ] || continue
    printf '%s\t%s\n' "$(normalise_remote "$(source_remote "$src")")" "$ref" >>"$tmp/pins"
  done <"$tmp/units"

  sort -u "$tmp/pins" >"$tmp/pins.uniq"
  : >"$tmp/lock-entries"
  while IFS=$'\t' read -r remote ref; do
    [ -n "$remote" ] || continue
    if is_sha40 "$ref"; then
      printf '%s#%s\t%s\n' "$remote" "$ref" "$ref" >>"$tmp/lock-entries"
      continue
    fi
    load_tags "$remote"
    tags_reachable "$remote" || { echo "pin-drift: cannot read tags from ${remote}" >&2; exit 2; }
    sha=$(sha_for_tag "$remote" "$ref")
    [ -n "$sha" ] || { echo "pin-drift: ${remote} carries no tag ${ref} — cut the tag before locking it" >&2; exit 2; }
    printf '%s#%s\t%s\n' "$remote" "$ref" "$sha" >>"$tmp/lock-entries"
  done <"$tmp/pins.uniq"

  jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | {(.[0]): .[1]}) | add // {}' \
    "$tmp/lock-entries" >"$lock"
  echo "pin-drift: wrote ${lock}"
  exit 0
fi

total_units=0
remote_units=0
inrepo_units=0

while IFS= read -r unit; do
  total_units=$((total_units + 1))
  # The unit's path relative to the tree root this run was given. It is the key
  # plan-expected.json is written against, so it has to be defined for the
  # degenerate root — a run pointed straight at one unit — as well.
  if [ "$unit" = "$live_root" ]; then rel="."; else rel=${unit#"$live_root"/}; fi
  cfg="${unit}/terragrunt.hcl"

  src=$(terragrunt render "${render_experiment[@]}" --json --no-dependency-outputs --no-tips \
          --working-dir "$unit" 2>"$tmp/render.err" | jq -r '.terraform.source // empty') || src=""
  if [ -z "$src" ]; then
    err "$cfg" "config does not resolve to a module source — a unit nothing can read is a unit nothing gates"
    plain <"$tmp/render.err" | tail -8 | indent
    continue
  fi

  ref=$(source_ref "$src") || ref=""

  # ── L0 shape ───────────────────────────────────────────────────────────────
  #
  # A remote source without ?ref= floats to the module's default branch: the
  # tracked file names no version, so two applies a week apart run two different
  # modules with no diff between them. A ref naming a branch is the same defect
  # spelled out.
  #
  # An in-repo path is a different arrangement, not a worse one — the component
  # and the unit move in the same commit, so the repository IS the version and a
  # change to either arrives in one diff. Those units are counted here and gated
  # by L3, which is the only layer that can say anything about them.
  if is_remote_source "$src"; then
    if [ -z "$ref" ]; then
      err "$cfg" "remote source with no ?ref= — it floats to the module's default branch"
      continue
    fi
    case "$ref" in
      main|master|HEAD|develop|*/*)
        err "$cfg" "?ref=${ref} names a branch, not a version — it moves under the pin"
        continue ;;
    esac
    remote_units=$((remote_units + 1))

    # ── L1 the ref resolves, and resolves where the lock says it did ─────────
    remote=$(normalise_remote "$(source_remote "$src")")
    if is_sha40 "$ref"; then
      sha=$ref                       # a commit pin cannot move; there is nothing to check
    else
      load_tags "$remote"
      if ! tags_reachable "$remote"; then
        err "$cfg" "cannot read tags from ${remote} — L1 did not run, which is not the same as passing"
        tags_error "$remote" | tail -3 | indent
        continue
      fi
      sha=$(sha_for_tag "$remote" "$ref")
      if [ -z "$sha" ]; then
        err "$cfg" "?ref=${ref} does not exist on ${remote} — the module cannot be fetched, so this cannot apply"
        continue
      fi
    fi
    if [ -f "$lock" ]; then
      want=$(jq -r --arg k "${remote}#${ref}" '.[$k] // empty' "$lock")
      if [ -z "$want" ]; then
        err "$lock" "${remote}#${ref} is pinned by ${rel} and not locked — run 'pin-drift.sh ${live_root} --write-lock' and review the diff"
      elif [ "$want" != "$sha" ]; then
        err "$lock" "${remote}#${ref} moved: locked ${want}, remote ${sha} — a tag was repointed under a pin"
      fi
    fi
  else
    inrepo_units=$((inrepo_units + 1))
  fi

  # ── L2 the unit's inputs and the module's variables agree ──────────────────
  #
  # This FETCHES the module, which is the step every other gate in the estate
  # skips, and it is what turns bumping a ref from a one-word edit into a checked
  # one: a version that renamed a required variable fails here rather than at
  # apply, with no credentials and no account.
  #
  # It blocks on ONE thing — a required variable the config does not supply. The
  # other half of the alignment, an input naming a variable the module does not
  # declare, is reported and does not block: a root that injects a common input
  # into every unit (region, environment, name_prefix) makes "unused" the normal
  # state of every component that does not read it, so `--strict` reports a
  # healthy tree as broken. That leaves one gap named rather than papered over —
  # an input a NEW module version dropped, where the old value is silently
  # discarded and the module's default applies instead. Terragrunt hands inputs
  # to OpenTofu as TF_VAR_ and OpenTofu discards a TF_VAR_ for a variable nothing
  # declares, so nothing errors; the unused-input notice below is where it shows,
  # and L3's plan is what proves what it cost.
  #
  # A leaf is judged only once its validation is known to have RUN. Exactly two
  # outcomes mean it did. Anything else — a parse error, a module that cannot be
  # fetched, terragrunt absent — means the unit was NOT inspected, and reporting
  # that as clean is the vacuous pass this whole gate exists to refuse.
  #
  # L2 reads no state and reaches no account, so it says nothing whatever about
  # which version was applied. It does not substitute for L3.
  inputs_ok="All required inputs are passed in by terragrunt"
  inputs_missing="required inputs are missing"
  inputs_unused="inputs passed in by terragrunt are unused"
  terragrunt hcl validate --inputs --working-dir "$unit" >"$tmp/inputs.raw" 2>&1 || true
  plain <"$tmp/inputs.raw" >"$tmp/inputs.out"
  if grep -qF "$inputs_missing" "$tmp/inputs.out"; then
    err "$cfg" "the module's required variables are not all supplied — this unit cannot apply"
    named_after "$inputs_missing" "$tmp/inputs.out" | indent
  elif ! grep -qF "$inputs_ok" "$tmp/inputs.out"; then
    err "$cfg" "input validation produced neither a pass nor a missing-input result — this unit was NOT inspected"
    grep -v 'TIP (debugging-docs)' "$tmp/inputs.out" | tail -12 | indent
  elif grep -qF "$inputs_unused" "$tmp/inputs.out"; then
    # Collected rather than printed here. A root that injects a common input into
    # every unit produces this on every component that does not read it, and one
    # block per unit buries the case worth seeing: a SINGLE unit passing a value
    # the module dropped. The summary at the end sorts by how many units share it.
    named_after "$inputs_unused" "$tmp/inputs.out" \
      | while IFS= read -r name; do printf '%s\t%s\n' "$name" "$rel"; done >>"$tmp/unused"
  fi

  # ── L3 the account ─────────────────────────────────────────────────────────
  [ "$do_plan" -eq 1 ] || continue

  if ! terragrunt plan -lock=false -input=false -out="$tmp/plan.bin" --working-dir "$unit" >"$tmp/plan.out" 2>&1; then
    err "$cfg" "plan could not be produced — a unit nothing can plan is a unit nothing gates"
    plain <"$tmp/plan.out" | tail -20 | indent
    continue
  fi

  if ! terragrunt show -json "$tmp/plan.bin" --working-dir "$unit" >"$tmp/plan.json" 2>"$tmp/show.err"; then
    err "$cfg" "plan produced but not readable as JSON"
    plain <"$tmp/show.err" | tail -10 | indent
    continue
  fi

  findings=$(jq -c -f "$sev_jq" "$tmp/plan.json")

  # Suppression matches on the unit AND the resource address, and only while the
  # entry is in date. `$f.address` is the finding under test; comparing an entry's
  # address against anything else matches nothing at all, which is a suppression
  # file that never suppresses — worse than none, because it reads as one.
  blocking=$(printf '%s' "$findings" | jq -c \
    --arg unit "$rel" --arg today "$today" --slurpfile expected "$expect_file" '
    ($expected[0][$unit] // []) as $allowed
    | [ .[]
        | select(.severity == "DESTRUCTIVE" or .severity == "REVERTING")
        | . as $f
        | select( $allowed | any(.address == $f.address and .expires > $today) | not ) ]')

  suppressed=$(printf '%s' "$findings" | jq -r \
    --arg unit "$rel" --arg today "$today" --slurpfile expected "$expect_file" '
    ($expected[0][$unit] // []) as $allowed
    | [ .[]
        | select(.severity == "DESTRUCTIVE" or .severity == "REVERTING")
        | . as $f
        | select( $allowed | any(.address == $f.address and .expires > $today) ) ]
    | .[] | "\(.severity)  \(.address)"')

  advancing=$(printf '%s' "$findings" | jq -r \
    '.[] | select(.severity == "ADVANCING") | "\(.actions | join(","))  \(.address)"')

  if [ "$blocking" != "[]" ]; then
    err "$cfg" "applying this unit as tracked destroys or reverts live state"
    printf '%s' "$blocking" | jq -r '.[] | "\(.severity)  \(.actions | join(","))  \(.address) — \(.why)"' | indent
    # The plan's own resource headers and its count line, with terragrunt's
    # per-line STDOUT prefix stripped. `head` would close the pipe early, and
    # under `pipefail` a SIGPIPE upstream becomes this script's exit code.
    plain <"$tmp/plan.out" \
      | awk '{ sub(/^.*STDOUT +tofu: +/, "") }
             /^[[:space:]]*# .* will be /  { if (n++ < 60) print }
             /^Plan: /                     { print }' | indent
  elif [ -n "$advancing" ]; then
    note "${rel} advances live state"
    printf '%s\n' "$advancing" | indent
  fi
  if [ -n "$suppressed" ]; then
    note "${rel} carries findings suppressed by ${expect}"
    printf '%s\n' "$suppressed" | indent
  fi
done <"$tmp/units"

if [ "$do_plan" -eq 1 ]; then planned=", each planned"; else planned=", not planned (no --plan)"; fi
printf 'pin-drift: %s unit(s) under %s — %s remote-pinned, %s in-repo%s\n' \
  "$total_units" "$live_root" "$remote_units" "$inrepo_units" "$planned"

# An input Terragrunt passes for a variable the module does not declare reaches
# OpenTofu as a TF_VAR_ and is discarded without a word. Reported rather than
# failed: a root injecting a common input into every unit makes this the normal
# state of every component that does not read it. The count is what separates
# that from the case worth acting on — one unit passing a value its module
# dropped, where the tracked file reads as configured and the default applies.
if [ -s "$tmp/unused" ]; then
  note "inputs passed to units whose module does not declare them — OpenTofu discards them silently"
  sort "$tmp/unused" | awk -F'\t' '
    { n[$1]++; if (n[$1] <= 3) where[$1] = (where[$1] == "" ? $2 : where[$1] ", " $2) }
    END { for (i in n) printf "%s\t%s unit(s)%s\n", i, n[i], (n[i] <= 3 ? ": " where[i] : "") }
  ' | sort | awk -F'\t' '{ printf "  %-28s %s\n", $1, $2 }' | indent
fi

# Which layers actually ran is part of the result. A tree with remote pins and no
# lock passes L1's existence check and skips its movement check entirely, and a
# gate that does not say so reads as though it checked both.
if [ "$remote_units" -gt 0 ] && [ ! -f "$lock" ]; then
  printf 'pin-drift: no %s — a tag repointed under a pin would go unnoticed; write one with --write-lock\n' "$lock"
fi
exit "$fail"
