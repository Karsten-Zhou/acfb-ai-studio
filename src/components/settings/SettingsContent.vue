<script setup lang="ts">
// Body of the settings modal: one section per concern, so adding a settings
// group means adding a component here rather than another block of markup.
import PreferencesSection from "@/components/settings/PreferencesSection.vue";
import AboutSection from "@/components/settings/AboutSection.vue";
</script>

<template>
  <div class="space-y-6">
    <PreferencesSection />
    <AboutSection />
  </div>
</template>
