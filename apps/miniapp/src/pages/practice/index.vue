<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import LumaIcon from '@/components/LumaIcon.vue';
import StudyText from '@/components/StudyText.vue';
import { usePracticeStore } from '@/stores/practice';
import type { SelfEval } from '@luma/shared';

const study = usePracticeStore();
const pageHeight = uni.getSystemInfoSync().windowHeight;
const keyboard = ref(0), scrollTop = ref(0), reviewTarget = ref(''), fullReview = ref(false);
let artifactId = '', attemptId: string | undefined, loaded = false;
const draft = computed({ get: () => study.current?.myAnswer?.textDraft ?? '', set: (text: string) => study.edit({ textDraft: text }) });
const difficultyLabel = (value: string) => ({ basic: '基础理解', variant: '同类变式', transfer: '综合应用', review: '复测' }[value] ?? '对点练习');
const ratings: Array<{ value: SelfEval; label: string }> = [{ value: 'independent', label: '独立做对' }, { value: 'partial', label: '部分会' }, { value: 'stuck', label: '还不会' }];
onLoad(async (query) => { artifactId = query?.artifactId ?? ''; attemptId = query?.attemptId; await load(); loaded = true; });
onShow(() => { if (loaded) void run(() => study.resume()); });
onHide(() => { keyboard.value = 0; void study.flush().catch(() => { /* 本机草稿保留，同步状态可重试。 */ }); });
onUnload(() => { void study.flush().catch(() => {}); });
async function load(): Promise<void> { if (!artifactId) { study.error = '缺少练习来源，请从对话中的练习卡进入'; return; } await study.open(artifactId, attemptId); }
async function run(action: () => Promise<unknown>): Promise<void> { try { await action(); } catch (err) { uni.showToast({ title: err instanceof Error ? err.message : '操作未完成，请重试', icon: 'none', duration: 2500 }); } }
function goTop(): void { scrollTop.value = scrollTop.value === 0 ? 1 : 0; }
async function back(): Promise<void> {
  try { await study.flush(); } catch { uni.showToast({ title: '草稿未同步，请先重试保存', icon: 'none' }); return; }
  if (getCurrentPages().length > 1) uni.navigateBack(); else if (study.material) uni.redirectTo({ url: `/pages/chat/index?id=${encodeURIComponent(study.material.conversationId)}&topic=${encodeURIComponent(study.material.subjectId)}` }); else uni.switchTab({ url: '/pages/home/index' });
}
async function jump(index: number): Promise<void> { await run(async () => { await study.jump(index); goTop(); }); }
function submit(): void {
  const send = () => void run(async () => { await study.submit(); goTop(); });
  if (study.answered < study.exercises.length) uni.showModal({ title: '还有未作答的题', content: '可以回去补充，也可以按未完成提交，接下来对照解析自评。', confirmText: '仍然提交', cancelText: '继续作答', confirmColor: '#4f6652', success: (res) => { if (res.confirm) send(); } });
  else send();
}
function finish(): void {
  const missing = study.attempt?.exercises.find((ex) => !ex.myAnswer?.selfEval);
  if (missing) { reviewTarget.value = ''; setTimeout(() => { reviewTarget.value = `review-${missing.id}`; }, 0); uni.showToast({ title: '请为每一道题选择自评结果', icon: 'none' }); return; }
  void run(async () => { await study.complete(); goTop(); });
}
async function ask(id: string, hint = false): Promise<void> {
  await run(async () => {
    await study.flush();
    const doc = study.material, attempt = study.attempt;
    if (!doc || !attempt) return;
    await study.jump(attempt.exercises.findIndex((ex) => ex.id === id));
    const question = hint ? '这道题我没思路，请给我一点方向提示。' : study.stage === 'doing' ? '这道题我卡住了，请结合我的作答引导我检查。' : '这道题的解析我还没理解，请结合我的作答讲讲。';
    uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(doc.conversationId)}&topic=${encodeURIComponent(doc.subjectId)}&artifactId=${encodeURIComponent(doc.id)}&artifactVersion=${doc.version}&attemptId=${encodeURIComponent(attempt.id)}&exerciseId=${encodeURIComponent(id)}&question=${encodeURIComponent(question)}` });
  });
}
</script>

<template>
  <view class="practice-page" :style="{ height: Math.max(260, pageHeight - keyboard) + 'px' }">
    <view class="page-header"><button @tap="back"><LumaIcon name="chevron-left" :size="18" /><text>返回学习</text></button><text>配套练习</text><text class="header-space" /></view>
    <view v-if="study.loading" class="unavailable"><text>正在打开练习…</text></view>
    <view v-else-if="study.error" class="unavailable"><text>{{ study.error }}</text><button @tap="load">重新加载</button></view>
    <template v-else-if="study.material">
      <view v-if="study.saveError" class="save-warning"><text>{{ study.saveError }}</text><button v-if="study.hasConflict" @tap="study.recoverDraft()">恢复本机草稿</button><button v-else @tap="run(() => study.flush())">重试同步</button></view>
      <scroll-view class="content-scroll" scroll-y :scroll-top="scrollTop" :scroll-into-view="reviewTarget">
        <view class="sheet">
          <template v-if="study.stage === 'intro'">
            <text class="eyebrow">PRACTICE</text><text class="page-title">试着自己走一遍。</text><text class="intro">{{ study.exercises.length }} 道同知识点练习，先独立尝试，再对照解析自评。</text>
            <view class="route"><text class="route-active">独立尝试</text><text>对照解析</text><text>回顾巩固</text></view>
            <view v-for="(exercise, i) in study.exercises" :key="exercise.id" class="task-row"><text class="number">{{ String(i + 1).padStart(2, '0') }}</text><view><text class="task-title">{{ exercise.topic }}</text><text class="muted">{{ difficultyLabel(exercise.difficulty) }} · {{ exercise.purpose }}</text></view></view>
            <text class="footnote">作答会自动保存，暂时不会也可以先记下来。</text>
          </template>
          <template v-else-if="study.stage === 'doing' && study.current">
            <view class="progress"><text>第 {{ study.index + 1 }} / {{ study.exercises.length }} 题</text><text>{{ study.answered }} 题已有记录</text></view>
            <view class="progress-line"><view :style="{ width: (study.index + 1) / study.exercises.length * 100 + '%' }" /></view>
            <view class="question-nav"><button v-for="(ex, i) in study.exercises" :key="ex.id" :disabled="study.busy" :class="{ active: study.index === i, recorded: study.attempt?.exercises[i]?.myAnswer?.textDraft || study.attempt?.exercises[i]?.myAnswer?.markedUnknown }" :aria-label="`跳到第 ${i + 1} 题`" @tap="jump(i)">{{ i + 1 }}</button></view>
            <text class="eyebrow">{{ study.current.topic }} · {{ difficultyLabel(study.current.difficulty) }}</text><view class="exercise-stem"><StudyText :text="study.current.stem" /></view><text class="purpose">{{ study.current.purpose }}</text>
            <view class="answer-heading"><text>我的思路与答案</text><text class="saved">{{ study.saving ? '正在保存…' : study.dirty.length ? '待同步' : '已保存' }}</text></view>
            <textarea :key="study.current.id" v-model="draft" :disabled="study.busy" class="draft" :maxlength="8000" placeholder="写下第一步，或试着完整推一遍…" :adjust-position="false" :show-confirm-bar="false" @keyboardheightchange="keyboard = $event.detail.height" />
            <view class="answer-tools"><button :disabled="study.busy" @tap="ask(study.current!.id, true)">给我一点提示</button><button :disabled="study.busy" class="ask-link" @tap="ask(study.current!.id)">围绕这题追问<LumaIcon name="arrow-diagonal" :size="12" /></button></view>
            <button class="unknown" :disabled="study.busy" :class="{ marked: study.current.myAnswer?.markedUnknown }" @tap="study.edit({ markedUnknown: !study.current?.myAnswer?.markedUnknown })"><text class="check">{{ study.current.myAnswer?.markedUnknown ? '✓' : '' }}</text><text>这题暂时不会，先记下来</text></button>
          </template>
          <template v-else-if="study.stage === 'review' || fullReview">
            <text class="eyebrow">{{ fullReview ? 'MY PRACTICE' : 'SELF REVIEW' }}</text><text class="page-title">对照过程，再判断。</text><text class="intro">{{ fullReview ? '本轮已完成，作答和自评只读保留。' : '参考解析已经展开，请按自己的实际过程自评。' }}</text>
            <view v-for="(exercise, i) in study.attempt?.exercises" :id="`review-${exercise.id}`" :key="exercise.id" class="review-section">
              <text class="task-title">{{ String(i + 1).padStart(2, '0') }} · {{ exercise.topic }}</text><view class="review-stem"><StudyText :text="exercise.stem" /></view>
              <view class="my-answer"><text class="small-label">我的作答</text><StudyText :text="exercise.myAnswer?.textDraft || (exercise.myAnswer?.markedUnknown ? '暂时不会，待讲解' : '未填写作答')" /></view>
              <view class="reference"><text class="small-label">参考答案与解析</text><StudyText :text="exercise.answer ?? ''" /><StudyText :text="exercise.analysis ?? ''" /></view>
              <text v-if="exercise.myAnswer?.hintsUsed || exercise.myAnswer?.solutionViewedAt" class="help-note">本题曾请求{{ exercise.myAnswer?.solutionViewedAt ? '解析' : '提示' }}，请结合实际过程自评。</text>
              <view class="rating-row"><button v-for="rating in ratings" :key="rating.value" :disabled="study.busy || study.stage === 'summary'" :class="{ selected: exercise.myAnswer?.selfEval === rating.value }" @tap="study.rate(exercise.id, rating.value)"><text class="rating-dot">{{ exercise.myAnswer?.selfEval === rating.value ? '●' : '○' }}</text>{{ rating.label }}</button></view>
              <button class="ask-link" :disabled="study.busy" @tap="ask(exercise.id)">没看懂解析？围绕这题问问<LumaIcon name="arrow-diagonal" :size="12" /></button>
            </view>
          </template>
          <template v-else-if="study.stage === 'summary'">
            <text class="eyebrow">REFLECTION</text><text class="page-title">这一次，哪里更清楚了？</text>
            <view class="result"><text>{{ study.independent }}</text><text class="result-total"> / {{ study.exercises.length }} 题独立做对</text></view><text class="self-label">根据你的自评记录</text>
            <view v-for="(exercise, i) in study.attempt?.exercises" :key="exercise.id" class="result-row"><text>{{ String(i + 1).padStart(2, '0') }} · {{ exercise.topic }}</text><text class="result-status">{{ ratings.find((r) => r.value === exercise.myAnswer?.selfEval)?.label }}</text></view>
            <view class="hint"><text class="hint-label">下一步建议</text><text>{{ study.needsPractice.length ? '先回顾还没理解的步骤，再试着独立推一遍。' : '本轮完成了，可以回到对话继续探索。' }}</text></view>
            <text v-if="study.usedHelp" class="help-note">本轮有借助提示或解析的记录，已保留在对应题目中。</text>
            <view class="result-links"><button @tap="fullReview = true; goTop()">查看本轮完整作答</button><button v-if="study.needsPractice.length" @tap="ask(study.needsPractice[0]!.id)">追问不会的题<LumaIcon name="arrow-diagonal" :size="12" /></button></view>
            <text class="footnote">这是本轮自评，不代表考试得分率或知识点掌握率。</text>
          </template>
        </view>
      </scroll-view>
      <view class="action-dock">
        <template v-if="study.stage === 'intro'"><text class="dock-note">先给自己一点思考时间</text><button class="primary" :disabled="study.busy" @tap="study.start()"><text>{{ study.busy ? '正在开始…' : '开始作答' }}</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
        <template v-else-if="study.stage === 'doing'"><button v-if="study.index" class="secondary" :disabled="study.busy" @tap="jump(study.index - 1)">上一题</button><text v-else class="dock-note">作答自动保存</text><button class="primary" :disabled="study.busy" @tap="study.index < study.exercises.length - 1 ? jump(study.index + 1) : submit()"><text>{{ study.busy ? '正在保存…' : study.index < study.exercises.length - 1 ? '下一题' : '提交并自评' }}</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
        <template v-else-if="study.stage === 'review'"><text class="dock-note">{{ study.rated }} / {{ study.exercises.length }} 题已自评</text><button class="primary" :disabled="study.busy" @tap="finish"><text>{{ study.busy ? '正在保存…' : '完成自评' }}</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
        <template v-else-if="fullReview"><text class="dock-note">本轮记录 · 只读</text><button class="primary" @tap="fullReview = false; goTop()">返回反馈</button></template>
        <template v-else><text class="dock-note">本轮已完成</text><button class="primary" @tap="back"><text>返回继续学习</text><LumaIcon name="arrow-diagonal" :size="14" /></button></template>
      </view>
    </template>
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
.save-warning { display:flex; align-items:center; gap:20rpx; padding:16rpx 30rpx; background:#f4eee5; color:#a08464; font-size:22rpx; line-height:1.7; }
.save-warning text { flex:1; }
.save-warning button { flex-shrink:0; color:#667e58; font-size:22rpx; }
.help-note { display:block; margin-top:18rpx; color:#a08d70; font-size:21rpx; line-height:1.8; }
.practice-page button[disabled] { opacity:.5; }
</style>
