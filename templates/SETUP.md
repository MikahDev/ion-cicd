# ION Workspace Setup Guide

This guide walks you through setting up a new ION components workspace using `ion-cicd`.

## Prerequisites

- Node.js 18+ installed
- Git installed
- Infor CloudSuite access with ION API credentials (`.ionapi` files)
- GitHub repository for your project

## Step 1: Create Your Repository

Create a new GitHub repository for your ION components (e.g., `my-company/ion-workspace`).

```bash
# Clone your new repo
git clone git@github.com:your-org/your-repo.git
cd your-repo

# Create Production branch as default
git checkout -b Production
```

## Step 2: Initialize the Project

```bash
# Initialize npm project
npm init -y

# Install ion-cicd
npm install ion-cicd

# Create directory structure
mkdir -p credentials ion-components .github/workflows .vscode
```

## Step 3: Copy Template Files

Copy the following files from `node_modules/ion-cicd/templates/`:

```bash
# Configuration files
cp node_modules/ion-cicd/templates/ion-cicd.config.json .
cp node_modules/ion-cicd/templates/env-mappings.json .
cp node_modules/ion-cicd/templates/.gitignore .

# GitHub workflows
cp node_modules/ion-cicd/templates/workflows/* .github/workflows/

# VS Code tasks (optional but recommended)
cp -r node_modules/ion-cicd/templates/.vscode .
```

## Step 4: Configure Your Environments

Edit `ion-cicd.config.json` with your environment details:

```json
{
  "version": "1.0",
  "defaultEnvironment": "tst",
  "environments": {
    "tst": {
      "ionapi": "./credentials/TST.ionapi",
      "repository": "your-org/your-repo",
      "branch": "Test",
      "displayName": "Test",
      "protected": false
    },
    "trn": {
      "ionapi": "./credentials/TRN.ionapi",
      "repository": "your-org/your-repo",
      "branch": "Training",
      "displayName": "Training",
      "protected": false
    },
    "prd": {
      "ionapi": "./credentials/PRD.ionapi",
      "repository": "your-org/your-repo",
      "branch": "Production",
      "displayName": "Production",
      "protected": true
    }
  },
  "settings": {
    "componentsPath": "./ion-components"
  }
}
```

## Step 5: Add Credentials

1. Download `.ionapi` files from Infor for each environment
2. Place them in the `credentials/` directory:
   - `credentials/TST.ionapi`
   - `credentials/TRN.ionapi`
   - `credentials/PRD.ionapi`

> **Important:** These files are git-ignored and should NEVER be committed.

## Step 6: Update package.json

Replace the contents of `package.json`:

```json
{
  "name": "your-project-name",
  "version": "1.0.0",
  "private": true,
  "description": "ION components workspace",
  "scripts": {
    "export": "ion-cicd export",
    "export:all": "ion-cicd export --all --local",
    "deploy": "ion-cicd deploy",
    "validate": "ion-cicd validate",
    "backup": "ion-cicd --env prd export --all --local --prune",
    "push": "ion-cicd push"
  },
  "dependencies": {
    "ion-cicd": "^1.0.0"
  }
}
```

## Step 7: Initial Export

Export existing components from your ION environment:

```bash
# Export all components from TEST
npx ion-cicd --env tst export --all --local

# Or from PRODUCTION
npx ion-cicd --env prd export --all --local
```

## Step 8: Initial Commit

```bash
git add .
git commit -m "Initial ION workspace setup"
git push -u origin Production
```

## Step 9: Configure GitHub Secrets

For CI/CD workflows, add these secrets to your GitHub repository:

1. Go to **Settings → Secrets and variables → Actions**
2. Add these secrets:

| Secret Name | Value |
|------------|-------|
| `IONAPI_CONFIG_TST` | Base64-encoded TST.ionapi |
| `IONAPI_CONFIG_TRN` | Base64-encoded TRN.ionapi |
| `IONAPI_CONFIG_PRD` | Base64-encoded PRD.ionapi |

To encode a file:
```bash
# macOS
base64 -i credentials/TST.ionapi | pbcopy

# Linux
base64 -w 0 credentials/TST.ionapi
```

## Step 10: Configure Production Environment (Optional)

For production deployment approval gates:

1. Go to **Settings → Environments → New environment**
2. Name it `production`
3. Add required reviewers
4. Enable "Required reviewers" protection rule

## VS Code Tasks

If you copied the `.vscode` folder, you can use these tasks (Cmd/Ctrl+Shift+P → "Tasks: Run Task"):

| Task | Description |
|------|-------------|
| Export All (Local) | Export all components from default environment |
| Export All from Environment | Export with environment picker |
| Deploy to Environment | Deploy components with environment picker |
| Push All to Environment | Bulk push all components |
| Validate Components | Run pre-deployment validation |
| Backup Production | Export from production with pruning |

## Project Structure

After setup, your project should look like:

```
your-repo/
├── .github/
│   └── workflows/
│       ├── backup.yml
│       ├── deploy-test.yml
│       └── deploy-production.yml
├── .vscode/
│   └── tasks.json
├── credentials/           # git-ignored
│   ├── TST.ionapi
│   ├── TRN.ionapi
│   └── PRD.ionapi
├── ion-components/
│   ├── Script/
│   ├── Document flow/
│   ├── Mapping/
│   └── ...
├── .gitignore
├── env-mappings.json
├── ion-cicd.config.json
├── package.json
└── package-lock.json
```

## Next Steps

- Test the backup workflow manually in GitHub Actions
- Create a PR to test the deploy-test workflow
- Review the [Commands Reference](../docs/COMMANDS.md) for all available commands
