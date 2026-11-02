import type { ConversationSummary } from '@/api/conversations';

/** 依据设备本地日历分组，昨天跨月/跨年及夏令时切换时仍按日历计算。 */
export function groupHistory(items: ConversationSummary[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const groups: Array<{ label: string; items: ConversationSummary[] }> = [];
  for (const item of items) {
    const time = new Date(item.lastActiveAt).getTime();
    const label = time >= today ? '今天' : time >= yesterday ? '昨天' : '更早';
    let group = groups.find((entry) => entry.label === label);
    if (!group) { group = { label, items: [] }; groups.push(group); }
    group.items.push(item);
  }
  return groups;
}

export function activityTime(value: string): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
