<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { LearningRouteView } from '@luma/shared';
import LumaIcon from './LumaIcon.vue';
const props = defineProps<{ route: LearningRouteView; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'action', action: 'pause' | 'resume' | 'skip' | 'revisit', nodeId?: string): void; (e: 'continue', objective: string): void }>();
const expanded = ref(false);
const current = computed(() => props.route.nodes.find((n) => n.id === props.route.currentNodeId));
const checked = computed(() => props.route.nodes.filter((n) => n.status === 'checked').length);
const labels = { pending: '待学习', learning: '未完成', checked: '通过验证', needs_review: '待巩固', skipped: '已跳过' };
watch(() => props.route.id, () => { expanded.value = false; });
</script>
<template>
  <view class="learning-route">
    <button class="route-toggle" aria-label="展开或收起学习安排" @tap="expanded = !expanded">
      <view class="route-copy"><text class="route-caption">{{ route.status === 'paused' ? '已暂停 · 进度保留' : route.status === 'ended' ? '本次安排已结束' : checked === route.nodes.length ? '本次目标已验证' : '本次学习' }} · {{ checked }}/{{ route.nodes.length }} 通过验证</text><text class="route-goal">{{ route.goal }}</text></view>
      <LumaIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="14" />
    </button>
    <view v-if="expanded" class="route-details">
      <view v-for="node in route.nodes" :key="node.id" class="route-node" :class="{ current: node.id === current?.id }">
        <text class="node-number">{{ String(node.position + 1).padStart(2, '0') }}</text><text class="node-objective">{{ node.objective }}</text>
        <view class="node-state"><text class="node-status">{{ route.status === 'active' && node.id === current?.id ? (node.status === 'needs_review' ? '正在巩固' : '正在学') : labels[node.status] }}</text>
          <button v-if="route.status === 'active' && ['checked', 'skipped'].includes(node.status)" class="node-revisit" :class="{ 'revisit-disabled': disabled }" :disabled="disabled" :aria-label="`${node.status === 'checked' ? '再巩固' : '回来学'}：${node.objective}`" @tap="emit('action', 'revisit', node.id)">{{ node.status === 'checked' ? '再巩固' : '回来学' }}</button>
        </view>
      </view>
      <text v-if="current?.check && !current.check.evaluation && route.status === 'active'" class="route-note">短验证留在对话中，按自己的思路回答即可。</text>
      <view v-if="route.status !== 'ended'" class="route-actions" :class="{ disabled }">
        <button class="route-action" :disabled="disabled" @tap="emit('action', route.status === 'paused' ? 'resume' : 'pause')">{{ route.status === 'paused' ? '恢复学习' : '暂停' }}</button>
        <button class="route-action" v-if="current && route.status === 'active'" :disabled="disabled" @tap="emit('action', 'skip', current.id)">先跳过这一步</button>
        <button class="route-action" v-if="current && route.status === 'active'" :disabled="disabled" @tap="emit('continue', current.objective)">接着学</button>
      </view>
      <text class="route-note">跳过不代表已掌握，随时可以回来继续。</text>
    </view>
  </view>
</template>
<style scoped>
.learning-route { border-bottom:1rpx solid #e3e8dc; margin-bottom:26rpx; }
.route-toggle,.route-action,.node-revisit { background:transparent; border:0; border-radius:0; margin:0; padding:0; line-height:1.6; font-weight:400; }
.route-toggle::after,.route-action::after,.node-revisit::after { border:0; }
.route-toggle { display:flex; align-items:center; gap:24rpx; width:100%; text-align:left; padding:10rpx 0 22rpx; }
.route-copy { flex:1; min-width:0; }
.route-caption { display:block; font-size:20rpx; color:#98a18c; }
.route-goal { display:block; margin-top:8rpx; color:#526b48; font-size:25rpx; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.route-details { padding-bottom:22rpx; }
.route-node { display:flex; gap:16rpx; padding:14rpx 0; align-items:baseline; color:#8c987f; }
.node-number { color:#ad9879; font-size:21rpx; font-family:Georgia,serif; }
.node-objective { flex:1; min-width:0; font-size:24rpx; line-height:1.7; overflow-wrap:anywhere; }
.current .node-objective { color:#4f6946; }
.node-status { flex-shrink:0; font-size:19rpx; }
.node-state { flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; }
.node-revisit { font-size:21rpx; color:#66825b; min-height:62rpx; display:flex; align-items:center; }
.revisit-disabled { opacity:.4; }
.route-actions { display:flex; flex-wrap:wrap; gap:28rpx; margin-top:12rpx; }
.route-action { font-size:23rpx; min-height:68rpx; color:#66825b; }
.disabled .route-action { opacity:.4; }
.route-note { display:block; color:#9fa88f; font-size:20rpx; line-height:1.7; }
</style>
