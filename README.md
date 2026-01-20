studio patch v6

What this patch fixes/improves

1) Stops AI runs from crashing on hallucinated/bad npm deps
   - Filters common invalid deps (including @next/* like @next/navigation)
   - Dependency installs are now best-effort: they won't abort the whole AI run
   - Skipped deps are reported back to the UI/chat so the model can adjust

2) Makes AI output parsing more tolerant
   - Supports headings like "### src/app/page.tsx" followed by a code fence
   - Supports fences like "```tsx file=src/app/page.tsx"
   - Dependencies lines can be prefixed with bullets or headings

3) Makes AI prompting more reliable and v0-like
   - Stronger system prompt to enforce correct Next.js App Router + Tailwind patterns
   - Adds an automatic build-check + fix loop after applying AI changes:
     - Runs `pnpm run build` (or npm/yarn if detected)
     - If build fails, re-prompts the model with the error output and retries (up to 4 passes)

Files included

- apps/studio/src/main/index.ts
- apps/studio/src/shared/types.ts
- packages/codegen/src/apply.ts
- packages/codegen/src/parse.ts
- packages/codegen/src/types.ts

How to apply

1) Unzip this patch at the ROOT of your studio repo (so it merges into apps/ and packages/).
2) Reinstall deps if needed:
   pnpm install
3) Rebuild Studio:
   pnpm -C apps/studio build
   (or your normal dev/build command)

Notes

- If you're using a slower Ollama model, AI calls can still take time. The timeout for local mode was increased.
- The auto-fix loop is designed to keep the chat clean by only storing the final summary message,
  but it still iterates internally until `pnpm run build` succeeds or the max passes are reached.
