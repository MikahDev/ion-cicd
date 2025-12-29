# Setting Up Your Own ION CI/CD Repository

This guide explains how to create your own private copy of the ION CI/CD toolkit.

## Why Not a Regular Fork?

GitHub doesn't allow forking private repositories to other private repositories. Instead, you'll create a **duplicate** of this repository.

---

## Option 1: Quick Setup (Recommended)

### Step 1: Create New Private Repository

```bash
# Using GitHub CLI
gh repo create YourOrg/ion-cicd --private --description "ION CI/CD for YourCompany"

# Or create via GitHub web UI:
# 1. Go to github.com/new
# 2. Name: ion-cicd
# 3. Visibility: Private
# 4. Don't initialize with README
```

### Step 2: Clone and Push

```bash
# Clone the source repo
git clone --bare https://github.com/PedalGroup/Infor.git ion-cicd-temp

# Push to your new repo
cd ion-cicd-temp
git push --mirror https://github.com/YourOrg/ion-cicd.git

# Clean up
cd ..
rm -rf ion-cicd-temp

# Clone your new repo
git clone https://github.com/YourOrg/ion-cicd.git
cd ion-cicd
```

### Step 3: Configure for Your Environment

1. **Update config file:**
   ```bash
   # Edit ion-cicd.config.json
   # Change repository to your repo
   # Update branch names if different
   ```

2. **Add your credentials:**
   ```bash
   # Download .ionapi files from your Infor environment
   # Save to credentials/ folder
   cp ~/Downloads/TST.ionapi credentials/
   cp ~/Downloads/PRD.ionapi credentials/
   ```

3. **Set up GitHub secrets:**
   ```bash
   # Encode credentials
   base64 -i credentials/PRD.ionapi | pbcopy

   # Add to GitHub: Settings → Secrets → Actions
   # IONAPI_CONFIG_TST, IONAPI_CONFIG_PRD
   ```

4. **Test:**
   ```bash
   npm install
   npm run build
   npm link
   ion-cicd auth test
   ```

---

## Option 2: GitHub Import

1. Go to [github.com/new/import](https://github.com/new/import)
2. Enter source URL: `https://github.com/PedalGroup/Infor.git`
3. Set owner and repository name
4. Select **Private**
5. Click **Begin import**

Then follow Step 3 above to configure.

---

## What to Customize

After creating your copy, update these files:

### ion-cicd.config.json

```json
{
  "version": "1.0",
  "defaultEnvironment": "tst",
  "environments": {
    "tst": {
      "ionapi": "./credentials/TST.ionapi",
      "repository": "YourOrg/YourRepo",  // ← Change this
      "branch": "Test",                   // ← Your branch name
      "displayName": "Test",
      "protected": false
    },
    "prd": {
      "ionapi": "./credentials/PRD.ionapi",
      "repository": "YourOrg/YourRepo",  // ← Change this
      "branch": "Production",             // ← Your branch name
      "displayName": "Production",
      "protected": true
    }
  }
}
```

### .github/workflows/*.yml

Update if your branch names differ from `Production` and `Test`.

### ion-components/

Delete the example components and export your own:

```bash
# Clear example components
rm -rf ion-components/*/
mkdir -p ion-components/{Script,Library,"Document flow","Connection point",Mapping,Workflow,"File template","Enterprise Connector","Activation policy"}

# Export your components
ion-cicd export --all --local
```

---

## Keeping Up to Date

To pull updates from the original repo:

```bash
# Add upstream remote (one time)
git remote add upstream https://github.com/PedalGroup/Infor.git

# Fetch updates
git fetch upstream

# Merge updates (be careful with conflicts)
git merge upstream/Production --no-commit

# Review changes, then commit
git commit -m "Merge upstream updates"
```

### What to Keep vs Override

| Files | Action |
|-------|--------|
| `src/`, `dist/` | Merge from upstream |
| `docs/` | Merge from upstream |
| `.github/workflows/` | Merge carefully, keep customizations |
| `ion-cicd.config.json` | Keep yours |
| `ion-components/` | Keep yours |
| `credentials/` | Keep yours (not in git) |

---

## Checklist

- [ ] Create private repository
- [ ] Clone/duplicate the source
- [ ] Update `ion-cicd.config.json` with your settings
- [ ] Add your `.ionapi` credential files
- [ ] Set up GitHub secrets for CI/CD
- [ ] Configure GitHub environment protection
- [ ] Delete example components
- [ ] Export your ION components
- [ ] Test authentication: `ion-cicd auth test`
- [ ] Test deployment: `ion-cicd deploy --all --dry-run`
