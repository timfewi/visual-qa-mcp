# Project policy

- Keep credentials, personal data and runtime state outside Git.
- Preserve existing user changes. Write documentation and CLI text in English.
- Run `project-check fast` after meaningful changes and `project-check full`
  before handoff. Checks are declared in `.project-checks.json` and never run on
  their own.
- Missing tools or offline dependencies are environment blockers, not failures.
- Do not stage, commit, push, publish or deploy without explicit authorization.
