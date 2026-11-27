export const viewerTheme = `
  :root {
    --panel: #191e27f5;
    --border: #3e4a5d;
    --button: #242e3c;
    --button-hover: #33465b;
    --accent: #146b88;
    --accent-text: #a5f3fc;
    --text: #edf3fa;
    --text-dim: #aebaca;
  }
  .ioviewer-floating { border-radius: 4px; }
  .ioviewer-rail-button, .ioviewer-tool { border-radius: 3px; }
  .ioviewer-rail-button.active, .ioviewer-tool.active {
    box-shadow: inset 0 -2px #08465b;
  }
`;
