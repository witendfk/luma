<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onHide, onLoad, onShow } from '@dcloudio/uni-app';
import { UI_MOCK } from '@/config';
import PreviewCollectionAction from '@/components/PreviewCollectionAction.vue';
import LumaIcon from '@/components/LumaIcon.vue';
import StudyText from '@/components/StudyText.vue';
import type { StudyRating } from '@/fixtures/study';
import { useStudyPreviewStore } from '@/stores/study-preview';
import { previewExampleKey, rememberPreviewLocation } from '@/mocks/workspace';
import AttachmentStrip from '@/components/AttachmentStrip.vue';
import { chooseAttachments, MAX_IMAGES } from '@/utils/attachments';
import { sessionVersion } from '@/utils/token';
let scope = 'preview-quadratic';
let visible = true;
const choosing = ref(false);
const invalidImages = ref<Record<string, boolean>>({});
const study = useStudyPreviewStore();
const preview = ref(false), historyOpen = ref(false);
const selectedHistory = ref<string | null>(null);
const pageHeight = uni.getSystemInfoSync().windowHeight;
const keyboard = ref(0), scrollTop = ref(0);
const current = computed(() => study.currentExercise);
const answer = computed(() => study.currentAnswer);
const draft = computed({ get: () => study.currentAnswer.text, set: (value: string) => study.answer(value) });
const exercises = computed(() => study.round.ids.map((id) => study.example.exercises.find((item) => item.id === id)!));
const answered = computed(() => study.round.ids.filter((id) => study.round.answers[id]!.text.trim() || study.round.answers[id]!.images?.length || study.round.answers[id]!.unknown).length);
const independent = computed(() => study.round.ids.filter((id) => study.round.answers[id]!.rating === 'independent').length);
const reviewRound = computed(() => selectedHistory.value ? study.history.find((item) => item.id === selectedHistory.value) : study.round);
const reviewExercises = computed(() => (reviewRound.value?.ids ?? []).map((id) => study.example.exercises.find((item) => item.id === id)!));
const reviewTarget = ref('');
const ratings: Array<{ value: StudyRating; label: string }> = [{ value: 'independent', label: '独立做对' }, { value: 'partial', label: '部分会' }, { value: 'stuck', label: '还不会' }];
onLoad((query) => { preview.value = import.meta.env.DEV && query?.preview === '1'; if (preview.value) {
  scope = query?.scope ?? 'preview-quadratic'; study.restore(scope, previewExampleKey(scope));
  if (query?.historyId) {
    if (study.history.some((round) => round.id === query.historyId)) selectedHistory.value = query.historyId;
    else uni.showToast({ title: '该轮记录已不在本机，已回到当前轮次', icon: 'none' });
  }
} });
function rememberVisit(): void { if (visible && UI_MOCK && preview.value && !selectedHistory.value) { try { rememberPreviewLocation(scope, 'practice'); } catch { /* 保留本机作答。 */ } } }
onShow(() => { visible = true; if (preview.value) { study.restore(scope, previewExampleKey(scope)); study.endFocus(); rememberVisit(); } });
onHide(() => { visible = false; if (preview.value) study.persist(); keyboard.value = 0; });
watch(() => [study.round.index, study.round.phase, study.currentAnswer.text, study.currentAnswer.images?.length, selectedHistory.value], rememberVisit);
async function uploadAnswer(index?: number): Promise<void> {
  if (choosing.value || study.round.phase !== 'doing') return;
  const images = study.currentAnswer.images ?? [];
  if (index === undefined && images.length >= MAX_IMAGES) { uni.showToast({ title: '每题最多添加 3 张作答图片', icon: 'none' }); return; }
  const round = study.round.id, question = study.currentExercise.id, session = sessionVersion();
  choosing.value = true;
  try {
    const selected = await chooseAttachments(index === undefined ? MAX_IMAGES - images.length : 1);
    if (!selected?.length || session !== sessionVersion() || study.round.id !== round || study.currentExercise.id !== question || !visible) return;
    const next = [...images]; if (index === undefined) next.push(...selected); else next.splice(index, 1, selected[0]!);
    study.answerImages(next); rememberVisit();
  } finally { choosing.value = false; }
}
function removeAnswer(index: number): void { const images = [...(study.currentAnswer.images ?? [])]; images.splice(index, 1); study.answerImages(images); }
function back(): void {
  if (getCurrentPages().length > 1) uni.navigateBack(); else uni.switchTab({ url: '/pages/home/index' });
}
function goTop(): void { scrollTop.value = scrollTop.value === 0 ? 1 : 0; }
function jump(index: number): void { study.jump(index); goTop(); }
function submit(): void {
  const invalidQuestion = study.round.ids.find((id) => invalidImages.value[id] && study.round.answers[id]?.images?.length);
  if (invalidQuestion) { jump(study.round.ids.indexOf(invalidQuestion)); uni.showToast({ title: '请先更换或移除这题的失效图片', icon: 'none' }); return; }
  if (choosing.value) { uni.showToast({ title: '请等待选图完成', icon: 'none' }); return; }
  if (answered.value < study.round.ids.length) {
    uni.showModal({ title: '还有未作答的题', content: '可以回去补充，也可以按未完成提交，接下来对照解析自评。', confirmText: '仍然提交', cancelText: '继续作答', confirmColor: '#4f6652', success: (res) => { if (res.confirm) { study.submit(); goTop(); } } });
  } else { study.submit(); goTop(); }
}
function finish(): void {
  if (!study.finish()) {
    const id = study.round.ids.find((item) => !study.round.answers[item]!.rating);
    reviewTarget.value = ''; setTimeout(() => { if (id) reviewTarget.value = `review-${id}`; }, 0);
    uni.showToast({ title: '请为每一道题选择自评结果', icon: 'none' }); return;
  }
  goTop();
}
function ask(id: string): void {
  const index = study.round.ids.indexOf(id); if (index >= 0) study.jump(index);
  const exercise = study.example.exercises.find((item) => item.id === id)!;
  study.ask({ kind: 'exercise', id, roundId: study.round.id, heading: `第 ${study.round.ids.indexOf(id) + 1} 题 · ${exercise.kind}`, question: '这道题我还没理解，请先给我一个思考方向。' });
  uni.navigateTo({ url: '/pages/chat/index?preview=study' });
}
function restart(onlyNeeds: boolean): void {
  uni.showModal({ title: '开始新一轮练习？', content: '本轮作答与自评会保留，新一轮从空白开始。', confirmText: '开始重做', confirmColor: '#4f6652', success: (res) => { if (res.confirm) { study.restart(onlyNeeds); goTop(); } } });
}
function more(): void {
  const items = [...(study.needsPractice.length ? ['重做需巩固的题'] : []), '全部重做', '查看历史轮次'];
  uni.showActionSheet({ itemList: items, success: ({ tapIndex }) => {
    const chosen = items[tapIndex];
    if (chosen === '查看历史轮次') historyOpen.value = true; else restart(chosen === '重做需巩固的题');
  } });
}
function lesson(): void {
  const pages = getCurrentPages();
  if (pages.length > 1 && pages[pages.length - 2]?.route === 'pages/reader/index') uni.navigateBack();
  else uni.navigateTo({ url: `/pages/reader/index?preview=1&scope=${encodeURIComponent(scope)}` });
}
function viewHistory(id: string): void { selectedHistory.value = id; historyOpen.value = false; goTop(); }
</script>

