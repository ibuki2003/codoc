import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box, CircularProgress, FormControl,
  IconButton, InputLabel, MenuItem, Select, TextField,
  ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography,
  useMediaQuery, useTheme,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import CodeIcon from "@mui/icons-material/Code";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import SendIcon from "@mui/icons-material/Send";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import VisibilityIcon from "@mui/icons-material/Visibility";
import {
  getProject, updateContent, patchProject, chatStream, listModels, clearHistory,
  type Project, type ConversationEntry, type StreamChunk, type ModelInfo,
} from "../api";
import MarkdownPreview from "../components/MarkdownPreview";
import ChatMessageItem from "../components/ChatMessageItem";
import type { ChatMessage } from "../components/ChatMessageItem";

const AUTOSAVE_DELAY = 1500;
const CHAT_WIDTH_DEFAULT = 380;
const CHAT_WIDTH_MIN = 240;
const CHAT_WIDTH_MAX = 700;

type ViewMode = "editor" | "split" | "preview";

function entryToChat(e: ConversationEntry): ChatMessage | null {
  if (e.role === "user") return { role: "user", content: e.content };
  if (e.role === "assistant") {
    const edits = e.tool_calls
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [project, setProject] = useState<Project | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [modelSynced, setModelSynced] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH_DEFAULT);
  const [chatOpenOverride, setChatOpenOverride] = useState<boolean | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const streamingAssistantRef = useRef("");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On breakpoint change, reset the override so default behavior (open on desktop, closed on mobile) resumes
  useEffect(() => { setChatOpenOverride(null); }, [isMobile]);

  const chatOpen = chatOpenOverride !== null ? chatOpenOverride : !isMobile;

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = chatWidth;
    const onMouseMove = (e: MouseEvent) => {
      setChatWidth(Math.max(CHAT_WIDTH_MIN, Math.min(CHAT_WIDTH_MAX, startWidth - (e.clientX - startX))));
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [chatWidth]);

  useEffect(() => {
    listModels().then((ms) => { setModels(ms); });
  }, []);

  // Set model once both project and models are loaded, using project's saved model as default
  useEffect(() => {
    if (!modelSynced && models.length > 0 && project) {
      setModel(project.model ?? models[0].id);
      setModelSynced(true);
    }
  }, [models, project, modelSynced]);

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

  const handleTitleSave = async () => {
    if (!id || !titleInput.trim() || titleInput.trim() === project?.title) {
      setEditingTitle(false);
      return;
    }
    await patchProject(id, { title: titleInput.trim() });
    setProject((p) => p ? { ...p, title: titleInput.trim() } : p);
    setEditingTitle(false);
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
        {editingTitle ? (
          <TextField
            size="small"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleTitleSave(); }
              if (e.key === "Escape") setEditingTitle(false);
            }}
            autoFocus
            sx={{ flex: 1 }}
          />
        ) : (
          <Typography
            variant="h6"
            sx={{ flex: 1, cursor: "text" }}
            onClick={() => { setTitleInput(project.title); setEditingTitle(true); }}
          >
            {project.title}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {saving ? "Saving…" : "Saved"}
        </Typography>
        <Tooltip title={chatOpen ? "Hide chat" : "Show chat"}>
          <IconButton onClick={() => setChatOpenOverride(!chatOpen)} color={chatOpen ? "primary" : "default"}>
            <ChatBubbleOutlineIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>

      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Document panel — hidden on mobile when chat is open */}
        <Box sx={{
          flex: 1,
          display: (isMobile && chatOpen) ? "none" : "flex",
          flexDirection: "column",
          p: 2,
          overflow: "hidden",
          minWidth: 0,
        }}>
          <Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 1 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ flex: 1 }}>
              Document
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={viewMode}
              onChange={(_, v) => { if (v) setViewMode(v); }}
            >
              <ToggleButton value="editor"><Tooltip title="Editor"><CodeIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="split"><Tooltip title="Split"><ViewColumnIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="preview"><Tooltip title="Preview"><VisibilityIcon fontSize="small" /></Tooltip></ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Box sx={{ flex: 1, display: "flex", gap: 1, overflow: "hidden" }}>
            {viewMode !== "preview" && (
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
            )}
            {viewMode !== "editor" && <MarkdownPreview content={content} />}
          </Box>
        </Box>

        {/* Resize handle */}
        {chatOpen && !isMobile && (
          <Box
            onMouseDown={handleResizeMouseDown}
            sx={{
              width: 5, flexShrink: 0, cursor: "col-resize",
              bgcolor: "divider",
              "&:hover": { bgcolor: "primary.main" },
              transition: "background-color 0.15s",
            }}
          />
        )}

        {/* Chat panel */}
        {chatOpen && (
          <Box sx={{
            width: isMobile ? "100%" : chatWidth,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            p: 2,
            overflow: "hidden",
            borderLeft: isMobile ? 0 : 0,
          }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 1 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ flex: 1 }}>
                Chat
              </Typography>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Model</InputLabel>
                <Select value={model} label="Model" onChange={(e) => {
                  setModel(e.target.value);
                  if (id) patchProject(id, { model: e.target.value });
                }}>
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
              {chatMessages.map((msg, i) => (
                <ChatMessageItem
                  key={i}
                  msg={msg}
                  isStreamingLast={streaming && i === chatMessages.length - 1 && msg.role === "assistant"}
                />
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
        )}
      </Box>
    </Box>
  );
}
