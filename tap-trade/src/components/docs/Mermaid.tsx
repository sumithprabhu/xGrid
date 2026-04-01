import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      background: "#0d1120",
      primaryColor: "#1a2035",
      primaryTextColor: "#e2e8f0",
      primaryBorderColor: "#ff3b8d",
      lineColor: "#ff3b8d",
      secondaryColor: "#111827",
      tertiaryColor: "#0d1120",
      edgeLabelBackground: "#0d1120",
      clusterBkg: "#111827",
      titleColor: "#ff3b8d",
      nodeTextColor: "#e2e8f0",
      mainBkg: "#1a2035",
      nodeBorder: "#ff3b8d",
      clusterBorder: "#ff3b8d44",
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      fontSize: "13px",
    },
    flowchart: { curve: "basis", htmlLabels: true },
  });
}

let idCounter = 0;

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef(`mermaid-${++idCounter}`);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    ensureInit();
    mermaid
      .render(id.current, chart.trim())
      .then(({ svg }) => setSvg(svg))
      .catch((e) => setError(String(e)));
  }, [chart]);

  if (error) {
    return (
      <pre className="text-xs text-red-400 bg-red-900/20 p-3 rounded-lg overflow-auto">
        {error}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="my-6 flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