<template>
  <view class="practice-page" :style="{ height: Math.max(260, pageHeight - keyboard) + 'px' }">
    <view v-if="selectedHistory" class="page-header"><button @tap="selectedHistory = null"><LumaIcon name="chevron-left" :size="18" /><text>回到本轮</text></button><text>历史作答 · 只读</text><text class="header-space" /></view>
    <view v-if="preview" class="preview-label">交互预览 · 示例题与解析 · 仅保存在本机</view>
    <PreviewCollectionAction v-if="UI_MOCK && preview" />
    <view v-if="!preview" class="unavailable"><text>这份练习暂未载入</text><text class="muted">作答交互可先从首页预览入口体验。</text><button @tap="back">返回对话</button></view>
    <template v-else>
      <view v-if="!selectedHistory && study.history.length && study.round.phase !== 'summary'" class="round-tools"><text>当前轮次</text><button @tap="historyOpen = true">历史作答</button></view>
      <scroll-view class="content-scroll" scroll-y :scroll-top="scrollTop" :scroll-into-view="reviewTarget">
        <view class="sheet">
          <template v-if="!selectedHistory && study.round.phase === 'intro'">
            <text class="eyebrow">PRACTICE</text><text class="page-title">把理解，变成会做。</text><text class="intro">{{ exercises.length }} 题 · 约 5–8 分钟<br />先独立尝试，再对照解析。</text>
            <view class="route"><text class="route-active">独立作答</text><text>对照自评</text><text>回顾巩固</text></view>
            <view v-for="(exercise, index) in exercises" :key="exercise.id" class="task-row"><text class="number">0{{ index + 1 }}</text><view><text class="task-title">{{ exercise.kind }}</text><text class="muted">{{ exercise.purpose }}</text></view></view>
            <text class="footnote">不用急着看答案。卡住时可以要一点提示，或者带着这道题继续问。</text>
          </template>
          <template v-else-if="!selectedHistory && study.round.phase === 'doing'">
            <view class="progress"><text>第 {{ study.round.index + 1 }} / {{ exercises.length }} 题</text><text>{{ answered }} 题已有记录</text></view>
            <view class="progress-line"><view :style="{ width: (study.round.index + 1) / exercises.length * 100 + '%' }" /></view>
            <view class="question-nav"><button v-for="(exercise, index) in exercises" :key="exercise.id" :class="{ active: study.round.index === index, recorded: study.round.answers[exercise.id]?.text || study.round.answers[exercise.id]?.unknown }" :aria-label="`跳到第 ${index + 1} 题`" @tap="jump(index)">{{ index + 1 }}</button></view>
            <text class="eyebrow">{{ current.kind }}</text><text class="exercise-stem">{{ current.stem }}</text><text class="purpose">{{ current.purpose }}</text>
            <view class="answer-heading"><text>我的思路与答案</text><text class="saved">{{ study.savedLocally ? '本机已保存' : '未能保存，请勿退出' }}</text></view>
            <textarea :key="current.id" v-model="draft" class="draft" :maxlength="4000" placeholder="写下第一步，或试着完整推一遍…" :adjust-position="false" :show-confirm-bar="false" @keyboardheightchange="keyboard = $event.detail.height" />
            <AttachmentStrip :images="answer.images ?? []" @replace="uploadAnswer($event)" @remove="removeAnswer" @invalid="invalidImages[current.id] = $event" />
            <view class="answer-tools"><button :disabled="choosing" @tap="uploadAnswer()"><LumaIcon name="photo" :size="14" />添加作答照片</button><button @tap="study.toggleHint()">{{ answer.hint ? '收起提示' : '给点提示' }}</button></view><button class="ask-link" @tap="ask(current.id)">围绕这题追问<LumaIcon name="arrow-diagonal" :size="12" /></button>
            <view v-if="answer.hint" class="hint"><text class="hint-label">先想一想</text><text>{{ current.hint }}</text></view>
            <button class="unknown" :class="{ marked: answer.unknown }" @tap="study.markUnknown()"><text class="check">{{ answer.unknown ? '✓' : '' }}</text><text>这题暂时不会，先记下来</text></button>
          </template>
          <template v-else-if="selectedHistory || study.round.phase === 'review'">
            <text class="eyebrow">{{ selectedHistory ? 'HISTORY' : 'SELF REVIEW' }}</text><text class="page-title">对照过程，再判断。</text><text class="intro">{{ selectedHistory ? '这是已完成轮次，只读查看。' : '参考解析已经展开，请按自己的实际过程自评。' }}</text>
            <view v-for="(exercise, index) in reviewExercises" :id="`review-${exercise.id}`" :key="exercise.id" class="review-section">
              <text class="task-title">0{{ index + 1 }} · {{ exercise.kind }}</text><text class="review-stem">{{ exercise.stem }}</text>
              <view class="my-answer"><text class="small-label">我的作答</text><text>{{ reviewRound?.answers[exercise.id]?.text || (reviewRound?.answers[exercise.id]?.images?.length ? '已添加作答照片' : reviewRound?.answers[exercise.id]?.unknown ? '暂时不会，待讲解' : '未填写作答') }}</text></view>
              <AttachmentStrip :images="reviewRound?.answers[exercise.id]?.images ?? []" readonly />
              <view class="reference"><text class="small-label">参考答案与解析</text><text class="answer-text">{{ exercise.answer }}</text><StudyText :text="exercise.analysis" /></view>
              <view class="rating-row"><button v-for="rating in ratings" :key="rating.value" :class="{ selected: reviewRound?.answers[exercise.id]?.rating === rating.value }" :disabled="Boolean(selectedHistory)" @tap="study.rate(exercise.id, rating.value)"><text class="rating-dot">{{ reviewRound?.answers[exercise.id]?.rating === rating.value ? '●' : '○' }}</text>{{ rating.label }}</button></view>
              <button v-if="!selectedHistory" class="ask-link" @tap="ask(exercise.id)">没看懂解析？围绕这题问问<LumaIcon name="arrow-diagonal" :size="12" /></button>
            </view>
          </template>
          <template v-else>
            <text class="eyebrow">REFLECTION</text><text class="page-title">这一次，哪里更清楚了？</text>
            <view class="result"><text>{{ independent }}</text><text class="result-total"> / {{ exercises.length }} 题独立做对</text></view><text class="self-label">根据你的自评记录</text>
            <view v-for="(exercise, index) in exercises" :key="exercise.id" class="result-row"><text>0{{ index + 1 }} · {{ exercise.kind }}</text><text class="result-status">{{ ratings.find((rating) => rating.value === study.round.answers[exercise.id]?.rating)?.label }}</text></view>
            <view class="hint"><text class="hint-label">下一步建议</text><text>{{ study.needsPractice.length ? '先回顾还没理解的步骤，再独立重做需要巩固的题。' : '本轮完成了，可以回看方法，再用新的题目检验理解。' }}</text></view>
            <view class="result-links"><button @tap="selectedHistory = study.round.id">查看本轮完整作答</button><button v-if="study.needsPractice.length" @tap="ask(study.needsPractice[0]!)">追问不会的题<LumaIcon name="arrow-diagonal" :size="12" /></button><button @tap="more">历史与重做</button></view>
            <text class="footnote">这是本轮自评，不代表考试得分率或知识点掌握率。</text>
          </template>
        </view>
      </scroll-view>
      <view class="action-dock">
        <template v-if="selectedHistory"><text class="dock-note">已完成轮次 · 只读</text><button class="primary" @tap="selectedHistory = null"><text>回到当前轮次</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
        <template v-else-if="study.round.phase === 'intro'"><text class="dock-note">先给自己一点思考时间</text><button class="primary" @tap="study.start()"><text>开始作答</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
        <template v-else-if="study.round.phase === 'doing'"><button v-if="study.round.index" class="secondary" @tap="jump(study.round.index - 1)">上一题</button><text v-else class="dock-note">作答会保留在本机</text><button class="primary" @tap="study.round.index < exercises.length - 1 ? jump(study.round.index + 1) : submit()"><text>{{ study.round.index < exercises.length - 1 ? '下一题' : '提交并自评' }}</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
        <template v-else-if="study.round.phase === 'review'"><text class="dock-note">{{ study.rated }} / {{ exercises.length }} 题已自评</text><button class="primary" @tap="finish"><text>完成自评</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
        <template v-else-if="study.needsPractice.length"><button class="secondary" @tap="lesson">回顾讲解</button><button class="primary" @tap="restart(true)"><text>重做需巩固题</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
        <template v-else><text class="dock-note">本轮已完成</text><button class="primary" @tap="lesson"><text>回顾讲解</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
      </view>
    </template>
    <view v-if="historyOpen" class="history-layer"><view class="scrim" @tap="historyOpen = false" /><view class="history-sheet"><view class="history-heading"><text>历史轮次</text><button aria-label="关闭历史轮次" @tap="historyOpen = false"><LumaIcon name="close" :size="18" /></button></view><scroll-view scroll-y class="history-list"><button v-for="(item, index) in study.history" :key="item.id" @tap="viewHistory(item.id)"><text>第 {{ index + 1 }} 轮</text><text>{{ item.ids.length }} 题 · 已完成 · 只读查看</text></button></scroll-view></view></view>
  </view>
