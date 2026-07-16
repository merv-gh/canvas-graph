.PHONY: run test release-patch release-minor release-major

run:
	npm run dev

test:
	npm run release:check

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
