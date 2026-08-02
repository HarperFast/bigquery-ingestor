# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**DO NOT** create a public GitHub issue for security vulnerabilities.

### How to Report

Send security vulnerabilities to: **security@harperdb.io**

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to Expect

1. **Acknowledgment**: Within 48 hours
2. **Assessment**: Within 5 business days
3. **Fix Timeline**: Depends on severity
   - Critical: 7 days
   - High: 14 days
   - Medium: 30 days
   - Low: Next release cycle

4. **Disclosure**: Coordinated with reporter

## Security Best Practices

### Credentials Management

**NEVER commit credentials to the repository:**

```bash
# Bad - DO NOT DO THIS
git add service-account-key.json

# Good - Keep credentials secure
# Add to .gitignore
echo "service-account-key.json" >> .gitignore

# Use environment variables or secure vaults
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
```

### Service Account Keys

1. **Never commit** service account JSON files
2. **Rotate keys** regularly (every 90 days)
3. **Use minimal permissions** (principle of least privilege)
4. **Monitor usage** in GCP Console
5. **Delete unused keys** immediately

### Required Permissions

For the BigQuery plugin/synthesizer, service accounts need:

**Minimum Required**:

- `bigquery.jobs.create`
- `bigquery.tables.getData`
- `bigquery.tables.create`
- `bigquery.tables.updateData`

**Not Required**:

- `bigquery.datasets.delete`
- `bigquery.tables.delete` (unless using clean/reset)
- Admin permissions

### Configuration Security

**config.yaml**:

```yaml
# Safe - relative path to credential file
bigquery:
  credentials: service-account-key.json  # File is .gitignored

# Safer - use environment variable
bigquery:
  credentials: ${GOOGLE_APPLICATION_CREDENTIALS}
```

**.env file**:

```bash
# Always add to .gitignore
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
echo ".env.*.local" >> .gitignore
```

### BigQuery Security

1. **Use service accounts** (not user accounts)
2. **Enable audit logging** in GCP
3. **Use VPC Service Controls** for sensitive data
4. **Implement column-level security** if needed
5. **Monitor query costs** to detect abuse

### Harper Security

1. **Enable authentication** on Harper instances
2. **Use TLS** for clustering communication
3. **Restrict network access** to trusted IPs
4. **Regular security updates**
5. **Monitor access logs**

## Known Security Considerations

### 1. Credentials in Configuration

**Issue**: config.yaml references credential files

**Mitigation**:

- Credential files must be in .gitignore
- Use environment variables where possible
- Rotate keys regularly

### 2. Data Exposure

**Issue**: Synthetic data may resemble production patterns

**Mitigation**:

- Use synthesizer only for testing
- Don't use production data characteristics
- Sanitize any borrowed patterns

### 3. BigQuery Costs

**Issue**: Malicious or buggy code could incur costs

**Mitigation**:

- Set up billing alerts
- Use BigQuery quotas
- Monitor query patterns
- Review costs regularly

### 4. Node Trust

**Issue**: Distributed system requires node trust

**Mitigation**:

- Use Harper authentication
- TLS for inter-node communication
- Network isolation where possible
- Monitor for anomalies

## Security Checklist

Before deploying to production:

- [ ] All credential files in .gitignore
- [ ] Service account has minimal permissions
- [ ] Credentials rotated (if existing)
- [ ] Audit logging enabled
- [ ] Network access restricted
- [ ] TLS enabled for all connections
- [ ] Monitoring and alerting configured
- [ ] Backup and recovery tested
- [ ] Incident response plan documented
- [ ] Dependencies audited: `npm audit`

## Dependency Security

### Regular Audits

```bash
# Check for vulnerabilities
npm audit

# Fix automatically if possible
npm audit fix

# Review manual fixes needed
npm audit fix --force  # Use with caution
```

### Dependency Updates

- Review security advisories weekly
- Update dependencies monthly
- Test thoroughly after updates
- Pin versions in package-lock.json

### Automated Scanning

We use:

- GitHub Dependabot
- npm audit in CI/CD
- Snyk (optional)

## Incident Response

If a security incident occurs:

1. **Contain**: Disable affected systems
2. **Assess**: Determine scope and impact
3. **Notify**: Email security@harperdb.io
4. **Fix**: Apply patches immediately
5. **Verify**: Test the fix thoroughly
6. **Communicate**: Update users if affected
7. **Learn**: Post-mortem and improvements

## Security Updates

Security patches are released as soon as possible:

- **Critical**: Emergency release within 24-48 hours
- **High**: Expedited release within 1 week
- **Medium**: Included in next minor release
- **Low**: Included in next release cycle

Users are notified via:

- GitHub Security Advisories
- Release notes
- Email (for critical issues)

## Compliance

This project aims to follow:

- OWASP Top 10
- CIS Benchmarks
- NIST Cybersecurity Framework (where applicable)

## Security Resources

- [Google Cloud Security Best Practices](https://cloud.google.com/security/best-practices)
- [Harper Security Documentation](https://docs.harperdb.io/docs/security)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

## Contact

For security concerns:

- Email: security@harperdb.io
- Expect response within 48 hours
- PGP key available on request

Thank you for helping keep this project secure! 🔒
