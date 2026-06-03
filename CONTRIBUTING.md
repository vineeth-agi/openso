# Contributing to Openso

Thank you for your interest in contributing to Openso! This guide will help you get started.

## 🚀 Quick Start

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/openso.git
   cd openso
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Set up environment:**
   ```bash
   cp .env.example .env.local
   ```
   Fill in the required values (see `.env.example` for documentation).

5. **Start developing:**
   ```bash
   npm run dev
   ```

## 📋 Development Workflow

### Branching

- Create a feature branch from `main`:
  ```bash
  git checkout -b feat/your-feature-name
  ```
- Use prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`

### Making Changes

1. Make your changes in a focused, atomic commit
2. Run linting and tests before pushing:
   ```bash
   npm run lint
   npm test
   ```
3. Write meaningful commit messages:
   ```
   feat: add dark mode toggle to portfolio
   fix: prevent rate limit bypass on telegram webhook
   docs: update environment variable documentation
   ```

### Submitting a Pull Request

1. Push your branch to your fork
2. Open a Pull Request against `main`
3. Fill in the PR template with:
   - What the change does
   - Why it's needed
   - How to test it
4. Wait for review — we aim to review PRs within 48 hours

## 🧪 Testing

We use [Vitest](https://vitest.dev/) for testing:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

When adding new features, please include tests. We use:
- **Unit tests** for utility functions and core logic
- **Property-based tests** with [fast-check](https://fast-check.dev/) for edge cases

## 🎨 Code Style

- **TypeScript** — strict mode is enabled
- **Prettier** — for formatting (run `npm run format`)
- **ESLint** — for linting (run `npm run lint`)
- Follow existing patterns in the codebase
- Use meaningful variable and function names
- Add JSDoc comments for exported functions

## 🐛 Reporting Bugs

1. Check [existing issues](https://github.com/vineeth-agi/openso/issues) first
2. Use the bug report template
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser/OS/Node version
   - Screenshots if applicable

## 💡 Feature Requests

1. Check existing issues and discussions
2. Open a new issue with the `enhancement` label
3. Describe the use case and proposed solution

## 🔒 Security

If you discover a security vulnerability, **do not** open a public issue. Instead, email [security@openso.dev](mailto:security@openso.dev). See our [Security Policy](./docs/SECURITY.md) for details.

## 📜 License

By contributing, you agree that your contributions will be licensed under the same [MIT + Commons Clause License](./LICENSE) that covers the project.

---

Thank you for helping make Openso better! 🎉
