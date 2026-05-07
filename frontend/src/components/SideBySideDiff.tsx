import { structuredPatch } from "diff";

interface Props {
  oldContent: string;
  newContent: string;
}

type DiffRow =
  | { kind: "hunk"; label: string }
  | { kind: "lines"; oldLn: number | null; oldText: string | null; newLn: number | null; newText: string | null };

function buildRows(oldContent: string, newContent: string): DiffRow[] {
  const patch = structuredPatch("", "", oldContent, newContent, "", "", { context: 3 });
  const rows: DiffRow[] = [];

  for (const hunk of patch.hunks) {
    rows.push({ kind: "hunk", label: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` });

    let oldLn = hunk.oldStart;
    let newLn = hunk.newStart;
    let i = 0;

    while (i < hunk.lines.length) {
      const line = hunk.lines[i];
      if (line[0] === " ") {
        rows.push({ kind: "lines", oldLn, oldText: line.slice(1), newLn, newText: line.slice(1) });
        oldLn++;
        newLn++;
        i++;
      } else {
        // collect a run of - and + lines, then pair them side-by-side
        const removed: string[] = [];
        const added: string[] = [];
        while (i < hunk.lines.length && hunk.lines[i][0] !== " ") {
          if (hunk.lines[i][0] === "-") removed.push(hunk.lines[i].slice(1));
          else added.push(hunk.lines[i].slice(1));
          i++;
        }
        const len = Math.max(removed.length, added.length);
        for (let j = 0; j < len; j++) {
          rows.push({
            kind: "lines",
            oldLn: j < removed.length ? oldLn + j : null,
            oldText: j < removed.length ? removed[j] : null,
            newLn: j < added.length ? newLn + j : null,
            newText: j < added.length ? added[j] : null,
          });
        }
        oldLn += removed.length;
        newLn += added.length;
      }
    }
  }

  return rows;
}

const CELL: React.CSSProperties = { padding: "1px 8px", whiteSpace: "pre-wrap", wordBreak: "break-all", verticalAlign: "top" };
const LN: React.CSSProperties = { padding: "1px 6px", textAlign: "right", userSelect: "none", color: "#636e7b", minWidth: "2.5em", verticalAlign: "top" };

export default function SideBySideDiff({ oldContent, newContent }: Props) {
  const rows = buildRows(oldContent, newContent);

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.8rem", tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "3em" }} />
        <col style={{ width: "calc(50% - 3em)" }} />
        <col style={{ width: "3em" }} />
        <col style={{ width: "calc(50% - 3em)" }} />
      </colgroup>
      <tbody>
        {rows.map((row, i) => {
          if (row.kind === "hunk") {
            return (
              <tr key={i} style={{ background: "#ddf4ff" }}>
                <td colSpan={4} style={{ ...CELL, color: "#0550ae", padding: "1px 8px" }}>{row.label}</td>
              </tr>
            );
          }

          const isRemoved = row.oldText !== null && row.newText === null;
          const isAdded = row.oldText === null && row.newText !== null;
          const isModified = row.oldText !== null && row.newText !== null && row.oldText !== row.newText;

          const oldBg = (isRemoved || isModified) ? "#ffebe9" : "transparent";
          const oldLnBg = (isRemoved || isModified) ? "#ffd7d5" : "#f6f8fa";
          const newBg = (isAdded || isModified) ? "#e6ffec" : "transparent";
          const newLnBg = (isAdded || isModified) ? "#ccffd8" : "#f6f8fa";

          return (
            <tr key={i}>
              <td style={{ ...LN, background: oldLnBg, borderRight: "1px solid #d0d7de" }}>{row.oldLn}</td>
              <td style={{ ...CELL, background: oldBg, borderRight: "1px solid #d0d7de" }}>
                {row.oldText !== null && <><span style={{ color: "#cf222e", userSelect: "none" }}>{isRemoved || isModified ? "-" : " "}</span>{row.oldText}</>}
              </td>
              <td style={{ ...LN, background: newLnBg, borderRight: "1px solid #d0d7de" }}>{row.newLn}</td>
              <td style={{ ...CELL, background: newBg }}>
                {row.newText !== null && <><span style={{ color: "#1a7f37", userSelect: "none" }}>{isAdded || isModified ? "+" : " "}</span>{row.newText}</>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
