import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import SessionRoot from "@/components/session-root";

import "@/i18n";
import { captureCredentials } from "@/lib/session-context";
import { initAnalytics } from "@/lib/analytics";

captureCredentials();
initAnalytics();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <SessionRoot />
    </React.StrictMode>,
);
