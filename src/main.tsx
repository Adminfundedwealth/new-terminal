import { createRoot } from "react-dom/client";
import App from "./App";
import { installChunkLoadRecovery } from "./lib/chunkRecovery";
import "./index.css";

installChunkLoadRecovery(window, window.sessionStorage);

createRoot(document.getElementById("root")!).render(<App />);
