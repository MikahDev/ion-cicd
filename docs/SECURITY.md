# Security Guide

Security best practices and considerations for ION CI/CD.

## Table of Contents

- [Credential Management](#credential-management)
- [Access Control](#access-control)
- [Production Safety](#production-safety)
- [Audit Trail](#audit-trail)
- [Security Checklist](#security-checklist)
- [Incident Response](#incident-response)

---

## Credential Management

### Credential Types

| Type | Storage | Purpose |
|------|---------|---------|
| Personal `.ionapi` | Local `credentials/` folder | Developer access |
| Service `.ionapi` | GitHub Secrets (base64) | CI/CD automation |

### Best Practices

#### Never Commit Credentials

The `credentials/` folder is git-ignored by default. Verify this in `.gitignore`:

```gitignore
# Credentials (never commit)
*.ionapi
credentials/
```

#### Check Git History

If credentials were accidentally committed:

```bash
# Check if .ionapi files exist in history
git log --all --full-history -- "*.ionapi"
git log --all --full-history -- "credentials/"
```

If found, **immediately**:
1. Rotate all affected credentials in Infor
2. Remove from git history using BFG Repo-Cleaner
3. Force push cleaned history
4. Notify security team

#### Rotate Credentials Regularly

- Personal credentials: Every 90 days
- Service credentials: Every 180 days or on team changes
- Immediately after any suspected compromise

### GitHub Secrets Security

- Use repository secrets, not organization secrets (limits blast radius)
- Use environment secrets for production (additional protection layer)
- Regularly audit secret access in repository settings

---

## Access Control

### Principle of Least Privilege

#### Service User Roles

Create a custom role with minimum required permissions:

| Permission | Required |
|------------|----------|
| ION API Read | Yes |
| ION API Write | Yes |
| Script Approval | No (manual approval preferred) |
| Admin Access | No |

#### Repository Access

| Role | Permissions |
|------|-------------|
| Developers | Read, Write (branches) |
| Reviewers | Read, Write, Approve PRs |
| Admins | Full access, manage secrets |

### Environment Separation

Use separate service users per environment:

| Environment | Service User |
|-------------|--------------|
| TST | `svc_ion_cicd_tst` |
| TRN | `svc_ion_cicd_trn` |
| PRD | `svc_ion_cicd_prd` |

Benefits:
- Isolated credentials per environment
- If one is compromised, others remain safe
- Clear audit trail per environment

---

## Production Safety

### Built-in Protections

| Protection | Description |
|------------|-------------|
| **Environment Protection** | GitHub approval required for production |
| **Pre-deployment Backup** | Automatic snapshot before changes |
| **Concurrency Lock** | Prevents simultaneous deployments |
| **No `--all` in Manual Deploys** | Must specify component type |
| **Dry Run Default** | Manual triggers preview by default |
| **No Auto-Approve** | Scripts stay in DRAFT for review |
| **CI Detection** | `--ci` flag only works in actual CI |

### Protected Environment Configuration

In `ion-cicd.config.json`:

```json
{
  "environments": {
    "prd": {
      "displayName": "Production",
      "protected": true
    }
  }
}
```

### CI Flag Validation

The `--ci` flag is validated against actual CI environment variables:

```typescript
// Detected CI environments
- GitHub Actions: GITHUB_ACTIONS=true, CI=true
- GitLab CI: GITLAB_CI=true
- Azure DevOps: TF_BUILD=True
- Jenkins: JENKINS_URL set
- CircleCI: CIRCLECI=true
```

Using `--ci` outside these environments generates a warning.

### Script Approval Workflow

Production scripts are deployed in DRAFT status:

1. Deploy creates script in DRAFT state
2. Human reviews script in ION Desk
3. Manual approval activates the script
4. Audit trail records who approved

---

## Audit Trail

### What Gets Logged

#### In Infor

| Action | Logged As |
|--------|-----------|
| Personal deploy | Individual user name |
| CI/CD deploy | Service user name |
| Script approval | Approving user |

#### In GitHub

| Action | Visible In |
|--------|------------|
| PR creation | Pull request history |
| Deployment | Actions workflow runs |
| Approval | Environment deployment history |
| Changes | Git commit history |

### Audit Queries

**Find who deployed a component:**

```bash
# Git history
git log --oneline -- "ion-components/Script/MyScript.py"

# With full details
git log -p -- "ion-components/Script/MyScript.py"
```

**Find all production deployments:**

Check GitHub Actions → Workflows → Deploy to Production

---

## Security Checklist

### Initial Setup

- [ ] Create separate service users per environment
- [ ] Use minimum required permissions for service users
- [ ] Configure GitHub environment protection for production
- [ ] Add required reviewers for production deployments
- [ ] Verify `.gitignore` excludes credentials

### Ongoing

- [ ] Rotate credentials every 90-180 days
- [ ] Review repository access quarterly
- [ ] Audit GitHub Actions workflow runs
- [ ] Monitor failed deployment attempts
- [ ] Keep dependencies updated (`npm audit`)

### Before Production Deploy

- [ ] Review all changed components
- [ ] Validate components pass checks
- [ ] Verify backup was created
- [ ] Confirm approval from designated reviewer
- [ ] Test in lower environment first

### After Security Incident

- [ ] Immediately rotate affected credentials
- [ ] Review git history for exposed secrets
- [ ] Check Infor audit logs for unauthorized access
- [ ] Review GitHub Actions logs
- [ ] Update access controls as needed
- [ ] Document incident and response

---

## Incident Response

### Credential Exposure

**If credentials are exposed (committed to git, logged, etc.):**

1. **Immediate (within 15 minutes):**
   - Revoke the exposed credentials in Infor
   - Create new credentials
   - Update GitHub secrets

2. **Short-term (within 1 hour):**
   - Remove from git history if applicable
   - Force push cleaned history
   - Review recent actions for unauthorized use

3. **Follow-up:**
   - Document the incident
   - Review how exposure occurred
   - Implement preventive measures

### Unauthorized Deployment

**If unauthorized deployment is detected:**

1. **Immediate:**
   - Use rollback to restore from backup
   - Revoke compromised access

2. **Investigation:**
   - Review GitHub Actions logs
   - Check Infor audit logs
   - Identify attack vector

3. **Recovery:**
   - Restore from known-good state
   - Rotate all credentials
   - Review and tighten access controls

### Rollback Procedure

```bash
# Find the pre-deployment backup branch
git branch -r | grep backup/pre-deploy

# Rollback using the CLI
ion-cicd rollback --branch backup/pre-deploy-YYYYMMDD-HHMMSS --env prd

# Or manually restore
git checkout backup/pre-deploy-YYYYMMDD-HHMMSS
ion-cicd deploy --all --env prd --force
```

---

## Dependency Security

### Regular Updates

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Fix vulnerabilities
npm audit fix
```

### Dependabot

Enable Dependabot in repository settings for automatic security updates.

---

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do not** open a public issue
2. Contact the security team directly
3. Provide detailed description and reproduction steps
4. Allow time for fix before public disclosure
