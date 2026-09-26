#!/bin/sh
# palimpsest - the verification gate.
#
# WHAT IT IS: the checks that need no .env, no network and no model calls,
# run on the way out of every push (a machine-wide pre-push hook runs this file
# if the repo ships it). This repo has no CI, so without this the unit tests
# run only when somebody remembers to run them.
#
# TIERS (each mirrors a package.json script; keep them in step):
#   1. typecheck   tsc --noEmit
#   2. build       tsc -p tsconfig.build.json   (emitted into a temp dir, so the
#                  gate never touches build/, which holds deploy artifacts)
#   3. test:unit   node --test ... "src/**/*.test.ts"   (skipped by --quick)
#
# NOT RUN, ON PURPOSE - printed on every run so a green is not over-read:
#   pnpm test (src/scripts/doctor.ts) needs .env and makes LIVE model calls.
#   A push gate must not spend money or depend on a key.
#
# USAGE
#   sh claude-setup/scripts/verify.sh            # all tiers, ~8s warm
#   sh claude-setup/scripts/verify.sh --quick    # drops test:unit
#
# EXIT CONTRACT - the caller (a pre-push hook, a session) relies on it:
#   0 = every tier that ran passed.
#   1 = a tier genuinely failed. The ONLY code that blocks a push.
#   2 = the gate COULD NOT RUN: no node, node older than 22 (engines.node),
#       or node_modules missing. The hook warns and lets the push through,
#       because a gate that blocks for a reason that is not the code's own
#       gets deleted rather than obeyed.
#
# NO `set -u`: an unset HOME must not crash the gate; every environment
# expansion is written "${VAR:-}". NO `set -e`: every tier runs, so the report
# is complete. POSIX sh only.

# ---------------------------------------------------------------- where we are
# Resolve the repo root from this script's own location, never from $PWD.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd) || exit 2

QUICK=0
for arg in "$@"; do
	case "$arg" in
		--quick) QUICK=1 ;;
		-h|--help) sed -n '3,34p' "$0"; exit 0 ;;
		*) printf 'verify: ignoring unknown argument %s\n' "$arg" >&2 ;;
	esac
done

FAILED=0
SKIPPED=0
RAN=0
SKIP_NOTES=""
FAIL_NOTES=""

note_skip() {
	SKIPPED=$((SKIPPED + 1))
	SKIP_NOTES="${SKIP_NOTES}
  - $1"
	printf '  SKIP  %s\n' "$1"
}
note_fail() {
	FAILED=$((FAILED + 1))
	FAIL_NOTES="${FAIL_NOTES}
  - $1"
	printf '  FAIL  %s\n' "$1"
}
note_pass() {
	RAN=$((RAN + 1))
	printf '  ok    %s\n' "$1"
}
cannot_run() {
	printf '── palimpsest verify ── %s\n' "$ROOT"
	printf '⚠️  COULD NOT RUN: %s\n' "$1"
	printf '   Nothing was verified. Exit 2 = could-not-run, not RED.\n'
	exit 2
}

