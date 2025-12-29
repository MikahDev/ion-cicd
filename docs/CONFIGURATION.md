# Configuration Reference

Complete reference for ION CI/CD configuration options.

## Table of Contents

- [Configuration File](#configuration-file)
- [Environment Options](#environment-options)
- [Settings Options](#settings-options)
- [Environment Variables](#environment-variables)
- [.ionapi File Format](#ionapi-file-format)
- [Example Configurations](#example-configurations)

---

## Configuration File

The toolkit uses `ion-cicd.config.json` for configuration. The file is searched in these locations (in order):

1. `./ion-cicd.config.json` (project root)
2. `./.ion-cicd/config.json`
3. `./config/ion-cicd.json`

### Basic Structure

```json
{
  "version": "1.0",
  "defaultEnvironment": "tst",
  "environments": {
    "tst": { ... },
    "trn": { ... },
    "prd": { ... }
  },
  "settings": { ... }
}
```

### Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | Yes | Config version (currently "1.0") |
| `defaultEnvironment` | string | Yes | Default environment when not specified |
| `environments` | object | Yes | Environment configurations |
| `settings` | object | No | Global settings |

---

## Environment Options

Each environment is configured under the `environments` key:

```json
{
  "environments": {
    "tst": {
      "ionapi": "./credentials/TST.ionapi",
      "repository": "MyOrg/MyRepo",
      "branch": "Test",
      "displayName": "Test",
      "protected": false
    }
  }
}
```

### Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `ionapi` | string | Yes | - | Path to .ionapi credentials file |
| `repository` | string | Yes | - | GitHub repository (owner/repo format) |
| `branch` | string | Yes | - | Default Git branch for this environment |
| `displayName` | string | No | env key | Human-readable environment name |
| `protected` | boolean | No | `false` | Require confirmation for deployments |

### Protected Environments

When `protected: true`:

- CLI shows warning before deployment
- Requires user confirmation (unless `--force`, `--dry-run`, or `--ci`)
- Environment picker shows ⚠️ indicator

```
⚠️  WARNING: Production is a PROTECTED environment ⚠️

  Environment: PRD
  Tenant: YOUR_TENANT_PRD

? Are you sure you want to deploy to Production? (Y/n)
```

---

## Settings Options

Global settings under the `settings` key:

```json
{
  "settings": {
    "componentsPath": "./ion-components",
    "retryAttempts": 3,
    "retryDelayMs": 1000,
    "tokenRefreshBufferSeconds": 300,
    "logLevel": "info"
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `componentsPath` | string | `./ion-components` | Local component storage path |
| `retryAttempts` | number | `3` | API retry attempts on failure |
| `retryDelayMs` | number | `1000` | Delay between retries (ms) |
| `tokenRefreshBufferSeconds` | number | `300` | Refresh token before expiry (seconds) |
| `logLevel` | string | `info` | Log level (debug, info, warn, error) |

---

## Environment Variables

Environment variables can override configuration:

| Variable | Description | Example |
|----------|-------------|---------|
| `IONAPI_CONFIG` | Base64-encoded .ionapi content | Used in CI/CD |
| `ION_CICD_ENV` | Override default environment | `prd` |
| `ION_CICD_LOG_LEVEL` | Override log level | `debug` |

### Priority Order

1. CLI options (highest)
2. Environment variables
3. Config file
4. Default values (lowest)

### CI/CD Usage

In GitHub Actions, credentials are passed via environment variable:

```yaml
env:
  IONAPI_CONFIG: ${{ secrets.IONAPI_CONFIG_PRD }}
```

The toolkit automatically detects and decodes base64-encoded credentials.

---

## .ionapi File Format

The `.ionapi` file is a JSON file downloaded from Infor containing OAuth credentials:

```json
{
  "ti": "TENANT_ID",
  "cn": "Company Name",
  "dt": "Backend Service",
  "ci": "CLIENT_ID",
  "cs": "CLIENT_SECRET",
  "iu": "https://mingle-ionapi.inforcloudsuite.com",
  "pu": "https://mingle-sso.inforcloudsuite.com/TENANT_ID/as/",
  "oa": "authorization.oauth2",
  "ot": "token.oauth2",
  "or": "revoke_token.oauth2",
  "saak": "SERVICE_ACCOUNT_ACCESS_KEY",
  "sask": "SERVICE_ACCOUNT_SECRET_KEY",
  "ev": "2.0"
}
```

### Fields

| Field | Description |
|-------|-------------|
| `ti` | Tenant ID |
| `cn` | Company/connection name |
| `dt` | Description/type |
| `ci` | OAuth Client ID |
| `cs` | OAuth Client Secret |
| `iu` | ION API base URL |
| `pu` | OAuth provider URL |
| `oa` | OAuth authorization endpoint |
| `ot` | OAuth token endpoint |
| `or` | OAuth revoke endpoint |
| `saak` | Service account access key |
| `sask` | Service account secret key |
| `ev` | API version |

> **Security:** Never commit `.ionapi` files to version control.

---

## Example Configurations

### Minimal Configuration

```json
{
  "version": "1.0",
  "defaultEnvironment": "tst",
  "environments": {
    "tst": {
      "ionapi": "./credentials/TST.ionapi",
      "repository": "MyOrg/MyRepo",
      "branch": "main"
    }
  }
}
```

### Multi-Environment Configuration

```json
{
  "version": "1.0",
  "defaultEnvironment": "tst",
  "environments": {
    "tst": {
      "ionapi": "./credentials/TST.ionapi",
      "repository": "MyOrg/MyRepo",
      "branch": "Test",
      "displayName": "Test",
      "protected": false
    },
    "trn": {
      "ionapi": "./credentials/TRN.ionapi",
      "repository": "MyOrg/MyRepo",
      "branch": "Training",
      "displayName": "Training",
      "protected": false
    },
    "prd": {
      "ionapi": "./credentials/PRD.ionapi",
      "repository": "MyOrg/MyRepo",
      "branch": "Production",
      "displayName": "Production",
      "protected": true
    }
  },
  "settings": {
    "componentsPath": "./ion-components",
    "retryAttempts": 3,
    "retryDelayMs": 1000,
    "logLevel": "info"
  }
}
```

### Development Configuration

For local development with verbose logging:

```json
{
  "version": "1.0",
  "defaultEnvironment": "tst",
  "environments": {
    "tst": {
      "ionapi": "./credentials/dev.ionapi",
      "repository": "MyOrg/MyRepo",
      "branch": "develop",
      "displayName": "Development"
    }
  },
  "settings": {
    "logLevel": "debug",
    "retryAttempts": 1
  }
}
```

### CI/CD Configuration

For GitHub Actions (credentials via environment variable):

```json
{
  "version": "1.0",
  "defaultEnvironment": "tst",
  "environments": {
    "tst": {
      "repository": "MyOrg/MyRepo",
      "branch": "Test",
      "displayName": "Test"
    },
    "prd": {
      "repository": "MyOrg/MyRepo",
      "branch": "Production",
      "displayName": "Production",
      "protected": true
    }
  }
}
```

Note: `ionapi` path is omitted because credentials are provided via `IONAPI_CONFIG` environment variable.

---

## Validation

The toolkit validates configuration on startup:

### Required Fields

- `version` must be "1.0"
- `defaultEnvironment` must match an environment key
- Each environment must have `repository` and `branch`

### Common Errors

**"Missing required field"**
```
Error: Environment 'tst' missing required field: repository
```
→ Add the missing field to the environment configuration

**"Environment not found"**
```
Error: Environment 'prod' not found in configuration
```
→ Check environment name matches config (use `prd` not `prod`)

**"Cannot load ionapi file"**
```
Error: Cannot read ionapi file: ./credentials/TST.ionapi
```
→ Verify file path is correct and file exists

---

## Component Storage

Components are stored in the path specified by `componentsPath`:

```
ion-components/
├── Script/
│   ├── MyScript.py
│   └── MyScript.meta.json
├── Library/
│   └── MyLibrary.py
├── Document flow/
│   └── MyDataflow.json
├── Connection point/
│   └── MyConnection.json
├── Mapping/
│   └── MyMapping.json
├── Workflow/
│   └── MyWorkflow.json
├── File template/
│   └── MyTemplate.json
├── Enterprise Connector/
│   └── MyConnector.json
└── Activation policy/
    └── MyPolicy.json
```

### Script Format

Scripts are split into two files:

**MyScript.py** - Python code only:
```python
def process(input_data):
    return input_data.upper()
```

**MyScript.meta.json** - Metadata:
```json
{
  "name": "MyScript",
  "description": "Processes input data",
  "inputVariables": [
    { "name": "input_data", "type": "STRING" }
  ],
  "outputVariables": [
    { "name": "result", "type": "STRING" }
  ],
  "usedLibraries": ["mylib"]
}
```

### Other Components

All other components are stored as single JSON files containing the full component definition as exported from ION.
