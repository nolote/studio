# Studio

Studio is an open-source, local-first desktop app for building modern web apps with AI.

It provides a chat-driven workflow (prompt → generate → refine) plus a live preview and a visual editor so you can iterate quickly on a real Next.js codebase that lives on your machine.

- Website: <https://studio.nolote.com>
- Docs: <https://studio.nolote.com/docs>

## Project status

This repository is in active development and currently uses early version numbers (e.g. `0.1.0` at the repo root). Expect some rough edges.

## Key features

- **Local-first workflow**: core project files are generated and edited locally.
- **Next.js + Tailwind output**: generated projects use a modern stack by default.
- **Template library**: start from scratch or from curated templates.
- **Chat-based iteration**: refine and extend projects by describing changes in plain language.
- **Live preview**: run a Next.js dev server for the generated project and preview it inside the app.
- **Design mode**: visually inspect/select elements and apply safe code edits.
- **Model flexibility**: use local models (e.g. via Ollama / LM Studio) or a cloud model (bring your own API key).
- **Project history**: optional Git initialization and change tracking.

## Quickstart

### Prerequisites

- **Node.js**: the template kit expects Node **>= 20.9.0**.
- **pnpm**: this repo is set up for pnpm workspaces.

### Install

```bash
pnpm install
```

### Run Studio (desktop app)

```bash
pnpm dev:studio
```

### Run Template Kit (optional)

The template kit is the Next.js scaffold that Studio copies into new projects.

```bash
pnpm dev:template-kit
```

## Configuration

### Studio environment variables

The desktop app reads environment variables from `apps/studio/.env` in development.

Typical values include:

- `studio_TEMPLATE_KIT_PATH`: path to the template kit package
- `studio_TEMPLATES_PATH`: path to the templates package
- `studio_PROJECTS_ROOT`: default folder where generated projects are created

## Where Studio stores project state

For each generated project, Studio stores metadata in a **`.studio/`** folder inside that project (for example, project metadata and chat history).

## Repository layout

This is a monorepo.

- `apps/studio/` — the Studio desktop app (Electron + React)
- `packages/engine/` — provider-agnostic AI engine (chat + adapters)
- `packages/codegen/` — parses AI output and applies file changes
- `packages/preview/` — starts/stops a Next.js dev server and streams status/logs
- `packages/templates/` — template registry + overlays
- `packages/template-kit/` — base scaffold copied into new projects

## Contributing

Contributions are welcome.

- See [CONTRIBUTING.md](CONTRIBUTING.md)
- Be mindful of the monorepo boundaries (apps vs packages) and keep changes focused.

## License

Studio is free to use and open source.

See [LICENSE.md](LICENSE.md).

## Credits & contact

Developed by **Boris Karaoglanov** at **Nolote**.

- Email: <boris@nolote.com>
- Contact: <contact@nolote.com>
