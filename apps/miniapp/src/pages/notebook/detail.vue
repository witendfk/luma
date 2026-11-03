<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { readNoteDraft, rememberNoteDraft, clearNoteDraft } from '@/utils/note-draft';
import { UI_MOCK } from '@/config';
import PreviewNotice from '@/components/PreviewNotice.vue';
import LumaIcon from '@/components/LumaIcon.vue';
import StudyText from '@/components/StudyText.vue';
import { useNotebookPreviewStore } from '@/stores/notebook-preview';
import { useStudyPreviewStore } from '@/stores/study-preview';
const notebook = useNotebookPreviewStore();
const study = useStudyPreviewStore();
const id = ref('');
const editing = ref(false), draft = ref(''), historyOpen = ref(false);
const item = computed(() => notebook.records.find((r) => r.id === id.value));
const dirty = computed(() => editing.value && draft.value !== (item.value?.note ?? ''));
onLoad((query) => { id.value = query?.id ?? ''; });
onShow(() => { if (UI_MOCK) { notebook.refresh(); study.restore(); } });
// 原生返回/手势离开也保留未保存文字；主动取消则不保存。
const draftSaved = ref(true);
function remember(): void {
  if (editing.value) draftSaved.value = rememberNoteDraft(id.value, draft.value, item.value?.note ?? '');
}
onUnload(remember);
function edit(): void {
  draft.value = readNoteDraft(id.value, item.value?.note ?? '');
  editing.value = true;
}
function save(): void {
  try {
    notebook.update(id.value, { note: draft.value.trim() });
    clearNoteDraft(id.value); editing.value = false;
    uni.showToast({ title: '笔记已保存在本机', icon: 'none' });
  } catch { uni.showToast({ title: '保存失败，文字仍保留，请重试', icon: 'none' }); }
}
function cancel(): void {
  if (!dirty.value) { editing.value = false; return; }
  uni.showModal({ title: '放弃这次修改？', content: '已保存的笔记会保留。', confirmText: '放弃修改', cancelText: '继续编辑', confirmColor: '#8d7b61', success: (res) => { if (res.confirm) { editing.value = false; clearNoteDraft(id.value); } } });
}
function review(): void {
  if (!item.value) return;
  const reviewed = item.value.reviewStatus === 'reviewed';
  try {
    notebook.update(id.value, { reviewStatus: reviewed ? 'to_review' : 'reviewed' });
    uni.showToast({ title: reviewed ? '已放回待复习' : '已标记为已复习', icon: 'none' });
  } catch { uni.showToast({ title: '状态未能保存，请重试', icon: 'none' }); }
}
function open(kind: 'lesson' | 'practice' | 'chat'): void {
  remember();
  const url = kind === 'chat' ? `/pages/chat/index?id=${encodeURIComponent(id.value)}` : `/pages/${kind === 'lesson' ? 'reader' : 'practice'}/index?preview=1`;
  uni.navigateTo({ url });
}
function remove(): void {
  uni.showModal({ title: '从错题本移除？', content: '只取消收藏，原对话、讲解和练习记录都会保留。', confirmText: '移除收藏', cancelText: '保留', confirmColor: '#927c61', success: (res) => { if (res.confirm) { try { notebook.update(id.value, { collected: false }); uni.navigateBack(); } catch { uni.showToast({ title: '移除失败，请重试', icon: 'none' }); } } } });
}
function viewRound(roundId: string): void { historyOpen.value = false; uni.navigateTo({ url: `/pages/practice/index?preview=1&historyId=${encodeURIComponent(roundId)}` }); }
</script>
<template>
  <view class="detail-page">
    <PreviewNotice />
    <view v-if="!UI_MOCK || !item" class="unavailable"><text>这条学习记录暂时无法打开</text><text>返回错题本，选择其他内容试试。</text></view>
    <scroll-view v-else class="detail-scroll" scroll-y enhanced :bounces="false" :show-scrollbar="false">
      <view class="detail-content">
        <view class="meta"><text>{{ item.type === 'knowledge' ? '知识点记录' : '错题记录' }}</text><button class="quiet review-toggle" @tap="review"><view class="status-dot" :class="{ done: item.reviewStatus === 'reviewed' }" />{{ item.reviewStatus === 'reviewed' ? '已复习 · 改为待复习' : '待复习 · 标记已复习' }}</button></view>
        <text class="title">{{ item.title }}</text><text class="tags">{{ item.tags.join(' · ') }}</text>
        <view class="subject"><text class="section-label">{{ item.type === 'knowledge' ? '最初的困惑' : '回到题目' }}</text><StudyText :text="item.text" /></view>
        <view class="material-links"><button v-if="item.lesson" class="quiet material-link" @tap="open('lesson')"><view class="link-copy"><LumaIcon name="book" :size="20" /><view><text class="link-title">阅读图文讲解</text><text class="link-note">接着上次的位置，慢慢想明白</text></view></view><LumaIcon name="arrow-diagonal" :size="14" /></button><button v-if="item.practice" class="quiet material-link" @tap="open('practice')"><view class="link-copy"><LumaIcon name="practice" :size="20" /><view><text class="link-title">继续配套练习</text><text class="link-note">保留当前轮次与作答草稿</text></view></view><LumaIcon name="arrow-diagonal" :size="14" /></button><text v-if="!item.lesson && !item.practice" class="material-empty">还没有讲解或练习，可以回原对话继续问。</text></view>
        <view class="notes"><view class="section-head"><text class="section-label">我的理解</text><button v-if="!editing" class="quiet text-action" @tap="edit">{{ item.note ? '编辑笔记' : '记一笔' }}</button></view><template v-if="editing"><textarea v-model="draft" class="note-input" :maxlength="2000" :show-confirm-bar="false" placeholder="记下哪里容易错，或用自己的话解释一下…" @input="remember" /><view class="note-actions"><text>{{ draft.length }}/2000 · {{ draftSaved ? '草稿留在本机' : '草稿未能保存，请勿退出' }}</text><button class="quiet text-action" @tap="cancel">取消</button><button class="quiet text-action save-note" @tap="save">保存笔记</button></view></template><text v-else class="note-text" :class="{ placeholder: !item.note }">{{ item.note || '不用抄解析。写下让你突然想通的那一句。' }}</text></view>
        <view v-if="item.practice" class="practice-history"><view class="section-head"><text class="section-label">练习记录</text><button v-if="study.history.length" class="quiet text-action" @tap="historyOpen = true">查看历史</button></view><text class="history-note">{{ study.history.length ? `已完成 ${study.history.length} 轮 · 自评记录` : '还没有完成的轮次，做完后会留在这里。' }}</text></view>
        <text class="review-note">复习状态由你手动确认，阅读或做对一次不会自动标记。</text>
        <view class="footer-links"><button class="quiet back-chat" @tap="open('chat')">回到原对话<LumaIcon name="arrow-diagonal" :size="13" /></button><button class="quiet remove" @tap="remove">移除收藏</button></view>
      </view>
    </scroll-view>
    <view v-if="historyOpen" class="history-layer"><view class="scrim" @tap="historyOpen = false" /><view class="history-sheet"><view class="section-head"><text class="section-label">历史作答 · 只读</text><button class="quiet close-history" aria-label="关闭历史作答" @tap="historyOpen = false"><LumaIcon name="close" :size="18" /></button></view><scroll-view scroll-y class="history-list"><button v-for="(round, index) in study.history" :key="round.id" class="quiet history-item" @tap="viewRound(round.id)"><text>第 {{ index + 1 }} 轮</text><text>{{ round.ids.length }} 题 · 查看作答与自评</text></button></scroll-view></view></view>
  </view>
