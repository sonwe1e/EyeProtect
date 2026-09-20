import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { PetCharacter } from '../features/pet/PetCharacter';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useSettings } from '../hooks/useSettings';

const REACTION_MS = 1_100;

export default function PetView(): JSX.Element {
  const reminderStatus = useReminderStatus();
  const { settings } = useSettings();
  const animal = settings.petAppearance;

  useLayoutEffect(() => {
    const svg = document.querySelector<SVGSVGElement>('.pet-character svg');
    if (!svg) return;
    const box = svg.getBBox();
    const viewBox = svg.viewBox.baseVal;
    if (!viewBox.height) return;
    void window.eyeProtect.reportPetArtworkBounds({
      top: Math.max(0, (box.y - viewBox.y) / viewBox.height),
      bottom: Math.min(1, (box.y + box.height - viewBox.y) / viewBox.height)
    });
  }, [animal]);

  const dragRef = useRef<{
    pointerId: number;
    screenX: number;
    screenY: number;
    windowX: number;
    windowY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const reactionTimer = useRef<number | null>(null);
  const [reacting, setReacting] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handlePetDoubleClick = useCallback(() => {
    const active = reminderStatus.activeReminder;
    if (active?.mode === 'gentle') {
      void window.eyeProtect.reminderAction('complete', active.id);
      return;
    }
    void window.eyeProtect.openWorkbench('today');
  }, [reminderStatus.activeReminder]);

  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    void window.eyeProtect.showPetContextMenu();
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Capture before the pointer moves. A small transparent always-on-top
    // window can otherwise lose a fast pointer before the drag threshold is
    // crossed, especially at non-100% Windows display scaling.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      windowX: window.screenX,
      windowY: window.screenY,
      moved: false
    };
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.screenX - drag.screenX;
    const dy = event.screenY - drag.screenY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    setDragging(true);
    void window.eyeProtect.movePetWindow({ x: drag.windowX + dx, y: drag.windowY + dy });
  }, []);

  const handlePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) suppressClickUntilRef.current = Date.now() + 400;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const compactPet = settings.petScale < 0.7;

  // Pointer capture on the drag surface retargets the synthesized `click`
  // event to the surface itself, so it never reaches the PetCharacter child.
  // The reaction trigger therefore lives here, on the capturing element, and
  // only fires on a genuine single click (detail === 1), never after a drag.
  const handleReact = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.detail !== 1) return;
    setReacting(true);
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = window.setTimeout(() => setReacting(false), REACTION_MS);
  }, []);

  return (
    <main className={`pet-shell ${compactPet ? 'pet-compact' : ''}`.trim()} onContextMenu={handleContextMenu}>
      <div className="character-stage">
        <div
          className={`pet-drag-surface ${dragging ? 'is-dragging' : ''}`.trim()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
          onClick={(event) => {
            // A drag synthesizes a click on release; suppress it so releasing
            // a drag does not also trigger an interaction. Pointer capture
            // retargets the click to this surface, so the handler lives here
            // rather than on the PetCharacter child.
            if (Date.now() <= suppressClickUntilRef.current) return;
            handleReact(event);
          }}
          onDoubleClick={handlePetDoubleClick}
        >
          <PetCharacter
            animal={animal}
            reacting={reacting}
            motion={settings.petMotion}
            doubleClickHint={
              reminderStatus.activeReminder?.mode === 'gentle'
                ? '双击完成当前休息'
                : '双击打开工作台'
            }
          />
        </div>
        <div className="pet-drag-handle" aria-hidden="true" title="按住拖动桌宠" />
      </div>
    </main>
  );
}
