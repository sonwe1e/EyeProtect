export const formatClock = (timestamp: number): string => {
  if (!timestamp) {
    return '--:--';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp));
};

export const minutesLeft = (timestamp: number, now: number): string => {
  const diff = Math.max(0, timestamp - now);
  return `${Math.ceil(diff / 60_000)} 分钟`;
};