</template>
<style scoped>
.detail-page { display:flex; flex-direction:column; height:100vh; overflow:hidden; background:#f8f7f2; color:#42573e; }
.quiet { margin:0; padding:0; border:0; background:transparent; border-radius:0; line-height:1.7; font-weight:400; }
.quiet::after { border:0; }
.detail-scroll { flex:1; height:0; min-height:0; }
.detail-content { padding:28rpx 38rpx max(36rpx,env(safe-area-inset-bottom)); }
.meta { display:flex; align-items:center; justify-content:space-between; color:#a18c6e; font-size:20rpx; }
.review-toggle { display:flex; align-items:center; gap:10rpx; min-height:88rpx; font-size:21rpx; color:#91a080; }
.status-dot { width:10rpx; height:10rpx; border-radius:50%; border:1rpx solid #b6bda8; }
.status-dot.done { background:#92a67c; border-color:#92a67c; }
.title { display:block; margin:16rpx 0 22rpx; font-family:'Songti SC','STSong',serif; font-size:42rpx; line-height:1.65; }
.tags { color:#98a68a; font-size:22rpx; }
.subject { margin-top:38rpx; padding:32rpx 0; border-top:1rpx solid #dfe6d5; }
.section-label { display:block; color:#728966; font-size:23rpx; }
.subject .section-label { margin-bottom:24rpx; }
.material-links { border-top:1rpx solid #e0e6d6; border-bottom:1rpx solid #e0e6d6; }
.material-link { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:130rpx; text-align:left; }
.link-copy { display:flex; align-items:center; gap:24rpx; }
.link-title { display:block; color:#4c6845; font-size:27rpx; }
.link-note { display:block; margin-top:8rpx; color:#a1ab95; font-size:20rpx; }
.material-empty { display:block; padding:28rpx 0; font-size:23rpx; color:#a1ab95; line-height:1.9; }
.notes,.practice-history { margin-top:26rpx; }
.section-head { display:flex; align-items:center; justify-content:space-between; gap:20rpx; }
.text-action { display:flex; align-items:center; min-height:88rpx; color:#8b9e7b; font-size:22rpx; }
.note-text { display:block; white-space:pre-wrap; font-size:27rpx; color:#667d59; line-height:1.95; }
.note-text.placeholder { color:#a6af9a; font-size:24rpx; }
.note-input { width:100%; height:240rpx; box-sizing:border-box; padding:22rpx; border:1rpx solid #dfe5d5; border-radius:16rpx; background:#fdfcf8; color:#526b46; font-size:27rpx; line-height:1.9; }
.note-actions { display:flex; align-items:center; gap:24rpx; font-size:18rpx; color:#a6ae99; }
.note-actions text { flex:1; }
.save-note { color:#527147; }
.history-note,.review-note { display:block; color:#a0ac92; font-size:22rpx; line-height:1.9; }
.review-note { margin-top:48rpx; font-size:20rpx; }
.footer-links { display:flex; align-items:center; justify-content:space-between; margin-top:22rpx; border-top:1rpx solid #e0e6d6; }
.back-chat { display:flex; gap:12rpx; align-items:center; min-height:100rpx; color:#6b855d; font-size:24rpx; }
.remove { min-height:100rpx; font-size:21rpx; color:#ab9678; }
.unavailable { padding:100rpx 40rpx; font-size:28rpx; color:#92a082; text-align:center; }
.unavailable text { display:block; margin-top:26rpx; }
.history-layer { position:fixed; inset:0; z-index:120; }
.scrim { position:absolute; inset:0; background:rgba(38,51,40,.24); }
.history-sheet { position:absolute; bottom:0; left:0; right:0; padding:26rpx 38rpx max(36rpx,env(safe-area-inset-bottom)); border-radius:28rpx 28rpx 0 0; background:#fafbf7; }
.close-history { display:flex; align-items:center; justify-content:center; width:80rpx; height:80rpx; }
.history-list { max-height:50vh; }
.history-item { display:flex; align-items:center; justify-content:space-between; width:100%; padding:26rpx 0; border-top:1rpx solid #e1e7d8; color:#7f936f; font-size:23rpx; }
</style>
