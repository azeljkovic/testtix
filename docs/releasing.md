# Releasing TestTix

Releases are automated with [release-please](https://github.com/googleapis/release-please) from the Conventional Commits on `main`. Nobody edits versions, writes the changelog or pushes tags by hand.

## How a release happens

1. Every push to `main` runs CI. When it passes, the **Release** workflow (`.github/workflows/release.yml`) runs release-please, which opens or updates one pull request, `chore(main): release <version>`. It bumps the version in every `package.json` and in `apps/api/openapi.json` (`info.version`), and adds the new section to `CHANGELOG.md`.
2. Merging that PR is the release. CI runs on the merge commit as usual and pushes its images as `sha-<7>`.
3. When that CI run passes, the Release workflow tags the merge commit `v<version>` and creates the GitHub Release with the changelog section as its notes. Its `publish` job then:
   - gives the commit's images the release's tags in GHCR, without rebuilding: `<version>` always, `<major>.<minor>` and `latest` when it is the highest release so far;
   - attaches `apps/api/openapi.json` to the release (after checking that its version is the release's);
   - sends a `repository_dispatch` to the tests repo ([below](#tests-repo-dispatch)).

So a release is always a commit that passed CI, and its images are the ones CI tested.

**Versions.** Before 1.0, `feat` commits bump the minor version and everything else the patch; breaking changes (`feat!:` or a `BREAKING CHANGE:` footer) also bump only the minor version (`bump-minor-pre-major`). The first release is `0.1.0` (`initial-version`). `0.x` releases are marked **pre-release** on GitHub; from `1.0.0` they aren't. To release 1.0 (C6.5), merge a commit with the footer `Release-As: 1.0.0`; release-please proposes that version next.

**Changelog.** Sections for `feat`, `fix`, `perf`, `revert` and `docs` commits; `chore`, `ci`, `test`, `refactor`, `build` and `style` commits are left out. Merge commits aren't Conventional Commits and are skipped, so the PR's own commits are what counts. `CHANGELOG.md` is written by release-please only (Prettier ignores it). Configuration: `release-please-config.json`; the last released version: `.release-please-manifest.json`.

## Setting up

Once, in the testtix repository's settings:

1. **Actions → General → Workflow permissions:** tick _Allow GitHub Actions to create and approve pull requests_. release-please opens the release PR with the workflow's `GITHUB_TOKEN`.
2. **For the tests repo dispatch** (skipped until set):
   - Variable `TESTS_REPO` (Secrets and variables → Actions → Variables): `owner/name` of the tests repository.
   - Secret `TESTS_REPO_DISPATCH_TOKEN`: a fine-grained personal access token with access to **only the tests repository** and the permission _Contents: Read and write_ (what `POST /repos/{owner}/{repo}/dispatches` needs). Give it an expiry and note it somewhere you'll see.

**CI on the release PR.** GitHub doesn't start workflows for pull requests opened with `GITHUB_TOKEN`, so the release PR has no checks. Its changes are versions and the changelog, and CI on the merge commit gates the release. To run CI on the PR anyway, close and reopen it.

## Cutting a release

Merge the open release PR (review the changelog and version first). Then watch the **CI** run on `main`, then the **Release** run, then the release page: notes, the `openapi.json` asset and, in GHCR, the version tags on `ghcr.io/azeljkovic/testtix/{api,web,fake-payments}`.

To run a release's images locally:

```sh
export TESTTIX_IMAGE_REGISTRY=ghcr.io/azeljkovic/testtix TESTTIX_IMAGE_TAG=0.1.0
docker compose --project-directory . -f docker/compose.yml --profile full pull
pnpm full:up
```

**When something fails.** If CI fails on the release merge commit, no release is created; fix it on `main` and the next passing run creates the release (still tagging the release PR's merge commit, whose images may then be missing: see the next point). If `publish` fails (say, the images of the release commit aren't on GHCR because its CI run was cancelled or failed), re-run CI for that commit, then run **Release** by hand (Actions → Release → Run workflow) with the tag, e.g. `v0.1.0`. That repeats `publish` only: tags, `openapi.json` (replaced) and the dispatch.

**The hosted demo** already runs the release commit: **Demo deploy** follows every passing CI run on `main`. To deploy a release by hand later, run **Demo deploy** with `image-tag` = the version (e.g. `0.1.0`), or pick the tag as the ref; for a tag ref, add `v*` tags to the `demo` environment's deployment branches and tags.

## Tests repo dispatch

The tests repository (UI/API end-to-end and k6 tests) runs against each release. The Release workflow sends it:

```http
POST /repos/{TESTS_REPO}/dispatches
```

```json
{
  "event_type": "testtix-release",
  "client_payload": {
    "version": "0.1.0",
    "tag": "v0.1.0",
    "sha": "<40-character commit SHA>",
    "prerelease": true,
    "image_registry": "ghcr.io/azeljkovic/testtix",
    "image_tag": "0.1.0",
    "release_url": "https://github.com/azeljkovic/testtix/releases/tag/v0.1.0",
    "openapi_url": "https://github.com/azeljkovic/testtix/releases/download/v0.1.0/openapi.json"
  }
}
```

- `image_registry` and `image_tag` are the `TESTTIX_IMAGE_REGISTRY` / `TESTTIX_IMAGE_TAG` of `docker/compose.yml`: check out testtix at `tag`, set both, pull and start the `full` profile (as in the workflow below; without the pull, compose builds the images from source instead). The images are public on GHCR.
- `openapi_url` is the release's spec, for generated clients or contract checks.
- Fields may be added later; none will be removed or renamed without a major version.

A minimal receiving workflow in the tests repository:

```yaml
on:
  repository_dispatch:
    types: [testtix-release]

jobs:
  e2e:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v6
        with:
          repository: azeljkovic/testtix
          ref: ${{ github.event.client_payload.tag }}
          path: testtix
      - name: Start TestTix
        working-directory: testtix
        env:
          TESTTIX_IMAGE_REGISTRY: ${{ github.event.client_payload.image_registry }}
          TESTTIX_IMAGE_TAG: ${{ github.event.client_payload.image_tag }}
        run: |
          docker compose --project-directory . -f docker/compose.yml --profile full pull
          docker compose --project-directory . -f docker/compose.yml --profile full up -d --wait --no-build
      # … run the tests against http://localhost:5173 (web) and http://localhost:3000 (API)
```
