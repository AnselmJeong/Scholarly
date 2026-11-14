# Scholarly

Academic PDF library with paper Q&A and evidence-first Markdown reading notes.

See [PDF deep reading and AI provider setup](docs/deep-reading.md) for the reading
workflow, Claude/Codex subscription connections, Ollama Cloud settings, and tests.

## Native desktop app (0.10.4)

The Rust + GPUI Kit app preserves the three-pane library and adds learning notes,
streaming generation and safe rewriting. Notes render as offline HTML with KaTeX,
selectable comparison tables, and automatically isolated source figures/tables.
Figures sit beside their explanatory paragraphs and flow below them in narrow panes.
See [native build and installation](native/README.md) and the
[HTML rendering evaluation](docs/evaluation/2026-11-14-html-reader.md).

## Frontend tooling

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
}
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list
