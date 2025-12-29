# Setup Guide

This guide covers the one-time setup required to connect ION CI/CD with your Infor CloudSuite environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Infor Environment Setup](#infor-environment-setup)
  - [Step 1: Create GitHub App](#step-1-create-github-app)
  - [Step 2: Create Service User](#step-2-create-service-user)
  - [Step 3: Create ION API Authorized App](#step-3-create-ion-api-authorized-app)
  - [Step 4: Register GitHub API in ION](#step-4-register-github-api-in-ion)
  - [Step 5: Update GitHub App Callback](#step-5-update-github-app-callback)
  - [Step 6: Authorize the Connection](#step-6-authorize-the-connection)
- [Credentials Setup](#credentials-setup)
  - [Local Development](#local-development)
  - [GitHub Actions](#github-actions)
- [GitHub Environment Protection](#github-environment-protection)

---

## Prerequisites

Before starting, ensure you have:

- **Infor CloudSuite** with ION API access
- **Administrator access** to Infor OS Portal
- **GitHub account** with ability to create GitHub Apps
- **Repository admin access** for setting up secrets and environments

---

## Infor Environment Setup

This setup is required **once per Infor environment** (TST, TRN, PRD, etc.).

### Step 1: Create GitHub App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **GitHub Apps** → **New GitHub App**
3. Fill in the details:

   | Field | Value |
   |-------|-------|
   | GitHub App name | `ION-CICD-YourCompany` (must be unique) |
   | Homepage URL | `https://your-company.com` |
   | Callback URL | Leave empty (will update later) |

4. Configure settings:
   - ✅ Check **Expire user authorization tokens**
   - ❌ Uncheck **Webhook → Active**

5. Set **Repository Permissions**:

   | Permission | Access Level |
   |------------|--------------|
   | Contents | Read and write |
   | Metadata | Read only |
   | Pull requests | Read and write |
   | Commit statuses | Read and write |

6. Set **Where can this GitHub App be installed?** → **Any account**

7. Click **Create GitHub App**

8. After creation:
   - Copy the **Client ID**
   - Click **Generate a new client secret** and copy it
   - **Save both values** - you'll need them later

9. Click **Install App** (left sidebar):
   - Install on your account/organization
   - Select **All repositories** or choose specific repos

### Step 2: Create Service User

Using a service user provides better audit trails in Infor logs.

1. In Infor, go to **Infor OS** → **Security**
2. Open the menu and select **Service user**
3. Click **Add** to create a new service user:

   | Field | Value |
   |-------|-------|
   | Service Username | `svc_ion_cicd` |
   | Ownership Name | `ION CI/CD Service` |

4. Assign appropriate security roles:
   - `IONAPI-Administrator` (or custom role with ION API access)

5. Click **Save**

### Step 3: Create ION API Authorized App

1. In Infor, go to **Infor OS** → **API Gateway**
2. Click **Authorized Apps** → **Add New App**
3. Fill in:

   | Field | Value |
   |-------|-------|
   | Name | `Infor CI/CD` |
   | Type | Backend Service |
   | Description | CI/CD GitHub Integration |
   | Grant Type | Password Credentials |

4. Click **Save**
5. Click **Download Credentials**:
   - ✅ Enable **Create Service Account**
   - Search and select `svc_ion_cicd` (from Step 2)
   - Click **Download**

6. Save the downloaded file as `TST.ionapi` (or `PRD.ionapi` for production)

### Step 4: Register GitHub API in ION

1. In Infor, go to **Menu** → **ION API**
2. Click **Import**
3. Select `setup/GitHubAPI-Suite.xml` from this repository
4. Click **Edit Details** and configure:

   | Field | Value |
   |-------|-------|
   | Target Endpoint URL | `https://api.github.com` |
   | Token Endpoint | `https://github.com/login/oauth/access_token` |
   | Grant Type | Authorization Code |
   | Auth URL | `https://github.com/login/oauth/authorize` |
   | Client ID | (from Step 1) |
   | Client Secret | (from Step 1) |

5. Add Custom Parameter:

   | Setting | Value |
   |---------|-------|
   | Key Mode | Header |
   | Key Name | `accept` |
   | Key Value | `application/json` |

6. **Copy the Redirect URL** shown on this page
7. Click **Save** → **Import**

### Step 5: Update GitHub App Callback

1. Go back to [GitHub Developer Settings](https://github.com/settings/apps)
2. Click on your GitHub App
3. Paste the **Redirect URL** (from Step 4) into **User authorization callback URL**
4. Click **Save changes**

### Step 6: Authorize the Connection

1. In Infor ION API, search for **GitHubAPI**
2. Go to **Authorization** tab
3. Click on **GitHubAPI** - opens GitHub login in a new tab
4. Authorize the app
5. You'll be redirected back to Infor - connection is now active

### Optional: Upload GitHub Swagger

If API endpoints are missing under the **Documentation** tab:

1. Open `setup/github-swagger.json` in a text editor
2. Find `basePath` and update with your tenant name
3. In ION API → GitHubAPI → Documentation, click **+** and import the file
4. Click **Save**

---

## Credentials Setup

The toolkit uses two types of credentials:

| Type | Used By | Purpose |
|------|---------|---------|
| **Personal** | Developers (local CLI) | Individual changes tracked in Infor audit |
| **Service User** | GitHub Actions | Automated operations |

### Local Development

Each developer creates their own personal `.ionapi` file:

#### Step 1: Create ION API Authorized App

1. In Infor, go to **Infor OS** → **API Gateway**
2. Click **Authorized Apps** → **Add New App**
3. Fill in:

   | Field | Value |
   |-------|-------|
   | Name | `[Your Name] CI/CD` |
   | Type | Backend Service |
   | Description | Personal CI/CD Development Access |
   | Grant Type | Password Credentials |

4. Click **Save**
5. Click **Download Credentials**:
   - ✅ Enable **Create Service Account** (if you want a dedicated service user)
   - Or select your **personal account**
   - Click **Download**

   > **Note:** You can create a new service user during credential download by enabling "Create Service Account" and specifying a username.

6. Save the downloaded file as TST.ionapi (or PRD.ionapi for production)

#### Step 2: Verify Configuration File

The `ion-cicd.config.json` file already exists in the repository with the correct configuration:

```json
{
  "version": "1.0",
  "defaultEnvironment": "tst",
  "environments": {
    "tst": {
      "ionapi": "./credentials/TST.ionapi",
      "repository": "PedalGroup/Infor",
      "branch": "Test",
      "displayName": "Test",
      "protected": false
    },
    "trn": {
      "ionapi": "./credentials/TRN.ionapi",
      "repository": "PedalGroup/Infor",
      "branch": "Training",
      "displayName": "Training",
      "protected": false
    },
    "prd": {
      "ionapi": "./credentials/PRD.ionapi",
      "repository": "PedalGroup/Infor",
      "branch": "Production",
      "displayName": "Production",
      "protected": true
    }
  },
  "settings": {
    "retryAttempts": 3,
    "retryDelayMs": 1000,
    "tokenRefreshBufferSeconds": 300,
    "stateDirectory": ".infor-cicd",
    "logLevel": "info",
    "componentsPath": "./ion-components"
  }
}
```

#### Step 3: Authorize Git Connection

Before you can use the CLI, you need to authorize the GitHub API connection:

1. In Infor, go to **Infor OS** → **API Gateway**
2. Click **Authorizations**
3. Find **GitHubAPI** in the list
4. Click on **GitHubAPI** - this will open GitHub login in a new tab
5. Authorize the application when prompted
6. You'll be redirected back to Infor - the connection is now authorized

#### Step 4: Test Authentication

```bash
ion-cicd auth test
```

> **Note:** The `credentials/` folder is git-ignored. Each developer maintains their own local credentials.

### GitHub Actions

GitHub Actions uses service user credentials stored as repository secrets.

#### Encode Credentials

**macOS:**
```bash
base64 -i credentials/PRD.ionapi | pbcopy
```

**Linux:**
```bash
base64 -w 0 credentials/PRD.ionapi | xclip -selection clipboard
```

**Windows (PowerShell):**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("credentials\PRD.ionapi")) | Set-Clipboard
```

#### Add Repository Secrets

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following:

| Secret Name | Value |
|-------------|-------|
| `IONAPI_CONFIG_TST` | Base64-encoded TST.ionapi |
| `IONAPI_CONFIG_TRN` | Base64-encoded TRN.ionapi (if applicable) |
| `IONAPI_CONFIG_PRD` | Base64-encoded PRD.ionapi |

> **Important:** Use **service user** credentials for GitHub secrets, not personal credentials.

---

## GitHub Environment Protection

For production safety, configure GitHub environment protection:

1. Go to your repository → **Settings** → **Environments**
2. Click **New environment** → Name it `production`
3. Configure protection rules:

   | Setting | Recommended Value |
   |---------|-------------------|
   | Required reviewers | Add 1-2 team members |
   | Wait timer | 0-5 minutes (optional) |
   | Deployment branches | `Production` branch only |

4. Click **Save protection rules**

This ensures:
- Production deployments require manual approval
- Only authorized team members can approve
- Deployments are logged with approver information

---

## Verification

After setup, verify everything works:

```bash
# Test authentication
ion-cicd auth test

# List components from ION
ion-cicd list components

# Export components locally
ion-cicd export --all --local --dry-run
```

Expected output:
```
✓ Authentication successful
  Environment: tst
  ION tenant: YOUR_TENANT_TST
  GitHub repos accessible: 5
```

---

## Troubleshooting

### "Authentication failed"

- Verify `.ionapi` file path in config
- Check that service user has required roles
- Ensure credentials haven't expired

### "GitHub API access denied"

- Re-authorize the connection in ION API
- Verify GitHub App is installed on the repository
- Check repository permissions

### "Cannot find ion-cicd.config.json"

- Ensure file exists in project root
- Check file name spelling (case-sensitive)
- Try specifying path: `--config ./ion-cicd.config.json`
