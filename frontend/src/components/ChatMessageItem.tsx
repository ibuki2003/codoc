import { Paper, Typography } from "@mui/material";
import DiffWidget from "./DiffWidget";
import TypingDots from "./TypingDots";
import MarkdownContent from "./MarkdownContent";
import type { Edit } from "./DiffWidget";

export type { Edit };
export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; edits?: Edit[] }
  | { role: "user_edit"; diff: string };

export default function ChatMessageItem({ msg, isStreamingLast }: {
  msg: ChatMessage;
  isStreamingLast: boolean;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1,
        bgcolor:
          msg.role === "user" ? "primary.light" :
          msg.role === "user_edit" ? "action.hover" :
          "background.paper",
        border: 1,
        borderColor: "divider",
        alignSelf: (msg.role === "user" || msg.role === "user_edit") ? "flex-end" : "flex-start",
        maxWidth: "90%",
      }}
    >
      <Typography variant="caption" color="text.secondary" display="block">
        {msg.role === "user" ? "You" : msg.role === "assistant" ? "Assistant" : "Edited"}
      </Typography>
      {msg.role === "user_edit" ? (
        <DiffWidget diff={msg.diff} failed={false} />
      ) : msg.role === "assistant" ? (
        <>
          {msg.content
            ? <MarkdownContent content={msg.content} />
            : isStreamingLast && <TypingDots />
          }
          {isStreamingLast && msg.content && <TypingDots />}
          {msg.edits?.map((edit, j) => (
            <DiffWidget key={j} diff={edit.diff} failed={edit.failed} />
          ))}
        </>
      ) : (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {msg.content}
        </Typography>
      )}
    </Paper>
  );
}
