import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box, Button, CircularProgress, Container, Divider, FormControl,
  IconButton, InputLabel, MenuItem, Paper, Select, TextField,
  Toolbar, Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import SaveIcon from "@mui/icons-material/Save";
import {
  getProject, updateContent, chatStream, listModels,
  type Project, type ConversationEntry, type StreamChunk, type ModelInfo,
} from "../api";

type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "system"; text: string };

function entryToChat(e: ConversationEntry): ChatMessage | null {
  if (e.role === "user") return { role: "user", content: e.content };
  if (e.role === "assistant") return { role: "assistant", content: e.content };
  if (e.role === "system") {
    if (e.subtype === "diff") return { role: "system", text: `[Document edited]` };
    if (e.subtype === "whole") return null;
    if (e.subtype === "redacted") return null;
  }
  return null;
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [content, setContent] = useState("");
  const [contentDirty, setContentDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [streaming, setStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const streamingAssistantRef = useRef("");

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
    setContentDirty(false);
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

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    await updateContent(id, content);
    setSaving(false);
    setContentDirty(false);
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
          next[next.length - 1] = { role: "assistant", content: streamingAssistantRef.current };
          return next;
        });
      } else if (chunk.type === "document_updated") {
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
        <Button
          startIcon={<SaveIcon />}
          variant={contentDirty ? "contained" : "outlined"}
          disabled={!contentDirty || saving}
          onClick={handleSave}
          size="small"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
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
            onChange={(e) => { setContent(e.target.value); setContentDirty(true); }}
            sx={{ flex: 1, "& .MuiInputBase-root": { height: "100%", alignItems: "flex-start" } }}
            inputProps={{ style: { fontFamily: "monospace", height: "100%", overflowY: "auto" } }}
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
              <Select
                value={model}
                label="Model"
                onChange={(e) => setModel(e.target.value)}
              >
                {models.map((m) => (
                  <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1, mb: 1 }}>
            {chatMessages.map((msg, i) => (
              <Paper
                key={i}
                elevation={0}
                sx={{
                  p: 1,
                  bgcolor:
                    msg.role === "user" ? "primary.light" :
                    msg.role === "system" ? "action.hover" :
                    "background.paper",
                  border: 1,
                  borderColor: "divider",
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "90%",
                }}
              >
                <Typography variant="caption" color="text.secondary" display="block">
                  {msg.role === "user" ? "You" : msg.role === "assistant" ? "Assistant" : "System"}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {"content" in msg ? msg.content : msg.text}
                </Typography>
              </Paper>
            ))}
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
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              disabled={streaming}
              multiline
              maxRows={4}
            />
            <IconButton
              color="primary"
              onClick={handleSend}
              disabled={streaming || !input.trim()}
            >
              {streaming ? <CircularProgress size={24} /> : <SendIcon />}
            </IconButton>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
