# Contributing to voice-calendar-integrator

Thank you for your interest in contributing! Please follow these guidelines to keep the codebase healthy and consistent.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)

---

## Getting Started

1. **Fork** the repository and clone your fork.
2. Install dependencies:
   ```bash
   npm ci
   ```
3. Copy the environment template and fill in your values:
   ```bash
   cp .env.example .env
   ```
4. Run the database migration:
   ```bash
   npm run migrate-db
   ```
5. Start the development server (auto-reloads on change):
   ```bash
   npm run dev
   ```

---

## Development Workflow

- Work on a feature branch cut from `main`:
  ```bash
  git checkout -b feat/my-feature
  ```
- Keep commits small and focused. Write clear commit messages in the imperative mood (e.g. `Add /health endpoint`).
- Rebase or merge `main` into your branch before opening a pull request.

---

## Code Standards

- **Language**: Node.js 18+ / CommonJS modules.
- **Style**: The project uses [ESLint](https://eslint.org/) with `eslint:recommended` plus a handful of custom rules. Run the linter before committing:
  ```bash
  npm run lint
  ```
- **No `var`**: Use `const` / `let` only.
- **Error handling**: Always handle promise rejections and pass `err` to `next()` or log it.
- **Secrets**: Never embed credentials, tokens, or PII in code or logs.

---

## Testing

Tests live in `tests/` and are run with [Jest](https://jestjs.io/) + [Supertest](https://github.com/ladjs/supertest).

```bash
npm test          # run all tests
```

- Cover every new endpoint or helper function with at least one happy-path and one error-path test.
- Mock external services (`axios`, `ai_adapter`, `db/tokenStore`) so tests remain fast and hermetic.

---

## Pull Request Process

1. Ensure `npm run lint` and `npm test` both pass locally.
2. Describe **what** changed and **why** in the PR description.
3. Reference any related issue numbers (e.g. `Closes #42`).
4. A maintainer will review and merge once approved.

---

## Reporting Issues

Open a GitHub Issue with:
- A clear title summarising the problem.
- Steps to reproduce.
- Expected vs. actual behaviour.
- Node version, OS, and any relevant logs.
