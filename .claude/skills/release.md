---
name: release
description: Publish a new version of hookflare CLI to npm via trusted publisher and update Homebrew formula
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Grep, Glob
---

Release hookflare CLI version $ARGUMENTS.

Follow these steps exactly:

1. **Validate version argument**
   - $ARGUMENTS must be a valid semver (e.g., 0.1.0, 1.0.0)
   - If empty, read current version from packages/cli/package.json and suggest the next patch

2. **Run all checks**
   ```bash
   pnpm --filter @hookflare/shared build
   pnpm --filter @hookflare/worker typecheck
   pnpm --filter hookflare typecheck
   pnpm --filter @hookflare/worker test
   ```
   Stop if any check fails.

3. **Update version in two files**
   - `packages/cli/package.json` → `"version": "$ARGUMENTS"`
   - `packages/cli/src/index.ts` → `.version("$ARGUMENTS")`

4. **Build CLI and verify**
   ```bash
   pnpm --filter hookflare build
   node packages/cli/dist/index.js --version
   ```
   Verify output matches $ARGUMENTS.

5. **Commit and tag**
   ```bash
   git add packages/cli/package.json packages/cli/src/index.ts
   git commit -m "chore: release hookflare CLI v$ARGUMENTS"
   git tag v$ARGUMENTS
   ```

6. **Push to trigger trusted publisher**
   Do NOT proceed without explicit user confirmation.
   ```bash
   git push && git push --tags
   ```

7. **Monitor GitHub Actions**
   ```bash
   sleep 10
   gh run list --repo hookedge/hookflare --limit 1
   ```
   Report the workflow URL so the user can watch it.

8. **Wait for npm publish, then verify**
   ```bash
   sleep 90
   npm view hookflare version
   ```
   Confirm version matches $ARGUMENTS.

9. **Update Homebrew formula**
   Get the new tarball SHA256 and update the formula:
   ```bash
   SHA256=$(curl -sL "https://registry.npmjs.org/hookflare/-/hookflare-$ARGUMENTS.tgz" | shasum -a 256 | cut -d' ' -f1)
   ```
   Edit `~/Projects/hookedge/homebrew-hookflare/Formula/hookflare.rb`:
   - Update `url` to `https://registry.npmjs.org/hookflare/-/hookflare-$ARGUMENTS.tgz`
   - Update `sha256` to the value computed above

10. **Commit and push Homebrew formula**
    ```bash
    cd ~/Projects/hookedge/homebrew-hookflare
    git add Formula/hookflare.rb
    git commit -m "hookflare $ARGUMENTS"
    git push
    ```

11. **Verify Homebrew**
    ```bash
    brew update
    brew info hookedge/hookflare/hookflare
    ```
    Confirm version matches $ARGUMENTS.
