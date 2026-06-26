// Luma stores event descriptions as a ProseMirror document ("description_mirror").
// Flatten it to readable plain text: text nodes joined, block nodes separated by
// blank lines, list items prefixed with "- ".

const BLOCK_TYPES = new Set(["paragraph", "heading", "blockquote", "code_block", "bullet_list", "ordered_list", "list_item", "horizontal_rule"]);

export function mirrorToText(doc) {
  if (!doc || typeof doc !== "object") return "";
  const out = [];
  walk(doc, out, { listDepth: 0 });
  return out.join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walk(node, out, ctx) {
  if (!node) return;
  if (Array.isArray(node)) { for (const n of node) walk(n, out, ctx); return; }

  const type = node.type;

  if (type === "text") { out.push(node.text || ""); return; }
  if (type === "hard_break") { out.push("\n"); return; }
  if (type === "horizontal_rule") { out.push("\n\n---\n\n"); return; }

  if (type === "list_item") {
    out.push("\n" + "  ".repeat(Math.max(0, ctx.listDepth - 1)) + "- ");
    walk(node.content, out, ctx);
    return;
  }

  if (type === "bullet_list" || type === "ordered_list") {
    walk(node.content, out, { ...ctx, listDepth: ctx.listDepth + 1 });
    out.push("\n");
    return;
  }

  // generic container
  if (node.content) walk(node.content, out, ctx);

  // separate top-level blocks with a blank line
  if (BLOCK_TYPES.has(type)) out.push("\n\n");
}
