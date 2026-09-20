import { useLayoutEffect, useState } from 'react';

/** Observe natural card content, never the window-sized shell (avoids feedback). */
export const useBubbleLayout = (surface: string): void => {
  const [layout, setLayout] = useState({ placement: 'above', tailX: 124 });
  useLayoutEffect(() => window.eyeProtect.onBubbleLayout(setLayout), []);
  useLayoutEffect(() => {
    document.documentElement.dataset.bubblePlacement = layout.placement;
    document.documentElement.style.setProperty('--bubble-tail-x', `${layout.tailX}px`);
  }, [layout]);
  useLayoutEffect(() => {
    const card = document.querySelector('.bubble-card');
    if (!card) return;
    let previous = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(card.getBoundingClientRect().height) + 20;
      if (height === previous) return;
      previous = height;
      void window.eyeProtect.reportBubbleHeight(height);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [surface]);
};
