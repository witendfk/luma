<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number; white?: boolean }>(), { size: 20, white: false });
</script>
<template>
  <image class="luma-icon" :src="`/static/icons/${name}${white ? '-white' : ''}.svg`" :style="{ width: `${size}px`, height: `${size}px` }" mode="aspectFit" />
</template>
<style scoped>
.luma-icon { display: inline-block; flex-shrink: 0; vertical-align: middle; }
</style>
