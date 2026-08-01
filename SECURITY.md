# Security Policy

## Supported Versions

Fixes land on the latest minor release. Older lines do not receive backports.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:

1. Go to the [Security tab](https://github.com/DariushStony/smart-storage/security)
2. Click **Report a vulnerability**
3. Describe the issue and how to reproduce it

This opens a private advisory visible only to you and the maintainers.

> **Maintainer note:** private reporting must be enabled once per repository
> under **Settings → Code security → Private vulnerability reporting**. If the
> button above is missing, that setting is off.

### What to include

- A description of the vulnerability and its impact
- Steps to reproduce, ideally a minimal snippet
- Affected versions
- Any suggested fix

### What to expect

- **Acknowledgement** within 7 days
- **Assessment** with a severity judgement and rough timeline
- **Fix and disclosure** coordinated with you; credit given unless you prefer otherwise

If you get no response within 14 days, please open a public issue saying only
that you are awaiting a security response — with no vulnerability details.

## Scope

This library is a wrapper around the browser's Web Storage APIs. Reports about
the library's own behavior are in scope, for example:

- Bypassing the prototype-pollution guards on stored keys
- Transform chain handling that could execute untrusted input
- Flaws letting one slice read or corrupt another slice's data
- Expiry handling that returns data which should have expired

### Out of scope: Web Storage is not a security boundary

The following are **inherent properties of Web Storage**, not vulnerabilities in
this library, and reports about them will be closed:

- Stored data is readable by any JavaScript on the same origin, including via XSS
- Users can read and edit stored values through devtools
- Data is not encrypted at rest
- A malicious browser extension with host access can read storage

As the README states, **do not store auth tokens, passwords, or sensitive
personal data in Web Storage.** Use `httpOnly` cookies or server-side sessions.
Encrypting via a transform does not fix this — the key must live in client code,
where an attacker can also reach it.

## Dependencies

The published package has **zero runtime dependencies**; `dist/` is all that
ships. Dependency advisories therefore affect only the development and release
toolchain, never consumers of the package.

Transitive advisories are pinned to patched versions via `overrides` in
[`pnpm-workspace.yaml`](./pnpm-workspace.yaml), and Dependabot watches for new
ones weekly. Run `pnpm audit` to check the current state.
