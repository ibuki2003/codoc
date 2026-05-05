import { Box } from "@mui/material";

export default function TypingDots() {
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
