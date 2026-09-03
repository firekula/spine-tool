import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SpineApp } from "@/app/spine-app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SpineApp />
  </StrictMode>,
);
