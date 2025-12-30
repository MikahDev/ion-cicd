# Error Codes Reference

This document describes all error codes that may be returned by the ion-cicd toolkit.

## Error Format

Errors are displayed in the format: `[CODE] Message (retryable)`

- **CODE**: Numeric error code for programmatic handling
- **Message**: Human-readable description
- **retryable**: Indicates if the operation can be retried

---

## Authentication Errors (100-199)

| Code | Error Class | Description | Retryable | Resolution |
|------|-------------|-------------|-----------|------------|
| 100 | `AUTH_FAILED` | Invalid or missing credentials | No | Verify your `.ionapi` file exists and contains valid credentials |
| 101 | `TOKEN_EXPIRED` | OAuth token has expired | Yes | Token will auto-refresh; if persists, re-download `.ionapi` |
| 102 | `TOKEN_REFRESH_FAILED` | Could not refresh OAuth token | No | Download fresh `.ionapi` file from Infor |

### Common Causes
- `.ionapi` file not found at configured path
- Credentials expired in Infor tenant
- Service account disabled or deleted
- Incorrect environment specified with `--env`

---

## API Errors (200-299)

| Code | Error Class | Description | Retryable | Resolution |
|------|-------------|-------------|-----------|------------|
| 200 | `ION_API_ERROR` | ION API request failed | Yes (5xx) | Check component exists; verify API permissions |
| 201 | `GITHUB_API_ERROR` | GitHub API request failed | Yes (5xx, 429) | Check GitHub token permissions; verify repository access |
| 202 | `RATE_LIMITED` | Too many API requests | Yes | Wait and retry; toolkit auto-retries with backoff |

### Common Causes
- Component doesn't exist in target environment
- Insufficient API permissions for service account
- Network connectivity issues
- GitHub repository not accessible via ION API proxy

---

## Validation Errors (300-399)

| Code | Error Class | Description | Retryable | Resolution |
|------|-------------|-------------|-----------|------------|
| 300 | `INVALID_CONFIG` | Configuration file invalid or missing | No | Check `ion-cicd.config.json` syntax and paths |
| 301 | `INVALID_COMPONENT` | Component data is malformed | No | Verify component JSON structure matches ION schema |
| 302 | `MISSING_DEPENDENCY` | Required dependency not found | No | Deploy dependencies first or use `--with-dependencies` |

### Common Causes
- Malformed JSON in configuration files
- Missing required fields in component definitions
- Dataflow references non-existent mapping, script, or connection point

---

## Operation Errors (400-499)

| Code | Error Class | Description | Retryable | Resolution |
|------|-------------|-------------|-----------|------------|
| 400 | `EXPORT_FAILED` | Failed to export component | No | Check component exists and permissions |
| 401 | `IMPORT_FAILED` | Failed to import component | No | Check target environment and conflict mode |
| 402 | `DUPLICATE_NAME` | Component with same name exists | No | Use `--on-conflict rename\|skip\|update` |

### Common Causes
- Component doesn't exist when exporting
- Name conflict when importing without conflict resolution
- Permission denied in target environment

---

## System Errors (500-599)

| Code | Error Class | Description | Retryable | Resolution |
|------|-------------|-------------|-----------|------------|
| 500 | `FILE_NOT_FOUND` | Local file not found | No | Verify file path is correct |
| 501 | `NETWORK_ERROR` | Network connectivity issue | Yes | Check network connection; retry operation |

### Common Causes
- File path typos
- Files moved or deleted
- DNS resolution failures
- Firewall blocking connections

---

## Using Error Codes Programmatically

Error codes can be used in scripts to handle specific failures:

```bash
# Example: Retry on rate limit, fail on auth error
npx ion-cicd deploy --all 2>&1
exit_code=$?

case $exit_code in
  0) echo "Success" ;;
  100) echo "Auth failed - check credentials" ;;
  202) echo "Rate limited - will retry" ;;
  *) echo "Failed with code $exit_code" ;;
esac
```

---

## Retryable Errors

The following errors are automatically retried with exponential backoff:

- `TOKEN_EXPIRED` (101)
- `ION_API_ERROR` (200) - only for 5xx status codes
- `GITHUB_API_ERROR` (201) - for 5xx and 429 status codes
- `RATE_LIMITED` (202)
- `NETWORK_ERROR` (501)

Retry configuration can be adjusted in `ion-cicd.config.json`:

```json
{
  "settings": {
    "retryAttempts": 3,
    "retryDelayMs": 1000
  }
}
```

---

## Getting Help

If you encounter persistent errors:

1. Run with `--verbose` flag for detailed logging
2. Check the [Troubleshooting Guide](./TROUBLESHOOTING.md)
3. Review your configuration with `npx ion-cicd auth test`
4. Report issues at https://github.com/MikahDev/ion-cicd/issues
