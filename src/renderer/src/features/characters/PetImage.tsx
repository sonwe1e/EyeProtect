import { useEffect, useRef, useState } from 'react';

/**
 * Custom 奋斗猫 GIFs keep looping; `petMotion` only gates fidget/click switches
 * in PetCharacter. GIFs still ignore CSS reduced-motion, so snapshot then.
 */
export function PetImage({ src, label, motion = true }: { src: string; label: string; motion?: boolean }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [allowed, setAllowed] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setAllowed(!reduced.matches);
    sync();
    reduced.addEventListener('change', sync);
    return () => {
      reduced.removeEventListener('change', sync);
    };
  }, [motion]);
  useEffect(() => {
    setFailed(false);
    if (allowed) return;
    let disposed = false;
    const image = new Image();
    image.onload = () => {
      const target = canvas.current;
      if (disposed || !target) return;
      target.width = image.naturalWidth;
      target.height = image.naturalHeight;
      target.getContext('2d')?.drawImage(image, 0, 0);
    };
    image.onerror = () => { if (!disposed) setFailed(true); };
    image.src = src;
    return () => { disposed = true; image.onload = null; image.onerror = null; };
  }, [src, allowed]);
  if (failed) return <span role="img" aria-label={`${label}，图片无法加载`}>图片无法加载</span>;
  return allowed
    ? <img className="pet-image" src={src} alt={label} draggable={false} onError={() => setFailed(true)} />
    : <canvas className="pet-image" ref={canvas} role="img" aria-label={label} />;
}
