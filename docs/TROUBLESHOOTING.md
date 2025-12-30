# Troubleshooting Guide

Common issues and solutions for the ion-cicd toolkit.

---

## Authentication Issues

### "Authentication failed" (Error 100)

**Symptoms:**
- `[100] Authentication failed`
- `Invalid credentials`

**Causes:**
1. `.ionapi` file not found
2. Credentials expired in Infor
3. Wrong environment specified

**Solutions:**

1. **Verify `.ionapi` file exists:**
   ```bash
   ls -la credentials/*.ionapi
   ```

2. **Test authentication:**
   ```bash
   npx ion-cicd auth test
   ```

3. **Check environment configuration:**
   ```bash
   cat ion-cicd.config.json
   # Verify the ionapi path for your environment
   ```

4. **Download fresh credentials from Infor:**
   - Navigate to ION API → Authorized Apps
   - Download new `.ionapi` file
   - Replace old file in `credentials/` folder

---

### "Token refresh failed" (Error 102)

**Symptoms:**
- `[102] Failed to refresh authentication token`
- Works initially, then fails after ~2 hours

**Solutions:**

1. Download fresh `.ionapi` file from Infor
2. If using CI/CD, update GitHub secret:
   ```bash
   base64 -i credentials/PRD.ionapi | pbcopy
   # Paste into GitHub Settings → Secrets
   ```

---

## Deployment Issues

### "Component not found" (Error 200)

**Symptoms:**
- `[200] Component "X" not found`
- Export or compare fails

**Solutions:**

1. **Verify component name:**
   ```bash
   npx ion-cicd list components -t dataflows
   ```

2. **Check correct environment:**
   ```bash
   npx ion-cicd --env tst list components
   npx ion-cicd --env prd list components
   ```

---

### "Missing dependency" (Error 302)

**Symptoms:**
- `[302] Component "MyFlow" requires "MyMapping" which was not found`
- Deployment validation fails

**Solutions:**

1. **Deploy with dependencies:**
   ```bash
   npx ion-cicd deploy --file "Document flow/MyFlow.json" --with-dependencies
   ```

2. **Deploy dependencies first:**
   ```bash
   # Deploy in dependency order
   npx ion-cicd deploy -t libraries
   npx ion-cicd deploy -t scripts
   npx ion-cicd deploy -t mappings
   npx ion-cicd deploy -t dataflows
   ```

3. **Sync missing connection points:**
   ```bash
   npx ion-cicd deploy --file "Document flow/MyFlow.json" --sync-dependencies --source-env prd
   ```

---

### "Duplicate name" (Error 402)

**Symptoms:**
- `[402] Component "X" already exists`
- Import fails

**Solutions:**

Use conflict resolution mode:

```bash
# Skip existing components
npx ion-cicd deploy --all --on-conflict skip

# Update existing components (recommended)
npx ion-cicd deploy --all --on-conflict update

# Rename conflicting components
npx ion-cicd deploy --all --on-conflict rename
```

---

### "Protected environment" Error

**Symptoms:**
- `Cannot deploy to protected environment 'prd' in interactive mode`

**Solutions:**

For production environments:

1. **Use CI mode in GitHub Actions:**
   ```bash
   npx ion-cicd --env prd deploy --ci --auto-approve
   ```

2. **Or confirm deployment explicitly:**
   ```bash
   npx ion-cicd --env prd deploy --force
   ```

---

## CI/CD Issues

### GitHub Actions failing with "Authentication failed"

**Symptoms:**
- Workflow fails at authentication step
- Works locally but not in CI

**Solutions:**

1. **Verify secret is set:**
   - Go to GitHub → Settings → Secrets → Actions
   - Check `IONAPI_CONFIG_PRD` exists

2. **Verify base64 encoding:**
   ```bash
   # macOS
   base64 -i credentials/PRD.ionapi | pbcopy

   # Linux
   base64 -w 0 credentials/PRD.ionapi | xclip -selection clipboard

   # Windows PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("credentials\PRD.ionapi")) | Set-Clipboard
   ```

3. **Test locally with env var:**
   ```bash
   export IONAPI_CONFIG=$(base64 -i credentials/PRD.ionapi)
   npx ion-cicd auth test
   ```

---

### "Rate limited" (Error 202)

**Symptoms:**
- `[202] Rate limited. Retry after X seconds`
- Many concurrent requests

**Solutions:**

1. **Wait and retry:** Toolkit auto-retries with backoff

2. **Reduce concurrency:** Deploy in smaller batches
   ```bash
   npx ion-cicd deploy -t scripts
   sleep 30
   npx ion-cicd deploy -t dataflows
   ```

3. **Increase retry settings:**
   ```json
   {
     "settings": {
       "retryAttempts": 5,
       "retryDelayMs": 2000
     }
   }
   ```

---

## File & Configuration Issues

### "File not found" (Error 500)

**Symptoms:**
- `[500] File not found: ./credentials/TST.ionapi`
- `Cannot read ionapi file`

**Solutions:**

1. **Verify file path:**
   ```bash
   ls -la credentials/
   ```

2. **Check config paths are relative to config file:**
   ```json
   {
     "environments": {
       "tst": {
         "ionapi": "./credentials/TST.ionapi"
       }
     }
   }
   ```

---

### "Invalid configuration" (Error 300)

**Symptoms:**
- `[300] Failed to parse config file`
- JSON syntax errors

**Solutions:**

1. **Validate JSON syntax:**
   ```bash
   cat ion-cicd.config.json | python -m json.tool
   ```

2. **Check required fields:**
   ```json
   {
     "version": "1.0",
     "defaultEnvironment": "tst",
     "environments": {
       "tst": {
         "ionapi": "./credentials/TST.ionapi"
       }
     }
   }
   ```

---

## Network Issues

### "Network error" (Error 501)

**Symptoms:**
- `[501] Network error occurred`
- Timeouts, DNS failures

**Solutions:**

1. **Check connectivity:**
   ```bash
   curl -I https://mingle-ionapi.inforcloudsuite.com
   ```

2. **Check proxy/firewall:** Ensure access to Infor cloud endpoints

3. **Increase timeout:** Operations auto-retry on network failures

---

## Debugging

### Enable verbose logging

```bash
npx ion-cicd --verbose deploy --all
```

### Test specific components

```bash
# Test single file
npx ion-cicd deploy --file "Document flow/MyFlow.json" --dry-run

# Validate before deploy
npx ion-cicd validate -t dataflows
```

### Compare environments

```bash
npx ion-cicd compare -t connectionpoints -n MyCP --env1 prd --env2 tst
```

---

## Getting Help

If issues persist:

1. **Check error codes:** See [ERRORS.md](./ERRORS.md)
2. **Review configuration:** See [CONFIGURATION.md](./CONFIGURATION.md)
3. **Report issue:** https://github.com/MikahDev/ion-cicd/issues

Include in bug reports:
- Error code and message
- Command run (with `--verbose`)
- Node.js version (`node --version`)
- Operating system
