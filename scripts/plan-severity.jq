# How much a plan's proposed change costs if it is applied unread.
#
# Reads `tofu show -json <plan>` and returns one entry per change that a reviewer
# has to act on, each carrying a severity — so a deleted alarm and a rewritten
# description stop arriving as the same annotation.
#
# Three levels, and only the first two block:
#
#   DESTRUCTIVE  the plan removes a resource from the account. Mechanical: the
#                action list contains `delete`, which covers a replacement
#                (`delete,create`) as well as a plain destroy, because a replaced
#                alarm is an alarm that stops reporting for the length of the
#                apply and a replaced role is a new principal id.
#
#   REVERTING    the plan rewrites an IAM document in place and the result
#                constrains LESS than the document it replaces: fewer statements,
#                or a condition key the live document carries and the proposed one
#                does not. No resource is destroyed, nothing fails at apply, and
#                the first symptom is a deploy that stops being trusted.
#
#   ADVANCING    everything else. Reported, never blocking — an add, a retag, a
#                description rewrite, a widened route table.
#
# REVERTING is a heuristic and its shape is deliberately narrow: it is keyed on
# what the confirmed instances share, an assume-role or resource policy that ends
# with fewer condition keys than it started with. Two things it does NOT see, and
# a plan is the only place either shows up: a condition whose KEY survives while
# its VALUE widens (`repo:owner/name:*` where the live document holds
# `repo:owner/name:ref:refs/heads/main`), and a policy whose Action list grows.
# Broaden it against a plan in hand, never speculatively — every widening trades
# a real catch for annotations reviewers learn to scroll past.

# `Revision` is stamped from the applying commit into every resource's tags, so it
# differs on every run and its difference carries no information about the account.
# One key, not the map: a change to any other tag stays material.
def scrub:
  if type == "object" then
    (if has("tags") then .tags |= (if type == "object" then del(.Revision) else . end) else . end)
    | (if has("tags_all") then .tags_all |= (if type == "object" then del(.Revision) else . end) else . end)
  else . end;

# IAM allows `Statement` as a single object as well as a list, and both forms
# reach a plan verbatim from whatever wrote them.
def statements:
  (.Statement // [])
  | if type == "array" then . elif type == "object" then [.] else [] end;

# The condition keys and statement count of whichever field on this resource
# carries an IAM document. Returns null for a resource that carries none, and for
# one whose document is unknown until apply — a comparison against a document
# nobody can read yet says nothing.
def doc_shape:
  (.assume_role_policy // .policy // null)
  | if type == "string" then (try fromjson catch null) else . end
  | if type == "object" then
      { stmts: (statements | length),
        conds: [ statements[]
                 | (.Condition // {})
                 | if type == "object" then to_entries[] else empty end
                 | .value
                 | if type == "object" then keys[] else empty end ]
               | unique }
    else null end;

[ .resource_changes[]?
  | select(.change.actions != ["no-op"] and .change.actions != ["read"])
  | select((.change.before | scrub) != (.change.after | scrub))
  | { address: .address,
      actions: .change.actions,
      before_doc: ((.change.before // {}) | doc_shape),
      after_doc:  ((.change.after  // {}) | doc_shape) }
  | .lost = (if (.before_doc != null and .after_doc != null)
             then (.before_doc.conds - .after_doc.conds) else [] end)
  | .dropped = (if (.before_doc != null and .after_doc != null)
                then (.before_doc.stmts - .after_doc.stmts) else 0 end)
  | { address, actions,
      severity: (
        if (.actions | index("delete")) then "DESTRUCTIVE"
        elif ((.lost | length) > 0 or .dropped > 0) then "REVERTING"
        else "ADVANCING" end),
      why: (
        if (.actions | index("delete")) then "removed from the account"
        elif ((.lost | length) > 0)
          then "the proposed IAM document no longer constrains \(.lost | join(", "))"
        elif .dropped > 0 then "the proposed IAM document drops \(.dropped) statement(s)"
        else "advances live state" end) } ]
