# Security Policy

## Supported versions

JalopyBot does not currently publish versioned releases. Security fixes are
made on the latest `main` branch.

| Version | Supported |
| --- | --- |
| Latest `main` | Yes |
| Historical commits | No |

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability, exposed
credential, private Discord data, or production database.

Use [GitHub private vulnerability reporting](https://github.com/kckirch/Jalopy-Bot/security/advisories/new)
and include:

- the affected component and revision;
- steps to reproduce or a proof of concept;
- the possible impact;
- any suggested mitigation; and
- whether the issue is already public or actively exploited.

If a credential may be exposed, revoke or rotate it immediately before
investigating repository history. Avoid including working credentials or
unredacted user data in the report.

You should receive an acknowledgment within seven days. Remediation timing
depends on severity and deployment risk. Please allow time for a fix before
public disclosure.
