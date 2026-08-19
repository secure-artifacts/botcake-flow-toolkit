import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

type Position = { x: number; y: number };
type Size = { width: number; height: number };

export function usePersistentPosition(storageKey: string, size: Size, initial: () => Position) {
  const [position, setPosition] = useState(() => clampPosition(initial(), size));
  const positionRef = useRef(position);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Position; moved: boolean } | undefined>(undefined);
  const suppressClickRef = useRef(false);

  useEffect(() => { positionRef.current = position; }, [position]);

  useEffect(() => {
    void chrome.storage.local.get(storageKey).then((result) => {
      const saved = result[storageKey];
      if (!isPosition(saved)) return;
      const next = clampPosition(saved, size);
      positionRef.current = next;
      setPosition(next);
    });
    const onResize = () => {
      const next = clampPosition(positionRef.current, size);
      positionRef.current = next;
      setPosition(next);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [storageKey, size.width, size.height]);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const interactive = event.target instanceof Element ? event.target.closest("button, input, textarea, select, a, label") : null;
    if (interactive && interactive !== event.currentTarget) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: positionRef.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const next = clampPosition({ x: drag.origin.x + dx, y: drag.origin.y + dy }, size);
    positionRef.current = next;
    setPosition(next);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) void chrome.storage.local.set({ [storageKey]: positionRef.current });
  }

  function consumeSuppressedClick() {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }

  const style: CSSProperties = { left: position.x, top: position.y, right: "auto", bottom: "auto" };
  return { style, dragProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }, consumeSuppressedClick };
}

function clampPosition(position: Position, size: Size): Position {
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(position.x, Math.max(margin, window.innerWidth - size.width - margin))),
    y: Math.max(margin, Math.min(position.y, Math.max(margin, window.innerHeight - size.height - margin))),
  };
}

function isPosition(value: unknown): value is Position {
  return Boolean(value && typeof value === "object" && Number.isFinite((value as Position).x) && Number.isFinite((value as Position).y));
}
