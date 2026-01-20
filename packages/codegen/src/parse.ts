import type { FileChange, ParsedAiResponse } from "./types";

function safeTrim(s: string) {
  return s.replace(/\s+$/g, "").replace(/^\s+/g, "");
}

function parseJsonArrayLoose(text: string): string[] {
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr))
      return arr.filter((x) => typeof x === "string") as string[];
  } catch {}

  const cleaned = text
    .replace(/^Dependencies\s*:\s*/i, "")
    .replace(/^[\[\(]\s*/g, "")
    .replace(/[\]\)]\s*$/g, "")
    .trim();

  const bulletLines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);

  if (bulletLines.length >= 2 && !cleaned.includes(",")) {
    return bulletLines
      .map((s) => s.replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }

  return cleaned
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function extractFileMarkerFromFence(
  contentLines: string[],
): { filePath: string; content: string } | null {
  const patterns: RegExp[] = [
    /^\s*\/\/\s*File\s*:\s*(.+?)\s*$/i,
    /^\s*\/\*\s*File\s*:\s*(.+?)\s*\*\/\s*$/i,
    /^\s*#\s*File\s*:\s*(.+?)\s*$/i,
    /^\s*<!--\s*File\s*:\s*(.+?)\s*-->\s*$/i,
    /^\s*File\s*:\s*(.+?)\s*$/i,
  ];

  const maxScan = Math.min(contentLines.length, 8);
  for (let idx = 0; idx < maxScan; idx++) {
    const line = contentLines[idx];
    for (const pat of patterns) {
      const m = line.match(pat);
      if (!m) continue;
      const filePath = (m[1] ?? "").trim().replace(/^\.\//, "");
      if (!filePath) return null;

      const rest = [...contentLines];
      rest.splice(idx, 1);
      while (rest.length && rest[0].trim() === "") rest.shift();
      return { filePath, content: rest.join("\n") };
    }
  }
  return null;
}

/**
 * Supported AI response formats:
 *  1) "File: path" + fenced code block
 *  2) fenced code block info string like ```file path/to/file.tsx
 *  3) fenced code block whose first lines inside include a file marker comment (e.g. // File: path)
 */
export function parseAiResponse(raw: string): ParsedAiResponse {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  const files: FileChange[] = [];
  const deps: string[] = [];

  let i = 0;
  let firstFileLineIndex: number | null = null;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*(?:[-*•]\s*)?(?:#{1,6}\s*)?Dependencies\s*:/i.test(line)) {
      const rest = line
        .replace(/^\s*(?:[-*•]\s*)?(?:#{1,6}\s*)?Dependencies\s*:\s*/i, "")
        .trim();
      if (rest) {
        deps.push(...parseJsonArrayLoose(rest));
        i++;
        continue;
      }

      let j = i + 1;
      let buf = "";
      while (j < lines.length && buf.length < 20000) {
        const l = lines[j];
        if (l.trim() === "") break;
        buf += l + "\n";
        j++;
      }
      deps.push(...parseJsonArrayLoose(buf.trim()));
      i = j;
      continue;
    }

    const mFile = line.match(/^\s*(?:#{1,6}\s*)?File\s*:\s*(.+)$/i);
    if (mFile) {
      if (firstFileLineIndex === null) firstFileLineIndex = i;
      const filePath = mFile[1].trim();
      i++;

      while (i < lines.length && lines[i].trim() === "") i++;
      if (i >= lines.length || !lines[i].startsWith("```")) continue;

      i++;
      const contentLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        contentLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith("```")) i++;

      files.push({ path: filePath, content: contentLines.join("\n") });
      continue;
    }

    const mHeadingPath = line.match(
      /^\s*(?:#{1,6}\s*)?([^\s]+?\.(?:tsx|ts|jsx|js|json|css|mjs|cjs))\s*$/i,
    );
    if (mHeadingPath) {
      const filePath = (mHeadingPath[1] ?? "").trim().replace(/^\.\//, "");
      if (filePath) {
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        if (j < lines.length && lines[j].startsWith("```")) {
          if (firstFileLineIndex === null) firstFileLineIndex = i;
          i = j + 1;
          const contentLines: string[] = [];
          while (i < lines.length && !lines[i].startsWith("```")) {
            contentLines.push(lines[i]);
            i++;
          }
          if (i < lines.length && lines[i].startsWith("```")) i++;
          files.push({ path: filePath, content: contentLines.join("\n") });
          continue;
        }
      }
    }

    const mFenceFile = line.match(/^```\s*file\s+(.+)$/i);
    if (mFenceFile) {
      if (firstFileLineIndex === null) firstFileLineIndex = i;
      const filePath = mFenceFile[1].trim();
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        contentLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith("```")) i++;
      files.push({ path: filePath, content: contentLines.join("\n") });
      continue;
    }

    const mFenceWithFile = line.match(
      /^```\s*\w+\s+file(?:name)?\s*[:=]\s*(.+)$/i,
    );
    if (mFenceWithFile) {
      if (firstFileLineIndex === null) firstFileLineIndex = i;
      const filePath = (mFenceWithFile[1] ?? "").trim().replace(/^\.\//, "");
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        contentLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith("```")) i++;
      if (filePath)
        files.push({ path: filePath, content: contentLines.join("\n") });
      continue;
    }

    if (line.startsWith("```")) {
      const fenceLineIndex = i;
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        contentLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith("```")) i++;

      const extracted = extractFileMarkerFromFence(contentLines);
      if (extracted) {
        if (firstFileLineIndex === null) firstFileLineIndex = fenceLineIndex;
        files.push({ path: extracted.filePath, content: extracted.content });
      }
      continue;
    }

    i++;
  }

  const summary =
    firstFileLineIndex === null
      ? safeTrim(raw)
      : safeTrim(lines.slice(0, firstFileLineIndex).join("\n"));

  const uniqDeps = Array.from(
    new Set(deps.map((d) => d.trim()).filter(Boolean)),
  );

  return { summary, files, dependencies: uniqDeps, raw };
}
