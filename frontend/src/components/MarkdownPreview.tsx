import { Box } from "@mui/material";
import MarkdownContent from "./MarkdownContent";

export default function MarkdownPreview({ content }: { content: string }) {
  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
      <MarkdownContent content={content} />
    </Box>
  );
}
