# GitHub Pages deployment

This repository publishes the static app from `app/` with GitHub Pages.

## Repository settings

Set `Settings -> Pages -> Build and deployment -> Source` to `GitHub Actions`.

No custom domain is required for this setup.

## Deployment flow

1. Push changes to `main`.
2. GitHub Actions runs `.github/workflows/deploy-pages.yml`.
3. The workflow uploads the contents of `app/` as the Pages artifact.
4. GitHub deploys the site to the repository's standard Pages URL.

## Operational notes

- Relative asset paths in `app/index.html` keep the app compatible with the repository subpath used by standard GitHub Pages hosting.
- The app stays a static frontend; no backend or build step is required for deployment.
- Some third-party radio streams may fail on the deployed site because browsers block insecure media on HTTPS pages. In that case the app should fall back to `Brak dostępnej stacji radiowej`.
