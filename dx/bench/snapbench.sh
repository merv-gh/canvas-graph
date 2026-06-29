#!/usr/bin/env bash
# snapbench <label> — freeze the current working tree as a commit, snapshot it
# into a detached git worktree (with node_modules symlinked), and launch the
# 1k-capped bench there in the background. Returns once the snapshot is taken
# (so the caller can keep editing) — the bench then runs isolated from further
# edits and writes dx/bench/runs/<label>.md back into THIS repo.
set -euo pipefail
LABEL="${1:?usage: snapbench <label>}"
MAIN="/Users/user/Documents/AI/ecs-canvas-graph"
SCRATCH="/private/tmp/claude-501/-Users-user-Documents-AI-ecs-canvas-graph/e1fcc255-22d9-470f-9d93-85ca4e4750c1/scratchpad"
WT="$SCRATCH/wt-$LABEL"
RUNS="$MAIN/dx/bench/runs"
cd "$MAIN"
mkdir -p "$RUNS"

git add -A
git commit -q -m "perf: $LABEL" || echo "(nothing to commit for $LABEL)"
SHA="$(git rev-parse --short HEAD)"

git worktree remove --force "$WT" 2>/dev/null || true
rm -rf "$WT"; git worktree prune
git worktree add -q --detach "$WT" HEAD
ln -s "$MAIN/node_modules" "$WT/node_modules"

nohup bash -c "cd '$WT' && BENCH=1 BENCH_MAX=1000 BENCH_OUT='$RUNS/$LABEL.md' BENCH_LABEL='$LABEL @ $SHA' npx vitest run --config vitest.bench.config.ts > '$RUNS/$LABEL.log' 2>&1; git -C '$MAIN' worktree remove --force '$WT' 2>/dev/null; git -C '$MAIN' worktree prune" >/dev/null 2>&1 &
echo "snapshot '$LABEL' @ $SHA ready; bench running in background (pid $!) → dx/bench/runs/$LABEL.md"
