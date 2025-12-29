# Commands Reference

Complete documentation for all ION CI/CD CLI commands.

## Table of Contents

- [Global Options](#global-options)
- [Commands](#commands)
  - [export](#export)
  - [import](#import)
  - [deploy](#deploy)
  - [push](#push)
  - [validate](#validate)
  - [sync](#sync)
  - [rollback](#rollback)
  - [auth test](#auth-test)
  - [list components](#list-components)

---

## Global Options

These options can be used with any command:

| Option | Description | Default |
|--------|-------------|---------|
| `--config <path>` | Path to ionapi or config file | Auto-detected |
| `--env <name>` | Environment name (tst, trn, prd) | From config |
| `--output <format>` | Output format (text, json) | `text` |
| `--verbose` | Enable verbose logging | `false` |
| `-v, --version` | Display version number | - |
| `-h, --help` | Display help | - |

**Examples:**

```bash
# Use specific environment
ion-cicd deploy --all --env prd

# JSON output for scripting
ion-cicd list components --output json

# Verbose logging for debugging
ion-cicd deploy --all --verbose
```

---

## Commands

### export

Export ION components to local files or GitHub.

```bash
ion-cicd export [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --type <type>` | Component type to export | All types |
| `-i, --items <names>` | Comma-separated component names | All items |
| `-a, --all` | Export all components | `false` |
| `--interactive` | Use interactive selection | `false` |
| `--local` | Export to local folder | `false` |
| `--prune` | Remove local files that no longer exist in ION (with `--local`) | `false` |
| `--repo <name>` | Target GitHub repository | From config |
| `--branch <name>` | Target branch | From config |
| `--dry-run` | Preview without changes | `false` |
| `--force` | Skip change detection | `false` |

#### Examples

```bash
# Export all components locally
ion-cicd export --all --local

# Export and prune orphaned files
ion-cicd export --all --local --prune

# Export specific type
ion-cicd export -t scripts --local

# Export specific items
ion-cicd export -t scripts -i MyScript1,MyScript2 --local

# Interactive selection
ion-cicd export --interactive --local

# Dry run (preview only)
ion-cicd export --all --local --dry-run

# Dry run with prune (see what would be deleted)
ion-cicd export --all --local --prune --dry-run

# Export to GitHub
ion-cicd export --all --repo MyOrg/MyRepo --branch main
```

#### Pruning Orphaned Files

The `--prune` flag removes local files that no longer exist in ION. This is useful for keeping your repository in sync when components are deleted from ION.

```bash
# Preview what would be pruned
ion-cicd export --all --local --prune --dry-run

# Output:
# Pruned: 3 orphaned file(s)
#   ✗ Document flow/DeletedFlow.json
#   ✗ Script/OldScript.py
#   ✗ Script/OldScript.meta.json
```

**Notes:**
- Only works with `--local` flag
- Skips `.gitkeep` files
- For scripts, deletes both `.py` and `.meta.json` files together
- Use `--dry-run` first to preview what will be deleted

#### Component Types

Valid values for `-t, --type`:
- `scripts` - Python scripts
- `libraries` - Python libraries
- `dataflows` - Document flows
- `connectionpoints` - Connection points
- `mappings` - Data mappings
- `workflows` - Workflows
- `activationpolicies` - Activation policies
- `fileformattemplates` - File templates
- `enterpriselocations` - Enterprise connectors

---

### import

Import components from GitHub to ION.

```bash
ion-cicd import [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --type <type>` | Component type to import | All types |
| `-i, --items <names>` | Comma-separated component names | All items |
| `-a, --all` | Import all components | `false` |
| `--interactive` | Use interactive selection | `false` |
| `--repo <name>` | Source GitHub repository | From config |
| `--branch <name>` | Source branch | From config |
| `--dry-run` | Preview without changes | `false` |
| `--skip-validation` | Skip pre-import validation | `false` |
| `--on-conflict <mode>` | Conflict handling | `rename` |

#### Conflict Modes

| Mode | Description |
|------|-------------|
| `rename` | Create with unique name (e.g., `MyScript_1`) |
| `skip` | Skip existing components |
| `update` | Overwrite existing components |
| `fail` | Abort on conflict |

#### Examples

```bash
# Import all from GitHub
ion-cicd import --all

# Import with update on conflict
ion-cicd import --all --on-conflict update

# Import specific type
ion-cicd import -t scripts

# Dry run
ion-cicd import --all --dry-run
```

---

### deploy

Deploy local component files to an ION environment.

```bash
ion-cicd deploy [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --type <type>` | Component type to deploy | - |
| `-i, --items <names>` | Comma-separated component names | - |
| `-f, --file <path>` | Deploy single file by path | - |
| `-a, --all` | Deploy all components | `false` |
| `--changed` | Only deploy git-changed files | `false` |
| `--dry-run` | Preview without changes | `false` |
| `--on-conflict <mode>` | Conflict handling | `update` |
| `--force` | Skip production confirmation | `false` |
| `--auto-approve` | Auto-approve scripts | `false` |
| `--ci` | CI mode (for GitHub Actions) | `false` |
| `--with-dependencies` | Deploy dataflow dependencies | `false` |
| `--sync-dependencies` | Sync dependencies from source environment | `false` |

#### Examples

```bash
# Deploy all components
ion-cicd deploy --all

# Deploy to specific environment
ion-cicd deploy --all --env prd

# Deploy only changed files (git diff)
ion-cicd deploy --changed

# Deploy with auto-approval for scripts
ion-cicd deploy --all --auto-approve

# Dry run
ion-cicd deploy --all --dry-run

# Deploy specific components
ion-cicd deploy -t scripts -i MyScript1,MyScript2

# Deploy a single file by path
ion-cicd deploy --file ion-components/Script/MyScript.py

# Deploy a dataflow with all its dependencies
ion-cicd deploy --file ion-components/Document\ flow/MyDataflow.json --with-dependencies

# Deploy dataflow dependencies and sync them from another environment
ion-cicd deploy --file ion-components/Document\ flow/MyDataflow.json --with-dependencies --sync-dependencies
```

#### Deploying with Dependencies

The `--with-dependencies` flag automatically detects and deploys all components referenced by a dataflow:

| Dependency Type | Description |
|-----------------|-------------|
| **Libraries** | Python libraries used by scripts in the dataflow |
| **Scripts** | Script activities and their referenced scripts |
| **Workflows** | Workflow activities referenced in the dataflow |
| **Mappings** | Mapping activities and their referenced mappings |
| **BOD Schemas** | Custom BOD nouns used by scripts and mappings |
| **Connection Points** | ION API connection points used by API activities |

**How it works:**

1. Parses the dataflow JSON to extract all referenced components
2. Reads mapping files to detect second-level dependencies (BOD schemas)
3. Detects input documents from script activities
4. Presents an interactive selection allowing you to choose which types to deploy
5. Deploys selected dependencies in the correct order

**With `--sync-dependencies`:**

When combined with `--sync-dependencies`, the tool:
1. Prompts for a source environment (e.g., production)
2. Downloads dependencies from that environment
3. Imports them to the target environment
4. Useful for syncing dependencies that don't exist locally

#### Protected Environments

When deploying to a protected environment (e.g., production):

```
⚠️  WARNING: Production is a PROTECTED environment ⚠️

  Environment: PRD
  Tenant: YOUR_TENANT_PRD

? Are you sure you want to deploy to Production? (Y/n)
```

Confirmation is skipped with:
- `--force` flag
- `--dry-run` flag
- `--ci` flag (only works in actual CI environments)

---

### push

Bulk push ALL local components to an ION environment. A simpler alternative to `deploy` for full environment refreshes.

```bash
ion-cicd push [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --type <type>` | Filter by component type | All types |
| `--dry-run` | Preview without changes | `false` |
| `--force` | Skip confirmation prompt | `false` |

#### Examples

```bash
# Push all components to test environment
ion-cicd push --env tst

# Preview what would be pushed
ion-cicd push --env tst --dry-run

# Push only scripts
ion-cicd push --env tst --type scripts

# Push without confirmation
ion-cicd push --env tst --force
```

#### Special Handling

| Component Type | Behavior |
|----------------|----------|
| **Enterprise Locations** | Skipped - must be created manually in ION |
| **Libraries** | Skipped if same version already exists (cannot overwrite) |
| **Connection Points** | Credentials preserved (connectionPointProperties stripped) |
| **Dataflows** | Auto-adds `type: DATA_FLOW` if missing |

#### Differences from `deploy`

| Aspect | `deploy` | `push` |
|--------|----------|--------|
| Selection | Filter by type/items/changed | All components by default |
| Validation | Dataflow dependency validation | None |
| Dependencies | Auto-deploy with `--with-dependencies` | N/A - pushes everything |
| Prompts | Interactive selections | Simple confirm only |
| Conflict mode | `--on-conflict` option | Always update |
| Use case | Selective deployment | Full environment refresh |

---

### validate

Validate ION components before deployment.

```bash
ion-cicd validate [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --type <type>` | Component type to validate | - |
| `-i, --items <names>` | Comma-separated component names | - |
| `-a, --all` | Validate all components | `false` |
| `--strict` | Treat warnings as errors | `false` |

#### What It Checks

- Required fields (name, scriptCode, etc.)
- Empty scripts
- Mixed tabs/spaces (Python indentation issues)
- Potential hardcoded credentials
- Missing dependencies (libraries used by scripts)
- Component name mismatches with filenames

#### Examples

```bash
# Validate all components
ion-cicd validate --all

# Validate with strict mode (warnings = errors)
ion-cicd validate --all --strict

# Validate specific type
ion-cicd validate -t scripts

# Validate specific items
ion-cicd validate -t scripts -i MyScript1,MyScript2
```

#### Output

```
=== Component Validation ===

Components: 104
Errors: 0
Warnings: 3

Script:
  ✓ MyScript1
  ✓ MyScript2 (1 warnings)
    ⚠ Mixed tabs and spaces detected

Library:
  ✓ MyLibrary
```

---

### sync

Bidirectional synchronization between ION and GitHub.

```bash
ion-cicd sync [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--direction <dir>` | Sync direction | `both` |
| `--repo <name>` | GitHub repository | From config |
| `--branch <name>` | Branch name | From config |
| `--dry-run` | Preview without changes | `false` |
| `--force` | Skip change detection | `false` |
| `--on-conflict <mode>` | Conflict handling | `rename` |
| `--interactive` | Interactive confirmation | `false` |

#### Direction Values

| Value | Description |
|-------|-------------|
| `export` | ION → GitHub only |
| `import` | GitHub → ION only |
| `both` | Bidirectional sync |

#### Examples

```bash
# Full bidirectional sync
ion-cicd sync --direction both

# Export only (ION to GitHub)
ion-cicd sync --direction export

# Import only (GitHub to ION)
ion-cicd sync --direction import

# Dry run
ion-cicd sync --direction both --dry-run
```

---

### rollback

Restore components from a previous Git commit.

```bash
ion-cicd rollback [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--commit <sha>` | Git commit SHA to rollback to | - |
| `--date <date>` | Rollback to date (YYYY-MM-DD) | - |
| `-t, --type <type>` | Component type to rollback | All types |
| `-i, --items <names>` | Comma-separated component names | All items |
| `--repo <name>` | GitHub repository | From config |
| `--branch <name>` | Branch name | From config |
| `--dry-run` | Preview without changes | `false` |
| `--on-conflict <mode>` | Conflict handling | `rename` |
| `--interactive` | Interactive selection | `false` |

#### Examples

```bash
# Rollback to specific commit
ion-cicd rollback --commit abc123

# Rollback to date
ion-cicd rollback --date 2024-01-15

# Rollback specific type
ion-cicd rollback --commit abc123 -t scripts

# Rollback specific items
ion-cicd rollback --commit abc123 -t scripts -i MyScript1

# Dry run
ion-cicd rollback --commit abc123 --dry-run
```

---

### auth test

Test ION API authentication.

```bash
ion-cicd auth test
```

#### Output

```
✓ Authentication successful
  Environment: tst
  ION tenant: YOUR_TENANT_TST
  GitHub repos accessible: 5
```

---

### list components

List all ION components.

```bash
ion-cicd list components [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --type <type>` | Filter by component type | All types |

#### Examples

```bash
# List all components
ion-cicd list components

# List specific type
ion-cicd list components -t scripts

# JSON output
ion-cicd list components --output json
```

---

## VS Code Integration

The toolkit includes VS Code tasks for quick deployments.

### Keyboard Shortcut

| Platform | Shortcut |
|----------|----------|
| macOS | `Cmd+Shift+B` |
| Windows/Linux | `Ctrl+Shift+B` |

### How It Works

1. Open any component file (e.g., `ion-components/Script/MyScript.py`)
2. Press the keyboard shortcut
3. Select target environment from the dropdown
4. Confirm deployment (for protected environments)

### Available Tasks

Access via **Command Palette** → **Tasks: Run Task**:

| Task | Description |
|------|-------------|
| Deploy Current File to ION | Deploy the open file |
| Deploy Current File (Dry Run) | Preview deployment |
| Deploy Dataflow with All Dependencies | Deploy dataflow and all its dependencies |
| Deploy Dataflow with All Dependencies (Dry Run) | Preview dataflow and dependencies deployment |

### Deploying with Dependencies

For dataflow files, use the dependency tasks to automatically deploy all referenced components:

1. Open a dataflow file (e.g., `ion-components/Document flow/MyDataflow.json`)
2. Run **Deploy Dataflow with All Dependencies**
3. Select target environment when prompted
4. Select source environment for syncing dependencies (if using `--sync-dependencies`)
5. Choose which dependency types to include (interactive checkbox)
6. Confirm deployment

---

## Exit Codes

| Code | Description |
|------|-------------|
| `0` | Success |
| `1` | Error (validation failed, deployment failed, etc.) |

Use exit codes for scripting:

```bash
ion-cicd validate --all --strict || echo "Validation failed"
```
