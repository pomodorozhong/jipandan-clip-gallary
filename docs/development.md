# Development

The viewer is a plain static site with no build step: [src/index.html](../src/index.html), [src/assets/app.js](../src/assets/app.js), and [src/assets/style.css](../src/assets/style.css).

## Running it locally

Browsers will not load the data file from a page opened straight from disk, so serve the `src` folder over HTTP. With Node.js installed, install the tools once, then start the server:

```bash
npm install
```

```bash
npm run serve
```

Then open http://localhost:8765. `npm run check` catches syntax errors in the script and in the data file.

## Hosting on GitHub Pages

The workflow in [.github/workflows/pages.yml](../.github/workflows/pages.yml) publishes the `src` folder as it is, with no build. In the repository's **Settings → Pages**, set **Source** to "GitHub Actions". The viewer is then published at `https://<owner>.github.io/jipandan-clip-gallary/` and updates on every push to `main`. The same workflow runs `npm run check` on every pull request.
