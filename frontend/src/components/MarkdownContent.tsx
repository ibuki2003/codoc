import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import styles from "./MarkdownPreview.module.scss";

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className={styles.content}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >{content}</ReactMarkdown>
    </div>
  );
}
