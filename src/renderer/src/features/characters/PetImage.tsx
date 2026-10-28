import { useEffect, useRef, useState } from 'react';

/**
 * GIFs ignore CSS animation controls. Unmount the image and snapshot it when
 * motion is disabled, reduced, or the window is hidden.
 */
export function PetImage({ src, label, motion = true }: { src: string; label: string; motion?: boolean }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [allowed, setAllowed] = useState(() => motion && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [failed, setFailed] = useState(false);
  const playing = motion && allowed;
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setAllowed(motion && !document.hidden && !reduced.matches);
    sync();
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      reduced.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [motion]);
  useEffect(() => {
    setFailed(false);
    if (playing) return;
    let disposed = false;
    const image = new Image();
    image.onload = () => {
      const target = canvas.current;
      if (disposed || !target) return;
      target.width = image.naturalWidth;
      target.height = image.naturalHeight;
      target.getContext('2d')?.drawImage(image, 0, 0);
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };
    image.onerror = () => { if (!disposed) setFailed(true); };
    image.src = src;
    return () => { disposed = true; image.onload = null; image.onerror = null; };
  }, [src, playing]);
  if (failed) return <span role="img" aria-label={`${label}，图片无法加载`}>图片无法加载</span>;
  return playing
    ? <img className="pet-image" src={src} alt={label} draggable={false} onError={() => setFailed(true)} />
    : <canvas className="pet-image" ref={canvas} role="img" aria-label={label} />;
}
