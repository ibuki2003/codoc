import { useState } from "react";
import { Box, Button } from "@mui/material";

export type Edit = { diff: string; failed: boolean };

function parseDiffStats(diff: string) {
  const lines = diff.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  return { added, removed };
}

export default function DiffWidget({ diff, failed }: { diff: string; failed: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { added, removed } = parseDiffStats(diff);
  return (
    <Box sx={{ mt: 0.5 }}>
      <Button
        size="small"
        variant="outlined"
        color={failed ? "error" : "inherit"}
        onClick={() => setExpanded((v) => !v)}
        sx={{ fontFamily: "monospace", fontSize: "0.7rem", py: 0, px: 0.75, minWidth: 0 }}
      >
        {failed ? `edit failed (-${removed} +${added})` : `edit -${removed} +${added}`}
      </Button>
      {expanded && (
        <Box
          component="pre"
          sx={{
            mt: 0.5, p: 1, fontSize: "0.7rem", fontFamily: "monospace",
            overflowX: "auto", bgcolor: "grey.900", color: "grey.300", borderRadius: 1,
            "& .add": { color: "#4caf50" },
            "& .del": { color: "#f44336" },
          }}
        >
          {diff.split("\n").map((line, i) => (
            <span
              key={i}
              className={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : ""}
            >
              {line}{"\n"}
            </span>
          ))}
        </Box>
      )}
    </Box>
  );
}
