import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box, Button, CircularProgress, Divider, FormControl,
  IconButton, InputLabel, MenuItem, Paper, Select, TextField,
  Toolbar, Tooltip, Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import {
  getProject, updateContent, chatStream, listModels, clearHistory,
  type Project, type ConversationEntry, type StreamChunk, type ModelInfo,
} from "../api";

const AUTOSAVE_DELAY = 1500;

type Edit = { diff: string; failed: boolean };

type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; edits?: Edit[] }
  | { role: "user_edit"; diff: string };

function parseDiffStats(diff: string) {
  const lines = diff.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  return { added, removed };
}

function TypingDots() {
  return (
    <Box component="span" sx={{
      display: "inline-flex", gap: "3px", alignItems: "center", ml: 0.5, verticalAlign: "middle",
      "& span": {
        width: 5, height: 5, borderRadius: "50%", bgcolor: "text.secondary",
        animation: "typing-dot 1.2s ease-in-out infinite",
        "&:nth-of-type(2)": { animationDelay: "0.2s" },
        "&:nth-of-type(3)": { animationDelay: "0.4s" },
      },
      "@keyframes typing-dot": {
        "0%, 80%, 100%": { opacity: 0.2, transform: "scale(0.8)" },
        "40%": { opacity: 1, transform: "scale(1)" },
      },
    }}>
      <span /><span /><span />
    </Box>
  );
}

function DiffWidget({ diff, failed }: { diff: string; failed: boolean }) {
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

function entryToChat(e: ConversationEntry): ChatMessage | null {
  if (e.role === "user") return { role: "user", content: e.content };
  if (e.role === "assistant") {
    const edits: Edit[] = e.tool_calls
      .filter((tc) => tc.tool_name === "edit_document")
      .map((tc) => {
        let diff = "";
        try { diff = (JSON.parse(tc.args) as { diff: string }).diff; } catch { /* empty */ }
        return { diff, failed: tc.result.startsWith("Error") };
      })
      .filter((e) => e.diff);
    return { role: "assistant", content: e.content, edits: edits.length ? edits : undefined };
  }
  if (e.role === "system" && e.subtype === "user_diff") return { role: "user_edit", diff: e.diff };
  return null;
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [streaming, setStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const streamingAssistantRef = useRef("");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listModels().then((ms) => {
      setModels(ms);
      if (ms.length > 0) setModel(ms[0].id);
    });
  }, []);

  const loadProject = useCallback(async () => {
    if (!id) return;
    const p = await getProject(id);
    setProject(p);
    setContent(p.content);
    setChatMessages(
      p.history.map(entryToChat).filter((m): m is ChatMessage => m !== null),
    );
  }, [id]);

  useEffect(() => { loadProject(); }, [loadProject]);

  useEffect(() => {
    const handler = () => { if (document.visibilityState === "visible") loadProject(); };
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("focus", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("focus", handler);
    };
  }, [loadProject]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleContentChange = (value: string) => {
    setContent(value);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      if (!id) return;
      setSaving(true);
      await updateContent(id, value);
      setSaving(false);
    }, AUTOSAVE_DELAY);
  };

  const handleClearHistory = async () => {
    if (!id) return;
    await clearHistory(id);
    setChatMessages([]);
  };

  const handleSend = async () => {
    if (!id || !input.trim() || streaming) return;
    const msg = input.trim();
    setInput("");
    setStreaming(true);
    streamingAssistantRef.current = "";

    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    await chatStream(id, msg, model, (chunk: StreamChunk) => {
      if (chunk.type === "text_delta") {
        streamingAssistantRef.current += chunk.delta;
        setChatMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, role: "assistant", content: streamingAssistantRef.current } as ChatMessage;
          return next;
        });
      } else if (chunk.type === "document_updated") {
        setChatMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              edits: [...(last.edits ?? []), { diff: chunk.diff, failed: false }],
            };
          }
          return next;
        });
        loadProject();
      } else if (chunk.type === "done") {
        loadProject();
      }
    });

    setStreaming(false);
  };

  if (!project) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Toolbar variant="dense" sx={{ borderBottom: 1, borderColor: "divider", gap: 1 }}>
        <IconButton edge="start" onClick={() => navigate("/")}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ flex: 1 }}>{project.title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {saving ? "Saving…" : "Saved"}
        </Typography>
      </Toolbar>

      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Document Editor */}
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", p: 2, overflow: "hidden" }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Document
          </Typography>
          <TextField
            multiline
            fullWidth
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            sx={{
              flex: 1,
              "& .MuiInputBase-root": { height: "100%", alignItems: "flex-start", overflow: "hidden" },
              "& .MuiInputBase-input": { height: "100% !important", overflowY: "auto !important" },
            }}
            inputProps={{ style: { fontFamily: "monospace" } }}
            disabled={streaming}
          />
        </Box>

        <Divider orientation="vertical" flexItem />

        {/* Chat Panel */}
        <Box sx={{ width: 400, display: "flex", flexDirection: "column", p: 2, overflow: "hidden" }}>
          <Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 1 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ flex: 1 }}>
              Chat
            </Typography>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Model</InputLabel>
              <Select value={model} label="Model" onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Clear history">
              <IconButton size="small" onClick={handleClearHistory} disabled={streaming}>
                <DeleteSweepIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, mb: 1 }}>
            {chatMessages.map((msg, i) => {
              const isStreamingLast = streaming && i === chatMessages.length - 1 && msg.role === "assistant";
              return (
                <Paper
                  key={i}
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
                  ) : (
                    <>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {msg.content}{isStreamingLast && !msg.content && <TypingDots />}
                      </Typography>
                      {isStreamingLast && msg.content && <TypingDots />}
                      {msg.role === "assistant" && msg.edits?.map((edit, j) => (
                        <DiffWidget key={j} diff={edit.diff} failed={edit.failed} />
                      ))}
                    </>
                  )}
                </Paper>
              );
            })}
            <div ref={chatEndRef} />
          </Box>

          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // keyCode is deprecated but still widely used for detecting IME composition state
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              disabled={streaming}
              multiline
              maxRows={4}
            />
            <IconButton color="primary" onClick={handleSend} disabled={streaming || !input.trim()}>
              <SendIcon />
            </IconButton>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
