FP_BIN ?= /Users/user/Documents/AI/entrypoint/file-projections/bin/fp
EXPERIMENT_RUN ?= file-projections-$(shell date -u +%Y%m%dT%H%M%SZ)
EXPERIMENT_BASE ?= HEAD

.PHONY: run test experiments experiment experiment-file-projections \
	experiment-file-projections-recipe experiment-file-projections-strict \
	experiment-file-projections-reference \
	experiment-file-projections-strict-prepare experiment-file-projections-strict-concepts \
	experiment-file-projections-strict-package experiment-file-projections-strict-implement \
	experiment-file-projections-strict-score experiment-file-projections-strict-report \
	experiment-file-projections-prepare experiment-file-projections-discoverability \
	experiment-file-projections-automation experiment-file-projections-score \
	experiment-file-projections-report \
	release-patch release-minor release-major

run:
	npm run dev

test:
	npm run release:check

# Maintained fair front door: cold concepts, concept-scoped edits, literal 99% gate.
experiments: experiment-file-projections-strict

experiment: experiment-file-projections-strict

experiment-file-projections: experiment-file-projections-strict

# Historical recipe-replay benchmark. Useful for compression, not discovery fairness.
experiment-file-projections-recipe:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/suite.mjs "$(EXPERIMENT_RUN)" "$(EXPERIMENT_BASE)"

experiment-file-projections-strict:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/strict-suite.mjs "$(EXPERIMENT_RUN)" "$(EXPERIMENT_BASE)"

experiment-file-projections-reference:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/reference-suite.mjs "$(EXPERIMENT_RUN)" "$(EXPERIMENT_BASE)"

experiment-file-projections-strict-prepare:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/strict-prepare.mjs "$(EXPERIMENT_RUN)" "$(EXPERIMENT_BASE)"

experiment-file-projections-strict-concepts:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/strict-concepts.mjs "$(EXPERIMENT_RUN)"

experiment-file-projections-strict-package:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/strict-package.mjs "$(EXPERIMENT_RUN)"

experiment-file-projections-strict-implement:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/strict-implement.mjs "$(EXPERIMENT_RUN)"

experiment-file-projections-strict-score:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/strict-score.mjs "$(EXPERIMENT_RUN)"

experiment-file-projections-strict-report:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/strict-report.mjs "$(EXPERIMENT_RUN)"

experiment-file-projections-prepare:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/prepare.mjs "$(EXPERIMENT_RUN)" "$(EXPERIMENT_BASE)"

experiment-file-projections-discoverability:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/discoverability.mjs "$(EXPERIMENT_RUN)"

experiment-file-projections-automation:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/automation.mjs "$(EXPERIMENT_RUN)"

experiment-file-projections-score:
	FP_BIN="$(FP_BIN)" node dx/experiments/file-projections/score.mjs "$(EXPERIMENT_RUN)"

experiment-file-projections-report:
	node dx/experiments/file-projections/report.mjs "$(EXPERIMENT_RUN)"

define release
	@set -eu; \
	test "$$(git branch --show-current)" = "main" || { echo "release requires main" >&2; exit 1; }; \
	test -z "$$(git status --porcelain)" || { echo "release requires a clean working tree" >&2; exit 1; }; \
	git fetch --quiet origin main; \
	git merge-base --is-ancestor origin/main HEAD || { echo "local main is behind origin/main" >&2; exit 1; }; \
	current="$$(node -p "require('./package.json').version")"; \
	major="$${current%%.*}"; rest="$${current#*.}"; minor="$${rest%%.*}"; patch="$${rest#*.}"; \
	case "$(1)" in \
		patch) next="$$major.$$minor.$$((patch + 1))" ;; \
		minor) next="$$major.$$((minor + 1)).0" ;; \
		major) next="$$((major + 1)).0.0" ;; \
	esac; \
	grep -q "^## \[$$next\] - " CHANGELOG.md || { echo "CHANGELOG.md needs a dated $$next entry" >&2; exit 1; }; \
	tag="$$(npm version "$(1)" -m "chore(release): %s")"; \
	git push --atomic origin main "$$tag"
endef

release-patch: test
	$(call release,patch)

release-minor: test
	$(call release,minor)

release-major: test
	$(call release,major)
