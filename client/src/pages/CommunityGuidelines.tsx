import { Fragment, type ReactNode } from "react";

import guidelinesMarkdown from "../../../docs/COMMUNITY_GUIDELINES.md?raw";

const INLINE_TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string): ReactNode[] {
  return text
    .split(INLINE_TOKEN)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }

      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={index}
            className="rounded bg-muted px-1.5 py-0.5 text-[0.92em]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }

      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        return (
          <a
            key={index}
            href={link[2]}
            className="font-medium text-primary underline underline-offset-4"
            target={link[2].startsWith("http") ? "_blank" : undefined}
            rel={link[2].startsWith("http") ? "noreferrer" : undefined}
          >
            {link[1]}
          </a>
        );
      }

      return <Fragment key={index}>{part}</Fragment>;
    });
}

function isBlockStart(line: string): boolean {
  const value = line.trim();
  return (
    value === "" ||
    value === "---" ||
    /^#{1,3}\s/.test(value) ||
    /^-\s+/.test(value) ||
    /^\d+\.\s+/.test(value) ||
    value.startsWith("|")
  );
}

function renderMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i += 1;
      continue;
    }

    if (line === "---") {
      nodes.push(<hr key={key++} className="my-8 border-border" />);
      i += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      nodes.push(
        <h3 key={key++} className="mb-3 mt-7 text-lg font-semibold text-foreground">
          {renderInline(line.slice(4))}
        </h3>,
      );
      i += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={key++} className="mb-4 mt-10 text-2xl font-semibold tracking-tight text-foreground">
          {renderInline(line.slice(3))}
        </h2>,
      );
      i += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      nodes.push(
        <h1 key={key++} className="mb-5 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {renderInline(line.slice(2))}
        </h1>,
      );
      i += 1;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^-\s+/, ""));
        i += 1;
      }

      nodes.push(
        <ul key={key++} className="mb-5 list-disc space-y-2 pl-6 text-muted-foreground">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }

      nodes.push(
        <ol key={key++} className="mb-5 list-decimal space-y-2 pl-6 text-muted-foreground">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.startsWith("|")) {
      const rawRows: string[][] = [];

      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i]
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());

        rawRows.push(cells);
        i += 1;
      }

      const rows = rawRows.filter(
        (row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)),
      );

      if (rows.length > 0) {
        const [header, ...body] = rows;

        nodes.push(
          <div key={key++} className="mb-6 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[620px] border-collapse text-left text-sm">
              <thead className="bg-muted/60">
                <tr>
                  {header.map((cell, cellIndex) => (
                    <th key={cellIndex} className="border-b border-border px-4 py-3 font-semibold text-foreground">
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-border last:border-0">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-4 py-3 align-top text-muted-foreground">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }

      continue;
    }

    const paragraph: string[] = [line];
    i += 1;

    while (i < lines.length && !isBlockStart(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }

    nodes.push(
      <p key={key++} className="mb-5 leading-7 text-muted-foreground">
        {renderInline(paragraph.join(" "))}
      </p>,
    );
  }

  return nodes;
}

export default function CommunityGuidelines() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:py-16">
        <div className="mb-8 rounded-2xl border border-border bg-card p-6 sm:p-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-primary">
            Trust &amp; safety
          </p>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            These rules explain the standards for content and conduct on Viewrr,
            how reports are reviewed, and what happens when those standards are breached.
          </p>
        </div>

        <article className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
          {renderMarkdown(guidelinesMarkdown)}
        </article>
      </div>
    </main>
  );
}
