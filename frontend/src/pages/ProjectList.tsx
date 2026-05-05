import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Button, Container, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, List, ListItem, ListItemButton,
  ListItemText, TextField, Tooltip, Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SettingsIcon from "@mui/icons-material/Settings";
import { listProjects, createProject, deleteProject, getSettings, updateSettings, type ProjectSummary } from "../api";

export default function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemPromptDraft, setSystemPromptDraft] = useState("");
  const navigate = useNavigate();

  const load = () => listProjects().then(setProjects);
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    const { _id } = await createProject(title.trim());
    setOpen(false);
    setTitle("");
    navigate(`/projects/${_id}`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteProject(id);
    load();
  };

  const handleSettingsOpen = async () => {
    const s = await getSettings();
    setSystemPrompt(s.systemPrompt);
    setSystemPromptDraft(s.systemPrompt);
    setSettingsOpen(true);
  };

  const handleSettingsSave = async () => {
    await updateSettings({ systemPrompt: systemPromptDraft });
    setSystemPrompt(systemPromptDraft);
    setSettingsOpen(false);
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <Typography variant="h4" sx={{ flex: 1 }}>CoDoc</Typography>
        <Tooltip title="Settings">
          <IconButton onClick={handleSettingsOpen} sx={{ mr: 1 }}>
            <SettingsIcon />
          </IconButton>
        </Tooltip>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          New Project
        </Button>
      </Box>
      <List>
        {projects.map((p) => (
          <ListItem
            key={p._id}
            disablePadding
            secondaryAction={
              <IconButton edge="end" onClick={(e) => handleDelete(e, p._id)}>
                <DeleteIcon />
              </IconButton>
            }
          >
            <ListItemButton onClick={() => navigate(`/projects/${p._id}`)}>
              <ListItemText
                primary={p.title}
                secondary={new Date(p.updatedAt).toLocaleString()}
              />
            </ListItemButton>
          </ListItem>
        ))}
        {projects.length === 0 && (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            No projects yet. Create one to get started.
          </Typography>
        )}
      </List>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Project</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Title"
            fullWidth
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate}>Create</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Settings</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            System Instruction
          </Typography>
          <TextField
            multiline
            fullWidth
            minRows={8}
            maxRows={20}
            value={systemPromptDraft}
            onChange={(e) => setSystemPromptDraft(e.target.value)}
            placeholder="Enter system instruction for the AI assistant…"
            sx={{ fontFamily: "monospace" }}
            slotProps={{ input: { style: { fontFamily: "monospace", fontSize: "0.85rem" } } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setSystemPromptDraft(systemPrompt); setSettingsOpen(false); }}>Cancel</Button>
          <Button variant="contained" onClick={handleSettingsSave}>Save</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
