<script setup lang="ts">
import { FluentTheme } from "@platform-kit/fluent/vue";
import { createStudio, provideStudio } from "./studio";
import type { DecodedUrlState } from "./url-state";
import ActivityBar from "./components/ActivityBar.vue";
import BottomPanel from "./components/BottomPanel.vue";
import EditorPane from "./components/EditorPane.vue";
import Ribbon from "./components/Ribbon.vue";
import SideBar from "./components/SideBar.vue";
import StatusBar from "./components/StatusBar.vue";
import TitleBar from "./components/TitleBar.vue";

const props = defineProps<{ initialState?: DecodedUrlState | null; urlError?: boolean }>();
provideStudio(createStudio(props));
</script>

<template>
  <FluentTheme mode="dark">
    <div class="ide">
      <TitleBar />
      <Ribbon />
      <div class="ide-body">
        <ActivityBar />
        <SideBar />
        <main class="ide-main">
          <EditorPane />
          <BottomPanel />
        </main>
      </div>
      <StatusBar />
    </div>
  </FluentTheme>
</template>

<style scoped>
.ide { height: 100%; display: flex; flex-direction: column; min-width: 320px; overflow: hidden; background: var(--ide-editor); color: var(--fluent-text); font-size: 13px; }
.ide-body { flex: 1; min-height: 0; position: relative; display: flex; }
.ide-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
</style>
