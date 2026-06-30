# Shared Hard Filter Rules Design

## Goal

Replace the confusing flat keyword fields in job configuration with one shared dynamic hard-filter rule list used by both Recommend and Chat flows.

## Problem

The current UI exposes several unrelated controls together:

- `fieldRules.exclude/include`: reject if a broad field keyword hits, unless an exception keyword also hits.
- `expectSkillKeywords`, `expectSchoolKeywords`, `expectMajorKeywords`: require at least one keyword match, otherwise reject.
- `blockCandidateNameRegExpStr`: reject when the name regex matches.

These are all hard-filter rules, but the UI presents them as independent keyword boxes. Users cannot tell which boxes mean blacklist, whitelist, must-match, or exception.

## Design

Keep structured filters for city, education, work experience, and salary. Replace the free-text hard-filter section with `customRules`, an ordered list under `filter.preFilter`.

Each rule has:

- `field`: which candidate text to inspect, such as `name`, `skills`, `school`, `major`, `profile`, or `all`.
- `operator`: `containsAny`, `notContainsAny`, or `regex`.
- `keywords`: comma-style keyword list for contains operators.
- `pattern`: regex source for regex operator.
- `action`: initially only `reject`.
- `except`: optional nested condition. If the exception matches, the rule does not reject.
- `enabled`: disabled rules are ignored.
- `label`: optional UI label.

The rule engine returns the first rejecting rule with a readable reason. If no rule rejects, the candidate continues to the next stage.

## Migration

Existing saved filters are interpreted as rules without data loss:

- `fieldRules.exclude/include` becomes: if `all` contains any exclude keyword, reject, unless `all` contains any include keyword.
- `expectSkillKeywords` becomes: if `skills` does not contain any configured keyword, reject.
- `expectSchoolKeywords` becomes: if `school` does not contain any configured keyword, reject.
- `expectMajorKeywords` becomes: if `major` does not contain any configured keyword, reject.
- `blockCandidateNameRegExpStr` becomes: if `name` matches the regex, reject.

New saves write only `customRules` for these hard filters. Runtime still reads legacy fields for compatibility.

## Runtime Flow

Both Recommend and Chat flows already consume `candidateFilter` through `filterCandidates` or `ruleGate`. The new rule engine should run inside `filterCandidates` after structured filters and before accepting the candidate.

Recommend also keeps its card-level `fieldKnockout` behavior for pre-open triage only if needed during migration, but the persisted user-facing model becomes `customRules`.

## UI

In Job Configuration:

- Rename the section to "自定义硬筛规则".
- Show rows like "如果 [字段] [匹配方式] [关键词/正则] 则 [直接拒绝] 除非 [例外条件]".
- Provide add/remove controls and sensible defaults.
- Hide the old `排除词`, `包含/例外词`, `技能关键词`, `院校关键词`, `专业关键词`, and `屏蔽姓名` boxes.

## Testing

Add pure tests for:

- Legacy fields migrate to equivalent `customRules`.
- `containsAny` rejects and exception overrides rejection.
- `notContainsAny` rejects when no keyword matches.
- `regex` rejects by name and invalid regex is safe.
- Recommend and Chat conversion both preserve `customRules`.