</template>

<style scoped>
.practice-page { display:flex; flex-direction:column; overflow:hidden; background:#f8f7f2; color:#42563e; }
.practice-page button { margin:0; padding:0; background:transparent; border:0; font-weight:400; line-height:1.7; }
.practice-page button::after { border:0; }
.page-header { display:flex; align-items:center; justify-content:space-between; padding:8rpx 30rpx; min-height:84rpx; flex-shrink:0; border-bottom:1rpx solid #e4e9db; background:#fafbf7; font-size:27rpx; }
.page-header button { display:flex; align-items:center; gap:8rpx; min-height:80rpx; font-size:23rpx; color:#7e8e72; }
.header-space { width:80rpx; }
.preview-label { padding:10rpx 22rpx; text-align:center; font-size:19rpx; color:#9e8b70; background:#f4efe5; flex-shrink:0; }
.round-tools { display:flex; align-items:center; justify-content:space-between; padding:0 38rpx; flex-shrink:0; color:#a1ab96; font-size:20rpx; border-bottom:1rpx solid #e4e8dc; }
.round-tools button { display:flex; align-items:center; min-height:88rpx; color:#7b906d; font-size:22rpx; }
.content-scroll { flex:1; height:0; min-height:0; }
.sheet { padding:42rpx 38rpx 54rpx; }
.eyebrow { display:block; color:#a18763; font-size:19rpx; letter-spacing:3rpx; }
.page-title { display:block; margin:20rpx 0; font-family:'Songti SC','STSong',serif; font-size:43rpx; line-height:1.6; }
.intro { display:block; color:#91a083; font-size:25rpx; line-height:1.9; }
.route { display:flex; gap:28rpx; padding:32rpx 0 24rpx; border-bottom:1rpx solid #e2e8d9; font-size:21rpx; color:#a3ad96; }
.route-active { color:#5d7851; }
.task-row { display:flex; gap:24rpx; padding:32rpx 0; border-bottom:1rpx solid #e5e9df; }
.number { color:#ac9573; font-family:Georgia,serif; font-size:25rpx; }
.task-title { display:block; font-size:28rpx; color:#526c48; }
.muted { display:block; margin-top:10rpx; color:#96a08c; font-size:24rpx; line-height:1.8; }
.footnote { display:block; margin-top:34rpx; color:#a1ab94; font-size:22rpx; line-height:1.9; }
.progress { display:flex; justify-content:space-between; gap:20rpx; color:#8b9b7e; font-size:22rpx; }
.progress-line { margin-top:18rpx; height:4rpx; background:#e7ecdf; }
.progress-line view { height:100%; background:#9aaf87; }
.question-nav { display:flex; gap:22rpx; margin:26rpx 0 36rpx; }
.question-nav button { position:relative; display:flex; align-items:center; justify-content:center; width:88rpx; height:88rpx; border-radius:0; color:#9aa88d; font-size:27rpx; }
.question-nav button.active { color:#4f6d43; font-weight:500; box-shadow:inset 0 -2rpx #8ca27a; }
.question-nav button.recorded::before { content:''; position:absolute; bottom:8rpx; width:5rpx; height:5rpx; border-radius:50%; background:#a3b28f; }
.exercise-stem { display:block; margin:20rpx 0; color:#3e5239; font-size:32rpx; line-height:1.95; }
.purpose { display:block; color:#9daa92; font-size:22rpx; line-height:1.8; }
.answer-heading { display:flex; justify-content:space-between; gap:20rpx; margin:38rpx 0 18rpx; font-size:24rpx; color:#718568; }
.saved { color:#a2ad95; font-size:19rpx; }
.draft { width:100%; height:280rpx; box-sizing:border-box; padding:24rpx; border:1rpx solid #dce4d1; border-radius:20rpx; background:#fffefa; font-size:28rpx; line-height:1.9; color:#40543c; }
.answer-tools { display:flex; justify-content:space-between; gap:20rpx; }
.answer-tools button,.ask-link { display:flex; align-items:center; gap:10rpx; min-height:88rpx; color:#8a9c7b; font-size:23rpx; }
.hint { padding:24rpx; margin:20rpx 0; border-radius:16rpx; background:#eef2e7; color:#6d815f; font-size:25rpx; line-height:1.9; white-space:pre-wrap; }
.hint-label { display:block; margin-bottom:10rpx; color:#8d9e7f; font-size:20rpx; }
.practice-page .unknown { display:flex; align-items:center; gap:16rpx; min-height:88rpx; color:#a1ac93; font-size:23rpx; text-align:left; }
.unknown.marked { color:#7b8b6b; }
.check { display:flex; align-items:center; justify-content:center; width:30rpx; height:30rpx; border:1rpx solid #bdc9af; border-radius:7rpx; font-size:22rpx; }
.action-dock { display:flex; align-items:center; justify-content:space-between; gap:24rpx; padding:18rpx 30rpx max(24rpx,env(safe-area-inset-bottom)); border-top:1rpx solid #e0e7d7; background:#fafbf7; flex-shrink:0; }
.dock-note { color:#9ba68e; font-size:21rpx; }
.action-dock .primary { display:flex; align-items:center; justify-content:flex-end; gap:14rpx; padding:0 8rpx; min-height:88rpx; box-sizing:border-box; border-radius:0; color:#425f3f; background:transparent; font-size:26rpx; font-weight:500; }
.action-dock .secondary { display:flex; align-items:center; color:#829574; min-height:88rpx; font-size:24rpx; }
.review-section { padding:36rpx 0; border-bottom:1rpx solid #e0e6d8; }
.review-stem { display:block; margin:18rpx 0 26rpx; color:#4a5b43; font-size:28rpx; line-height:1.9; }
.my-answer { padding:22rpx; border-radius:16rpx; background:#edeee7; white-space:pre-wrap; color:#8b9682; font-size:25rpx; line-height:1.9; }
.small-label { display:block; margin-bottom:10rpx; font-size:20rpx; color:#99a38d; }
.reference { margin-top:24rpx; }
.answer-text { display:block; margin:10rpx 0 20rpx; color:#566e4c; font-size:28rpx; line-height:1.9; }
.rating-row { display:flex; flex-wrap:wrap; gap:8rpx 26rpx; margin-top:20rpx; }
.rating-row button { min-height:88rpx; font-size:23rpx; color:#a4ae98; }
.rating-row button.selected { color:#546f48; }
.rating-dot { margin-right:10rpx; font-size:22rpx; }
.result { margin-top:36rpx; color:#647e56; font-size:84rpx; font-family:Georgia,serif; }
.result-total { color:#9ba78d; font-size:26rpx; font-family:inherit; }
.self-label { display:block; margin:4rpx 0 32rpx; color:#a18e71; font-size:21rpx; }
.result-row { display:flex; justify-content:space-between; gap:20rpx; padding:24rpx 0; border-bottom:1rpx solid #e1e7d8; color:#728568; font-size:26rpx; }
.result-status { color:#a08f74; font-size:23rpx; }
.result-links { display:flex; flex-wrap:wrap; gap:0 30rpx; margin-top:12rpx; }
.result-links button { display:flex; align-items:center; gap:10rpx; min-height:88rpx; font-size:23rpx; color:#809470; }
.unavailable { display:flex; align-items:center; flex-direction:column; gap:20rpx; padding:110rpx 32rpx; font-size:30rpx; color:#819574; }
.unavailable button { color:#58754c; font-size:25rpx; min-height:88rpx; }
.history-layer { position:fixed; inset:0; z-index:120; }
.scrim { position:absolute; inset:0; background:rgba(38,51,40,.24); }
.history-sheet { position:absolute; bottom:0; left:0; right:0; padding:32rpx 36rpx max(36rpx,env(safe-area-inset-bottom)); border-radius:32rpx 32rpx 0 0; background:#fdfcf8; }
.history-heading { display:flex; align-items:center; justify-content:space-between; font-size:30rpx; color:#4b6344; }
.history-heading button { display:flex; align-items:center; justify-content:center; width:80rpx; height:80rpx; }
.history-list { max-height:50vh; }
.history-list button { display:flex; justify-content:space-between; gap:20rpx; padding:28rpx 0; border-top:1rpx solid #e3e9da; color:#718967; font-size:25rpx; text-align:left; }
.history-list button text:last-child { color:#a4ad98; font-size:22rpx; }
</style>