# ------------------------------------------------------------- resolving node
# ⛔ Git runs hooks with a minimal environment, and node is often installed by
# a version manager that a bare PATH does not see. Look on PATH first, then in
# the usual version-manager and package-manager locations, and take the first
# node that satisfies engines.node (>= 22). pnpm is deliberately NOT needed:
# every tier calls node on the package's own entry point directly.
node_major() {
	"$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

NODE=""
OLD_NODE=""
try_node() {
	[ -n "$NODE" ] && return 0
	case "$1" in /*) ;; *) return 1 ;; esac   # absolute paths only
	[ -x "$1" ] || return 1
	major=$(node_major "$1")
	case "$major" in ''|*[!0-9]*) return 1 ;; esac
	if [ "$major" -ge 22 ]; then NODE=$1; else OLD_NODE="$1 (v$major)"; fi
}

PATH_NODE=$(command -v node 2>/dev/null) || PATH_NODE=""
try_node "$PATH_NODE"
try_node "${NVM_BIN:-}/node"
NVM_DIR_GUESS=${NVM_DIR:-${HOME:+$HOME/.nvm}}
if [ -n "$NVM_DIR_GUESS" ] && [ -f "$NVM_DIR_GUESS/alias/default" ]; then
	nvm_default=$(cat "$NVM_DIR_GUESS/alias/default" 2>/dev/null)
	for cand in "$NVM_DIR_GUESS"/versions/node/v"${nvm_default#v}"*/bin/node; do
		try_node "$cand"
	done
fi
if [ -n "$NVM_DIR_GUESS" ]; then
	for cand in "$NVM_DIR_GUESS"/versions/node/*/bin/node; do try_node "$cand"; done
fi
try_node "${VOLTA_HOME:-${HOME:-}/.volta}/bin/node"
try_node /opt/homebrew/bin/node
try_node /usr/local/bin/node
try_node /usr/bin/node

if [ -z "$NODE" ]; then
	if [ -n "$OLD_NODE" ]; then cannot_run "only an old node was found: $OLD_NODE; package.json requires >= 22"
	else cannot_run "no node found on PATH or in the usual install locations"; fi
fi
# The tsx loader and anything it spawns look node up on PATH; put ours first.
NODE_DIR=$(dirname -- "$NODE")
PATH="$NODE_DIR${PATH:+:}${PATH:-}"
export PATH

TSC="$ROOT/node_modules/typescript/bin/tsc"
if [ ! -d "$ROOT/node_modules" ]; then
	cannot_run "node_modules is missing - run: pnpm install"
fi
if [ ! -f "$TSC" ] || [ ! -d "$ROOT/node_modules/tsx" ]; then
	cannot_run "node_modules is incomplete (typescript or tsx missing) - run: pnpm install"
fi

printf '── palimpsest verify ── %s  (node %s)\n' "$ROOT" "$("$NODE" -v)"
cd "$ROOT" || cannot_run "cannot cd to $ROOT"

# ============================================================ tier 1: typecheck
if "$NODE" "$TSC" --noEmit >/dev/null 2>&1; then
	note_pass 'typecheck (tsc --noEmit)'
else
	note_fail 'typecheck (tsc --noEmit) - rerun visibly: pnpm typecheck'
fi

# ================================================================ tier 2: build
# Same config as `pnpm build`, but the output goes to a throwaway directory:
# build/ is the deploy staging area and a pre-push gate must not rewrite it.
BUILD_OUT=$(mktemp -d 2>/dev/null) || BUILD_OUT=""
if [ -z "$BUILD_OUT" ]; then
	note_skip 'build - mktemp -d failed, no scratch dir to emit into'
else
	trap 'rm -rf "$BUILD_OUT"' EXIT INT TERM
	if "$NODE" "$TSC" -p tsconfig.build.json --outDir "$BUILD_OUT" >/dev/null 2>&1; then
		note_pass 'build (tsc -p tsconfig.build.json, emitted to a temp dir)'
	else
		note_fail 'build (tsc -p tsconfig.build.json) - rerun visibly: pnpm build'
	fi
fi

# ============================================================ tier 3: test:unit
if [ "$QUICK" -eq 1 ]; then
	note_skip 'test:unit - --quick was passed'
else
	UNIT_LOG=$("$NODE" --test --experimental-test-module-mocks --import tsx \
		"src/**/*.test.ts" 2>&1)
	UNIT_RC=$?
	UNIT_SUM=$(printf '%s\n' "$UNIT_LOG" | grep -E '^# (tests|pass|fail) ' | sed 's/^# //' | tr '\n' ' ')
	if [ "$UNIT_RC" -eq 0 ]; then
		note_pass "test:unit (node --test)  ${UNIT_SUM}"
	else
		printf '%s\n' "$UNIT_LOG" | grep -E '^not ok|^# (tests|pass|fail) ' | sed 's/^/        /'
		note_fail "test:unit (node --test)  ${UNIT_SUM}- rerun visibly: pnpm test:unit"
	fi
fi

# ---------------------------------------------------------------------- verdict
printf '  --    NOT RUN: pnpm test (doctor.ts) - needs .env and makes live model calls\n'
printf '──\n'
if [ "$SKIPPED" -gt 0 ]; then
	printf '⚠️  %s tier(s) DID NOT RUN:%s\n' "$SKIPPED" "$SKIP_NOTES"
	printf '   This pass is NARROWER than it looks.\n'
fi
if [ "$FAILED" -gt 0 ]; then
	printf '⛔ RED - %s of %s tier(s) that ran FAILED:%s\n' "$FAILED" "$((RAN + FAILED))" "$FAIL_NOTES"
	exit 1
fi
printf '✅ %s tier(s) passed, %s skipped. The live-model doctor was not run.\n' "$RAN" "$SKIPPED"
exit 0
