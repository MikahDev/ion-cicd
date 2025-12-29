# ion-cicd

CLI toolkit for managing Infor ION components with Git-based version control and automated CI/CD pipelines.

## Features

- **Export** - Download ION components (scripts, dataflows, mappings, etc.) to local files or GitHub
- **Deploy** - Push local components to ION with validation and dependency resolution
- **Backup** - Automated daily backups with Git history tracking
- **Multi-environment** - Support for TEST, TRAINING, and PRODUCTION environments
- **Reusable Workflows** - GitHub Actions workflows for automated CI/CD
- **Validation** - Pre-deployment checks for dependencies and conflicts

## Supported Component Types

| Type | Description |
|------|-------------|
| Script | Python scripts with metadata |
| Library | Python packages/libraries |
| Mapping | Data transformation mappings |
| Document flow | Dataflow definitions |
| Connection point | API connection configurations |
| Workflow | Business process workflows |
| BOD schema | Custom BOD noun schemas |
| Object schema | Object schema definitions |
| File template | File format templates |
| Enterprise Connector | External system connectors |
| Activation policy | Workflow activation rules |

## Installation

```bash
# Install from npm
npm install ion-cicd

# Or install globally
npm install -g ion-cicd
```

### From Source

```bash
git clone https://github.com/MikahDev/ion-cicd.git
cd ion-cicd
npm install
npm run build
npm link
```

## Quick Start

### 1. Initialize a Project

Create a new directory for your ION components:

```bash
mkdir my-ion-project && cd my-ion-project
npm init -y
npm install ion-cicd
```

### 2. Configure Environments

Create `ion-cicd.config.json`:

```json
{
  "version": "1.0",
  "defaultEnvironment": "tst",
  "environments": {
    "tst": {
      "ionapi": "./credentials/TST.ionapi",
      "protected": false
    },
    "prd": {
      "ionapi": "./credentials/PRD.ionapi",
      "protected": true
    }
  },
  "settings": {
    "componentsPath": "./ion-components"
  }
}
```

### 3. Add Credentials

Place your `.ionapi` files in the `credentials/` directory (git-ignored).

### 4. Export Components

```bash
# Export all components from TEST
npx ion-cicd --env tst export --all --local

# Export specific type
npx ion-cicd --env tst export --type Script --local
```

### 5. Deploy Components

```bash
# Validate before deploying
npx ion-cicd --env tst validate

# Deploy to TEST
npx ion-cicd --env tst deploy

# Deploy specific component type
npx ion-cicd --env tst deploy --type Script
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `export` | Export components from ION to local/GitHub |
| `deploy` | Deploy local components to ION |
| `push` | Bulk deploy all local components |
| `validate` | Validate components before deployment |
| `sync` | Bi-directional sync between ION and Git |
| `refresh` | Copy components between environments |
| `rollback` | Revert to a previous Git commit state |
| `analyze` | Analyze component dependencies |
| `compare` | Compare components across environments |

### Common Options

```bash
--env <environment>    # Target environment (tst, trn, prd)
--type <type>          # Component type filter
--dry-run              # Preview without making changes
--ci                   # CI mode (non-interactive)
--auto-approve         # Auto-approve scripts (TEST only)
```

## GitHub Actions Integration

### Workflow Templates

Copy the workflow templates from `templates/workflows/` to your project's `.github/workflows/` directory:

- `backup.yml` - Daily automated backup from Production
- `deploy-test.yml` - Deploy to TEST on pull request
- `deploy-production.yml` - Deploy to PRODUCTION on release

### Setting Up Secrets

Encode your `.ionapi` files and add as GitHub secrets:

```bash
base64 -i credentials/TST.ionapi | pbcopy  # Copy to clipboard (macOS)
```

Add these secrets to your repository:
- `IONAPI_CONFIG_TST`
- `IONAPI_CONFIG_TRN`
- `IONAPI_CONFIG_PRD`

## Project Templates

Starter templates are included in the `templates/` directory:

```
templates/
├── package.json           # Minimal project dependencies
├── ion-cicd.config.json   # Environment configuration
├── env-mappings.json      # Environment transformation rules
├── .gitignore             # Git ignore patterns
└── workflows/             # GitHub Actions workflow templates
    ├── backup.yml
    ├── deploy-test.yml
    └── deploy-production.yml
```

## Security

- **Protected Environments** - Production deployments require CI/CD pipeline with approval gates
- **Credential Safety** - `.ionapi` files are never committed to Git
- **Pre-deployment Backup** - Automatic snapshots before production changes
- **Script Approval** - Scripts deploy in DRAFT state by default (manual ION approval required)

## Requirements

- Node.js >= 18.0.0
- Infor ION API credentials (`.ionapi` file)
- GitHub account (for CI/CD features)

## Documentation

- [Setup Guide](docs/SETUP.md)
- [Commands Reference](docs/COMMANDS.md)
- [Configuration](docs/CONFIGURATION.md)
- [Workflows](docs/WORKFLOWS.md)
- [Security](docs/SECURITY.md)

## License

MIT
