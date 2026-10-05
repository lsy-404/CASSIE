import { createApp } from "vue";
import TerminalShell from "./TerminalShell.vue";
import { i18n } from "./i18n";
import "./style.css";

createApp(TerminalShell).use(i18n).mount("#app");
