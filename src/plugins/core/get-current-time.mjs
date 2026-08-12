// ── get_current_time plugin ──
// 提供當前日期與時間給 LLM。LLM 沒有時鐘，這是唯一可靠的日期來源。
// 解決「LLM 不知道今天日期」的問題：需要日期/時間/星期/時區時呼叫此工具。

export default {
  name: 'get_current_time',
  responsePolicy: { maxLevel: 0 },

  description: `Get the current date and time (today's date, weekday, time, timezone).
LLMs have no built-in clock — use this tool whenever you need to know today's date,
the current time, weekday, timezone, or when the user asks about dates, times,
schedules, deadlines, holidays, or anything time-sensitive.`,
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description:
          'IANA timezone name (e.g. "Asia/Taipei", "America/New_York"). Default: local system timezone.',
      },
      format: {
        type: 'string',
        enum: ['full', 'date', 'iso'],
        description:
          'Output format: "full" = date + weekday + time (default), "date" = YYYY-MM-DD only, "iso" = ISO 8601 timestamp.',
      },
    },
  },

  handler: async (args = {}) => {
    const tz = String(args.timezone || '') || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const format = String(args.format || 'full').toLowerCase();
    const now = new Date();

    try {
      if (format === 'iso') {
        return now.toISOString();
      }

      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(now);

      const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';

      const y = get('year');
      const mo = get('month');
      const d = get('day');
      const wd = get('weekday');
      const h = get('hour');
      const mi = get('minute');
      const s = get('second');

      if (format === 'date') {
        return `${y}-${mo}-${d}`;
      }

      return [
        `Today is ${y}-${mo}-${d} (${wd}).`,
        `Current time: ${h}:${mi}:${s}`,
        `Timezone: ${tz}`,
        `ISO 8601: ${now.toISOString()}`,
      ].join('\n');
    } catch (e) {
      return `Invalid timezone "${tz}". Error: ${e.message}`;
    }
  },
};
