import { Box } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import styles from "./MarkdownPreview.module.scss";

export default function MarkdownPreview({ content }: { content: string }) {
  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}
      className={styles.content}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >{content}</ReactMarkdown>
    </Box>
  );
}
